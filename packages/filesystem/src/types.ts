import type { Hash, Timestamp } from '@antimatter/project-model';

/** Workspace-relative path, always forward-slash separated. */
export type WorkspacePath = string;

/** Raw file content as bytes. */
export type FileContent = Uint8Array;

export interface FileStat {
  readonly size: number;
  readonly modifiedAt: Timestamp;
  readonly createdAt: Timestamp;
  readonly isDirectory: boolean;
  readonly isFile: boolean;
}

export interface FileEntry {
  readonly name: string;
  readonly isDirectory: boolean;
}

export type WatchEventType = 'create' | 'modify' | 'delete';

export interface WatchEvent {
  readonly type: WatchEventType;
  readonly path: WorkspacePath;
}

export type WatchListener = (events: readonly WatchEvent[]) => void;

export interface Watcher {
  close(): void;
}

export interface FileSystem {
  readFile(path: WorkspacePath): Promise<FileContent>;
  readTextFile(path: WorkspacePath): Promise<string>;
  writeFile(path: WorkspacePath, content: FileContent | string): Promise<void>;
  deleteFile(path: WorkspacePath): Promise<void>;
  exists(path: WorkspacePath): Promise<boolean>;
  stat(path: WorkspacePath): Promise<FileStat>;
  readDirectory(path: WorkspacePath): Promise<readonly FileEntry[]>;
  mkdir(path: WorkspacePath): Promise<void>;
  copyFile(src: WorkspacePath, dest: WorkspacePath): Promise<void>;
  rename(src: WorkspacePath, dest: WorkspacePath): Promise<void>;
  watch(path: WorkspacePath, listener: WatchListener): Watcher;
}

export interface FileSnapshot {
  readonly path: WorkspacePath;
  readonly hash: Hash;
  readonly size: number;
  readonly modifiedAt: Timestamp;
}

export type ChangeKind = 'added' | 'modified' | 'deleted';

export interface FileChange {
  readonly path: WorkspacePath;
  readonly kind: ChangeKind;
  readonly beforeHash?: Hash;
  readonly afterHash?: Hash;
}

export interface WorkspaceSnapshot {
  readonly files: ReadonlyMap<WorkspacePath, FileSnapshot>;
  readonly createdAt: Timestamp;
}
