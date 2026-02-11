import nodeFs from 'node:fs';
import nodeFsPromises from 'node:fs/promises';
import nodePath from 'node:path';
import type { Timestamp } from '@antimatter/project-model';
import { normalizePath } from './path-utils.js';
import type {
  FileSystem,
  FileContent,
  FileStat,
  FileEntry,
  WorkspacePath,
  WatchListener,
  WatchEvent,
  WatchEventType,
  Watcher,
} from './types.js';

export class LocalFileSystem implements FileSystem {
  constructor(private readonly workspaceRoot: string) {}

  private resolve(path: WorkspacePath): string {
    return nodePath.join(this.workspaceRoot, normalizePath(path));
  }

  async readFile(path: WorkspacePath): Promise<FileContent> {
    const buffer = await nodeFsPromises.readFile(this.resolve(path));
    return new Uint8Array(buffer);
  }

  async readTextFile(path: WorkspacePath): Promise<string> {
    return nodeFsPromises.readFile(this.resolve(path), 'utf-8');
  }

  async writeFile(
    path: WorkspacePath,
    content: FileContent | string,
  ): Promise<void> {
    const resolved = this.resolve(path);
    await nodeFsPromises.mkdir(nodePath.dirname(resolved), { recursive: true });
    await nodeFsPromises.writeFile(resolved, content);
  }

  async deleteFile(path: WorkspacePath): Promise<void> {
    await nodeFsPromises.unlink(this.resolve(path));
  }

  async exists(path: WorkspacePath): Promise<boolean> {
    try {
      await nodeFsPromises.access(this.resolve(path));
      return true;
    } catch {
      return false;
    }
  }

  async stat(path: WorkspacePath): Promise<FileStat> {
    const stats = await nodeFsPromises.stat(this.resolve(path));
    return {
      size: stats.size,
      modifiedAt: stats.mtime.toISOString() as Timestamp,
      createdAt: stats.birthtime.toISOString() as Timestamp,
      isDirectory: stats.isDirectory(),
      isFile: stats.isFile(),
    };
  }

  async readDirectory(path: WorkspacePath): Promise<readonly FileEntry[]> {
    const entries = await nodeFsPromises.readdir(this.resolve(path), {
      withFileTypes: true,
    });
    return entries
      .map((entry) => ({
        name: entry.name,
        isDirectory: entry.isDirectory(),
      }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }

  async mkdir(path: WorkspacePath): Promise<void> {
    await nodeFsPromises.mkdir(this.resolve(path), { recursive: true });
  }

  async copyFile(src: WorkspacePath, dest: WorkspacePath): Promise<void> {
    const resolvedDest = this.resolve(dest);
    await nodeFsPromises.mkdir(nodePath.dirname(resolvedDest), {
      recursive: true,
    });
    await nodeFsPromises.copyFile(this.resolve(src), resolvedDest);
  }

  async rename(src: WorkspacePath, dest: WorkspacePath): Promise<void> {
    const resolvedDest = this.resolve(dest);
    await nodeFsPromises.mkdir(nodePath.dirname(resolvedDest), {
      recursive: true,
    });
    await nodeFsPromises.rename(this.resolve(src), resolvedDest);
  }

  watch(path: WorkspacePath, listener: WatchListener): Watcher {
    const resolved = this.resolve(path);
    const watcher = nodeFs.watch(
      resolved,
      { recursive: true },
      (eventType, filename) => {
        if (!filename) return;
        const normalized = normalizePath(filename);
        const fullPath =
          normalizePath(path) === ''
            ? normalized
            : `${normalizePath(path)}/${normalized}`;

        let type: WatchEventType;
        if (eventType === 'rename') {
          const fullResolved = nodePath.join(resolved, filename);
          type = nodeFs.existsSync(fullResolved) ? 'create' : 'delete';
        } else {
          type = 'modify';
        }

        const event: WatchEvent = { type, path: fullPath };
        listener([event]);
      },
    );

    return {
      close: () => watcher.close(),
    };
  }
}
