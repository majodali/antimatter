import { spawn } from 'node:child_process';
import { platform } from 'node:os';
import { LocalFileSystem } from '@antimatter/filesystem';
import type { FileSystem, FileEntry, FileStat, WorkspacePath } from '@antimatter/filesystem';
import type { WorkspaceEnvironment, ExecuteOptions, ExecutionResult } from './types.js';

export interface LocalWorkspaceEnvironmentOptions {
  /** Absolute path to the workspace root directory. */
  readonly rootPath: string;
  /** Unique identifier for this environment. Defaults to "local". */
  readonly id?: string;
  /** Human-readable label. Defaults to "local". */
  readonly label?: string;
}

/**
 * WorkspaceEnvironment backed by the local file system and subprocess execution.
 * Wraps LocalFileSystem for file operations and child_process for command execution.
 */
export class LocalWorkspaceEnvironment implements WorkspaceEnvironment {
  readonly id: string;
  readonly label: string;
  readonly fileSystem: FileSystem;
  private readonly rootPath: string;

  constructor(options: LocalWorkspaceEnvironmentOptions) {
    this.rootPath = options.rootPath;
    this.id = options.id ?? 'local';
    this.label = options.label ?? 'local';
    this.fileSystem = new LocalFileSystem(options.rootPath);
  }

  // --- File operations (delegate to LocalFileSystem) ---

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

  async execute(options: ExecuteOptions): Promise<ExecutionResult> {
    const startTime = Date.now();
    const isWindows = platform() === 'win32';
    const shell = isWindows ? 'cmd' : 'sh';
    const shellFlag = isWindows ? '/c' : '-c';

    // Build the full command string
    const fullCommand = options.args?.length
      ? `${options.command} ${options.args.join(' ')}`
      : options.command;

    // Resolve cwd relative to workspace root
    const cwd = options.cwd
      ? `${this.rootPath}/${options.cwd}`.replace(/\/+/g, '/')
      : this.rootPath;

    return new Promise((resolve, reject) => {
      const child = spawn(shell, [shellFlag, fullCommand], {
        cwd,
        env: options.env ? { ...process.env, ...options.env } : process.env,
        shell: false,
      });

      let stdout = '';
      let stderr = '';
      let completed = false;
      let timeoutId: NodeJS.Timeout | undefined;

      if (options.timeout && options.timeout > 0) {
        timeoutId = setTimeout(() => {
          if (!completed) {
            completed = true;
            child.kill('SIGTERM');
            setTimeout(() => child.kill('SIGKILL'), 1000);
            reject(new Error(`Command timed out after ${options.timeout}ms`));
          }
        }, options.timeout);
      }

      child.stdout?.on('data', (data: Buffer) => {
        const chunk = data.toString();
        stdout += chunk;
        options.onStdout?.(chunk);
      });

      child.stderr?.on('data', (data: Buffer) => {
        const chunk = data.toString();
        stderr += chunk;
        options.onStderr?.(chunk);
      });

      child.on('close', (code) => {
        if (completed) return;
        completed = true;
        if (timeoutId) clearTimeout(timeoutId);
        resolve({
          exitCode: code ?? 0,
          stdout,
          stderr,
          durationMs: Date.now() - startTime,
        });
      });

      child.on('error', (error: Error) => {
        if (completed) return;
        completed = true;
        if (timeoutId) clearTimeout(timeoutId);
        reject(error);
      });
    });
  }

  // --- Lifecycle ---

  async initialize(): Promise<void> {
    // No-op for local environment
  }

  async dispose(): Promise<void> {
    // No-op for local environment
  }
}
