import { create } from 'zustand';
import {
  fetchPipelineDeclarations,
  emitWorkflowEvent,
  runWorkflowRule,
  type PipelineDeclarations,
} from '@/lib/api';
import { eventLog } from '@/lib/eventLog';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface RuleExecutionState {
  ruleId: string;
  status: 'pending' | 'running' | 'success' | 'failed';
  lastRunAt?: string;
  durationMs?: number;
  error?: string;
}

export interface WorkflowInvocationResult {
  triggerEvents: readonly { type: string; [key: string]: unknown }[];
  rulesExecuted: readonly {
    ruleId: string;
    matchedEvents: number;
    durationMs: number;
    error?: string;
  }[];
  emittedEvents: readonly { type: string; [key: string]: unknown }[];
  logs: readonly { message: string; level: string; timestamp: string }[];
  durationMs: number;
  cycles: number;
}

interface PipelineState {
  /** Loaded declarations from workflow automation files. */
  declarations: PipelineDeclarations;
  /** Whether declarations have been loaded at least once. */
  loaded: boolean;
  /** Whether a load is in progress. */
  loading: boolean;

  /** Rule execution state — maps ruleId to last execution info. */
  ruleResults: Map<string, RuleExecutionState>;
  /** Custom workflow state from rule actions (e.g., build status, deploy status). */
  workflowState: any;
  /** Last invocation result snapshot. */
  lastInvocation: WorkflowInvocationResult | null;

  /** Fetch declarations from the workflow API. */
  loadDeclarations: (projectId?: string) => Promise<void>;

  /** Emit a workflow event (e.g., build:trigger, deploy:trigger). */
  emitEvent: (event: { type: string; [key: string]: unknown }, projectId?: string) => Promise<any>;

  /** Run a specific rule by ID (skips predicate). */
  runRule: (ruleId: string, projectId?: string) => Promise<any>;

  /** Update declarations from a WebSocket broadcast (workflow-reloaded). */
  setDeclarations: (declarations: PipelineDeclarations) => void;

  /** Handle a workflow-result WebSocket message. Updates rule execution state. */
  handleWorkflowResult: (result: WorkflowInvocationResult, state: any) => void;
}

// ---------------------------------------------------------------------------
// Store
// ---------------------------------------------------------------------------

const EMPTY_DECLARATIONS: PipelineDeclarations = {
  modules: [],
  targets: [],
  environments: [],
  rules: [],
};

export const usePipelineStore = create<PipelineState>((set, get) => ({
  declarations: EMPTY_DECLARATIONS,
  loaded: false,
  loading: false,
  ruleResults: new Map(),
  workflowState: null,
  lastInvocation: null,

  loadDeclarations: async (projectId?: string) => {
    set({ loading: true });
    try {
      const declarations = await fetchPipelineDeclarations(projectId);
      set({ declarations, loaded: true, loading: false });
    } catch (err) {
      // Not an error if workflow has no declarations — just means no automation files exist
      set({ declarations: EMPTY_DECLARATIONS, loaded: true, loading: false });
    }
  },

  emitEvent: async (event, projectId) => {
    try {
      const result = await emitWorkflowEvent(event, projectId);
      return result;
    } catch (err) {
      eventLog.error('workspace', `Failed to emit workflow event: ${event.type}`, String(err), { toast: true });
      throw err;
    }
  },

  runRule: async (ruleId, projectId) => {
    // Optimistically set the rule as running
    const currentResults = new Map(get().ruleResults);
    currentResults.set(ruleId, {
      ruleId,
      status: 'running',
      lastRunAt: new Date().toISOString(),
    });
    set({ ruleResults: currentResults });

    try {
      const result = await runWorkflowRule(ruleId, projectId);
      return result;
    } catch (err) {
      // Mark as failed on API error
      const failResults = new Map(get().ruleResults);
      failResults.set(ruleId, {
        ruleId,
        status: 'failed',
        error: String(err),
        lastRunAt: new Date().toISOString(),
      });
      set({ ruleResults: failResults });
      eventLog.error('workspace', `Failed to run rule: ${ruleId}`, String(err), { toast: true });
      throw err;
    }
  },

  setDeclarations: (declarations) => {
    set({ declarations, loaded: true });
  },

  handleWorkflowResult: (result, state) => {
    const currentResults = new Map(get().ruleResults);
    const now = new Date().toISOString();

    for (const executed of result.rulesExecuted) {
      currentResults.set(executed.ruleId, {
        ruleId: executed.ruleId,
        status: executed.error ? 'failed' : 'success',
        lastRunAt: now,
        durationMs: executed.durationMs,
        error: executed.error,
      });
    }

    set({
      ruleResults: currentResults,
      workflowState: state,
      lastInvocation: result,
    });
  },
}));
