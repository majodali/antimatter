export type {
  WorkspacePath,
  FileContent,
  FileStat,
  FileEntry,
  WatchEventType,
  WatchEvent,
  WatchListener,
  Watcher,
  FileSystem,
  FileSnapshot,
  ChangeKind,
  FileChange,
  WorkspaceSnapshot,
} from './types.js';

export {
  normalizePath,
  joinPath,
  dirName,
  baseName,
  extName,
  isWithin,
} from './path-utils.js';

export { hashContent } from './hashing.js';

export { MemoryFileSystem } from './memory-fs.js';
export { LocalFileSystem } from './local-fs.js';
export { watchDebounced } from './watcher.js';

export {
  detectLanguage,
  detectSourceType,
  createSourceFile,
  scanDirectory,
} from './source-file-utils.js';

export {
  createSnapshot,
  diffSnapshots,
  createIncrementalSnapshot,
} from './change-tracker.js';
