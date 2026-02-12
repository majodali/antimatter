import { create } from 'zustand';
import type { WorkspacePath } from '@antimatter/filesystem';

interface FileNode {
  name: string;
  path: WorkspacePath;
  isDirectory: boolean;
  isExpanded?: boolean;
  children?: FileNode[];
}

interface FileStore {
  files: FileNode[];
  selectedFile: WorkspacePath | null;
  expandedFolders: Set<string>;

  setFiles: (files: FileNode[]) => void;
  selectFile: (path: WorkspacePath) => void;
  toggleFolder: (path: WorkspacePath) => void;
  expandFolder: (path: WorkspacePath) => void;
  collapseFolder: (path: WorkspacePath) => void;
}

export const useFileStore = create<FileStore>((set) => ({
  files: [],
  selectedFile: null,
  expandedFolders: new Set<string>(),

  setFiles: (files) => set({ files }),

  selectFile: (path) => set({ selectedFile: path }),

  toggleFolder: (path) =>
    set((state) => {
      const newExpanded = new Set(state.expandedFolders);
      if (newExpanded.has(path)) {
        newExpanded.delete(path);
      } else {
        newExpanded.add(path);
      }
      return { expandedFolders: newExpanded };
    }),

  expandFolder: (path) =>
    set((state) => ({
      expandedFolders: new Set(state.expandedFolders).add(path),
    })),

  collapseFolder: (path) =>
    set((state) => {
      const newExpanded = new Set(state.expandedFolders);
      newExpanded.delete(path);
      return { expandedFolders: newExpanded };
    }),
}));
