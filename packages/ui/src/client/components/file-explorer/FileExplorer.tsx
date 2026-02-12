import { useEffect, useState } from 'react';
import { RefreshCw, FolderPlus, FilePlus, MoreVertical } from 'lucide-react';
import { ScrollArea } from '../ui/scroll-area';
import { Button } from '../ui/button';
import { FileTree } from './FileTree';
import { useFileStore } from '@/stores/fileStore';
import type { WorkspacePath } from '@antimatter/filesystem';

interface FileNode {
  name: string;
  path: WorkspacePath;
  isDirectory: boolean;
  children?: FileNode[];
}

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

  useEffect(() => {
    loadFiles();
  }, []);

  async function loadFiles() {
    setIsLoading(true);
    try {
      // Mock file structure for demonstration
      const mockFiles: FileNode[] = [
        {
          name: 'src',
          path: 'src' as WorkspacePath,
          isDirectory: true,
          children: [
            {
              name: 'components',
              path: 'src/components' as WorkspacePath,
              isDirectory: true,
              children: [
                {
                  name: 'Button.tsx',
                  path: 'src/components/Button.tsx' as WorkspacePath,
                  isDirectory: false,
                },
                {
                  name: 'Input.tsx',
                  path: 'src/components/Input.tsx' as WorkspacePath,
                  isDirectory: false,
                },
              ],
            },
            {
              name: 'lib',
              path: 'src/lib' as WorkspacePath,
              isDirectory: true,
              children: [
                {
                  name: 'utils.ts',
                  path: 'src/lib/utils.ts' as WorkspacePath,
                  isDirectory: false,
                },
              ],
            },
            {
              name: 'App.tsx',
              path: 'src/App.tsx' as WorkspacePath,
              isDirectory: false,
            },
            {
              name: 'index.ts',
              path: 'src/index.ts' as WorkspacePath,
              isDirectory: false,
            },
          ],
        },
        {
          name: 'tests',
          path: 'tests' as WorkspacePath,
          isDirectory: true,
          children: [
            {
              name: 'example.test.ts',
              path: 'tests/example.test.ts' as WorkspacePath,
              isDirectory: false,
            },
          ],
        },
        {
          name: 'package.json',
          path: 'package.json' as WorkspacePath,
          isDirectory: false,
        },
        {
          name: 'README.md',
          path: 'README.md' as WorkspacePath,
          isDirectory: false,
        },
        {
          name: 'tsconfig.json',
          path: 'tsconfig.json' as WorkspacePath,
          isDirectory: false,
        },
      ];

      setFiles(mockFiles);
    } catch (error) {
      console.error('Failed to load files:', error);
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
