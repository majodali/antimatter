/**
 * ServiceClient -- transport-agnostic dispatch interface.
 *
 * The ServiceClient routes commands and queries to the appropriate transport
 * based on the operation's ExecutionContext. Transport adapters implement the
 * actual communication (REST, WebSocket, direct browser call).
 *
 * The dispatch flow:
 *  1. Look up ExecutionContext from the operation registry
 *  2. Select the TransportAdapter for that context
 *  3. Send the operation via the adapter
 *  4. If response is `not-hosted`, retry via the REST fallback adapter
 *
 * Usage:
 * ```ts
 * const client = new ServiceClient({
 *   workspace: wsAdapter,   // WebSocket or REST to workspace server
 *   platform: restAdapter,  // REST to Lambda
 *   browser: browserAdapter, // Direct in-browser call
 * }, 'my-project-id');
 *
 * const result = await client.command({ type: 'files.write', projectId: '...', path: '/a.ts', content: '...' });
 * const tree = await client.query({ type: 'files.tree', projectId: '...' });
 * ```
 */

import type {
  ServiceResponse,
  ExecutionContext,
  Operation,
} from './protocol.js';
import type { Command, Query, ServiceEvent, ServiceEventType, CommandResponseMap, QueryResponseMap } from './index.js';
import { getExecutionContext } from './routing.js';

// ---------------------------------------------------------------------------
// Transport adapter interface
// ---------------------------------------------------------------------------

/**
 * A transport adapter sends operations to a specific execution context.
 * Implementations: RestTransport, WebSocketTransport, BrowserTransport.
 */
export interface TransportAdapter {
  /** Send a command and wait for the response. */
  sendCommand(command: Operation, projectId?: string): Promise<ServiceResponse>;

  /** Send a query and wait for the response. */
  sendQuery(query: Operation, projectId?: string): Promise<ServiceResponse>;

  /** Whether this adapter is currently connected and available. */
  readonly available: boolean;
}

/**
 * Extended transport that supports event subscriptions (WebSocket only).
 */
export interface EventTransport extends TransportAdapter {
  subscribe(eventTypes: readonly ServiceEventType[], handler: EventHandler): Unsubscribe;
}

export type EventHandler = (event: ServiceEvent) => void;
export type Unsubscribe = () => void;

// ---------------------------------------------------------------------------
// Transport registry
// ---------------------------------------------------------------------------

/**
 * Maps each execution context to its transport adapter.
 * The `fallback` adapter is used when a workspace transport returns `not-hosted`.
 */
export interface TransportRegistry {
  workspace?: TransportAdapter;
  platform: TransportAdapter;
  browser?: TransportAdapter;
  /** REST fallback for workspace operations when WebSocket returns `not-hosted`. */
  fallback?: TransportAdapter;
}

// ---------------------------------------------------------------------------
// ServiceClient
// ---------------------------------------------------------------------------

export class ServiceClient {
  private readonly transports: TransportRegistry;
  private projectId: string;

  constructor(transports: TransportRegistry, projectId: string) {
    this.transports = transports;
    this.projectId = projectId;
  }

  /** Update the active project (e.g. when user switches project tabs). */
  setProjectId(projectId: string): void {
    this.projectId = projectId;
  }

  getProjectId(): string {
    return this.projectId;
  }

  /**
   * Execute a command and return a typed response.
   *
   * Routes to the correct transport based on the command's execution context.
   * If the workspace transport returns `not-hosted`, falls back to REST.
   */
  async command<T extends Command['type']>(
    command: Extract<Command, { type: T }>,
    projectId?: string,
  ): Promise<ServiceResponse<CommandResponseMap[T]>> {
    const pid = projectId ?? this.projectId;
    const context = getExecutionContext(command.type) ?? 'platform';
    return this.dispatch(context, 'command', command, pid) as Promise<ServiceResponse<CommandResponseMap[T]>>;
  }

  /**
   * Execute a query and return a typed response.
   *
   * Routes to the correct transport based on the query's execution context.
   * If the workspace transport returns `not-hosted`, falls back to REST.
   */
  async query<T extends Query['type']>(
    query: Extract<Query, { type: T }>,
    projectId?: string,
  ): Promise<ServiceResponse<QueryResponseMap[T]>> {
    const pid = projectId ?? this.projectId;
    const context = getExecutionContext(query.type) ?? 'platform';
    return this.dispatch(context, 'query', query, pid) as Promise<ServiceResponse<QueryResponseMap[T]>>;
  }

  /**
   * Subscribe to server-push events (requires an EventTransport for workspace).
   */
  subscribe(eventTypes: readonly ServiceEventType[], handler: EventHandler): Unsubscribe {
    const transport = this.transports.workspace;
    if (!transport || !isEventTransport(transport)) {
      console.warn('[ServiceClient] No event transport available; subscription ignored.');
      return () => {};
    }
    return transport.subscribe(eventTypes, handler);
  }

  // -------------------------------------------------------------------------
  // Internal dispatch
  // -------------------------------------------------------------------------

  private async dispatch(
    context: ExecutionContext,
    kind: 'command' | 'query',
    operation: Operation,
    projectId: string,
  ): Promise<ServiceResponse> {
    const transport = this.resolveTransport(context);
    if (!transport) {
      return {
        ok: false,
        error: { code: 'unavailable', message: `No transport for context '${context}'` },
      };
    }

    const response = kind === 'command'
      ? await transport.sendCommand(operation, projectId)
      : await transport.sendQuery(operation, projectId);

    // Handle `not-hosted` fallback
    if (!response.ok && response.error?.code === 'not-hosted') {
      const fallback = this.transports.fallback ?? this.transports.platform;
      if (fallback && fallback !== transport) {
        return kind === 'command'
          ? fallback.sendCommand(operation, projectId)
          : fallback.sendQuery(operation, projectId);
      }
    }

    return response;
  }

  private resolveTransport(context: ExecutionContext): TransportAdapter | undefined {
    switch (context) {
      case 'workspace': {
        // Prefer workspace transport if available, fall back to platform (REST/S3)
        const ws = this.transports.workspace;
        if (ws?.available) return ws;
        return this.transports.fallback ?? this.transports.platform;
      }
      case 'platform':
        return this.transports.platform;
      case 'browser':
        return this.transports.browser;
      default:
        return undefined;
    }
  }
}

// ---------------------------------------------------------------------------
// Type guard
// ---------------------------------------------------------------------------

function isEventTransport(t: TransportAdapter): t is EventTransport {
  return typeof (t as EventTransport).subscribe === 'function';
}
