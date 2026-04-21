/**
 * ChildProcessManager — manages one child process per project.
 *
 * Spawns a project-worker.js child via fork(), handles IPC communication,
 * provides the UNIX socket path for HTTP proxying, and implements crash
 * recovery with exponential backoff.
 */

import { fork, type ChildProcess } from 'node:child_process';
import { existsSync, unlinkSync } from 'node:fs';
import { resolve } from 'node:path';
import type { ParentMessage, ChildMessage, SerializableConfig } from './ipc-types.js';

export interface ChildProcessManagerOptions {
  config: SerializableConfig;
  workerPath: string;
  onWsSend: (connectionId: string, data: string) => void;
  onWsBroadcast: (projectId: string, data: string) => void;
  onConnectionChange: (delta: number) => void;
  onExecHold: () => void;
  onExecRelease: () => void;
  onReady: () => void;
  onError: (message: string, fatal?: boolean) => void;
  onExit: (code: number | null, signal: string | null) => void;
  onLog: (level: 'info' | 'warn' | 'error', message: string) => void;
  /** Called when watchdog detects an unresponsive worker (before force-restart). */
  onUnresponsive?: () => void;
  /** Called when a force-restart is initiated due to unresponsiveness. */
  onForceRestart?: () => void;
  /** Called when a dead-state cooldown elapses and respawn is re-enabled. */
  onDeadCooldown?: () => void;
}

/** Crashes within this window count toward the crash budget. */
const CRASH_WINDOW_MS = 60_000;
/** After this many consecutive crashes, stop respawning. */
const CRASH_BUDGET = 5;
/** Time in dead state before crash count resets. */
const DEAD_COOLDOWN_MS = 15 * 60_000;
/** Watchdog ping interval. */
const WATCHDOG_INTERVAL_MS = 20_000;
/** Consecutive missed pings before force-restart. */
const WATCHDOG_MISSED_THRESHOLD = 3;

export class ChildProcessManager {
  readonly projectId: string;
  private child: ChildProcess | null = null;
  private state: 'idle' | 'spawning' | 'initializing' | 'ready' | 'dead' = 'idle';
  private readyResolve: (() => void) | null = null;
  private readyReject: ((err: Error) => void) | null = null;
  private socketPath = '';
  private crashCount = 0;
  private lastCrashTime = 0;
  private readonly options: ChildProcessManagerOptions;

  // Watchdog state
  private watchdogTimer: ReturnType<typeof setInterval> | null = null;
  private missedPings = 0;
  private pendingPong = false;

  // Dead cooldown state
  private cooldownTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(options: ChildProcessManagerOptions) {
    this.projectId = options.config.projectId;
    this.options = options;
  }

  get isReady(): boolean { return this.state === 'ready'; }
  get isDead(): boolean { return this.state === 'dead'; }
  getSocketPath(): string { return this.socketPath; }

  /**
   * Spawn the child process and wait for 'ready' IPC message.
   * Returns a promise that resolves when the child is fully initialized.
   */
  async spawn(): Promise<void> {
    if (this.state === 'ready' || this.state === 'initializing') return;

    this.state = 'spawning';
    const workerPath = this.options.workerPath;

    if (!existsSync(workerPath)) {
      throw new Error(`Worker bundle not found: ${workerPath}`);
    }

    // Clean up stale socket from previous crash
    const expectedSocket = `/tmp/am-${this.projectId}.sock`;
    if (existsSync(expectedSocket)) {
      try { unlinkSync(expectedSocket); } catch { /* ignore */ }
    }

    this.child = fork(workerPath, [], {
      serialization: 'json',
      stdio: ['pipe', 'inherit', 'inherit', 'ipc'],
    });

    // Set up IPC message handler
    this.child.on('message', (msg: ChildMessage) => this.handleChildMessage(msg));

    // Set up exit handler for crash recovery
    this.child.on('exit', (code, signal) => {
      console.log(`[child:${this.projectId}] Process exited: code=${code}, signal=${signal}`);
      this.stopWatchdog();
      this.state = 'dead';
      this.child = null;

      // Track crashes for backoff
      const now = Date.now();
      if (now - this.lastCrashTime < CRASH_WINDOW_MS) {
        this.crashCount++;
      } else {
        this.crashCount = 1;
      }
      this.lastCrashTime = now;

      // Schedule dead-state cooldown: if no crashes for DEAD_COOLDOWN_MS, reset count
      this.scheduleDeadCooldown();

      // Clean up socket file so next spawn can bind
      try {
        if (existsSync(this.socketPath)) unlinkSync(this.socketPath);
      } catch { /* ignore */ }

      // Reject pending ready promise if initializing
      if (this.readyReject) {
        this.readyReject(new Error(`Child process exited during initialization: code=${code}`));
        this.readyResolve = null;
        this.readyReject = null;
      }

      this.options.onExit(code, signal);
    });

    this.child.on('error', (err) => {
      console.error(`[child:${this.projectId}] Process error:`, err);
      this.options.onError(err.message, true);
    });

    // Wait for child to be ready
    this.state = 'initializing';
    const readyPromise = new Promise<void>((resolve, reject) => {
      this.readyResolve = resolve;
      this.readyReject = reject;
    });

    // Send initialize message
    this.send({ type: 'initialize', config: this.options.config });

    // Timeout: if child doesn't become ready within 5 minutes, consider it failed
    const timeout = setTimeout(() => {
      if (this.state === 'initializing') {
        this.readyReject?.(new Error('Child process initialization timed out (5 min)'));
        this.readyResolve = null;
        this.readyReject = null;
        this.kill();
      }
    }, 5 * 60 * 1000);

    try {
      await readyPromise;
    } finally {
      clearTimeout(timeout);
    }
  }

  /**
   * Restart a dead child process with exponential backoff.
   * Returns true if respawn was initiated, false if too many crashes.
   */
  async respawn(): Promise<boolean> {
    if (this.crashCount >= CRASH_BUDGET) {
      console.error(`[child:${this.projectId}] Too many crashes (${this.crashCount}), not restarting`);
      this.options.onError(`Project ${this.projectId} crashed too many times, manual intervention needed`, true);
      return false;
    }

    const delay = Math.min(2000 * Math.pow(2, this.crashCount - 1), 30_000);
    console.log(`[child:${this.projectId}] Respawning in ${delay}ms (crash #${this.crashCount})`);
    await new Promise(r => setTimeout(r, delay));

    try {
      await this.spawn();
      return true;
    } catch (err) {
      console.error(`[child:${this.projectId}] Respawn failed:`, err);
      return false;
    }
  }

  // ---- Self-healing ----

  /** Start the watchdog (heartbeat + socket ping). */
  private startWatchdog(): void {
    this.stopWatchdog();
    this.missedPings = 0;
    this.pendingPong = false;
    this.watchdogTimer = setInterval(() => this.watchdogTick(), WATCHDOG_INTERVAL_MS);
  }

  private stopWatchdog(): void {
    if (this.watchdogTimer) {
      clearInterval(this.watchdogTimer);
      this.watchdogTimer = null;
    }
  }

  /** One watchdog tick: ping if pending pong, count missed, force-restart if threshold. */
  private watchdogTick(): void {
    if (this.state !== 'ready' || !this.child?.connected) return;

    if (this.pendingPong) {
      this.missedPings++;
      console.warn(`[child:${this.projectId}] Watchdog: missed pong (${this.missedPings}/${WATCHDOG_MISSED_THRESHOLD})`);
      if (this.missedPings >= WATCHDOG_MISSED_THRESHOLD) {
        this.options.onUnresponsive?.();
        this.options.onForceRestart?.();
        console.error(`[child:${this.projectId}] Worker unresponsive — force-restarting`);
        this.kill(); // triggers exit handler → respawn path
        return;
      }
    }
    this.pendingPong = true;
    try { this.send({ type: 'heartbeat-ping' }); } catch { /* connection closing */ }
  }

  /** Schedule the dead-cooldown timer. If the child stays dead for DEAD_COOLDOWN_MS with no new
   *  crashes, reset crashCount so future respawns aren't gated. */
  private scheduleDeadCooldown(): void {
    if (this.cooldownTimer) clearTimeout(this.cooldownTimer);
    this.cooldownTimer = setTimeout(() => {
      if (this.crashCount > 0) {
        console.log(`[child:${this.projectId}] Dead cooldown elapsed — resetting crash count`);
        this.crashCount = 0;
        this.options.onDeadCooldown?.();
      }
    }, DEAD_COOLDOWN_MS);
  }

  // ---- IPC send methods ----

  sendWsConnect(connectionId: string): void {
    this.send({ type: 'ws-connect', connectionId });
  }

  sendWsMessage(connectionId: string, data: string): void {
    this.send({ type: 'ws-message', connectionId, data });
  }

  sendWsDisconnect(connectionId: string): void {
    this.send({ type: 'ws-disconnect', connectionId });
  }

  /** Push an application event into the worker's workflow engine (ingress). */
  sendIngressEvent(event: Record<string, unknown>): void {
    this.send({ type: 'ingress-event', event });
  }

  async shutdown(): Promise<void> {
    if (!this.child) return;
    this.send({ type: 'shutdown' });

    // Wait up to 10 seconds for graceful exit
    await new Promise<void>((resolve) => {
      const timeout = setTimeout(() => {
        this.kill();
        resolve();
      }, 10_000);

      this.child?.on('exit', () => {
        clearTimeout(timeout);
        resolve();
      });
    });
  }

  kill(): void {
    this.stopWatchdog();
    if (this.child) {
      try { this.child.kill('SIGKILL'); } catch { /* ignore */ }
      this.child = null;
      this.state = 'dead';
    }
  }

  // ---- Private ----

  private send(msg: ParentMessage): void {
    if (this.child?.connected) {
      this.child.send(msg);
    }
  }

  private handleChildMessage(msg: ChildMessage): void {
    switch (msg.type) {
      case 'ready':
        this.socketPath = msg.socketPath;
        this.state = 'ready';
        this.crashCount = 0; // Reset on successful start
        console.log(`[child:${this.projectId}] Ready, socket: ${this.socketPath}`);
        this.readyResolve?.();
        this.readyResolve = null;
        this.readyReject = null;
        this.options.onReady();
        this.startWatchdog();
        break;

      case 'heartbeat-pong':
        this.pendingPong = false;
        this.missedPings = 0;
        break;

      case 'ws-send':
        this.options.onWsSend(msg.connectionId, msg.data);
        break;

      case 'ws-broadcast':
        this.options.onWsBroadcast(this.projectId, msg.data);
        break;

      case 'connection-change':
        this.options.onConnectionChange(msg.delta);
        break;

      case 'exec-hold':
        this.options.onExecHold();
        break;

      case 'exec-release':
        this.options.onExecRelease();
        break;

      case 'error':
        console.error(`[child:${this.projectId}] Error: ${msg.message}`);
        this.options.onError(msg.message, msg.fatal);
        break;

      case 'log':
        this.options.onLog(msg.level, msg.message);
        break;
    }
  }
}
