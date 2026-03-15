/**
 * WorkspaceConnection — global singleton managing the WebSocket connection
 * to the EC2 workspace server.
 *
 * State machine: DISCONNECTED → PENDING → CONNECTED → (DISCONNECTED on close)
 *                                                   → PENDING (auto-reconnect)
 *
 * Consumers subscribe to messages by type instead of a monolithic switch.
 * Tests can await `waitForState('CONNECTED')` to block until the workspace is ready.
 *
 * This replaces the WebSocket lifecycle code that was previously embedded in terminalStore.
 */

import {
  startWorkspace,
  getWorkspaceStatus,
  getWorkspaceWsUrl,
  setActiveWorkspace,
  clearActiveWorkspace,
} from './api.js';
import { eventLog } from './eventLog.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type WsConnectionState = 'CONNECTED' | 'DISCONNECTED' | 'PENDING';

export type MessageHandler = (msg: any) => void;
export type StateChangeHandler = (state: WsConnectionState) => void;
export type RawDataHandler = (data: string) => void;

interface MessageSubscription {
  handler: MessageHandler;
  type?: string;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const MAX_RECONNECT_ATTEMPTS = 15;
const RECONNECT_DELAYS = [1000, 2000, 3000, 5000, 5000, 10000, 10000, 15000, 15000, 20000, 20000, 30000, 30000, 30000, 30000];
const KEEPALIVE_INTERVAL_MS = 15_000;
const PONG_TIMEOUT_MS = 45_000;

// ---------------------------------------------------------------------------
// WorkspaceConnection class
// ---------------------------------------------------------------------------

class WorkspaceConnection {
  state: WsConnectionState = 'DISCONNECTED';
  projectId: string | null = null;
  sessionToken: string | null = null;
  instanceId: string | null = null;

  private ws: WebSocket | null = null;
  private messageSubscriptions = new Set<MessageSubscription>();
  private stateChangeHandlers = new Set<StateChangeHandler>();
  private rawDataHandlers = new Set<RawDataHandler>();

  // Reconnect state
  private reconnectAttempt = 0;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private intentionalDisconnect = false;

  // Keepalive state
  private keepaliveTimer: ReturnType<typeof setInterval> | null = null;
  private lastPongTime = 0;

  // ---- Public API ----

  /**
   * Connect to a workspace: start EC2 instance, poll until running,
   * activate workspace-aware API routing, open WebSocket.
   */
  async connect(projectId: string): Promise<void> {
    // Already connected to this project
    if (this.state === 'CONNECTED' && this.projectId === projectId) {
      return;
    }

    // Clean up any existing connection
    this.cleanupConnection();

    this.projectId = projectId;
    this.sessionToken = null;
    this.instanceId = null;
    this.intentionalDisconnect = false;
    this.setState('PENDING');

    // 1. Start the EC2 instance (or get existing)
    const info = await startWorkspace(projectId);
    this.sessionToken = info.sessionToken;
    this.instanceId = info.instanceId;

    // 2. Poll until RUNNING
    if (info.status !== 'RUNNING') {
      let attempts = 0;
      const maxAttempts = 180;
      let status = info.status;

      while (status !== 'RUNNING' && attempts < maxAttempts) {
        await new Promise((r) => setTimeout(r, 1000));
        attempts++;

        try {
          const statusInfo = await getWorkspaceStatus(projectId);
          status = statusInfo.status;
          if (statusInfo.sessionToken) {
            this.sessionToken = statusInfo.sessionToken;
          }
        } catch {
          // Ignore transient errors during polling
        }
      }

      if (status !== 'RUNNING') {
        this.setState('DISCONNECTED');
        throw new Error(`Instance failed to start (last status: ${status})`);
      }
    }

    // 3. Open WebSocket
    await this.openWebSocket(projectId, this.sessionToken!);

    // 4. Activate workspace-aware API routing — only after the WebSocket is
    //    confirmed open.  This ensures file/API calls fall back to Lambda if
    //    the workspace isn't actually reachable (e.g. ALB rule not propagated).
    setActiveWorkspace(projectId);
  }

  /**
   * Disconnect from the current workspace.
   * Does NOT stop the EC2 instance — it will auto-shutdown after idle timeout.
   */
  disconnect(): void {
    this.intentionalDisconnect = true;
    this.cleanupConnection();

    if (this.projectId) {
      clearActiveWorkspace(this.projectId);
    }

    this.setState('DISCONNECTED');
  }

  /**
   * Send a typed message over the WebSocket.
   */
  send(msg: Record<string, unknown>): void {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(msg));
    }
  }

  /** Get the underlying WebSocket (for legacy compatibility). */
  getWebSocket(): WebSocket | null {
    return this.ws;
  }

  /**
   * Subscribe to incoming messages, optionally filtered by message type.
   * Returns an unsubscribe function.
   */
  onMessage(handler: MessageHandler, filter?: { type?: string }): () => void {
    const sub: MessageSubscription = { handler, type: filter?.type };
    this.messageSubscriptions.add(sub);
    return () => { this.messageSubscriptions.delete(sub); };
  }

  /**
   * Subscribe to raw (non-JSON) data from the WebSocket.
   * Used by terminal for raw PTY output.
   */
  onRawData(handler: RawDataHandler): () => void {
    this.rawDataHandlers.add(handler);
    return () => { this.rawDataHandlers.delete(handler); };
  }

  /**
   * Subscribe to connection state changes.
   * Returns an unsubscribe function.
   */
  onStateChange(handler: StateChangeHandler): () => void {
    this.stateChangeHandlers.add(handler);
    return () => { this.stateChangeHandlers.delete(handler); };
  }

  /**
   * Wait for the connection to reach a specific state.
   * Resolves immediately if already in that state.
   */
  waitForState(target: WsConnectionState, timeoutMs = 30_000): Promise<void> {
    if (this.state === target) return Promise.resolve();

    return new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => {
        unsub();
        reject(new Error(`Timed out waiting for workspace state '${target}' (current: '${this.state}') after ${timeoutMs}ms`));
      }, timeoutMs);

      const unsub = this.onStateChange((state) => {
        if (state === target) {
          clearTimeout(timer);
          unsub();
          resolve();
        }
      });
    });
  }

  // ---- Private: WebSocket lifecycle ----

  private async openWebSocket(projectId: string, sessionToken: string): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      getWorkspaceWsUrl(projectId, sessionToken).then(wsPath => {
        const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
        const wsUrl = `${protocol}//${window.location.host}${wsPath}`;
        const ws = new WebSocket(wsUrl);

        ws.onopen = () => {
          this.ws = ws;
          this.reconnectAttempt = 0;
          this.startKeepalive();
          this.setState('CONNECTED');
          resolve();
        };

        ws.onmessage = (event) => {
          this.handleWsMessage(event);
        };

        ws.onclose = (event) => {
          this.handleWsClose(event);
        };

        ws.onerror = () => {
          // The close handler will fire after this
        };
      }).catch(err => {
        this.setState('DISCONNECTED');
        reject(err);
      });
    });
  }

  private handleWsMessage(event: MessageEvent): void {
    try {
      const msg = JSON.parse(event.data);

      // Internal: handle keepalive pong
      if (msg.type === 'pong' || msg.type === 'heartbeat') {
        this.lastPongTime = Date.now();
      }

      // Dispatch to type-filtered subscribers
      for (const sub of this.messageSubscriptions) {
        if (!sub.type || sub.type === msg.type) {
          try {
            sub.handler(msg);
          } catch (err) {
            console.error('[workspace-connection] Message handler error:', err);
          }
        }
      }
    } catch {
      // Non-JSON message — dispatch to raw data handlers
      for (const handler of this.rawDataHandlers) {
        try {
          handler(event.data);
        } catch (err) {
          console.error('[workspace-connection] Raw data handler error:', err);
        }
      }
    }
  }

  private handleWsClose(event: CloseEvent): void {
    this.stopKeepalive();
    this.ws = null;

    if (this.intentionalDisconnect) {
      return; // Already set DISCONNECTED in disconnect()
    }

    if (this.projectId && event.code !== 1000) {
      // Unexpected close — attempt reconnect
      this.attemptReconnect();
    } else {
      this.setState('DISCONNECTED');
    }
  }

  private attemptReconnect(): void {
    if (this.reconnectAttempt >= MAX_RECONNECT_ATTEMPTS) {
      this.setState('DISCONNECTED');
      eventLog.error(
        'workspace',
        'Connection lost after multiple retries',
        `Gave up after ${MAX_RECONNECT_ATTEMPTS} reconnection attempts.`,
        { toast: true },
      );
      this.reconnectAttempt = 0;
      return;
    }

    const delay = RECONNECT_DELAYS[this.reconnectAttempt] ?? 16000;
    this.reconnectAttempt++;
    this.setState('PENDING');

    this.reconnectTimer = setTimeout(() => {
      if (this.projectId && this.sessionToken && !this.intentionalDisconnect) {
        this.openWebSocket(this.projectId, this.sessionToken).catch(() => {
          // Will be handled by ws.onclose → attemptReconnect
        });
      }
    }, delay);
  }

  // ---- Private: Keepalive ----

  private startKeepalive(): void {
    this.stopKeepalive();
    this.lastPongTime = Date.now();
    this.keepaliveTimer = setInterval(() => {
      if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;

      const elapsed = Date.now() - this.lastPongTime;
      if (elapsed > PONG_TIMEOUT_MS) {
        console.warn(`[workspace-connection] No pong for ${Math.round(elapsed / 1000)}s — closing`);
        this.ws.close(4000, 'Keepalive timeout');
        return;
      }

      this.ws.send(JSON.stringify({ type: 'ping' }));
    }, KEEPALIVE_INTERVAL_MS);
  }

  private stopKeepalive(): void {
    if (this.keepaliveTimer) {
      clearInterval(this.keepaliveTimer);
      this.keepaliveTimer = null;
    }
  }

  // ---- Private: State management ----

  private setState(state: WsConnectionState): void {
    if (this.state === state) return;
    this.state = state;
    for (const handler of this.stateChangeHandlers) {
      try {
        handler(state);
      } catch (err) {
        console.error('[workspace-connection] State change handler error:', err);
      }
    }
  }

  private cleanupConnection(): void {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    this.stopKeepalive();
    this.reconnectAttempt = 0;

    if (this.ws) {
      this.ws.close(1000, 'Cleanup');
      this.ws = null;
    }
  }
}

// ---------------------------------------------------------------------------
// Singleton export
// ---------------------------------------------------------------------------

export const workspaceConnection = new WorkspaceConnection();

// Expose on window for console/test access
if (typeof window !== 'undefined') {
  (window as any).__workspaceConnection = workspaceConnection;
}
