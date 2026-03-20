/**
 * Files Service
 *
 * Manages project file systems and annotations.
 *
 * All operations are project-scoped. The Files service owns the canonical
 * file system state and emits change events consumed by other services
 * (e.g., Builds subscribes to file changes to trigger rules).
 *
 * Annotations are a unified model for attaching structured metadata to
 * source file locations. Any tool can contribute annotations (build rules,
 * test runners, linters, agents). Each annotation has a source identifier
 * and optional actions that users can take.
 */

import type { ProjectScoped, ServiceEventBase, OperationMeta } from '../protocol.js';

// ---------------------------------------------------------------------------
// Resource types
// ---------------------------------------------------------------------------

export interface FileNode {
  readonly name: string;
  readonly path: string;
  readonly isDirectory: boolean;
  readonly children?: readonly FileNode[];
}

export interface FileChange {
  readonly changeType: 'add' | 'change' | 'unlink' | 'addDir' | 'unlinkDir';
  readonly path: string;
}

// ---------------------------------------------------------------------------
// Annotations
// ---------------------------------------------------------------------------

export type AnnotationSeverity = 'error' | 'warning' | 'info' | 'hint';

export interface Annotation {
  readonly id: string;
  readonly source: string;
  readonly path: string;
  readonly line?: number;
  readonly column?: number;
  readonly endLine?: number;
  readonly endColumn?: number;
  readonly severity: AnnotationSeverity;
  readonly message: string;
  /** Simple markup for links, lists, and basic formatting. */
  readonly detail?: string;
  /** Actions a user can take in response to this annotation. */
  readonly actions?: readonly AnnotationAction[];
}

/**
 * An action that can be presented to the user on an annotation.
 * Model TBD -- this is a placeholder for the action registration system.
 */
export interface AnnotationAction {
  readonly id: string;
  readonly label: string;
  /** Operation type to invoke when the action is triggered. */
  readonly command?: string;
  readonly params?: Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// Commands
// ---------------------------------------------------------------------------

export interface FilesWriteCommand extends ProjectScoped {
  readonly type: 'files.write';
  readonly path: string;
  readonly content: string;
}

export interface FilesDeleteCommand extends ProjectScoped {
  readonly type: 'files.delete';
  readonly path: string;
}

export interface FilesMkdirCommand extends ProjectScoped {
  readonly type: 'files.mkdir';
  readonly path: string;
}

/** Move/rename files, folders, or collections. Each entry is processed in order. */
export interface FilesMoveCommand extends ProjectScoped {
  readonly type: 'files.move';
  readonly entries: readonly { readonly src: string; readonly dest: string }[];
}

/** Copy files, folders, or collections. Each entry is processed in order. */
export interface FilesCopyCommand extends ProjectScoped {
  readonly type: 'files.copy';
  readonly entries: readonly { readonly src: string; readonly dest: string }[];
}

export interface FilesAnnotateCommand extends ProjectScoped {
  readonly type: 'files.annotate';
  readonly annotations: readonly Annotation[];
}

export interface FilesClearAnnotationsCommand extends ProjectScoped {
  readonly type: 'files.clearAnnotations';
  /** Clear annotations from a specific source. If omitted, clears all. */
  readonly source?: string;
  /** Clear annotations for a specific file. If omitted, clears across all files. */
  readonly path?: string;
}

// ---------------------------------------------------------------------------
// Queries
// ---------------------------------------------------------------------------

export interface FilesReadQuery extends ProjectScoped {
  readonly type: 'files.read';
  readonly path: string;
}

export interface FilesTreeQuery extends ProjectScoped {
  readonly type: 'files.tree';
  readonly path?: string;
}

export interface FilesExistsQuery extends ProjectScoped {
  readonly type: 'files.exists';
  readonly path: string;
}

export interface FilesAnnotationsQuery extends ProjectScoped {
  readonly type: 'files.annotations';
  /** Filter by source. */
  readonly source?: string;
  /** Filter by file path. */
  readonly path?: string;
  /** Filter by minimum severity. */
  readonly severity?: AnnotationSeverity;
}

// ---------------------------------------------------------------------------
// Events
// ---------------------------------------------------------------------------

export interface FilesChangedEvent extends ServiceEventBase {
  readonly type: 'files.changed';
  readonly changes: readonly FileChange[];
}

export interface FilesAnnotationsChangedEvent extends ServiceEventBase {
  readonly type: 'files.annotationsChanged';
  readonly source: string;
  /** Paths affected. Empty means potentially all files. */
  readonly paths: readonly string[];
}

// ---------------------------------------------------------------------------
// Union types
// ---------------------------------------------------------------------------

export type FilesCommand =
  | FilesWriteCommand
  | FilesDeleteCommand
  | FilesMkdirCommand
  | FilesMoveCommand
  | FilesCopyCommand
  | FilesAnnotateCommand
  | FilesClearAnnotationsCommand;

export type FilesQuery =
  | FilesReadQuery
  | FilesTreeQuery
  | FilesExistsQuery
  | FilesAnnotationsQuery;

export type FilesEvent =
  | FilesChangedEvent
  | FilesAnnotationsChangedEvent;

// ---------------------------------------------------------------------------
// Response maps
// ---------------------------------------------------------------------------

export interface FilesCommandResponseMap {
  'files.write': { path: string };
  'files.delete': { path: string };
  'files.mkdir': { path: string };
  'files.move': { moved: number; errors: readonly string[] };
  'files.copy': { copied: number; errors: readonly string[] };
  'files.annotate': { count: number };
  'files.clearAnnotations': { cleared: number };
}

export interface FilesQueryResponseMap {
  'files.read': { path: string; content: string };
  'files.tree': { tree: readonly FileNode[] };
  'files.exists': { exists: boolean };
  'files.annotations': { annotations: readonly Annotation[] };
}

// ---------------------------------------------------------------------------
// Operation metadata
// ---------------------------------------------------------------------------

export const FILES_OPERATIONS: Record<string, OperationMeta> = {
  'files.write':            { kind: 'command', context: 'workspace', description: 'Write file contents' },
  'files.delete':           { kind: 'command', context: 'workspace', description: 'Delete a file or directory' },
  'files.mkdir':            { kind: 'command', context: 'workspace', description: 'Create a directory' },
  'files.move':             { kind: 'command', context: 'workspace', description: 'Move/rename files or directories' },
  'files.copy':             { kind: 'command', context: 'workspace', description: 'Copy files or directories' },
  'files.annotate':         { kind: 'command', context: 'workspace', description: 'Add annotations to files' },
  'files.clearAnnotations': { kind: 'command', context: 'workspace', description: 'Clear annotations' },
  'files.read':             { kind: 'query',   context: 'workspace', description: 'Read file contents' },
  'files.tree':             { kind: 'query',   context: 'workspace', description: 'Get file tree' },
  'files.exists':           { kind: 'query',   context: 'workspace', description: 'Check if file exists' },
  'files.annotations':      { kind: 'query',   context: 'workspace', description: 'List file annotations' },
};
