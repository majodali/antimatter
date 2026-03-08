/**
 * Error Store — client-side cache of project errors from the server.
 *
 * Fetches errors from the REST API on init, then receives live updates
 * via WebSocket `project-errors-snapshot` messages from the ErrorStore
 * on the workspace server.
 *
 * All error state is authoritative on the server — this store is a
 * read-only cache for display in the editor, file explorer, and
 * Problems panel.
 */

import { create } from 'zustand';
import { fetchWorkflowErrors } from '@/lib/api';

/** Matches ProjectError from @antimatter/workflow (duplicated to avoid server-only import). */
export interface ProjectError {
  readonly errorType: {
    readonly name: string;
    readonly icon: string;
    readonly color: string;
    readonly highlightStyle: 'squiggly' | 'dotted' | 'solid' | 'double';
  };
  readonly toolId: string;
  readonly file: string;
  readonly message: string;
  readonly detail?: string;
  readonly line?: number;
  readonly column?: number;
  readonly endLine?: number;
  readonly endColumn?: number;
}

interface ErrorState {
  /** All project errors from the server. */
  errors: ProjectError[];
  /** Whether the initial load has completed. */
  loaded: boolean;

  /** Fetch errors from the REST API (initial load). */
  loadErrors: (projectId?: string) => Promise<void>;
  /** Handle a full snapshot from WebSocket. */
  handleSnapshot: (errors: ProjectError[]) => void;

  /** Get errors for a specific file path. */
  getErrorsForFile: (filePath: string) => ProjectError[];
  /** Get error count for a specific file path. */
  getErrorCountForFile: (filePath: string) => number;
  /** Get all errors. */
  getAllErrors: () => ProjectError[];
  /** Get total error count. */
  getErrorCount: () => number;
  /** Get error counts grouped by file path. */
  getErrorCountsByFile: () => Map<string, number>;
}

export const useErrorStore = create<ErrorState>((set, get) => ({
  errors: [],
  loaded: false,

  loadErrors: async (projectId?: string) => {
    try {
      const { errors } = await fetchWorkflowErrors(projectId);
      set({ errors: errors as ProjectError[], loaded: true });
    } catch {
      // Failed to load — start with empty errors
      set({ loaded: true });
    }
  },

  handleSnapshot: (errors: ProjectError[]) => {
    set({ errors, loaded: true });
  },

  getErrorsForFile: (filePath: string) => {
    return get().errors.filter(e => e.file === filePath);
  },

  getErrorCountForFile: (filePath: string) => {
    return get().errors.filter(e => e.file === filePath).length;
  },

  getAllErrors: () => {
    return get().errors;
  },

  getErrorCount: () => {
    return get().errors.length;
  },

  getErrorCountsByFile: () => {
    const counts = new Map<string, number>();
    for (const err of get().errors) {
      counts.set(err.file, (counts.get(err.file) ?? 0) + 1);
    }
    return counts;
  },
}));
