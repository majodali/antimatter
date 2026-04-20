/**
 * IPC message types for Router ↔ Project Worker communication.
 *
 * The Router (parent process) manages HTTP/WebSocket connections and proxies
 * to Project Workers (child processes) via Node's built-in IPC channel.
 * HTTP is proxied via UNIX socket; WebSocket is relayed via IPC messages.
 */

// ---------------------------------------------------------------------------
// Serializable configuration (crosses IPC boundary)
// ---------------------------------------------------------------------------

/** Config that can be sent from Router to Worker via IPC (no SDK clients). */
export interface SerializableConfig {
  projectId: string;
  workspaceRoot: string;
  projectsBucket: string;
  websiteBucket: string;
  anthropicApiKey: string;
  eventBusName: string;
  sqsQueueUrl?: string;
  awsRegion: string;
  cognitoUserPoolId?: string;
  cognitoClientId?: string;
}

// ---------------------------------------------------------------------------
// Parent → Child messages
// ---------------------------------------------------------------------------

export type ParentMessage =
  | { type: 'initialize'; config: SerializableConfig }
  | { type: 'ws-connect'; connectionId: string }
  | { type: 'ws-message'; connectionId: string; data: string }
  | { type: 'ws-disconnect'; connectionId: string }
  | { type: 'ingress-event'; event: Record<string, unknown> }
  | { type: 'shutdown' };

// ---------------------------------------------------------------------------
// Child → Parent messages
// ---------------------------------------------------------------------------

export type ChildMessage =
  | { type: 'ready'; socketPath: string }
  | { type: 'ws-send'; connectionId: string; data: string }
  | { type: 'ws-broadcast'; data: string }
  | { type: 'connection-change'; delta: number }
  | { type: 'exec-hold' }
  | { type: 'exec-release' }
  | { type: 'error'; message: string; fatal?: boolean }
  | { type: 'log'; level: 'info' | 'warn' | 'error'; message: string };
