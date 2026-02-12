import {
  File,
  FileText,
  FileCode,
  FileJson,
  FileImage,
  FolderClosed,
  FolderOpen,
  LucideIcon,
} from 'lucide-react';

const extensionMap: Record<string, LucideIcon> = {
  // Code files
  '.ts': FileCode,
  '.tsx': FileCode,
  '.js': FileCode,
  '.jsx': FileCode,
  '.py': FileCode,
  '.java': FileCode,
  '.c': FileCode,
  '.cpp': FileCode,
  '.h': FileCode,
  '.rs': FileCode,
  '.go': FileCode,

  // Config files
  '.json': FileJson,
  '.yaml': FileJson,
  '.yml': FileJson,
  '.toml': FileJson,
  '.xml': FileJson,

  // Documentation
  '.md': FileText,
  '.txt': FileText,
  '.doc': FileText,
  '.pdf': FileText,

  // Images
  '.png': FileImage,
  '.jpg': FileImage,
  '.jpeg': FileImage,
  '.gif': FileImage,
  '.svg': FileImage,
  '.ico': FileImage,
};

export function getFileIcon(filename: string, isDirectory: boolean, isExpanded = false): LucideIcon {
  if (isDirectory) {
    return isExpanded ? FolderOpen : FolderClosed;
  }

  const ext = filename.substring(filename.lastIndexOf('.')).toLowerCase();
  return extensionMap[ext] || File;
}

export function getFileColor(filename: string, isDirectory: boolean): string {
  if (isDirectory) {
    return 'text-blue-500';
  }

  const ext = filename.substring(filename.lastIndexOf('.')).toLowerCase();

  // Color coding by file type
  if (['.ts', '.tsx', '.js', '.jsx'].includes(ext)) return 'text-blue-400';
  if (['.json', '.yaml', '.yml'].includes(ext)) return 'text-yellow-500';
  if (['.md', '.txt'].includes(ext)) return 'text-gray-400';
  if (['.png', '.jpg', '.jpeg', '.gif', '.svg'].includes(ext)) return 'text-purple-400';

  return 'text-gray-500';
}
