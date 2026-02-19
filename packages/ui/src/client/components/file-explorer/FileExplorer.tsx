import { useEffect, useRef, useState } from 'react';
import { RefreshCw, FolderPlus, FilePlus, MoreVertical, File, Folder } from 'lucide-react';
import { ScrollArea } from '../ui/scroll-area';
import { Button } from '../ui/button';
import { FileTree } from './FileTree';
import { useFileStore } from '@/stores/fileStore';
import { useEditorStore } from '@/stores/editorStore';
import { useProjectStore } from '@/stores/projectStore';
import { fetchFileTree, saveFile, createFolder } from '@/lib/api';
import { onFileChange } from '@/lib/ws';
import type { WorkspacePath } from '@antimatter/filesystem';

export function FileExplorer() {
  const {
    files,
    setFiles,
    selectedFile,
    selectFile,
    expandedFolders,
    toggleFolder,
  } = useFileStore();

  const openFile = useEditorStore((s) => s.openFile);
  const currentProjectId = useProjectStore((s) => s.currentProjectId);

  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [creatingType, setCreatingType] = useState<'file' | 'folder' | null>(null);
  const [newName, setNewName] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    loadFiles();
    const unsub = onFileChange(() => {
      loadFiles();
    });
    return unsub;
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
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to load files';
      setError(msg);
      console.error('Failed to load files:', err);
    } finally {
      setIsLoading(false);
    }
  }

  function cancelCreation() {
    setCreatingType(null);
    setNewName('');
  }

  async function submitCreation() {
    const name = newName.trim();
    if (!name) {
      cancelCreation();
      return;
    }

    const pid = currentProjectId ?? undefined;
    try {
      if (creatingType === 'file') {
        await saveFile(name, '', pid);
        await loadFiles();
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
        await loadFiles();
      }
    } catch (err) {
      console.error(`Failed to create ${creatingType}:`, err);
    }
    cancelCreation();
  }

  return (
    <div className="h-full flex flex-col bg-card">
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
          >
            <FilePlus className="h-3.5 w-3.5" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="h-6 w-6"
            onClick={() => { cancelCreation(); setCreatingType('folder'); }}
          >
            <FolderPlus className="h-3.5 w-3.5" />
          </Button>
          <Button variant="ghost" size="icon" className="h-6 w-6">
            <MoreVertical className="h-3.5 w-3.5" />
          </Button>
        </div>
      </div>

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
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') submitCreation();
                  if (e.key === 'Escape') cancelCreation();
                }}
                onBlur={cancelCreation}
              />
            </div>
          )}

          {isLoading ? (
            <div className="px-4 py-2 text-xs text-muted-foreground">
              Loading files...
            </div>
          ) : error ? (
            <div className="px-4 py-2 text-xs text-red-500">
              {error}
            </div>
          ) : files.length === 0 && !creatingType ? (
            <div className="px-4 py-2 text-xs text-muted-foreground">
              No files found
            </div>
          ) : (
            <FileTree
              nodes={files}
              expandedFolders={expandedFolders}
              selectedFile={selectedFile}
              onSelectFile={selectFile}
              onToggleFolder={toggleFolder}
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
