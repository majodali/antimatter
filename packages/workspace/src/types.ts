import type { FileEntry, FileStat, FileSystem } from '@antimatter/filesystem';

/**
 * Options for executing a command in a workspace environment.
 */
export interface ExecuteOptions {
  /** The command to run (e.g., "tsc", "npm"). */
  readonly command: string;
  /** Command arguments. */
  readonly args?: readonly string[];
  /** Working directory relative to the environment root. */
  readonly cwd?: string;
  /** Environment variables (merged with environment defaults). */
  readonly env?: Readonly<Record<string, string>>;
  /** Timeout in milliseconds. */
  readonly timeout?: number;
  /** Stream stdout as it's produced. */
  readonly onStdout?: (chunk: string) => void;
  /** Stream stderr as it's produced. */
  readonly onStderr?: (chunk: string) => void;
}

/**
 * Result of executing a command in a workspace environment.
 */
export interface ExecutionResult {
  readonly exitCode: number;
  readonly stdout: string;
  readonly stderr: string;
  readonly durationMs: number;
}

/**
 * A WorkspaceEnvironment is a place where files live and commands execute.
 * It couples file access and command execution into a single context,
 * because they are inherently coupled — commands operate on files.
 */
export interface WorkspaceEnvironment {
  /** Unique identifier for this environment instance. */
  readonly id: string;

  /** Human-readable label (e.g., "local", "s3-project-abc", "efs-worker"). */
  readonly label: string;

  // --- File operations ---
  readFile(path: string): Promise<string>;
  writeFile(path: string, content: string): Promise<void>;
  deleteFile(path: string): Promise<void>;
  exists(path: string): Promise<boolean>;
  readDirectory(path: string): Promise<readonly FileEntry[]>;
  mkdir(path: string): Promise<void>;
  stat(path: string): Promise<FileStat>;

  // --- Command execution ---
  /**
   * Execute a command in this environment's file system context.
   * The command runs with the environment's files as its working tree.
   */
  execute(options: ExecuteOptions): Promise<ExecutionResult>;

  // --- Lifecycle ---
  /**
   * Ensure the environment is ready (EFS mounted, files synced, etc.).
   * Called before first use. Idempotent.
   */
  initialize(): Promise<void>;

  /**
   * Clean up resources (unmount, release locks, etc.).
   */
  dispose(): Promise<void>;

  // --- Backward compatibility ---
  /**
   * Expose the underlying FileSystem for packages that still need it
   * (BuildContext, agent tools) during the migration period.
   */
  readonly fileSystem: FileSystem;
}
