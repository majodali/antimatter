import { useEffect, useRef, useState, useCallback } from 'react';
import { RefreshCw, FolderPlus, FilePlus, MoreVertical, File, Folder, Trash2, X } from 'lucide-react';
import { ScrollArea } from '../ui/scroll-area';
import { Button } from '../ui/button';
import { FileTree } from './FileTree';
import { useFileStore } from '@/stores/fileStore';
import { useEditorStore } from '@/stores/editorStore';
import { useProjectStore } from '@/stores/projectStore';
import { useApplicationStore } from '@/stores/applicationStore';
import { fetchFileTree, fetchFileContent, saveFile, createFolder, deleteFile as apiDeleteFile } from '@/lib/api';
import { detectLanguage } from '@/lib/languageDetection';
import { eventLog } from '@/lib/eventLog';
import type { WorkspacePath } from '@antimatter/filesystem';

export function FileExplorer() {
  const {
    files,
    setFiles,
    selectedFile,
    selectedFiles,
    expandedFolders,
    selectFile,
    clearSelection,
    toggleFolder,
    pendingDelete,
    requestDeleteSelected,
    confirmDelete,
    cancelDelete,
    renamingFile,
    startRename,
    cancelRename,
    clipboard,
    setClipboard,
    clearClipboard,
  } = useFileStore();

  const openFile = useEditorStore((s) => s.openFile);
  const closeFile = useEditorStore((s) => s.closeFile);
  const currentProjectId = useProjectStore((s) => s.currentProjectId);
  const errorCounts = useApplicationStore((s) => s.getErrorCountsByFile());

  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [creatingType, setCreatingType] = useState<'file' | 'folder' | null>(null);
  const [newName, setNewName] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);
  const isSubmittingRef = useRef(false);
  const containerRef = useRef<HTMLDivElement>(null);

  // Load files on mount and when project changes
  useEffect(() => {
    loadFiles();
  }, [currentProjectId]);

  useEffect(() => {
    if (creatingType && inputRef.current) {
      inputRef.current.focus();
    }
  }, [creatingType]);

  async function loadFiles() {
    setIsLoading(true);
    setError(null);
    try {
      const tree = await fetchFileTree('/', currentProjectId ?? undefined);
      setFiles(tree);
      eventLog.info('file', `File tree loaded (${tree.length} items)`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to load files';
      setError(msg);
      eventLog.error('file', 'Failed to load file tree', msg);
    } finally {
      setIsLoading(false);
    }
  }

  function cancelCreation() {
    setCreatingType(null);
    setNewName('');
  }

  async function submitCreation() {
    const name = (inputRef.current?.value ?? newName).trim();
    if (!name) {
      cancelCreation();
      return;
    }

    isSubmittingRef.current = true;
    const pid = currentProjectId ?? undefined;
    try {
      if (creatingType === 'file') {
        await saveFile(name, '', pid);
        eventLog.info('file', `File created: ${name}`);
        await loadFiles();

        // Auto-expand parent folders for nested paths
        if (name.includes('/')) {
          const segments = name.split('/');
          for (let i = 1; i < segments.length; i++) {
            const ancestor = segments.slice(0, i).join('/') as WorkspacePath;
            if (!expandedFolders.has(ancestor)) {
              toggleFolder(ancestor);
            }
          }
        }

        // Detect language from extension
        const ext = name.split('.').pop() ?? '';
        const langMap: Record<string, string> = {
          ts: 'typescript', tsx: 'typescriptreact',
          js: 'javascript', jsx: 'javascriptreact',
          json: 'json', md: 'markdown', css: 'css',
          html: 'html', py: 'python', rs: 'rust',
        };
        openFile(name as WorkspacePath, '', langMap[ext] ?? 'plaintext');
      } else {
        await createFolder(name, pid);
        eventLog.info('file', `Folder created: ${name}`);
        await loadFiles();

        // Auto-expand parent folders
        if (name.includes('/')) {
          const segments = name.split('/');
          for (let i = 1; i < segments.length; i++) {
            const ancestor = segments.slice(0, i).join('/') as WorkspacePath;
            if (!expandedFolders.has(ancestor)) {
              toggleFolder(ancestor);
            }
          }
        }
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setError(`Failed to create ${creatingType}: ${msg}`);
      eventLog.error('file', `Failed to create ${creatingType}: ${name}`, msg);
    } finally {
      isSubmittingRef.current = false;
      cancelCreation();
    }
  }

  /** Open a file in the editor (triggered by double-click in file tree). */
  const handleOpenFile = useCallback(async (path: WorkspacePath) => {
    const editorState = useEditorStore.getState();
    if (editorState.openFiles.has(path)) {
      // Already open → just activate
      editorState.setActiveFile(path);
      return;
    }
    // Load from server and open
    try {
      const content = await fetchFileContent(path, currentProjectId ?? undefined);
      const language = detectLanguage(path);
      editorState.openFile(path, content, language);
      eventLog.info('editor', `Opened: ${path}`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to load file';
      eventLog.error('editor', `Failed to load file: ${path}`, msg);
    }
  }, [currentProjectId]);

  /** Handle inline rename submission. */
  const handleRenameSubmit = useCallback(async (oldPath: WorkspacePath, newName: string) => {
    const pid = currentProjectId ?? undefined;
    // Build the new path: same directory, new name
    const parts = oldPath.split('/');
    parts[parts.length - 1] = newName;
    const newPath = parts.join('/') as WorkspacePath;

    try {
      // Read old file content
      const content = await fetchFileContent(oldPath, pid);
      // Write to new path
      await saveFile(newPath, content, pid);
      // Delete old path
      await apiDeleteFile(oldPath, pid);
      eventLog.info('file', `Renamed: ${oldPath} → ${newPath}`);

      // Close old tab and open new one
      const editorState = useEditorStore.getState();
      if (editorState.openFiles.has(oldPath)) {
        editorState.closeFile(oldPath);
        const language = detectLanguage(newPath);
        editorState.openFile(newPath, content, language);
      }

      await loadFiles();
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      eventLog.error('file', `Failed to rename ${oldPath}: ${msg}`);
    }
    cancelRename();
  }, [currentProjectId]);

  /** Handle drag-drop move. */
  const handleDrop = useCallback(async (targetDir: WorkspacePath, e: React.DragEvent) => {
    const data = e.dataTransfer.getData('text/plain');
    if (!data) return;
    try {
      const paths: string[] = JSON.parse(data);
      const pid = currentProjectId ?? undefined;

      for (const sourcePath of paths) {
        const fileName = sourcePath.split('/').pop() ?? sourcePath;
        const destPath = `${targetDir}/${fileName}` as WorkspacePath;

        // Read content, write to new location, delete old
        const content = await fetchFileContent(sourcePath, pid);
        await saveFile(destPath, content, pid);
        await apiDeleteFile(sourcePath, pid);

        // Update editor tabs
        const editorState = useEditorStore.getState();
        if (editorState.openFiles.has(sourcePath as WorkspacePath)) {
          editorState.closeFile(sourcePath as WorkspacePath);
          const language = detectLanguage(destPath);
          editorState.openFile(destPath, content, language);
        }
      }

      eventLog.info('file', `Moved ${paths.length} file(s) to ${targetDir}`);
      await loadFiles();
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      eventLog.error('file', `Failed to move files: ${msg}`);
    }
  }, [currentProjectId]);

  /** Handle clipboard paste. */
  const handlePaste = useCallback(async () => {
    const clipState = useFileStore.getState().clipboard;
    if (!clipState) return;

    const pid = currentProjectId ?? undefined;
    // Determine target directory from selection
    const targetFile = selectedFile;
    let targetDir = '' as WorkspacePath;

    if (targetFile) {
      // Find if selected item is a directory
      const findNode = (nodes: typeof files, path: string): typeof files[number] | null => {
        for (const n of nodes) {
          if (n.path === path) return n;
          if (n.children) {
            const found = findNode(n.children, path);
            if (found) return found;
          }
        }
        return null;
      };
      const node = findNode(files, targetFile);
      if (node?.isDirectory) {
        targetDir = node.path;
      } else if (targetFile.includes('/')) {
        targetDir = targetFile.split('/').slice(0, -1).join('/') as WorkspacePath;
      }
    }

    try {
      for (const sourcePath of clipState.paths) {
        const fileName = sourcePath.split('/').pop() ?? sourcePath;
        const destPath = targetDir ? `${targetDir}/${fileName}` as WorkspacePath : fileName as WorkspacePath;

        const content = await fetchFileContent(sourcePath, pid);
        await saveFile(destPath, content, pid);

        if (clipState.mode === 'cut') {
          await apiDeleteFile(sourcePath, pid);
          const editorState = useEditorStore.getState();
          if (editorState.openFiles.has(sourcePath)) {
            editorState.closeFile(sourcePath);
          }
        }
      }

      if (clipState.mode === 'cut') {
        clearClipboard();
      }

      eventLog.info('file', `Pasted ${clipState.paths.size} file(s) (${clipState.mode})`);
      await loadFiles();
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      eventLog.error('file', `Failed to paste files: ${msg}`);
    }
  }, [currentProjectId, selectedFile, files]);

  // Keyboard handler for the explorer panel
  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    // Delete key → request delete of selected files
    if (e.key === 'Delete' && selectedFiles.size > 0 && !renamingFile) {
      e.preventDefault();
      requestDeleteSelected();
      return;
    }

    // Ctrl+C → copy selected files
    if ((e.ctrlKey || e.metaKey) && e.key === 'c' && selectedFiles.size > 0) {
      e.preventDefault();
      setClipboard('copy');
      return;
    }

    // Ctrl+X → cut selected files
    if ((e.ctrlKey || e.metaKey) && e.key === 'x' && selectedFiles.size > 0) {
      e.preventDefault();
      setClipboard('cut');
      return;
    }

    // Ctrl+V → paste
    if ((e.ctrlKey || e.metaKey) && e.key === 'v' && clipboard) {
      e.preventDefault();
      handlePaste();
      return;
    }

    // F2 → rename selected file
    if (e.key === 'F2' && selectedFile && selectedFiles.size === 1) {
      e.preventDefault();
      startRename(selectedFile);
      return;
    }

    // Escape → clear selection or cancel delete
    if (e.key === 'Escape') {
      if (pendingDelete) {
        cancelDelete();
      } else if (renamingFile) {
        cancelRename();
      } else {
        clearSelection();
      }
      return;
    }
  }, [selectedFiles, selectedFile, renamingFile, clipboard, pendingDelete]);

  return (
    <div
      ref={containerRef}
      className="h-full flex flex-col bg-card outline-none"
      tabIndex={0}
      onKeyDown={handleKeyDown}
      data-testid="file-explorer-panel"
    >
      {/* Header */}
      <div className="px-2 py-2 border-b border-border flex items-center justify-between">
        <h3 className="text-sm font-medium">Explorer</h3>
        <div className="flex items-center gap-1">
          <Button
            variant="ghost"
            size="icon"
            className="h-6 w-6"
            onClick={loadFiles}
            disabled={isLoading}
            data-testid="file-explorer-refresh-btn"
          >
            <RefreshCw
              className={cn('h-3.5 w-3.5', isLoading && 'animate-spin')}
            />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="h-6 w-6"
            onClick={() => { cancelCreation(); setCreatingType('file'); }}
            data-testid="file-explorer-new-file-btn"
          >
            <FilePlus className="h-3.5 w-3.5" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="h-6 w-6"
            onClick={() => { cancelCreation(); setCreatingType('folder'); }}
            data-testid="file-explorer-new-folder-btn"
          >
            <FolderPlus className="h-3.5 w-3.5" />
          </Button>
          <Button variant="ghost" size="icon" className="h-6 w-6" data-testid="file-explorer-more-btn">
            <MoreVertical className="h-3.5 w-3.5" />
          </Button>
        </div>
      </div>

      {/* Delete confirmation bar */}
      {pendingDelete && pendingDelete.size > 0 && (
        <div
          className="px-2 py-1.5 bg-destructive/10 border-b border-destructive/30 flex items-center gap-2 text-xs"
          data-testid="file-explorer-delete-confirm"
        >
          <Trash2 className="h-3.5 w-3.5 text-destructive flex-shrink-0" />
          <span className="flex-1 text-destructive">
            Delete {pendingDelete.size} {pendingDelete.size === 1 ? 'item' : 'items'}?
          </span>
          <Button
            variant="destructive"
            size="sm"
            className="h-5 px-2 text-xs"
            onClick={async () => {
              // Close editor tabs for files being deleted
              const deletePaths = pendingDelete ? Array.from(pendingDelete) : [];
              const editorState = useEditorStore.getState();
              for (const p of deletePaths) {
                if (editorState.openFiles.has(p)) {
                  editorState.closeFile(p);
                }
              }
              await confirmDelete();
            }}
            data-testid="file-explorer-confirm-delete-btn"
          >
            Delete
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="h-5 w-5"
            onClick={cancelDelete}
            data-testid="file-explorer-cancel-delete-btn"
          >
            <X className="h-3 w-3" />
          </Button>
        </div>
      )}

      {/* File tree */}
      <ScrollArea className="flex-1">
        <div className="py-1">
          {/* Inline creation input */}
          {creatingType && (
            <div className="flex items-center gap-1 px-2 py-0.5">
              {creatingType === 'file' ? (
                <File className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
              ) : (
                <Folder className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
              )}
              <input
                ref={inputRef}
                type="text"
                className="flex-1 bg-background border border-primary rounded px-1 py-0.5 text-xs outline-none"
                placeholder={creatingType === 'file' ? 'file name...' : 'folder name...'}
                data-testid="file-explorer-create-input"
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') submitCreation();
                  if (e.key === 'Escape') cancelCreation();
                }}
                onBlur={() => { if (!isSubmittingRef.current) cancelCreation(); }}
              />
            </div>
          )}

          {isLoading ? (
            <div className="px-4 py-2 text-xs text-muted-foreground" data-testid="file-explorer-loading">
              Loading files...
            </div>
          ) : error ? (
            <div className="px-4 py-2 text-xs text-red-500" data-testid="file-explorer-error">
              {error}
            </div>
          ) : files.length === 0 && !creatingType ? (
            <div className="px-4 py-2 text-xs text-muted-foreground" data-testid="file-explorer-empty">
              No files found
            </div>
          ) : (
            <FileTree
              nodes={files}
              expandedFolders={expandedFolders}
              selectedFile={selectedFile}
              selectedFiles={selectedFiles}
              renamingFile={renamingFile}
              onSelectFile={selectFile}
              onOpenFile={handleOpenFile}
              onToggleFolder={toggleFolder}
              onRenameSubmit={handleRenameSubmit}
              onRenameCancel={cancelRename}
              onDrop={handleDrop}
              errorCounts={errorCounts}
            />
          )}
        </div>
      </ScrollArea>
    </div>
  );
}

function cn(...classes: (string | boolean | undefined)[]) {
  return classes.filter(Boolean).join(' ');
}
