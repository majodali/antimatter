/**
 * WorkspaceEnvironment backed by an EFS mount with S3 synchronization.
 *
 * File operations and command execution delegate to a LocalWorkspaceEnvironment
 * pointed at the EFS project directory.  The S3 sync engine handles pulling
 * files from S3 before commands run and pushing changes back after.
 */

import { mkdir } from 'node:fs/promises';
import type { S3Client } from '@aws-sdk/client-s3';
import type { FileSystem, FileEntry, FileStat } from '@antimatter/filesystem';
import type { WorkspaceEnvironment, ExecuteOptions, ExecutionResult } from './types.js';
import { LocalWorkspaceEnvironment } from './local-workspace-environment.js';
import {
  syncFromS3,
  syncToS3,
  type SyncOptions,
  type SyncResult,
} from './s3-efs-sync.js';

// ---------------------------------------------------------------------------
// Options
// ---------------------------------------------------------------------------

export interface EfsWorkspaceEnvironmentOptions {
  /** Root of the EFS mount (e.g. "/mnt/projects"). */
  readonly efsRootPath: string;
  /** Project identifier — determines the subdirectory on EFS. */
  readonly projectId: string;

  /** S3 client for sync operations. */
  readonly s3Client: S3Client;
  /** S3 bucket containing project files. */
  readonly bucket: string;
  /** S3 key prefix (e.g. "projects/{id}/files/"). Must end with "/". */
  readonly s3Prefix: string;

  readonly id?: string;
  readonly label?: string;
  /** Max parallel S3 operations during sync. @default 10 */
  readonly syncConcurrency?: number;
  /** Patterns to exclude from EFS → S3 sync. @default ["node_modules/", ".git/"] */
  readonly excludePatterns?: readonly string[];
}

// ---------------------------------------------------------------------------
// Implementation
// ---------------------------------------------------------------------------

export class EfsWorkspaceEnvironment implements WorkspaceEnvironment {
  readonly id: string;
  readonly label: string;

  /** Absolute path to the project directory on EFS. */
  readonly projectPath: string;

  private readonly local: LocalWorkspaceEnvironment;
  private readonly syncOptions: SyncOptions;

  constructor(options: EfsWorkspaceEnvironmentOptions) {
    this.id = options.id ?? 'efs';
    this.label = options.label ?? `efs:${options.projectId}`;

    this.projectPath = `${options.efsRootPath}/${options.projectId}`;

    this.local = new LocalWorkspaceEnvironment({
      rootPath: this.projectPath,
      id: this.id,
      label: this.label,
    });

    this.syncOptions = {
      s3Client: options.s3Client,
      bucket: options.bucket,
      s3Prefix: options.s3Prefix,
      localPath: this.projectPath,
      concurrency: options.syncConcurrency,
      excludePatterns: options.excludePatterns,
    };
  }

  // ---- File operations (delegated to LocalWorkspaceEnvironment) ----

  get fileSystem(): FileSystem {
    return this.local.fileSystem;
  }

  readFile(path: string): Promise<string> {
    return this.local.readFile(path);
  }
  writeFile(path: string, content: string): Promise<void> {
    return this.local.writeFile(path, content);
  }
  deleteFile(path: string): Promise<void> {
    return this.local.deleteFile(path);
  }
  exists(path: string): Promise<boolean> {
    return this.local.exists(path);
  }
  readDirectory(path: string): Promise<readonly FileEntry[]> {
    return this.local.readDirectory(path);
  }
  mkdir(path: string): Promise<void> {
    return this.local.mkdir(path);
  }
  stat(path: string): Promise<FileStat> {
    return this.local.stat(path);
  }

  // ---- Command execution (delegated to LocalWorkspaceEnvironment) ----

  execute(options: ExecuteOptions): Promise<ExecutionResult> {
    return this.local.execute(options);
  }

  // ---- Lifecycle ----

  /** Ensure the project directory exists and sync files from S3. */
  async initialize(): Promise<void> {
    await mkdir(this.projectPath, { recursive: true });
    await this.syncFromS3();
  }

  /** Sync changed files back to S3. */
  async dispose(): Promise<void> {
    await this.syncToS3();
  }

  // ---- Sync (public for explicit control) ----

  /** Pull files from S3 → EFS. */
  async syncFromS3(): Promise<SyncResult> {
    return syncFromS3(this.syncOptions);
  }

  /** Push changed files from EFS → S3. */
  async syncToS3(): Promise<SyncResult> {
    return syncToS3(this.syncOptions);
  }
}
