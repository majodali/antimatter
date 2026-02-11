import type { Timestamp } from '@antimatter/project-model';
import { normalizePath, dirName } from './path-utils.js';
import type {
  FileSystem,
  FileContent,
  FileStat,
  FileEntry,
  WorkspacePath,
  WatchListener,
  WatchEvent,
  Watcher,
} from './types.js';

interface FileMetadata {
  modifiedAt: Timestamp;
  createdAt: Timestamp;
}

export class MemoryFileSystem implements FileSystem {
  private readonly files = new Map<WorkspacePath, Uint8Array>();
  private readonly dirs = new Set<WorkspacePath>();
  private readonly metadata = new Map<WorkspacePath, FileMetadata>();
  private readonly watchers = new Map<WorkspacePath, Set<WatchListener>>();

  constructor() {
    // Root directory always exists
    this.dirs.add('');
  }

  async readFile(path: WorkspacePath): Promise<FileContent> {
    const normalized = normalizePath(path);
    const data = this.files.get(normalized);
    if (!data) {
      throw new Error(`ENOENT: no such file or directory, open '${normalized}'`);
    }
    return new Uint8Array(data);
  }

  async readTextFile(path: WorkspacePath): Promise<string> {
    const data = await this.readFile(path);
    return new TextDecoder().decode(data);
  }

  async writeFile(
    path: WorkspacePath,
    content: FileContent | string,
  ): Promise<void> {
    const normalized = normalizePath(path);
    const bytes =
      typeof content === 'string'
        ? new TextEncoder().encode(content)
        : new Uint8Array(content);

    // Auto-create parent directories
    await this.ensureParentDirs(normalized);

    const isNew = !this.files.has(normalized);
    const now = new Date().toISOString() as Timestamp;

    this.files.set(normalized, bytes);

    const existing = this.metadata.get(normalized);
    this.metadata.set(normalized, {
      modifiedAt: now,
      createdAt: existing?.createdAt ?? now,
    });

    this.emit(normalized, isNew ? 'create' : 'modify');
  }

  async deleteFile(path: WorkspacePath): Promise<void> {
    const normalized = normalizePath(path);
    if (!this.files.has(normalized)) {
      throw new Error(
        `ENOENT: no such file or directory, unlink '${normalized}'`,
      );
    }
    this.files.delete(normalized);
    this.metadata.delete(normalized);
    this.emit(normalized, 'delete');
  }

  async exists(path: WorkspacePath): Promise<boolean> {
    const normalized = normalizePath(path);
    return this.files.has(normalized) || this.dirs.has(normalized);
  }

  async stat(path: WorkspacePath): Promise<FileStat> {
    const normalized = normalizePath(path);

    if (this.dirs.has(normalized)) {
      const meta = this.metadata.get(normalized);
      const now = new Date().toISOString() as Timestamp;
      return {
        size: 0,
        modifiedAt: meta?.modifiedAt ?? now,
        createdAt: meta?.createdAt ?? now,
        isDirectory: true,
        isFile: false,
      };
    }

    const data = this.files.get(normalized);
    if (!data) {
      throw new Error(
        `ENOENT: no such file or directory, stat '${normalized}'`,
      );
    }
    const meta = this.metadata.get(normalized)!;
    return {
      size: data.byteLength,
      modifiedAt: meta.modifiedAt,
      createdAt: meta.createdAt,
      isDirectory: false,
      isFile: true,
    };
  }

  async readDirectory(path: WorkspacePath): Promise<readonly FileEntry[]> {
    const normalized = normalizePath(path);
    if (!this.dirs.has(normalized)) {
      throw new Error(
        `ENOENT: no such file or directory, scandir '${normalized}'`,
      );
    }

    const prefix = normalized === '' ? '' : normalized + '/';
    const entries = new Map<string, FileEntry>();

    for (const filePath of this.files.keys()) {
      if (filePath.startsWith(prefix)) {
        const relative = filePath.slice(prefix.length);
        const slashIndex = relative.indexOf('/');
        const name = slashIndex === -1 ? relative : relative.slice(0, slashIndex);
        if (name && !entries.has(name)) {
          entries.set(name, { name, isDirectory: slashIndex !== -1 });
        }
      }
    }

    for (const dirPath of this.dirs) {
      if (dirPath.startsWith(prefix)) {
        const relative = dirPath.slice(prefix.length);
        const slashIndex = relative.indexOf('/');
        const name = slashIndex === -1 ? relative : relative.slice(0, slashIndex);
        if (name && !entries.has(name)) {
          entries.set(name, { name, isDirectory: true });
        }
      }
    }

    return [...entries.values()].sort((a, b) => a.name.localeCompare(b.name));
  }

  async mkdir(path: WorkspacePath): Promise<void> {
    const normalized = normalizePath(path);
    if (this.dirs.has(normalized)) return;

    await this.ensureParentDirs(normalized);
    const now = new Date().toISOString() as Timestamp;
    this.dirs.add(normalized);
    this.metadata.set(normalized, { modifiedAt: now, createdAt: now });
  }

  async copyFile(src: WorkspacePath, dest: WorkspacePath): Promise<void> {
    const content = await this.readFile(src);
    await this.writeFile(dest, content);
  }

  async rename(src: WorkspacePath, dest: WorkspacePath): Promise<void> {
    const content = await this.readFile(src);
    await this.writeFile(dest, content);
    await this.deleteFile(src);
  }

  watch(path: WorkspacePath, listener: WatchListener): Watcher {
    const normalized = normalizePath(path);
    let listeners = this.watchers.get(normalized);
    if (!listeners) {
      listeners = new Set();
      this.watchers.set(normalized, listeners);
    }
    listeners.add(listener);
    return {
      close: () => {
        listeners!.delete(listener);
        if (listeners!.size === 0) {
          this.watchers.delete(normalized);
        }
      },
    };
  }

  private async ensureParentDirs(filePath: WorkspacePath): Promise<void> {
    let dir = dirName(filePath);
    const toCreate: string[] = [];

    while (dir !== '' && !this.dirs.has(dir)) {
      toCreate.push(dir);
      dir = dirName(dir);
    }

    const now = new Date().toISOString() as Timestamp;
    for (let i = toCreate.length - 1; i >= 0; i--) {
      this.dirs.add(toCreate[i]!);
      this.metadata.set(toCreate[i]!, { modifiedAt: now, createdAt: now });
    }
  }

  private emit(
    filePath: WorkspacePath,
    type: WatchEvent['type'],
  ): void {
    const event: WatchEvent = { type, path: filePath };
    // Notify watchers on the file itself and all parent directories
    let current: string | undefined = filePath;
    while (current !== undefined) {
      const listeners = this.watchers.get(current);
      if (listeners) {
        for (const listener of listeners) {
          listener([event]);
        }
      }
      if (current === '') break;
      current = dirName(current);
    }
  }
}
