import type {
  Identifier,
  Timestamp,
  BuildRule,
  BuildTarget,
  Hash,
} from '@antimatter/project-model';
import type { FileSystem } from '@antimatter/filesystem';
import type { ToolRunner } from '@antimatter/tool-integration';

/**
 * Error thrown when build execution fails.
 */
export class BuildExecutionError extends Error {
  constructor(
    message: string,
    public readonly targetId: Identifier,
    public readonly reason:
      | 'dependency-failed'
      | 'execution-failed'
      | 'circular-dependency',
  ) {
    super(message);
    this.name = 'BuildExecutionError';
    Object.setPrototypeOf(this, BuildExecutionError.prototype);
  }
}

/**
 * Error thrown when cache operations fail.
 */
export class CacheError extends Error {
  constructor(
    message: string,
    public readonly reason: 'read-failed' | 'write-failed' | 'invalid-format',
  ) {
    super(message);
    this.name = 'CacheError';
    Object.setPrototypeOf(this, CacheError.prototype);
  }
}

/**
 * Context required for build execution.
 * @internal
 */
export interface BuildContext {
  /** Workspace root directory */
  readonly workspaceRoot: string;
  /** File system abstraction */
  readonly fs: FileSystem;
  /** Tool runner for executing commands */
  readonly runner: ToolRunner;
  /** Map of build rules by ID */
  readonly rules: ReadonlyMap<Identifier, BuildRule>;
  /** Optional cache directory (defaults to .antimatter-cache) */
  readonly cacheDir?: string;
}

/**
 * Execution plan with topologically sorted targets.
 * @internal
 */
export interface ExecutionPlan {
  /** Targets in execution order (dependencies first) */
  readonly targets: readonly BuildTarget[];
}

/**
 * Cache entry stored in .antimatter-cache/*.json
 * @internal
 */
export interface CacheEntry {
  /** Target ID this cache belongs to */
  readonly targetId: Identifier;
  /** Input file hashes: path -> hash */
  readonly inputHashes: ReadonlyMap<string, Hash>;
  /** Output file hashes: path -> hash */
  readonly outputHashes: ReadonlyMap<string, Hash>;
  /** When this cache was created */
  readonly timestamp: Timestamp;
}
