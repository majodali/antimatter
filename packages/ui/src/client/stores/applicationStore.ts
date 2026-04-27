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
import type {
  ContextSnapshot,
  ContextLifecycleSnapshot,
  ContextNodeSnapshot,
} from '../../shared/contexts-types';
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

  /**
   * Project context tree parsed from `.antimatter/contexts.dsl` (server-owned).
   * Lives outside `serverState` because it isn't a workflow concept — the
   * server pushes it under `state.contexts` and this store splits it back out.
   * Null until a snapshot arrives; `present: false` if no DSL file exists.
   */
  contexts: ContextSnapshot | null;

  /**
   * Server-derived lifecycle data: per-context status + per-context
   * requirement pass/fail. Pushed independently of `contexts` (contexts
   * changes when the DSL file changes; contextLifecycle changes whenever
   * rule/test results change). Merged with `contexts` by `getContexts()`.
   */
  contextLifecycle: ContextLifecycleSnapshot | null;

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

  /**
   * Project context snapshot ENRICHED with the server-derived lifecycle
   * data when present. Each ContextNodeSnapshot's `lifecycleStatus`
   * comes from `contextLifecycle.statuses[id]`, and its `requirements`
   * are overlaid with `contextLifecycle.requirements[id]` (real
   * pass/fail) when available. Falls back to the placeholder data on
   * the bare snapshot if the lifecycle store hasn't reported yet.
   */
  getContexts: () => ContextSnapshot | null;
  /** Convenience: just the runtime contexts, sorted by name. */
  getRuntimeContexts: () => Array<{ name: string; description?: string }>;

  // ---- Actions ----

  /** Handle an application-state WebSocket message.
   *  The `contexts` and `contextLifecycle` fields are split out of
   *  `state` and routed to their dedicated top-level store fields. */
  handleStateMessage: (msg: {
    full?: boolean;
    state: Partial<ApplicationState> & {
      contexts?: ContextSnapshot;
      contextLifecycle?: ContextLifecycleSnapshot;
    };
  }) => void;

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
  contexts: null,
  contextLifecycle: null,
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

  getContexts: () => {
    const ctx = get().contexts;
    if (!ctx) return null;
    const lifecycle = get().contextLifecycle;
    if (!lifecycle) return ctx;
    // Enrich: overlay status + live requirement pass/fail.
    const enrichedNodes: ContextNodeSnapshot[] = ctx.nodes.map((n) => {
      const status = lifecycle.statuses[n.id];
      const liveReqs = lifecycle.requirements[n.id];
      return {
        ...n,
        lifecycleStatus: status ?? n.lifecycleStatus,
        requirements: liveReqs && liveReqs.length === n.requirements.length
          ? liveReqs
          : n.requirements,
      };
    });
    return { ...ctx, nodes: enrichedNodes };
  },

  getRuntimeContexts: () => {
    const ctx = get().contexts;
    if (!ctx?.present) return [];
    return ctx.nodes
      .filter(n => n.kind === 'runtime')
      .map(n => ({ name: n.name, description: n.description }))
      .sort((a, b) => a.name.localeCompare(b.name));
  },

  // ---- Actions ----

  handleStateMessage: (msg) => {
    // Split `contexts` and `contextLifecycle` out — they live in their own
    // store fields, not inside ApplicationState (which is owned by the
    // workflow engine).
    const incoming = (msg.state ?? {}) as Partial<ApplicationState> & {
      contexts?: ContextSnapshot;
      contextLifecycle?: ContextLifecycleSnapshot;
    };
    const {
      contexts: nextContexts,
      contextLifecycle: nextLifecycle,
      ...workflowState
    } = incoming;

    if (msg.full) {
      // Full snapshot — replace entire server state.
      set({
        serverState: workflowState as ApplicationState,
        loaded: true,
        contexts: nextContexts ?? null,
        contextLifecycle: nextLifecycle ?? null,
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
      if (workflowState.ruleResults) {
        const newRunning = new Set(running);
        for (const ruleId of Object.keys(workflowState.ruleResults)) {
          newRunning.delete(ruleId);
        }
        running = newRunning;
      }

      set({
        serverState: { ...current, ...workflowState } as ApplicationState,
        loaded: true,
        // Only overwrite contexts/contextLifecycle if the patch carries them —
        // patches without those fields shouldn't clobber the cached snapshots.
        ...(nextContexts !== undefined ? { contexts: nextContexts } : {}),
        ...(nextLifecycle !== undefined ? { contextLifecycle: nextLifecycle } : {}),
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
