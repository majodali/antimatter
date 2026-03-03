import { create } from 'zustand';
import {
  fetchGitStatus,
  gitInit,
  gitStage,
  gitUnstage,
  gitCommit,
  gitPush,
  gitPull,
  gitAddRemote,
  fetchGitRemotes,
  fetchGitLog,
} from '@/lib/api';
import type { GitStatus } from '@/lib/api';
import { eventLog } from '@/lib/eventLog';

interface GitStore {
  status: GitStatus | null;
  remotes: { name: string; url: string; type: string }[];
  log: { hash: string; message: string }[];
  isLoading: boolean;
  error: string | null;
  commitMessage: string;

  loadStatus: (projectId?: string) => Promise<void>;
  loadRemotes: (projectId?: string) => Promise<void>;
  loadLog: (projectId?: string) => Promise<void>;
  stageFiles: (files: string[], projectId?: string) => Promise<void>;
  unstageFiles: (files: string[], projectId?: string) => Promise<void>;
  commit: (message: string, projectId?: string) => Promise<void>;
  push: (projectId?: string) => Promise<void>;
  pull: (projectId?: string) => Promise<void>;
  initRepo: (projectId?: string) => Promise<void>;
  addRemote: (name: string, url: string, projectId?: string) => Promise<void>;
  setCommitMessage: (message: string) => void;
  clearError: () => void;
}

export const useGitStore = create<GitStore>((set, get) => ({
  status: null,
  remotes: [],
  log: [],
  isLoading: false,
  error: null,
  commitMessage: '',

  loadStatus: async (projectId?: string) => {
    set({ isLoading: true, error: null });
    try {
      const status = await fetchGitStatus(projectId);
      set({ status, isLoading: false });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      set({ error: message, isLoading: false });
    }
  },

  loadRemotes: async (projectId?: string) => {
    try {
      const remotes = await fetchGitRemotes(projectId);
      set({ remotes });
    } catch {
      // Ignore — remotes may not exist
    }
  },

  loadLog: async (projectId?: string) => {
    try {
      const log = await fetchGitLog(20, projectId);
      set({ log });
    } catch {
      // Ignore — may not have commits yet
    }
  },

  stageFiles: async (files, projectId?) => {
    try {
      await gitStage(files, projectId);
      eventLog.info('file', `Staged: ${files.join(', ')}`);
      await get().loadStatus(projectId);
    } catch (err) {
      set({ error: err instanceof Error ? err.message : String(err) });
    }
  },

  unstageFiles: async (files, projectId?) => {
    try {
      await gitUnstage(files, projectId);
      eventLog.info('file', `Unstaged: ${files.join(', ')}`);
      await get().loadStatus(projectId);
    } catch (err) {
      set({ error: err instanceof Error ? err.message : String(err) });
    }
  },

  commit: async (message, projectId?) => {
    try {
      await gitCommit(message, projectId);
      eventLog.info('project', `Committed: ${message}`);
      set({ commitMessage: '' });
      await get().loadStatus(projectId);
      await get().loadLog(projectId);
    } catch (err) {
      set({ error: err instanceof Error ? err.message : String(err) });
    }
  },

  push: async (projectId?) => {
    try {
      await gitPush(undefined, undefined, projectId);
      eventLog.info('project', 'Pushed to remote');
      await get().loadLog(projectId);
    } catch (err) {
      set({ error: err instanceof Error ? err.message : String(err) });
    }
  },

  pull: async (projectId?) => {
    try {
      await gitPull(undefined, undefined, projectId);
      eventLog.info('project', 'Pulled from remote');
      await get().loadStatus(projectId);
      await get().loadLog(projectId);
    } catch (err) {
      set({ error: err instanceof Error ? err.message : String(err) });
    }
  },

  initRepo: async (projectId?) => {
    try {
      await gitInit(projectId);
      eventLog.info('project', 'Initialized git repository');
      await get().loadStatus(projectId);
    } catch (err) {
      set({ error: err instanceof Error ? err.message : String(err) });
    }
  },

  addRemote: async (name, url, projectId?) => {
    try {
      await gitAddRemote(name, url, projectId);
      eventLog.info('project', `Added remote: ${name} → ${url}`);
      await get().loadRemotes(projectId);
    } catch (err) {
      set({ error: err instanceof Error ? err.message : String(err) });
    }
  },

  setCommitMessage: (message) => set({ commitMessage: message }),

  clearError: () => set({ error: null }),
}));
