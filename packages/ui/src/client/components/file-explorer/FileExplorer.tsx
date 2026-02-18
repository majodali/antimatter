import { useEffect, useState } from 'react';
import { RefreshCw, FolderPlus, FilePlus, MoreVertical } from 'lucide-react';
import { ScrollArea } from '../ui/scroll-area';
import { Button } from '../ui/button';
import { FileTree } from './FileTree';
import { useFileStore } from '@/stores/fileStore';
import { fetchFileTree } from '@/lib/api';
import { onFileChange } from '@/lib/ws';

export function FileExplorer() {
  const {
    files,
    setFiles,
    selectedFile,
    selectFile,
    expandedFolders,
    toggleFolder,
  } = useFileStore();

  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    loadFiles();
    const unsub = onFileChange(() => {
      loadFiles();
    });
    return unsub;
  }, []);

  async function loadFiles() {
    setIsLoading(true);
    setError(null);
    try {
      const tree = await fetchFileTree();
      setFiles(tree);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to load files';
      setError(msg);
      console.error('Failed to load files:', err);
    } finally {
      setIsLoading(false);
    }
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
          <Button variant="ghost" size="icon" className="h-6 w-6">
            <FilePlus className="h-3.5 w-3.5" />
          </Button>
          <Button variant="ghost" size="icon" className="h-6 w-6">
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
          {isLoading ? (
            <div className="px-4 py-2 text-xs text-muted-foreground">
              Loading files...
            </div>
          ) : error ? (
            <div className="px-4 py-2 text-xs text-red-500">
              {error}
            </div>
          ) : files.length === 0 ? (
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
