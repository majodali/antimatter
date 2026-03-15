import { useState, useRef, useEffect } from 'react';
import { ChevronRight, ChevronDown } from 'lucide-react';
import { cn } from '@/lib/utils';
import { getFileIcon, getFileColor } from '@/lib/fileIcons';
import type { WorkspacePath } from '@antimatter/filesystem';
import type { SelectFileOptions } from '@/stores/fileStore';

/** Encode a file path for use in data-testid attributes. Replaces / with -- */
function encodePathForTestId(path: string): string {
  return path.replace(/\//g, '--');
}

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
  selectedFiles: Set<WorkspacePath>;
  renamingFile: WorkspacePath | null;
  onSelectFile: (path: WorkspacePath, opts?: SelectFileOptions) => void;
  onOpenFile: (path: WorkspacePath) => void;
  onToggleFolder: (path: WorkspacePath) => void;
  onRenameSubmit: (oldPath: WorkspacePath, newName: string) => void;
  onRenameCancel: () => void;
  onDragStart?: (paths: Set<WorkspacePath>, e: React.DragEvent) => void;
  onDrop?: (targetDir: WorkspacePath, e: React.DragEvent) => void;
  /** Error counts per file path — used to show error badges. */
  errorCounts?: Map<string, number>;
}

/** Count errors for a directory node by summing child file errors. */
function countDirectoryErrors(node: FileNode, errorCounts?: Map<string, number>): number {
  if (!errorCounts) return 0;
  if (!node.isDirectory) return errorCounts.get(node.path) ?? 0;
  let total = 0;
  for (const child of node.children ?? []) {
    total += countDirectoryErrors(child, errorCounts);
  }
  return total;
}

export function FileTree({
  nodes,
  level = 0,
  expandedFolders,
  selectedFile,
  selectedFiles,
  renamingFile,
  onSelectFile,
  onOpenFile,
  onToggleFolder,
  onRenameSubmit,
  onRenameCancel,
  onDragStart,
  onDrop,
  errorCounts,
}: FileTreeProps) {
  return (
    <div className="select-none">
      {nodes.map((node) => (
        <FileTreeItem
          key={node.path}
          node={node}
          level={level}
          expandedFolders={expandedFolders}
          selectedFile={selectedFile}
          selectedFiles={selectedFiles}
          renamingFile={renamingFile}
          onSelectFile={onSelectFile}
          onOpenFile={onOpenFile}
          onToggleFolder={onToggleFolder}
          onRenameSubmit={onRenameSubmit}
          onRenameCancel={onRenameCancel}
          onDragStart={onDragStart}
          onDrop={onDrop}
          errorCounts={errorCounts}
        />
      ))}
    </div>
  );
}

interface FileTreeItemProps {
  node: FileNode;
  level: number;
  expandedFolders: Set<string>;
  selectedFile: WorkspacePath | null;
  selectedFiles: Set<WorkspacePath>;
  renamingFile: WorkspacePath | null;
  onSelectFile: (path: WorkspacePath, opts?: SelectFileOptions) => void;
  onOpenFile: (path: WorkspacePath) => void;
  onToggleFolder: (path: WorkspacePath) => void;
  onRenameSubmit: (oldPath: WorkspacePath, newName: string) => void;
  onRenameCancel: () => void;
  onDragStart?: (paths: Set<WorkspacePath>, e: React.DragEvent) => void;
  onDrop?: (targetDir: WorkspacePath, e: React.DragEvent) => void;
  errorCounts?: Map<string, number>;
}

function FileTreeItem({
  node,
  level,
  expandedFolders,
  selectedFile,
  selectedFiles,
  renamingFile,
  onSelectFile,
  onOpenFile,
  onToggleFolder,
  onRenameSubmit,
  onRenameCancel,
  onDragStart,
  onDrop,
  errorCounts,
}: FileTreeItemProps) {
  const isExpanded = expandedFolders.has(node.path);
  const isSelected = selectedFiles.has(node.path);
  const isRenaming = renamingFile === node.path;
  const Icon = getFileIcon(node.name, node.isDirectory, isExpanded);
  const color = getFileColor(node.name, node.isDirectory);
  const errCount = node.isDirectory
    ? countDirectoryErrors(node, errorCounts)
    : (errorCounts?.get(node.path) ?? 0);
  const pathTestId = encodePathForTestId(node.path);

  // Inline rename state
  const [renameValue, setRenameValue] = useState(node.name);
  const renameInputRef = useRef<HTMLInputElement>(null);
  const isSubmittingRename = useRef(false);

  // Drag-over state for drop targets (directories)
  const [isDragOver, setIsDragOver] = useState(false);

  useEffect(() => {
    if (isRenaming && renameInputRef.current) {
      setRenameValue(node.name);
      renameInputRef.current.focus();
      // Select the filename without extension
      const dotIdx = node.name.lastIndexOf('.');
      renameInputRef.current.setSelectionRange(0, dotIdx > 0 ? dotIdx : node.name.length);
    }
  }, [isRenaming]);

  function handleClick(e: React.MouseEvent) {
    e.stopPropagation();

    if (node.isDirectory) {
      // For directories: click always toggles expand/collapse
      // But also select if ctrl/shift held
      onToggleFolder(node.path);
      if (e.ctrlKey || e.metaKey || e.shiftKey) {
        onSelectFile(node.path, { ctrl: e.ctrlKey || e.metaKey, shift: e.shiftKey });
      }
      return;
    }

    // For files: single click = select
    onSelectFile(node.path, {
      ctrl: e.ctrlKey || e.metaKey,
      shift: e.shiftKey,
    });
  }

  function handleDoubleClick(e: React.MouseEvent) {
    e.stopPropagation();
    if (node.isDirectory) return;
    // Double click = open file in editor
    onOpenFile(node.path);
  }

  function handleRenameSubmit() {
    isSubmittingRename.current = true;
    const newName = (renameInputRef.current?.value ?? renameValue).trim();
    if (newName && newName !== node.name) {
      onRenameSubmit(node.path, newName);
    } else {
      onRenameCancel();
    }
    isSubmittingRename.current = false;
  }

  function handleDragStart(e: React.DragEvent) {
    if (!isSelected) {
      // If dragging an unselected file, select it first
      onSelectFile(node.path);
    }
    const dragPaths = isSelected ? selectedFiles : new Set([node.path]);
    e.dataTransfer.setData('text/plain', JSON.stringify(Array.from(dragPaths)));
    e.dataTransfer.effectAllowed = 'move';
    onDragStart?.(dragPaths, e);
  }

  function handleDragOver(e: React.DragEvent) {
    if (node.isDirectory) {
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
      setIsDragOver(true);
    }
  }

  function handleDragLeave() {
    setIsDragOver(false);
  }

  function handleDrop(e: React.DragEvent) {
    e.preventDefault();
    setIsDragOver(false);
    if (node.isDirectory) {
      onDrop?.(node.path, e);
    }
  }

  return (
    <div key={node.path}>
      <div
        className={cn(
          'flex items-center gap-1 px-2 py-1 cursor-pointer hover:bg-accent/50 rounded-sm text-sm',
          isSelected && 'bg-accent text-accent-foreground',
          !isSelected && 'text-foreground/90',
          isDragOver && 'bg-primary/20 ring-1 ring-primary',
        )}
        style={{ paddingLeft: `${level * 12 + 8}px` }}
        data-testid={`file-tree-item-${pathTestId}`}
        data-path={node.path}
        data-type={node.isDirectory ? 'directory' : 'file'}
        data-expanded={node.isDirectory ? (isExpanded ? 'true' : 'false') : undefined}
        data-selected={isSelected ? 'true' : 'false'}
        onClick={handleClick}
        onDoubleClick={handleDoubleClick}
        draggable={!isRenaming}
        onDragStart={handleDragStart}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
      >
        {node.isDirectory && (
          <span className="flex-shrink-0" data-testid={`file-tree-toggle-${pathTestId}`}>
            {isExpanded ? (
              <ChevronDown className="h-4 w-4" />
            ) : (
              <ChevronRight className="h-4 w-4" />
            )}
          </span>
        )}
        {!node.isDirectory && <span className="w-4" />}
        <Icon className={cn('h-4 w-4 flex-shrink-0', color)} />

        {isRenaming ? (
          <input
            ref={renameInputRef}
            type="text"
            className="flex-1 bg-background border border-primary rounded px-1 py-0 text-xs outline-none min-w-0"
            data-testid="file-tree-rename-input"
            value={renameValue}
            onChange={(e) => setRenameValue(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') handleRenameSubmit();
              if (e.key === 'Escape') onRenameCancel();
              e.stopPropagation();
            }}
            onBlur={() => {
              if (!isSubmittingRename.current) onRenameCancel();
            }}
            onClick={(e) => e.stopPropagation()}
            onDoubleClick={(e) => e.stopPropagation()}
          />
        ) : (
          <span className="truncate">{node.name}</span>
        )}

        {errCount > 0 && (
          <span className="ml-auto text-[10px] font-medium text-red-500 bg-red-500/10 rounded px-1 flex-shrink-0">
            {errCount}
          </span>
        )}
      </div>

      {node.isDirectory && isExpanded && node.children && (
        <FileTree
          nodes={node.children}
          level={level + 1}
          expandedFolders={expandedFolders}
          selectedFile={selectedFile}
          selectedFiles={selectedFiles}
          renamingFile={renamingFile}
          onSelectFile={onSelectFile}
          onOpenFile={onOpenFile}
          onToggleFolder={onToggleFolder}
          onRenameSubmit={onRenameSubmit}
          onRenameCancel={onRenameCancel}
          onDragStart={onDragStart}
          onDrop={onDrop}
          errorCounts={errorCounts}
        />
      )}
    </div>
  );
}
