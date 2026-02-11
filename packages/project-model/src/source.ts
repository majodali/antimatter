import type { Hash } from './common.js';

/** Programming / markup language identifiers. */
export type SourceLanguage =
  | 'typescript'
  | 'javascript'
  | 'html'
  | 'css'
  | 'json'
  | 'yaml'
  | 'markdown'
  | 'rust'
  | 'go'
  | 'python'
  | 'other';

/** Logical role a source file plays inside a module. */
export type SourceType =
  | 'source'
  | 'test'
  | 'config'
  | 'asset'
  | 'documentation';

/** Metadata about a single file tracked by the project. */
export interface SourceFile {
  /** Workspace-relative path (forward-slash separated). */
  readonly path: string;
  readonly language: SourceLanguage;
  readonly type: SourceType;
  /** Content hash for change detection. */
  readonly hash: Hash;
  /** Byte size of the file on disk. */
  readonly size: number;
}
