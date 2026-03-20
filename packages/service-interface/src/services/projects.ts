/**
 * Projects Service
 *
 * Manages project lifecycle and version control.
 *
 * Projects are the top-level organizational unit. Each project has a file system,
 * build configuration, test suite, and optional VCS integration. VCS operations
 * use generic verbs that map to the underlying VCS provider (currently git).
 *
 * A single remote is supported per project. Complex branching, merging, and
 * multi-remote workflows are handled in the terminal.
 */

import type { ProjectScoped, ServiceEventBase, OperationMeta } from '../protocol.js';

// ---------------------------------------------------------------------------
// Resource types
// ---------------------------------------------------------------------------

export interface ProjectInfo {
  readonly id: string;
  readonly name: string;
  readonly createdAt: string;
  readonly remote?: string;
}

export interface VcsStatus {
  readonly initialized: boolean;
  readonly branch?: string;
  readonly staged: readonly VcsFileChange[];
  readonly unstaged: readonly VcsFileChange[];
  readonly untracked: readonly string[];
}

export interface VcsFileChange {
  readonly path: string;
  readonly status: 'modified' | 'added' | 'deleted' | 'renamed';
}

export interface VcsLogEntry {
  readonly hash: string;
  readonly message: string;
}

// ---------------------------------------------------------------------------
// Commands
// ---------------------------------------------------------------------------

export interface ProjectsCreateCommand {
  readonly type: 'projects.create';
  readonly name: string;
  readonly remote?: string;
}

export interface ProjectsDeleteCommand {
  readonly type: 'projects.delete';
  readonly projectId: string;
}

export interface ProjectsImportCommand {
  readonly type: 'projects.import';
  /** Git clone URL. */
  readonly url: string;
  readonly name?: string;
}

export interface ProjectsSetRemoteCommand extends ProjectScoped {
  readonly type: 'projects.setRemote';
  readonly url: string;
}

export interface ProjectsStageCommand extends ProjectScoped {
  readonly type: 'projects.stage';
  readonly files: readonly string[];
}

export interface ProjectsUnstageCommand extends ProjectScoped {
  readonly type: 'projects.unstage';
  readonly files: readonly string[];
}

export interface ProjectsCommitCommand extends ProjectScoped {
  readonly type: 'projects.commit';
  readonly message: string;
}

export interface ProjectsPushCommand extends ProjectScoped {
  readonly type: 'projects.push';
  readonly remote?: string;
  readonly branch?: string;
}

export interface ProjectsPullCommand extends ProjectScoped {
  readonly type: 'projects.pull';
  readonly remote?: string;
  readonly branch?: string;
}

// ---------------------------------------------------------------------------
// Queries
// ---------------------------------------------------------------------------

export interface ProjectsListQuery {
  readonly type: 'projects.list';
}

export interface ProjectsGetQuery {
  readonly type: 'projects.get';
  readonly projectId: string;
}

export interface ProjectsStatusQuery extends ProjectScoped {
  readonly type: 'projects.status';
}

export interface ProjectsLogQuery extends ProjectScoped {
  readonly type: 'projects.log';
  readonly limit?: number;
}

export interface ProjectsRemoteQuery extends ProjectScoped {
  readonly type: 'projects.remote';
}

// ---------------------------------------------------------------------------
// Events
// ---------------------------------------------------------------------------

export interface ProjectsCreatedEvent extends ServiceEventBase {
  readonly type: 'projects.created';
  readonly project: ProjectInfo;
}

export interface ProjectsDeletedEvent extends ServiceEventBase {
  readonly type: 'projects.deleted';
}

// ---------------------------------------------------------------------------
// Union types
// ---------------------------------------------------------------------------

export type ProjectsCommand =
  | ProjectsCreateCommand
  | ProjectsDeleteCommand
  | ProjectsImportCommand
  | ProjectsSetRemoteCommand
  | ProjectsStageCommand
  | ProjectsUnstageCommand
  | ProjectsCommitCommand
  | ProjectsPushCommand
  | ProjectsPullCommand;

export type ProjectsQuery =
  | ProjectsListQuery
  | ProjectsGetQuery
  | ProjectsStatusQuery
  | ProjectsLogQuery
  | ProjectsRemoteQuery;

export type ProjectsEvent =
  | ProjectsCreatedEvent
  | ProjectsDeletedEvent;

// ---------------------------------------------------------------------------
// Response maps
// ---------------------------------------------------------------------------

export interface ProjectsCommandResponseMap {
  'projects.create': ProjectInfo;
  'projects.delete': void;
  'projects.import': ProjectInfo & { importStats: { totalFiles: number } };
  'projects.setRemote': void;
  'projects.stage': void;
  'projects.unstage': void;
  'projects.commit': { hash: string };
  'projects.push': void;
  'projects.pull': { summary: string };
}

export interface ProjectsQueryResponseMap {
  'projects.list': { projects: readonly ProjectInfo[] };
  'projects.get': ProjectInfo;
  'projects.status': VcsStatus;
  'projects.log': { entries: readonly VcsLogEntry[] };
  'projects.remote': { url: string | null };
}

// ---------------------------------------------------------------------------
// Operation metadata
// ---------------------------------------------------------------------------

export const PROJECTS_OPERATIONS: Record<string, OperationMeta> = {
  'projects.create':    { kind: 'command', context: 'platform',  description: 'Create a new project' },
  'projects.delete':    { kind: 'command', context: 'platform',  description: 'Delete a project' },
  'projects.import':    { kind: 'command', context: 'platform',  description: 'Import project from remote repository' },
  'projects.setRemote': { kind: 'command', context: 'workspace', description: 'Set the VCS remote URL' },
  'projects.stage':     { kind: 'command', context: 'workspace', description: 'Stage files for commit' },
  'projects.unstage':   { kind: 'command', context: 'workspace', description: 'Unstage files' },
  'projects.commit':    { kind: 'command', context: 'workspace', description: 'Commit staged changes' },
  'projects.push':      { kind: 'command', context: 'workspace', description: 'Push to remote' },
  'projects.pull':      { kind: 'command', context: 'workspace', description: 'Pull from remote' },
  'projects.list':      { kind: 'query',   context: 'platform',  description: 'List all projects' },
  'projects.get':       { kind: 'query',   context: 'platform',  description: 'Get project details' },
  'projects.status':    { kind: 'query',   context: 'workspace', description: 'Get VCS working tree status' },
  'projects.log':       { kind: 'query',   context: 'workspace', description: 'Get VCS commit history' },
  'projects.remote':    { kind: 'query',   context: 'workspace', description: 'Get configured remote' },
};
