import { create } from 'zustand';
import {
  fetchPipelineDeclarations,
  emitWorkflowEvent,
  type PipelineDeclarations,
} from '@/lib/api';
import { eventLog } from '@/lib/eventLog';

interface PipelineState {
  /** Loaded declarations from workflow automation files. */
  declarations: PipelineDeclarations;
  /** Whether declarations have been loaded at least once. */
  loaded: boolean;
  /** Whether a load is in progress. */
  loading: boolean;

  /** Fetch declarations from the workflow API. */
  loadDeclarations: (projectId?: string) => Promise<void>;

  /** Emit a workflow event (e.g., build:trigger, deploy:trigger). */
  emitEvent: (event: { type: string; [key: string]: unknown }, projectId?: string) => Promise<any>;

  /** Update declarations from a WebSocket broadcast (workflow-reloaded). */
  setDeclarations: (declarations: PipelineDeclarations) => void;
}

const EMPTY_DECLARATIONS: PipelineDeclarations = {
  modules: [],
  targets: [],
  environments: [],
};

export const usePipelineStore = create<PipelineState>((set, get) => ({
  declarations: EMPTY_DECLARATIONS,
  loaded: false,
  loading: false,

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

  setDeclarations: (declarations) => {
    set({ declarations, loaded: true });
  },
}));
