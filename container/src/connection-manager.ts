/**
 * Connection Manager — tracks WebSocket connections and auto-shuts down
 * the container after an idle period with no connections.
 */

import type { WebSocket } from 'ws';

export interface ConnectionManagerOptions {
  /** Milliseconds to wait with 0 connections before shutting down. */
  idleTimeoutMs: number;
  /** Called when the idle timer fires. Should sync and exit. */
  onShutdown: () => Promise<void>;
}

export class ConnectionManager {
  private readonly connections = new Set<WebSocket>();
  private shutdownTimer: ReturnType<typeof setTimeout> | null = null;
  private readonly idleTimeoutMs: number;
  private readonly onShutdown: () => Promise<void>;

  constructor(options: ConnectionManagerOptions) {
    this.idleTimeoutMs = options.idleTimeoutMs;
    this.onShutdown = options.onShutdown;
  }

  get count(): number {
    return this.connections.size;
  }

  add(ws: WebSocket): void {
    this.connections.add(ws);

    // Cancel shutdown timer if we got a new connection
    if (this.shutdownTimer) {
      clearTimeout(this.shutdownTimer);
      this.shutdownTimer = null;
      console.log(`[connections] Shutdown timer cancelled (${this.connections.size} connected)`);
    }
  }

  remove(ws: WebSocket): void {
    this.connections.delete(ws);
    console.log(`[connections] Client removed (${this.connections.size} remaining)`);

    if (this.connections.size === 0) {
      console.log(`[connections] No connections — starting ${this.idleTimeoutMs / 1000}s shutdown timer`);
      this.shutdownTimer = setTimeout(async () => {
        console.log('[connections] Idle timeout reached — initiating shutdown');
        try {
          await this.onShutdown();
        } catch (err) {
          console.error('[connections] Shutdown handler failed:', err);
          process.exit(1);
        }
      }, this.idleTimeoutMs);
    }
  }
}
