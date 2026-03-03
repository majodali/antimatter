/**
 * PTY Manager — shared pseudo-terminal for all WebSocket connections.
 *
 * A single bash shell is spawned per project container. All connected
 * browser tabs and agents share this shell and see the same output.
 * A ring buffer stores recent output so new connections can replay.
 */

import * as pty from 'node-pty';
import { existsSync, mkdirSync } from 'node:fs';

const MAX_REPLAY_BYTES = 50 * 1024; // 50KB replay buffer

export class PtyManager {
  private shell: pty.IPty | null = null;
  private replayBuffer = '';
  private listeners = new Set<(data: string) => void>();

  get isRunning(): boolean {
    return this.shell !== null;
  }

  /**
   * Spawn a bash shell in the given working directory.
   */
  start(cwd: string): void {
    if (this.shell) {
      console.warn('[pty] Shell already running');
      return;
    }

    // Ensure the working directory exists
    if (!existsSync(cwd)) {
      mkdirSync(cwd, { recursive: true });
    }

    console.log(`[pty] Starting bash shell in ${cwd}`);

    this.shell = pty.spawn('bash', [], {
      name: 'xterm-256color',
      cols: 120,
      rows: 30,
      cwd,
      env: {
        ...process.env,
        TERM: 'xterm-256color',
        HOME: process.env.HOME || '/workspace',
        LANG: 'en_US.UTF-8',
      } as Record<string, string>,
    });

    this.shell.onData((data) => {
      // Append to replay buffer (ring buffer behavior)
      this.replayBuffer += data;
      if (this.replayBuffer.length > MAX_REPLAY_BYTES) {
        // Keep the last MAX_REPLAY_BYTES
        this.replayBuffer = this.replayBuffer.slice(-MAX_REPLAY_BYTES);
      }

      // Notify all listeners
      for (const cb of this.listeners) {
        try {
          cb(data);
        } catch {
          // Don't let one listener's error affect others
        }
      }
    });

    this.shell.onExit(({ exitCode, signal }) => {
      console.log(`[pty] Shell exited: code=${exitCode}, signal=${signal}`);
      this.shell = null;

      // Restart the shell after a brief delay
      setTimeout(() => {
        if (!this.shell) {
          console.log('[pty] Restarting shell...');
          this.start(cwd);
        }
      }, 1000);
    });
  }

  /**
   * Write data to the PTY (user input from the terminal).
   */
  write(data: string): void {
    if (this.shell) {
      this.shell.write(data);
    }
  }

  /**
   * Resize the PTY dimensions.
   */
  resize(cols: number, rows: number): void {
    if (this.shell) {
      try {
        this.shell.resize(cols, rows);
      } catch {
        // Ignore resize errors (can happen if shell just exited)
      }
    }
  }

  /**
   * Subscribe to PTY output. Returns an unsubscribe function.
   */
  onData(cb: (data: string) => void): () => void {
    this.listeners.add(cb);
    return () => this.listeners.delete(cb);
  }

  /**
   * Get the replay buffer for sending to newly connected clients.
   */
  getReplayBuffer(): string {
    return this.replayBuffer;
  }

  /**
   * Dispose the PTY and clean up.
   */
  dispose(): void {
    if (this.shell) {
      this.shell.kill();
      this.shell = null;
    }
    this.listeners.clear();
    this.replayBuffer = '';
  }
}
