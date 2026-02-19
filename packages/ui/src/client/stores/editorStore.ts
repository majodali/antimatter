import { create } from 'zustand';
import type { WorkspacePath } from '@antimatter/filesystem';
import { saveFile as apiSaveFile } from '@/lib/api';

interface EditorFile {
  path: WorkspacePath;
  content: string;
  originalContent: string;
  language: string;
  isDirty: boolean;
}

interface SaveState {
  status: 'idle' | 'saving' | 'saved' | 'error';
  error?: string;
}

interface EditorStore {
  openFiles: Map<WorkspacePath, EditorFile>;
  activeFile: WorkspacePath | null;
  saveState: SaveState;

  openFile: (path: WorkspacePath, content: string, language: string) => void;
  closeFile: (path: WorkspacePath) => void;
  closeAllFiles: () => void;
  setActiveFile: (path: WorkspacePath | null) => void;
  getActiveFileContent: () => EditorFile | null;
  updateFileContent: (path: WorkspacePath, content: string) => void;
  saveFile: (path: WorkspacePath, projectId?: string) => Promise<void>;
  saveActiveFile: (projectId?: string) => Promise<void>;
}

let autoSaveTimer: ReturnType<typeof setTimeout> | null = null;
let savedClearTimer: ReturnType<typeof setTimeout> | null = null;
let errorClearTimer: ReturnType<typeof setTimeout> | null = null;

export function scheduleAutoSave(path: WorkspacePath, projectId?: string) {
  if (autoSaveTimer) clearTimeout(autoSaveTimer);
  autoSaveTimer = setTimeout(() => {
    autoSaveTimer = null;
    useEditorStore.getState().saveFile(path, projectId);
  }, 1500);
}

export const useEditorStore = create<EditorStore>((set, get) => ({
  openFiles: new Map(),
  activeFile: null,
  saveState: { status: 'idle' },

  openFile: (path, content, language) =>
    set((state) => {
      const newOpenFiles = new Map(state.openFiles);
      newOpenFiles.set(path, { path, content, originalContent: content, language, isDirty: false });
      return {
        openFiles: newOpenFiles,
        activeFile: path,
      };
    }),

  closeFile: (path) =>
    set((state) => {
      const newOpenFiles = new Map(state.openFiles);
      newOpenFiles.delete(path);
      let newActiveFile = state.activeFile;
      if (state.activeFile === path) {
        const remaining = Array.from(newOpenFiles.keys());
        newActiveFile = remaining.length > 0 ? remaining[remaining.length - 1] : null;
      }
      return {
        openFiles: newOpenFiles,
        activeFile: newActiveFile,
      };
    }),

  closeAllFiles: () => set({ openFiles: new Map(), activeFile: null }),

  setActiveFile: (path) => set({ activeFile: path }),

  getActiveFileContent: () => {
    const state = get();
    if (!state.activeFile) return null;
    return state.openFiles.get(state.activeFile) || null;
  },

  updateFileContent: (path, content) =>
    set((state) => {
      const existing = state.openFiles.get(path);
      if (!existing) return state;
      const newOpenFiles = new Map(state.openFiles);
      newOpenFiles.set(path, {
        ...existing,
        content,
        isDirty: content !== existing.originalContent,
      });
      return { openFiles: newOpenFiles };
    }),

  saveFile: async (path, projectId?) => {
    const state = get();
    const file = state.openFiles.get(path);
    if (!file || !file.isDirty) return;

    if (savedClearTimer) { clearTimeout(savedClearTimer); savedClearTimer = null; }
    if (errorClearTimer) { clearTimeout(errorClearTimer); errorClearTimer = null; }

    set({ saveState: { status: 'saving' } });

    try {
      await apiSaveFile(path, file.content, projectId);

      // After save, re-read state in case user typed during the save
      set((current) => {
        const latest = current.openFiles.get(path);
        if (!latest) return { saveState: { status: 'saved' } };
        const newOpenFiles = new Map(current.openFiles);
        newOpenFiles.set(path, {
          ...latest,
          originalContent: file.content,
          isDirty: latest.content !== file.content,
        });
        return { openFiles: newOpenFiles, saveState: { status: 'saved' } };
      });

      savedClearTimer = setTimeout(() => {
        savedClearTimer = null;
        set({ saveState: { status: 'idle' } });
      }, 2000);

      // If user typed during save, re-trigger auto-save
      const afterSave = get().openFiles.get(path);
      if (afterSave?.isDirty) {
        scheduleAutoSave(path, projectId);
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      set({ saveState: { status: 'error', error: message } });
      errorClearTimer = setTimeout(() => {
        errorClearTimer = null;
        set({ saveState: { status: 'idle' } });
      }, 3000);
    }
  },

  saveActiveFile: async (projectId?) => {
    const state = get();
    if (!state.activeFile) return;
    await get().saveFile(state.activeFile, projectId);
  },
}));
