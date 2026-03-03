import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { WorkspacePath } from '@antimatter/filesystem';
import { createProjectStorage, serializeSet, deserializeSet } from '@/lib/storePersist';
import { fetchFileTree } from '@/lib/api';
import { useProjectStore } from './projectStore';

export interface FileChange {
  type: 'create' | 'modify' | 'delete';
  path: string;
}

let treeRefreshTimer: ReturnType<typeof setTimeout> | null = null;

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
  /** Handle file change notifications from workspace server */
  handleExternalChanges: (changes: FileChange[]) => void;
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

      handleExternalChanges: (changes) => {
        // Any create/delete means tree structure changed → debounced refresh
        const hasStructuralChange = changes.some(c => c.type === 'create' || c.type === 'delete');
        if (hasStructuralChange) {
          // Debounce at 500ms to coalesce bulk ops (git checkout, etc.)
          if (treeRefreshTimer) clearTimeout(treeRefreshTimer);
          treeRefreshTimer = setTimeout(async () => {
            treeRefreshTimer = null;
            try {
              const projectId = useProjectStore.getState().currentProjectId;
              const tree = await fetchFileTree('/', projectId ?? undefined);
              set({ files: tree });
            } catch {
              // Ignore — tree will be stale but user can manually refresh
            }
          }, 500);
        }
      },
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
