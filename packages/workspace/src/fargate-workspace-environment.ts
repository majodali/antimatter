/**
 * Fargate Workspace Environment — delegates file operations to S3 and
 * command execution to a running Fargate container's HTTP /exec endpoint.
 *
 * This replaces CommandLambdaEnvironment for projects that have an active
 * workspace container. File operations still go through S3FileSystem
 * (the container syncs from S3 on startup).
 */

import type { S3Client } from '@aws-sdk/client-s3';
import { S3FileSystem } from '@antimatter/filesystem';
import type { FileSystem, FileEntry, FileStat, WorkspacePath } from '@antimatter/filesystem';
import type { WorkspaceEnvironment, ExecuteOptions, ExecutionResult } from './types.js';

export interface FargateWorkspaceEnvironmentOptions {
  /** Project identifier. */
  readonly projectId: string;
  /** AWS S3 client instance. */
  readonly s3Client: S3Client;
  /** S3 bucket name. */
  readonly bucket: string;
  /** S3 key prefix (e.g., "projects/abc123/files/"). */
  readonly prefix: string;
  /** Base URL of the running Fargate container (e.g., "http://10.0.1.5:8080"). */
  readonly containerUrl: string;
  /** Session token for authenticating requests to the container. */
  readonly sessionToken: string;
}

/**
 * WorkspaceEnvironment backed by S3 for file operations and a Fargate
 * container for command execution. Used when an interactive workspace
 * container is running for the project.
 */
export class FargateWorkspaceEnvironment implements WorkspaceEnvironment {
  readonly id: string;
  readonly label: string;
  readonly fileSystem: FileSystem;

  private readonly containerUrl: string;
  private readonly sessionToken: string;
  private readonly projectId: string;

  constructor(options: FargateWorkspaceEnvironmentOptions) {
    this.projectId = options.projectId;
    this.id = `fargate-${options.projectId}`;
    this.label = `fargate-${options.projectId}`;
    this.containerUrl = options.containerUrl.replace(/\/$/, '');
    this.sessionToken = options.sessionToken;
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

  // --- Command execution (delegate to Fargate container) ---

  async execute(options: ExecuteOptions): Promise<ExecutionResult> {
    const args = options.args ?? [];
    const command = [options.command, ...args].join(' ');

    const res = await fetch(`${this.containerUrl}/exec`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.sessionToken}`,
      },
      body: JSON.stringify({
        command,
        cwd: options.cwd,
        env: options.env,
        timeout: options.timeout,
        syncAfter: true,
      }),
    });

    if (!res.ok) {
      const body = await res.json().catch(() => ({ error: res.statusText }));
      throw new Error(
        `Container exec failed: ${(body as any).message ?? (body as any).error ?? res.statusText}`,
      );
    }

    const result = (await res.json()) as {
      exitCode: number;
      stdout: string;
      stderr: string;
      durationMs: number;
    };

    return {
      exitCode: result.exitCode,
      stdout: result.stdout,
      stderr: result.stderr,
      durationMs: result.durationMs,
    };
  }

  // --- Lifecycle ---

  async initialize(): Promise<void> {
    // Container handles its own initialization (S3 sync on startup).
    // We could trigger a sync-pull here if needed in the future.
  }

  async dispose(): Promise<void> {
    // Nothing to clean up — container lifecycle is managed by the
    // WorkspaceContainerService. The container shuts itself down
    // after an idle period.
  }
}
