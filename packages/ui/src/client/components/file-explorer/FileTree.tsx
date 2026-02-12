import { ChevronRight, ChevronDown } from 'lucide-react';
import { cn } from '@/lib/utils';
import { getFileIcon, getFileColor } from '@/lib/fileIcons';
import type { WorkspacePath } from '@antimatter/filesystem';

interface FileNode {
  name: string;
  path: WorkspacePath;
  isDirectory: boolean;
  children?: FileNode[];
}

interface FileTreeProps {
  nodes: FileNode[];
  level?: number;
  expandedFolders: Set<string>;
  selectedFile: WorkspacePath | null;
  onSelectFile: (path: WorkspacePath) => void;
  onToggleFolder: (path: WorkspacePath) => void;
}

export function FileTree({
  nodes,
  level = 0,
  expandedFolders,
  selectedFile,
  onSelectFile,
  onToggleFolder,
}: FileTreeProps) {
  return (
    <div className="select-none">
      {nodes.map((node) => {
        const isExpanded = expandedFolders.has(node.path);
        const isSelected = selectedFile === node.path;
        const Icon = getFileIcon(node.name, node.isDirectory, isExpanded);
        const color = getFileColor(node.name, node.isDirectory);

        return (
          <div key={node.path}>
            <div
              className={cn(
                'flex items-center gap-1 px-2 py-1 cursor-pointer hover:bg-accent/50 rounded-sm text-sm',
                isSelected && 'bg-accent text-accent-foreground',
                !isSelected && 'text-foreground/90'
              )}
              style={{ paddingLeft: `${level * 12 + 8}px` }}
              onClick={() => {
                if (node.isDirectory) {
                  onToggleFolder(node.path);
                } else {
                  onSelectFile(node.path);
                }
              }}
            >
              {node.isDirectory && (
                <span className="flex-shrink-0">
                  {isExpanded ? (
                    <ChevronDown className="h-4 w-4" />
                  ) : (
                    <ChevronRight className="h-4 w-4" />
                  )}
                </span>
              )}
              {!node.isDirectory && <span className="w-4" />}
              <Icon className={cn('h-4 w-4 flex-shrink-0', color)} />
              <span className="truncate">{node.name}</span>
            </div>

            {node.isDirectory && isExpanded && node.children && (
              <FileTree
                nodes={node.children}
                level={level + 1}
                expandedFolders={expandedFolders}
                selectedFile={selectedFile}
                onSelectFile={onSelectFile}
                onToggleFolder={onToggleFolder}
              />
            )}
          </div>
        );
      })}
    </div>
  );
}
