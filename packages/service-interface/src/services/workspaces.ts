/**
 * Workspaces Service
 *
 * Manages workspace server lifecycle and terminal sessions.
 *
 * A workspace is a stateful server environment (currently EC2) that hosts
 * project file systems, build execution, and terminal access. Workspace
 * lifecycle (start, stop, status) is managed via the platform layer.
 *
 * Terminal sessions are resources within a running workspace. They support
 * interactive I/O via WebSocket frames and command execution from build
 * rules and agent tools. Clients may have multiple terminals open.
 * Build tools and agents write to the main terminal session by default.
 */

import type { ProjectScoped, ServiceEventBase, OperationMeta } from '../protocol.js';

// ---------------------------------------------------------------------------
// Resource types
// ---------------------------------------------------------------------------

export interface WorkspaceInfo {
  readonly projectId: string;
  readonly instanceId: string;
  readonly status: 'PENDING' | 'RUNNING' | 'STOPPING' | 'STOPPED' | 'TERMINATED' | 'UNKNOWN';
  readonly privateIp?: string;
  readonly port: number;
  readonly sessionToken: string;
  readonly startedAt?: string;
  readonly volumeId?: string;
}

export interface TerminalSession {
  readonly sessionId: string;
  readonly projectId: string;
  readonly name?: string;
  readonly createdAt: string;
  /** True if this is the default session for build/agent output. */
  readonly isDefault: boolean;
}

// ---------------------------------------------------------------------------
// Commands
// ---------------------------------------------------------------------------

export interface WorkspacesStartCommand {
  readonly type: 'workspaces.start';
  readonly projectId: string;
}

export interface WorkspacesStopCommand {
  readonly type: 'workspaces.stop';
  readonly projectId: string;
}

export interface WorkspacesTerminalsCreateCommand extends ProjectScoped {
  readonly type: 'workspaces.terminals.create';
  readonly name?: string;
}

export interface WorkspacesTerminalsCloseCommand extends ProjectScoped {
  readonly type: 'workspaces.terminals.close';
  readonly sessionId: string;
}

// ---------------------------------------------------------------------------
// Queries
// ---------------------------------------------------------------------------

export interface WorkspacesStatusQuery {
  readonly type: 'workspaces.status';
  readonly projectId: string;
}

export interface WorkspacesTerminalsListQuery extends ProjectScoped {
  readonly type: 'workspaces.terminals.list';
}

// ---------------------------------------------------------------------------
// Events
// ---------------------------------------------------------------------------

export interface WorkspacesStatusChangedEvent extends ServiceEventBase {
  readonly type: 'workspaces.statusChanged';
  readonly status: WorkspaceInfo['status'];
}

// ---------------------------------------------------------------------------
// Union types
// ---------------------------------------------------------------------------

export type WorkspacesCommand =
  | WorkspacesStartCommand
  | WorkspacesStopCommand
  | WorkspacesTerminalsCreateCommand
  | WorkspacesTerminalsCloseCommand;

export type WorkspacesQuery =
  | WorkspacesStatusQuery
  | WorkspacesTerminalsListQuery;

export type WorkspacesEvent =
  | WorkspacesStatusChangedEvent;

// ---------------------------------------------------------------------------
// Response maps
// ---------------------------------------------------------------------------

export interface WorkspacesCommandResponseMap {
  'workspaces.start': WorkspaceInfo;
  'workspaces.stop': void;
  'workspaces.terminals.create': TerminalSession;
  'workspaces.terminals.close': void;
}

export interface WorkspacesQueryResponseMap {
  'workspaces.status': WorkspaceInfo;
  'workspaces.terminals.list': { sessions: readonly TerminalSession[] };
}

// ---------------------------------------------------------------------------
// Operation metadata
// ---------------------------------------------------------------------------

export const WORKSPACES_OPERATIONS: Record<string, OperationMeta> = {
  'workspaces.start':            { kind: 'command', context: 'platform',  description: 'Start a workspace server' },
  'workspaces.stop':             { kind: 'command', context: 'platform',  description: 'Stop a workspace server' },
  'workspaces.terminals.create': { kind: 'command', context: 'workspace', description: 'Create a terminal session' },
  'workspaces.terminals.close':  { kind: 'command', context: 'workspace', description: 'Close a terminal session' },
  'workspaces.status':           { kind: 'query',   context: 'platform',  description: 'Get workspace status' },
  'workspaces.terminals.list':   { kind: 'query',   context: 'workspace', description: 'List terminal sessions' },
};
