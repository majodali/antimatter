import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { WorkspacePath } from '@antimatter/filesystem';
import { saveFile as apiSaveFile, fetchFileContent, fileExists } from '@/lib/api';
import { createProjectStorage, serializeMap, deserializeMap } from '@/lib/storePersist';
import type { FileChange } from './fileStore';

interface EditorFile {
  path: WorkspacePath;
  content: string;
  originalContent: string;
  language: string;
  isDirty: boolean;
  /** Set when the file was modified externally while the editor has unsaved changes */
  isExternallyModified?: boolean;
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
  /** Handle file change notifications from workspace server */
  handleExternalChanges: (changes: FileChange[]) => void;
  /** Accept external version for a conflicted file */
  acceptExternalVersion: (path: WorkspacePath) => void;
  /** Validate all open tabs — close any whose files no longer exist on the server. */
  validateOpenTabs: (projectId?: string) => Promise<void>;
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

/** Max content size to persist per file (100KB) */
const MAX_PERSIST_CONTENT_SIZE = 100 * 1024;

export const useEditorStore = create<EditorStore>()(
  persist(
    (set, get) => ({
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

      handleExternalChanges: (changes) => {
        const state = get();
        for (const change of changes) {
          const filePath = change.path as WorkspacePath;
          const openFile = state.openFiles.get(filePath);
          if (!openFile) continue;

          if (change.type === 'delete') {
            // File deleted externally → close tab
            get().closeFile(filePath);
          } else if (change.type === 'modify' || change.type === 'create') {
            if (!openFile.isDirty) {
              // Not dirty → silently reload from server
              fetchFileContent(filePath).then((content) => {
                set((s) => {
                  const newOpenFiles = new Map(s.openFiles);
                  const existing = newOpenFiles.get(filePath);
                  if (existing && !existing.isDirty) {
                    newOpenFiles.set(filePath, {
                      ...existing,
                      content,
                      originalContent: content,
                      isExternallyModified: false,
                    });
                  }
                  return { openFiles: newOpenFiles };
                });
              }).catch(() => {
                // Ignore — file might be temporarily unavailable
              });
            } else {
              // Dirty → mark conflict, let user decide
              set((s) => {
                const newOpenFiles = new Map(s.openFiles);
                const existing = newOpenFiles.get(filePath);
                if (existing) {
                  newOpenFiles.set(filePath, { ...existing, isExternallyModified: true });
                }
                return { openFiles: newOpenFiles };
              });
            }
          }
        }
      },

      acceptExternalVersion: (path) => {
        fetchFileContent(path).then((content) => {
          set((s) => {
            const newOpenFiles = new Map(s.openFiles);
            const existing = newOpenFiles.get(path);
            if (existing) {
              newOpenFiles.set(path, {
                ...existing,
                content,
                originalContent: content,
                isDirty: false,
                isExternallyModified: false,
              });
            }
            return { openFiles: newOpenFiles };
          });
        }).catch(() => {});
      },

      validateOpenTabs: async (projectId?) => {
        const state = get();
        const openPaths = Array.from(state.openFiles.keys());
        if (openPaths.length === 0) return;

        // Check each open file in parallel
        const results = await Promise.allSettled(
          openPaths.map(async (path) => {
            const exists = await fileExists(path, projectId);
            return { path, exists };
          }),
        );

        const toClose: WorkspacePath[] = [];
        for (const result of results) {
          if (result.status === 'fulfilled' && !result.value.exists) {
            toClose.push(result.value.path);
          }
        }

        if (toClose.length > 0) {
          set((s) => {
            const newOpenFiles = new Map(s.openFiles);
            for (const path of toClose) {
              newOpenFiles.delete(path);
            }
            let newActiveFile = s.activeFile;
            if (newActiveFile && toClose.includes(newActiveFile)) {
              const remaining = Array.from(newOpenFiles.keys());
              newActiveFile = remaining.length > 0 ? remaining[remaining.length - 1] : null;
            }
            return { openFiles: newOpenFiles, activeFile: newActiveFile };
          });
        }
      },
    }),
    {
      name: 'antimatter-editor',
      storage: createProjectStorage('editor'),
      partialize: (state) => ({
        activeFile: state.activeFile,
        openFiles: serializeMap(state.openFiles)
          .filter(([, file]) => file.content.length <= MAX_PERSIST_CONTENT_SIZE),
      }),
      merge: (persisted: any, current) => ({
        ...current,
        ...(persisted || {}),
        openFiles: persisted?.openFiles
          ? deserializeMap<WorkspacePath, EditorFile>(persisted.openFiles)
          : current.openFiles,
        saveState: { status: 'idle' as const },
      }),
    },
  ),
);
