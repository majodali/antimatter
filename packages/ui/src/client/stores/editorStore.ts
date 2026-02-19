import { create } from 'zustand';
import type { WorkspacePath } from '@antimatter/filesystem';

interface EditorFile {
  path: WorkspacePath;
  content: string;
  language: string;
}

interface EditorStore {
  openFiles: Map<WorkspacePath, EditorFile>;
  activeFile: WorkspacePath | null;

  openFile: (path: WorkspacePath, content: string, language: string) => void;
  closeFile: (path: WorkspacePath) => void;
  closeAllFiles: () => void;
  setActiveFile: (path: WorkspacePath | null) => void;
  getActiveFileContent: () => EditorFile | null;
}

export const useEditorStore = create<EditorStore>((set, get) => ({
  openFiles: new Map(),
  activeFile: null,

  openFile: (path, content, language) =>
    set((state) => {
      const newOpenFiles = new Map(state.openFiles);
      newOpenFiles.set(path, { path, content, language });
      return {
        openFiles: newOpenFiles,
        activeFile: path,
      };
    }),

  closeFile: (path) =>
    set((state) => {
      const newOpenFiles = new Map(state.openFiles);
      newOpenFiles.delete(path);
      const newActiveFile =
        state.activeFile === path ? null : state.activeFile;
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
}));
