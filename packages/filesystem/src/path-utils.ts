import posix from 'node:path/posix';
import type { WorkspacePath } from './types.js';

/**
 * Normalize a path to workspace-relative, forward-slash form.
 * Converts backslashes, strips leading `./` and `/`, and collapses `..` segments.
 */
export function normalizePath(path: string): WorkspacePath {
  // Backslash → forward-slash
  let normalized = path.replace(/\\/g, '/');
  // Use posix normalize to collapse .. and .
  normalized = posix.normalize(normalized);
  // Strip leading /
  if (normalized.startsWith('/')) {
    normalized = normalized.slice(1);
  }
  // posix.normalize may leave a leading ./
  if (normalized.startsWith('./')) {
    normalized = normalized.slice(2);
  }
  // Treat bare "." as empty root
  if (normalized === '.') {
    normalized = '';
  }
  return normalized;
}

export function joinPath(...segments: string[]): WorkspacePath {
  return normalizePath(posix.join(...segments));
}

export function dirName(path: WorkspacePath): WorkspacePath {
  const dir = posix.dirname(path);
  if (dir === '.') return '';
  return dir;
}

export function baseName(path: WorkspacePath, ext?: string): string {
  return posix.basename(path, ext);
}

export function extName(path: WorkspacePath): string {
  return posix.extname(path);
}

/** Check if `child` is inside `parent` directory. */
export function isWithin(parent: WorkspacePath, child: WorkspacePath): boolean {
  const normalizedParent = normalizePath(parent);
  const normalizedChild = normalizePath(child);
  if (normalizedParent === '') return normalizedChild.length > 0;
  return normalizedChild.startsWith(normalizedParent + '/');
}
