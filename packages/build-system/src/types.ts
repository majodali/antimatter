import type {
  Identifier,
  Timestamp,
  BuildRule,
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
    public readonly ruleId: Identifier,
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
  /** Optional cache directory (defaults to .antimatter-cache) */
  readonly cacheDir?: string;
  /** Maximum number of parallel rule executions (default: 4) */
  readonly maxConcurrency?: number;
  /** Progress callback for streaming build events */
  readonly onProgress?: (event: BuildProgressEvent) => void;
}

/** Events emitted during build execution for streaming progress. */
export type BuildProgressEvent =
  | { readonly type: 'rule-started'; readonly ruleId: Identifier; readonly timestamp: string }
  | { readonly type: 'rule-output'; readonly ruleId: Identifier; readonly line: string }
  | { readonly type: 'rule-completed'; readonly ruleId: Identifier; readonly result: import('@antimatter/project-model').BuildResult }

/**
 * Execution plan with topologically sorted rules.
 * @internal
 */
export interface ExecutionPlan {
  /** Rules in execution order (dependencies first) */
  readonly rules: readonly BuildRule[];
  /** Rules grouped by wave — all rules in a wave can run in parallel */
  readonly levels: readonly (readonly BuildRule[])[];
}

/**
 * Cache entry stored in .antimatter-cache/*.json
 * @internal
 */
export interface CacheEntry {
  /** Rule ID this cache belongs to */
  readonly ruleId: Identifier;
  /** Input file hashes: path -> hash */
  readonly inputHashes: ReadonlyMap<string, Hash>;
  /** Output file hashes: path -> hash */
  readonly outputHashes: ReadonlyMap<string, Hash>;
  /** When this cache was created */
  readonly timestamp: Timestamp;
}
