/**
 * Service Interface Protocol -- transport-agnostic core types.
 *
 * Defines envelopes, errors, execution contexts, and WebSocket frame types
 * used by all transports (REST, WebSocket, Tool-use).
 *
 * Key design decisions:
 *  - WebSocket connections are scoped to a default project (set at handshake).
 *  - Individual frames can override the project scope via optional `projectId`.
 *  - Terminal I/O is scoped by terminal session ID.
 *  - The `not-hosted` error code signals the client to redirect to another handler.
 */

// ---------------------------------------------------------------------------
// Response envelope
// ---------------------------------------------------------------------------

/**
 * Canonical response from any service operation.
 * All transports return this shape. Transport adapters wrap/unwrap as needed.
 */
export interface ServiceResponse<T = unknown> {
  readonly ok: boolean;
  readonly data?: T;
  readonly error?: ServiceError;
}

export interface ServiceError {
  readonly code: ServiceErrorCode;
  readonly message: string;
  /** Optional structured details (validation errors, stack trace in dev, etc.) */
  readonly details?: unknown;
}

export type ServiceErrorCode =
  | 'not-found'         // Resource doesn't exist
  | 'invalid-params'    // Bad input
  | 'unauthorized'      // Auth required or insufficient
  | 'conflict'          // Concurrent modification
  | 'timeout'           // Operation took too long
  | 'unavailable'       // Service temporarily unavailable
  | 'not-hosted'        // Project not hosted on this server (redirect hint)
  | 'unsupported'       // Operation not supported in this context
  | 'execution-error';  // Unclassified failure

// ---------------------------------------------------------------------------
// Execution context
// ---------------------------------------------------------------------------

/**
 * Where an operation can execute.
 *
 * - 'workspace'  -- Requires a running workspace server (file system, PTY, build engine)
 * - 'platform'   -- Runs on the stateless platform layer (project CRUD, auth, secrets)
 * - 'browser'    -- Runs in a connected browser client (editor UI, client automation)
 */
export type ExecutionContext = 'workspace' | 'platform' | 'browser';

// ---------------------------------------------------------------------------
// Base operation type
// ---------------------------------------------------------------------------

/**
 * Base shape for all operations (commands and queries).
 * Used by generic transport code. Service-specific types narrow this.
 *
 * Transport code that needs to accept arbitrary operations should use
 * `{ readonly type: string; [key: string]: unknown }` directly.
 */
export interface Operation {
  readonly type: string;
}

// ---------------------------------------------------------------------------
// Service event base
// ---------------------------------------------------------------------------

export interface ServiceEventBase {
  readonly type: string;
  readonly timestamp: string;
  /** Project this event relates to, if applicable. */
  readonly projectId?: string;
}

// ---------------------------------------------------------------------------
// WebSocket protocol frames
// ---------------------------------------------------------------------------

/**
 * Client -> Server WebSocket messages.
 *
 * Commands and queries carry an `id` for request/response correlation.
 * Optional `projectId` overrides the connection-scoped default.
 */
export type ClientFrame =
  | { readonly kind: 'command'; readonly id: string; readonly projectId?: string; readonly command: Operation }
  | { readonly kind: 'query'; readonly id: string; readonly projectId?: string; readonly query: Operation }
  | { readonly kind: 'subscribe'; readonly eventTypes: readonly string[] }
  | { readonly kind: 'unsubscribe'; readonly eventTypes: readonly string[] }
  | { readonly kind: 'terminal.input'; readonly sessionId: string; readonly data: string }
  | { readonly kind: 'terminal.resize'; readonly sessionId: string; readonly cols: number; readonly rows: number }
  | { readonly kind: 'ping' };

/**
 * Server -> Client WebSocket messages.
 */
export type ServerFrame =
  | { readonly kind: 'response'; readonly id: string; readonly response: ServiceResponse }
  | { readonly kind: 'event'; readonly event: ServiceEventBase }
  | { readonly kind: 'terminal.output'; readonly sessionId: string; readonly data: string }
  | { readonly kind: 'terminal.replay'; readonly sessionId: string; readonly data: string }
  | { readonly kind: 'pong' }
  | { readonly kind: 'heartbeat' };

// ---------------------------------------------------------------------------
// Project-scoped operation mixin
// ---------------------------------------------------------------------------

/**
 * Mixin for operations that are inherently project-scoped.
 * Transport adapters resolve projectId from URL path, frame override,
 * or connection default before dispatching to the service.
 */
export interface ProjectScoped {
  readonly projectId: string;
}

// ---------------------------------------------------------------------------
// Operation metadata entry
// ---------------------------------------------------------------------------

export interface OperationMeta {
  readonly kind: 'command' | 'query';
  readonly context: ExecutionContext;
  readonly description: string;
  /**
   * Zod parameter schema for MCP tool generation.
   * Keys are parameter names, values are Zod validators.
   * Omit `type` and `projectId` — those are handled by the tool generator.
   * Import `z` from 'zod' in each service file to define schemas.
   */
  readonly params?: Record<string, unknown>;
}
