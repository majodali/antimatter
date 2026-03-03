import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { WorkspacePath } from '@antimatter/filesystem';
import { createProjectStorage, serializeSet, deserializeSet } from '@/lib/storePersist';

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

export const useFileStore = create<FileStore>()(
  persist(
    (set) => ({
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
    }),
    {
      name: 'antimatter-files',
      storage: createProjectStorage('files'),
      partialize: (state) => ({
        files: state.files,
        selectedFile: state.selectedFile,
        expandedFolders: serializeSet(state.expandedFolders),
      }),
      merge: (persisted: any, current) => ({
        ...current,
        ...(persisted || {}),
        expandedFolders: persisted?.expandedFolders
          ? deserializeSet<string>(persisted.expandedFolders)
          : current.expandedFolders,
      }),
    },
  ),
);
