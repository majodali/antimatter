import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { WorkspacePath } from '@antimatter/filesystem';
import { createProjectStorage, serializeSet, deserializeSet } from '@/lib/storePersist';
import { fetchFileTree, deleteFile as apiDeleteFile } from '@/lib/api';
import { useProjectStore } from './projectStore';
export interface FileChange {
  type: 'create' | 'modify' | 'delete';
  path: string;
}

let treeRefreshTimer: ReturnType<typeof setTimeout> | null = null;

export interface FileNode {
  name: string;
  path: WorkspacePath;
  isDirectory: boolean;
  isExpanded?: boolean;
  children?: FileNode[];
}

/** Flatten a file tree into an ordered list of visible file paths. */
function flattenVisiblePaths(nodes: FileNode[], expandedFolders: Set<string>): WorkspacePath[] {
  const result: WorkspacePath[] = [];
  for (const node of nodes) {
    result.push(node.path);
    if (node.isDirectory && expandedFolders.has(node.path) && node.children) {
      result.push(...flattenVisiblePaths(node.children, expandedFolders));
    }
  }
  return result;
}

export interface SelectFileOptions {
  /** Ctrl/Cmd-click: toggle individual file in selection */
  ctrl?: boolean;
  /** Shift-click: range select from anchor to target */
  shift?: boolean;
}

interface FileStore {
  files: FileNode[];
  /** The primary selected file (last clicked). Used as anchor for shift-select. */
  selectedFile: WorkspacePath | null;
  /** All currently selected files (for multi-select). */
  selectedFiles: Set<WorkspacePath>;
  expandedFolders: Set<string>;
  /** Pending delete confirmation: set of paths awaiting user confirmation. */
  pendingDelete: Set<WorkspacePath> | null;
  /** Path currently being renamed inline. */
  renamingFile: WorkspacePath | null;
  /** Clipboard for cut/copy operations. */
  clipboard: { paths: Set<WorkspacePath>; mode: 'copy' | 'cut' } | null;

  setFiles: (files: FileNode[]) => void;
  /** Select a file with optional multi-select modifiers. */
  selectFile: (path: WorkspacePath, opts?: SelectFileOptions) => void;
  clearSelection: () => void;
  toggleFolder: (path: WorkspacePath) => void;
  expandFolder: (path: WorkspacePath) => void;
  collapseFolder: (path: WorkspacePath) => void;
  /** Request deletion of currently selected files (shows confirmation). */
  requestDeleteSelected: () => void;
  /** Confirm pending deletion. */
  confirmDelete: () => Promise<void>;
  /** Cancel pending deletion. */
  cancelDelete: () => void;
  /** Start inline rename for a file. */
  startRename: (path: WorkspacePath) => void;
  /** Cancel inline rename. */
  cancelRename: () => void;
  /** Set clipboard for cut/copy. */
  setClipboard: (mode: 'copy' | 'cut') => void;
  /** Clear clipboard. */
  clearClipboard: () => void;
  /** Handle file change notifications from workspace server */
  handleExternalChanges: (changes: FileChange[]) => void;
}

export const useFileStore = create<FileStore>()(
  persist(
    (set, get) => ({
      files: [],
      selectedFile: null,
      selectedFiles: new Set<WorkspacePath>(),
      expandedFolders: new Set<string>(),
      pendingDelete: null,
      renamingFile: null,
      clipboard: null,

      setFiles: (files) => set({ files }),

      selectFile: (path, opts) =>
        set((state) => {
          if (opts?.ctrl) {
            // Ctrl+click: toggle file in selection
            const newSelected = new Set(state.selectedFiles);
            if (newSelected.has(path)) {
              newSelected.delete(path);
              return {
                selectedFiles: newSelected,
                selectedFile: newSelected.size > 0 ? path : null,
              };
            } else {
              newSelected.add(path);
              return { selectedFiles: newSelected, selectedFile: path };
            }
          }

          if (opts?.shift && state.selectedFile) {
            // Shift+click: range select from anchor to target
            const visiblePaths = flattenVisiblePaths(state.files, state.expandedFolders);
            const anchorIdx = visiblePaths.indexOf(state.selectedFile);
            const targetIdx = visiblePaths.indexOf(path);
            if (anchorIdx >= 0 && targetIdx >= 0) {
              const start = Math.min(anchorIdx, targetIdx);
              const end = Math.max(anchorIdx, targetIdx);
              const newSelected = new Set(state.selectedFiles);
              for (let i = start; i <= end; i++) {
                newSelected.add(visiblePaths[i]);
              }
              return { selectedFiles: newSelected, selectedFile: path };
            }
          }

          // Normal click: single select (replaces selection)
          return {
            selectedFile: path,
            selectedFiles: new Set([path]),
          };
        }),

      clearSelection: () => set({ selectedFile: null, selectedFiles: new Set() }),

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

      requestDeleteSelected: () =>
        set((state) => {
          if (state.selectedFiles.size === 0) return state;
          return { pendingDelete: new Set(state.selectedFiles) };
        }),

      confirmDelete: async () => {
        const state = get();
        if (!state.pendingDelete || state.pendingDelete.size === 0) return;

        const paths = Array.from(state.pendingDelete);
        const projectId = useProjectStore.getState().currentProjectId ?? undefined;

        // Clear pending immediately to dismiss confirmation UI
        set({ pendingDelete: null });

        try {
          // Delete all files in parallel
          await Promise.all(paths.map((p) => apiDeleteFile(p, projectId)));
          // Clear selection of deleted files and refresh tree
          set((s) => {
            const newSelected = new Set(s.selectedFiles);
            for (const p of paths) newSelected.delete(p);
            return {
              selectedFiles: newSelected,
              selectedFile: newSelected.size > 0 ? Array.from(newSelected)[0] : null,
            };
          });

          // Refresh file tree
          const tree = await fetchFileTree('/', projectId);
          set({ files: tree });
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
        }
      },

      cancelDelete: () => set({ pendingDelete: null }),

      startRename: (path) => set({ renamingFile: path }),

      cancelRename: () => set({ renamingFile: null }),

      setClipboard: (mode) =>
        set((state) => ({
          clipboard: { paths: new Set(state.selectedFiles), mode },
        })),

      clearClipboard: () => set({ clipboard: null }),

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
