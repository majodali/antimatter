/**
 * Application Store — unified client-side mirror of server application state.
 *
 * Replaces the separate pipelineStore and errorStore with a single store
 * that receives state from the server via WebSocket:
 *   - Full snapshot on WebSocket connect (eliminates REST race condition)
 *   - Partial patches on mutations (only changed fields transmitted)
 *
 * All state is authoritative on the server — this store is a read-only
 * mirror for UI rendering. Commands (emit, runRule) are sent via REST.
 */

import { create } from 'zustand';
import type {
  ApplicationState,
  ProjectError,
  PersistedRuleResult,
  WorkflowDeclarations,
  WorkflowInvocationResult,
} from '@antimatter/workflow';
import { emitWorkflowEvent, runWorkflowRule } from '@/lib/api';
export type { ProjectError };

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Rule execution state — extends PersistedRuleResult with ruleId and running status. */
export interface RuleExecutionState {
  ruleId: string;
  status: 'pending' | 'running' | 'success' | 'failed';
  lastRunAt?: string;
  durationMs?: number;
  error?: string;
}

const EMPTY_DECLARATIONS: WorkflowDeclarations = {
  modules: [],
  targets: [],
  environments: [],
  rules: [],
  widgets: [],
};

interface ApplicationStore {
  /** Latest assembled state from server. Null until first full snapshot. */
  serverState: ApplicationState | null;
  /** Whether at least one full snapshot has been received. */
  loaded: boolean;

  /** Optimistic rule execution state — maps ruleId to running status. */
  optimisticRunning: Set<string>;

  // ---- Derived accessors ----

  getDeclarations: () => WorkflowDeclarations;
  getWorkflowState: () => unknown;
  getRuleResults: () => Readonly<Record<string, PersistedRuleResult>>;
  getRuleExecutionStates: () => Map<string, RuleExecutionState>;
  getErrors: () => readonly ProjectError[];
  getErrorsForFile: (filePath: string) => ProjectError[];
  getErrorCountsByFile: () => Map<string, number>;
  getErrorCount: () => number;
  getLastInvocation: () => WorkflowInvocationResult | null;
  getLoadedFiles: () => readonly string[];

  // ---- Actions ----

  /** Handle an application-state WebSocket message. */
  handleStateMessage: (msg: { full?: boolean; state: Partial<ApplicationState> }) => void;

  /** Emit a workflow event (e.g., build:trigger, deploy:trigger). */
  emitEvent: (event: { type: string; [key: string]: unknown }, projectId?: string) => Promise<any>;

  /** Run a specific rule by ID (skips predicate). */
  runRule: (ruleId: string, projectId?: string) => Promise<any>;
}

// ---------------------------------------------------------------------------
// Store
// ---------------------------------------------------------------------------

export const useApplicationStore = create<ApplicationStore>((set, get) => ({
  serverState: null,
  loaded: false,
  optimisticRunning: new Set(),

  // ---- Derived accessors ----

  getDeclarations: () => {
    return get().serverState?.declarations ?? EMPTY_DECLARATIONS;
  },

  getWorkflowState: () => {
    return get().serverState?.workflowState ?? {};
  },

  getRuleResults: () => {
    return get().serverState?.ruleResults ?? {};
  },

  /** Build a Map of RuleExecutionState from server ruleResults + optimistic running state. */
  getRuleExecutionStates: () => {
    const results = new Map<string, RuleExecutionState>();
    const serverResults = get().serverState?.ruleResults ?? {};
    const running = get().optimisticRunning;

    for (const [ruleId, r] of Object.entries(serverResults)) {
      results.set(ruleId, {
        ruleId,
        status: running.has(ruleId) ? 'running' : r.status,
        lastRunAt: r.lastRunAt,
        durationMs: r.durationMs,
        error: r.error,
      });
    }

    // Add any rules that are running but don't have server results yet
    for (const ruleId of running) {
      if (!results.has(ruleId)) {
        results.set(ruleId, {
          ruleId,
          status: 'running',
          lastRunAt: new Date().toISOString(),
        });
      }
    }

    return results;
  },

  getErrors: () => {
    return get().serverState?.errors ?? [];
  },

  getErrorsForFile: (filePath: string) => {
    const errors = get().serverState?.errors ?? [];
    return errors.filter(e => e.file === filePath);
  },

  getErrorCountsByFile: () => {
    const counts = new Map<string, number>();
    const errors = get().serverState?.errors ?? [];
    for (const err of errors) {
      counts.set(err.file, (counts.get(err.file) ?? 0) + 1);
    }
    return counts;
  },

  getErrorCount: () => {
    return (get().serverState?.errors ?? []).length;
  },

  getLastInvocation: () => {
    return get().serverState?.lastInvocation ?? null;
  },

  getLoadedFiles: () => {
    return get().serverState?.loadedFiles ?? [];
  },

  // ---- Actions ----

  handleStateMessage: (msg) => {
    if (msg.full) {
      // Full snapshot — replace entire server state
      set({
        serverState: msg.state as ApplicationState,
        loaded: true,
        optimisticRunning: new Set(), // Clear optimistic state on full snapshot
      });
    } else {
      const current = get().serverState;
      if (!current) {
        // Not loaded yet and not a full snapshot — ignore (wait for full)
        return;
      }

      // Partial patch — merge changed fields into existing state.
      // When ruleResults arrive from server, clear optimistic running state
      // for any rules that now have server-side results.
      let running = get().optimisticRunning;
      if (msg.state.ruleResults) {
        const newRunning = new Set(running);
        for (const ruleId of Object.keys(msg.state.ruleResults)) {
          newRunning.delete(ruleId);
        }
        running = newRunning;
      }

      set({
        serverState: { ...current, ...msg.state } as ApplicationState,
        loaded: true,
        optimisticRunning: running,
      });
    }
  },

  emitEvent: async (event, projectId) => {
    try {
      const result = await emitWorkflowEvent(event, projectId);
      return result;
    } catch (err) {
      throw err;
    }
  },

  runRule: async (ruleId, projectId) => {
    // Optimistically mark the rule as running
    set((s) => {
      const newRunning = new Set(s.optimisticRunning);
      newRunning.add(ruleId);
      return { optimisticRunning: newRunning };
    });

    try {
      const result = await runWorkflowRule(ruleId, projectId);
      return result;
    } catch (err) {
      // Clear optimistic running state on API error
      set((s) => {
        const newRunning = new Set(s.optimisticRunning);
        newRunning.delete(ruleId);
        return { optimisticRunning: newRunning };
      });
      throw err;
    }
  },
}));
