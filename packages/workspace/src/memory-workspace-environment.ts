import { MemoryFileSystem } from '@antimatter/filesystem';
import type { FileSystem, FileEntry, FileStat, WorkspacePath } from '@antimatter/filesystem';
import { MockRunner } from '@antimatter/tool-integration';
import type { ToolOutput } from '@antimatter/project-model';
import type { WorkspaceEnvironment, ExecuteOptions, ExecutionResult } from './types.js';

export interface MemoryWorkspaceEnvironmentOptions {
  /** Existing MemoryFileSystem to use. Creates a new one if not provided. */
  readonly fs?: MemoryFileSystem;
  /** Existing MockRunner to use. Creates a new one if not provided. */
  readonly runner?: MockRunner;
  /** Unique identifier. Defaults to "memory". */
  readonly id?: string;
  /** Human-readable label. Defaults to "memory". */
  readonly label?: string;
}

/**
 * WorkspaceEnvironment backed by in-memory file system and mock runner.
 * Used for testing — provides full control over file state and command results.
 */
export class MemoryWorkspaceEnvironment implements WorkspaceEnvironment {
  readonly id: string;
  readonly label: string;
  readonly fileSystem: FileSystem;

  /** Exposed for test setup — register mock responses, inspect execution history. */
  readonly runner: MockRunner;
  /** Exposed for test setup — pre-populate files, inspect state. */
  readonly fs: MemoryFileSystem;

  constructor(options: MemoryWorkspaceEnvironmentOptions = {}) {
    this.fs = options.fs ?? new MemoryFileSystem();
    this.runner = options.runner ?? new MockRunner();
    this.id = options.id ?? 'memory';
    this.label = options.label ?? 'memory';
    this.fileSystem = this.fs;
  }

  // --- File operations (delegate to MemoryFileSystem) ---

  async readFile(path: string): Promise<string> {
    return this.fs.readTextFile(path as WorkspacePath);
  }

  async writeFile(path: string, content: string): Promise<void> {
    await this.fs.writeFile(path as WorkspacePath, content);
  }

  async deleteFile(path: string): Promise<void> {
    await this.fs.deleteFile(path as WorkspacePath);
  }

  async exists(path: string): Promise<boolean> {
    return this.fs.exists(path as WorkspacePath);
  }

  async readDirectory(path: string): Promise<readonly FileEntry[]> {
    return this.fs.readDirectory(path as WorkspacePath);
  }

  async mkdir(path: string): Promise<void> {
    await this.fs.mkdir(path as WorkspacePath);
  }

  async stat(path: string): Promise<FileStat> {
    return this.fs.stat(path as WorkspacePath);
  }

  // --- Command execution (delegate to MockRunner) ---

  async execute(options: ExecuteOptions): Promise<ExecutionResult> {
    const startTime = Date.now();

    // Build a ToolConfig-compatible object for the MockRunner
    const fullCommand = options.args?.length
      ? `${options.command} ${options.args.join(' ')}`
      : options.command;

    const output: ToolOutput = await this.runner.run({
      tool: {
        id: 'execute',
        name: 'execute',
        command: fullCommand,
        parameters: [],
        env: options.env,
      },
      parameters: {},
      cwd: options.cwd ?? '/',
      env: options.env,
      timeout: options.timeout,
    });

    return {
      exitCode: output.exitCode,
      stdout: output.stdout,
      stderr: output.stderr,
      durationMs: Date.now() - startTime,
    };
  }

  // --- Lifecycle ---

  async initialize(): Promise<void> {
    // No-op for memory environment
  }

  async dispose(): Promise<void> {
    // No-op for memory environment
  }
}
