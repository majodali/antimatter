import type { S3Client } from '@aws-sdk/client-s3';
import { S3FileSystem } from '@antimatter/filesystem';
import type { FileSystem, FileEntry, FileStat, WorkspacePath } from '@antimatter/filesystem';
import type { WorkspaceEnvironment, ExecuteOptions, ExecutionResult } from './types.js';

export interface S3WorkspaceEnvironmentOptions {
  /** AWS S3 client instance. */
  readonly s3Client: S3Client;
  /** S3 bucket name. */
  readonly bucket: string;
  /** S3 key prefix (e.g., "projects/abc123/files/"). */
  readonly prefix: string;
  /** Unique identifier for this environment. Defaults to "s3". */
  readonly id?: string;
  /** Human-readable label. Defaults to "s3". */
  readonly label?: string;
}

/**
 * WorkspaceEnvironment backed by S3 for file operations.
 * Command execution is not supported — throws an error.
 * Used for file browsing and editing in Lambda when EFS isn't needed.
 */
export class S3WorkspaceEnvironment implements WorkspaceEnvironment {
  readonly id: string;
  readonly label: string;
  readonly fileSystem: FileSystem;

  constructor(options: S3WorkspaceEnvironmentOptions) {
    this.id = options.id ?? 's3';
    this.label = options.label ?? 's3';
    this.fileSystem = new S3FileSystem({
      s3Client: options.s3Client,
      bucket: options.bucket,
      prefix: options.prefix,
    });
  }

  // --- File operations (delegate to S3FileSystem) ---

  async readFile(path: string): Promise<string> {
    return this.fileSystem.readTextFile(path as WorkspacePath);
  }

  async writeFile(path: string, content: string): Promise<void> {
    await this.fileSystem.writeFile(path as WorkspacePath, content);
  }

  async deleteFile(path: string): Promise<void> {
    await this.fileSystem.deleteFile(path as WorkspacePath);
  }

  async exists(path: string): Promise<boolean> {
    return this.fileSystem.exists(path as WorkspacePath);
  }

  async readDirectory(path: string): Promise<readonly FileEntry[]> {
    return this.fileSystem.readDirectory(path as WorkspacePath);
  }

  async mkdir(path: string): Promise<void> {
    await this.fileSystem.mkdir(path as WorkspacePath);
  }

  async stat(path: string): Promise<FileStat> {
    return this.fileSystem.stat(path as WorkspacePath);
  }

  // --- Command execution ---

  async execute(_options: ExecuteOptions): Promise<ExecutionResult> {
    throw new Error('Command execution is not supported in S3 environment');
  }

  // --- Lifecycle ---

  async initialize(): Promise<void> {
    // No-op for S3 environment
  }

  async dispose(): Promise<void> {
    // No-op for S3 environment
  }
}
