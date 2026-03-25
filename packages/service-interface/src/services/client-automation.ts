/**
 * ClientAutomation Service
 *
 * Platform service for testing and automation within connected browser clients.
 *
 * Provides utilities to drive UI interactions in deployed web clients or
 * within the IDE itself. Primarily intended for testing built UI components
 * and providing agent control over the browser.
 *
 * Clients are identified independently of their WebSocket connection.
 * Browser-scope automation commands that were previously handled by the
 * automation API (editor.open, editor.tabs, etc.) are routed through this
 * service as `clients.automation.execute` with a client ID and command.
 */

import type { ServiceEventBase, OperationMeta } from '../protocol.js';

// ---------------------------------------------------------------------------
// Resource types
// ---------------------------------------------------------------------------

export interface ClientInfo {
  readonly clientId: string;
  readonly projectId?: string;
  readonly url?: string;
  readonly connectedAt: string;
  readonly lastSeenAt: string;
  readonly metadata?: Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// Commands
// ---------------------------------------------------------------------------

export interface ClientsAutomationExecuteCommand {
  readonly type: 'clients.automation.execute';
  readonly clientId: string;
  readonly command: string;
  readonly params?: Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// Queries
// ---------------------------------------------------------------------------

export interface ClientsListQuery {
  readonly type: 'clients.list';
  readonly projectId?: string;
}

// ---------------------------------------------------------------------------
// Events
// ---------------------------------------------------------------------------

export interface ClientsConnectedEvent extends ServiceEventBase {
  readonly type: 'clients.connected';
  readonly client: ClientInfo;
}

export interface ClientsDisconnectedEvent extends ServiceEventBase {
  readonly type: 'clients.disconnected';
  readonly clientId: string;
}

// ---------------------------------------------------------------------------
// Union types
// ---------------------------------------------------------------------------

export type ClientAutomationCommand =
  | ClientsAutomationExecuteCommand;

export type ClientAutomationQuery =
  | ClientsListQuery;

export type ClientAutomationEvent =
  | ClientsConnectedEvent
  | ClientsDisconnectedEvent;

// ---------------------------------------------------------------------------
// Response maps
// ---------------------------------------------------------------------------

export interface ClientAutomationCommandResponseMap {
  'clients.automation.execute': unknown;
}

export interface ClientAutomationQueryResponseMap {
  'clients.list': { clients: readonly ClientInfo[] };
}

// ---------------------------------------------------------------------------
// Operation metadata
// ---------------------------------------------------------------------------

import { z } from 'zod';

export const CLIENT_AUTOMATION_OPERATIONS: Record<string, OperationMeta> = {
  'clients.automation.execute': {
    kind: 'command', context: 'browser', description: 'Execute a command on a browser client',
    params: { clientId: z.string().describe('Target browser client ID'), command: z.string().describe('Automation command to execute'), params: z.record(z.unknown()).optional().describe('Command parameters') },
  },
  'clients.list': {
    kind: 'query', context: 'platform', description: 'List connected clients',
  },
};
