import type { Timestamp } from '@antimatter/project-model';
import { normalizePath } from './path-utils.js';
import { hashContent } from './hashing.js';
import type {
  FileSystem,
  FileSnapshot,
  FileChange,
  WorkspaceSnapshot,
  WorkspacePath,
} from './types.js';

export async function createSnapshot(
  fs: FileSystem,
  paths: readonly WorkspacePath[],
): Promise<WorkspaceSnapshot> {
  const files = new Map<WorkspacePath, FileSnapshot>();

  for (const path of paths) {
    const normalized = normalizePath(path);
    const content = await fs.readFile(normalized);
    const stat = await fs.stat(normalized);
    const hash = hashContent(content);

    files.set(normalized, {
      path: normalized,
      hash,
      size: stat.size,
      modifiedAt: stat.modifiedAt,
    });
  }

  return {
    files,
    createdAt: new Date().toISOString() as Timestamp,
  };
}

export function diffSnapshots(
  before: WorkspaceSnapshot,
  after: WorkspaceSnapshot,
): FileChange[] {
  const changes: FileChange[] = [];

  // Check for modified and deleted files
  for (const [path, beforeSnap] of before.files) {
    const afterSnap = after.files.get(path);
    if (!afterSnap) {
      changes.push({ path, kind: 'deleted', beforeHash: beforeSnap.hash });
    } else if (beforeSnap.hash !== afterSnap.hash) {
      changes.push({
        path,
        kind: 'modified',
        beforeHash: beforeSnap.hash,
        afterHash: afterSnap.hash,
      });
    }
  }

  // Check for added files
  for (const [path, afterSnap] of after.files) {
    if (!before.files.has(path)) {
      changes.push({ path, kind: 'added', afterHash: afterSnap.hash });
    }
  }

  return changes.sort((a, b) => a.path.localeCompare(b.path));
}

export async function createIncrementalSnapshot(
  fs: FileSystem,
  paths: readonly WorkspacePath[],
  previous: WorkspaceSnapshot,
): Promise<WorkspaceSnapshot> {
  const files = new Map<WorkspacePath, FileSnapshot>();

  for (const path of paths) {
    const normalized = normalizePath(path);
    const stat = await fs.stat(normalized);
    const prev = previous.files.get(normalized);

    // Reuse previous hash if size and mtime haven't changed
    if (
      prev &&
      prev.size === stat.size &&
      prev.modifiedAt === stat.modifiedAt
    ) {
      files.set(normalized, prev);
    } else {
      const content = await fs.readFile(normalized);
      const hash = hashContent(content);
      files.set(normalized, {
        path: normalized,
        hash,
        size: stat.size,
        modifiedAt: stat.modifiedAt,
      });
    }
  }

  return {
    files,
    createdAt: new Date().toISOString() as Timestamp,
  };
}
