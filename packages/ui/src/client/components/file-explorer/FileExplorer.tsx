import { useEffect, useState } from 'react';
import { RefreshCw, FolderPlus, FilePlus, MoreVertical } from 'lucide-react';
import { ScrollArea } from '../ui/scroll-area';
import { Button } from '../ui/button';
import { FileTree } from './FileTree';
import { useFileStore } from '@/stores/fileStore';
import { MemoryFileSystem } from '@antimatter/filesystem';
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
      // Create a sample file structure for demonstration
      const fs = new MemoryFileSystem();

      // Create sample files and directories
      await fs.mkdir('src' as WorkspacePath);
      await fs.mkdir('src/components' as WorkspacePath);
      await fs.mkdir('src/lib' as WorkspacePath);
      await fs.mkdir('tests' as WorkspacePath);

      await fs.writeFile('README.md' as WorkspacePath, '# Project');
      await fs.writeFile('package.json' as WorkspacePath, '{}');
      await fs.writeFile('tsconfig.json' as WorkspacePath, '{}');
      await fs.writeFile('src/index.ts' as WorkspacePath, 'export {}');
      await fs.writeFile('src/App.tsx' as WorkspacePath, 'export default App');
      await fs.writeFile(
        'src/components/Button.tsx' as WorkspacePath,
        'export Button'
      );
      await fs.writeFile(
        'src/lib/utils.ts' as WorkspacePath,
        'export const utils'
      );
      await fs.writeFile('tests/example.test.ts' as WorkspacePath, 'test()');

      // Build file tree
      const tree = await buildFileTree(fs, '' as WorkspacePath);
      setFiles(tree);
    } catch (error) {
      console.error('Failed to load files:', error);
    } finally {
      setIsLoading(false);
    }
  }

  async function buildFileTree(
    fs: MemoryFileSystem,
    dir: WorkspacePath
  ): Promise<FileNode[]> {
    const entries = await fs.readDirectory(dir);
    const nodes: FileNode[] = [];

    for (const entry of entries) {
      const path = dir ? `${dir}/${entry.name}` : entry.name;
      const node: FileNode = {
        name: entry.name,
        path: path as WorkspacePath,
        isDirectory: entry.isDirectory,
      };

      if (entry.isDirectory) {
        node.children = await buildFileTree(fs, path as WorkspacePath);
      }

      nodes.push(node);
    }

    // Sort: directories first, then files, both alphabetically
    return nodes.sort((a, b) => {
      if (a.isDirectory === b.isDirectory) {
        return a.name.localeCompare(b.name);
      }
      return a.isDirectory ? -1 : 1;
    });
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
