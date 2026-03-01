/**
 * WorkspaceEnvironment that routes file operations through S3 and
 * command execution through a Command Lambda (via direct Lambda invoke).
 *
 * Used by the API Lambda to delegate build/test/lint execution to a
 * Command Lambda that has VPC + EFS access for POSIX command execution.
 */

import type { S3Client } from '@aws-sdk/client-s3';
import type { FileSystem, FileEntry, FileStat } from '@antimatter/filesystem';
import type { WorkspaceEnvironment, ExecuteOptions, ExecutionResult } from './types.js';
import { S3WorkspaceEnvironment } from './s3-workspace-environment.js';

// ---------------------------------------------------------------------------
// Lambda invocation types
// ---------------------------------------------------------------------------

/** Payload sent to the Command Lambda for direct invocation. */
export interface CommandLambdaPayload {
  readonly action: 'exec' | 'sync' | 'sync-back';
  readonly projectId: string;
  readonly command?: string;
  readonly args?: readonly string[];
  readonly cwd?: string;
  readonly timeout?: number;
  readonly syncBefore?: boolean;
  readonly syncAfter?: boolean;
}

/**
 * Minimal interface for a Lambda invocation client.
 * Matches the shape of @aws-sdk/client-lambda's LambdaClient.send(InvokeCommand),
 * but expressed as a thin interface so tests can provide a mock without importing the SDK.
 */
export interface LambdaInvoker {
  invoke(functionName: string, payload: unknown): Promise<{
    statusCode?: number;
    functionError?: string;
    payload: string;
  }>;
}

// ---------------------------------------------------------------------------
// Options
// ---------------------------------------------------------------------------

export interface CommandLambdaEnvironmentOptions {
  /** Project identifier. */
  readonly projectId: string;

  /** S3 client for file operations. */
  readonly s3Client: S3Client;
  /** S3 bucket for project files. */
  readonly bucket: string;
  /** S3 key prefix (e.g. "projects/{id}/files/"). */
  readonly prefix: string;

  /** Lambda invoker (wraps LambdaClient). */
  readonly lambdaInvoker: LambdaInvoker;
  /** Command Lambda function name or ARN. */
  readonly functionName: string;

  readonly id?: string;
  readonly label?: string;

  /** Sync S3 → EFS before each execute() call. @default true */
  readonly syncBefore?: boolean;
  /** Sync EFS → S3 after each execute() call. @default true */
  readonly syncAfter?: boolean;
}

// ---------------------------------------------------------------------------
// Implementation
// ---------------------------------------------------------------------------

export class CommandLambdaEnvironment implements WorkspaceEnvironment {
  readonly id: string;
  readonly label: string;

  private readonly s3Env: S3WorkspaceEnvironment;
  private readonly lambdaInvoker: LambdaInvoker;
  private readonly functionName: string;
  private readonly projectId: string;
  private readonly syncBefore: boolean;
  private readonly syncAfter: boolean;

  constructor(options: CommandLambdaEnvironmentOptions) {
    this.id = options.id ?? 'command-lambda';
    this.label = options.label ?? `command-lambda:${options.projectId}`;
    this.projectId = options.projectId;
    this.functionName = options.functionName;
    this.lambdaInvoker = options.lambdaInvoker;
    this.syncBefore = options.syncBefore ?? true;
    this.syncAfter = options.syncAfter ?? true;

    this.s3Env = new S3WorkspaceEnvironment({
      s3Client: options.s3Client,
      bucket: options.bucket,
      prefix: options.prefix,
    });
  }

  // ---- File operations (delegate to S3) ----

  get fileSystem(): FileSystem {
    return this.s3Env.fileSystem;
  }

  readFile(path: string): Promise<string> {
    return this.s3Env.readFile(path);
  }
  writeFile(path: string, content: string): Promise<void> {
    return this.s3Env.writeFile(path, content);
  }
  deleteFile(path: string): Promise<void> {
    return this.s3Env.deleteFile(path);
  }
  exists(path: string): Promise<boolean> {
    return this.s3Env.exists(path);
  }
  readDirectory(path: string): Promise<readonly FileEntry[]> {
    return this.s3Env.readDirectory(path);
  }
  mkdir(path: string): Promise<void> {
    return this.s3Env.mkdir(path);
  }
  stat(path: string): Promise<FileStat> {
    return this.s3Env.stat(path);
  }

  // ---- Command execution (via Command Lambda) ----

  async execute(options: ExecuteOptions): Promise<ExecutionResult> {
    const payload: CommandLambdaPayload = {
      action: 'exec',
      projectId: this.projectId,
      command: options.command,
      args: options.args ? [...options.args] : undefined,
      cwd: options.cwd,
      timeout: options.timeout,
      syncBefore: this.syncBefore,
      syncAfter: this.syncAfter,
    };

    const result = await this.invokeLambda(payload);

    return {
      exitCode: result.exitCode ?? 1,
      stdout: result.stdout ?? '',
      stderr: result.stderr ?? '',
      durationMs: result.durationMs ?? 0,
    };
  }

  // ---- Lifecycle ----

  /** Pre-sync S3 → EFS on the Command Lambda. */
  async initialize(): Promise<void> {
    await this.invokeLambda({
      action: 'sync',
      projectId: this.projectId,
    });
  }

  /** Sync EFS → S3 on the Command Lambda. */
  async dispose(): Promise<void> {
    await this.invokeLambda({
      action: 'sync-back',
      projectId: this.projectId,
    });
  }

  // ---- Internal ----

  private async invokeLambda(payload: CommandLambdaPayload): Promise<any> {
    const response = await this.lambdaInvoker.invoke(this.functionName, payload);

    // Check for Lambda-level errors (function errors, invocation failures)
    if (response.functionError) {
      const parsed = tryParse(response.payload);
      const message = parsed?.errorMessage ?? parsed?.message ?? response.payload;
      throw new Error(`Command Lambda error: ${message}`);
    }

    const parsed = tryParse(response.payload);
    if (!parsed) {
      throw new Error(`Command Lambda returned unparseable response: ${response.payload}`);
    }

    // Check for application-level errors (returned by directHandler)
    if (parsed.error && !('exitCode' in parsed)) {
      throw new Error(`Command Lambda: ${parsed.error}${parsed.message ? ` — ${parsed.message}` : ''}`);
    }

    return parsed;
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function tryParse(json: string): any {
  try {
    return JSON.parse(json);
  } catch {
    return null;
  }
}
