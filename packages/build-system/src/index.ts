// Re-export types from @antimatter/project-model
export type {
  BuildRule,
  BuildResult,
  BuildStatus,
} from '@antimatter/project-model';

// Export error classes and types
export { BuildExecutionError, CacheError } from './types.js';
export type { BuildContext, BuildProgressEvent, ExecutionPlan } from './types.js';

// Export main classes
export { BuildExecutor } from './build-executor.js';
export { CacheManager } from './cache-manager.js';
export { DependencyResolver } from './dependency-resolver.js';
export { MockBuildExecutor } from './mock-build-executor.js';
export { BuildWatcher } from './build-watcher.js';
export type { BuildWatcherOptions } from './build-watcher.js';

// Export utility functions
export { parseDiagnostics } from './diagnostic-parser.js';
export { expandGlobs, matchesAnyGlob, globToRegex } from './glob-matcher.js';

// Import types for convenience function
import type { Identifier, BuildRule, BuildResult } from '@antimatter/project-model';
import type { FileSystem } from '@antimatter/filesystem';
import type { ToolRunner } from '@antimatter/tool-integration';
import { BuildExecutor } from './build-executor.js';

/**
 * Convenience function to execute a build.
 *
 * Creates a BuildExecutor instance and executes the specified rules.
 *
 * @param options - Build execution options
 * @returns Map of rule ID to build result
 *
 * @example
 * ```typescript
 * import { executeBuild } from '@antimatter/build-system';
 * import { MemoryFileSystem } from '@antimatter/filesystem';
 * import { MockRunner } from '@antimatter/tool-integration';
 *
 * const results = await executeBuild({
 *   rules: [{
 *     id: 'compile',
 *     name: 'Compile',
 *     inputs: ['src/**\/*.ts'],
 *     outputs: ['dist/**\/*.js'],
 *     command: 'tsc',
 *   }],
 *   workspaceRoot: '/',
 *   fs: new MemoryFileSystem(),
 *   runner: new MockRunner(),
 * });
 * ```
 */
export async function executeBuild(options: {
  /** Build rules to execute */
  readonly rules: readonly BuildRule[];
  /** Workspace root directory */
  readonly workspaceRoot: string;
  /** File system abstraction */
  readonly fs: FileSystem;
  /** Tool runner for executing commands */
  readonly runner: ToolRunner;
  /** Optional cache directory (defaults to .antimatter-cache) */
  readonly cacheDir?: string;
}): Promise<ReadonlyMap<Identifier, BuildResult>> {
  const executor = new BuildExecutor({
    workspaceRoot: options.workspaceRoot,
    fs: options.fs,
    runner: options.runner,
    cacheDir: options.cacheDir,
  });

  return executor.executeBatch(options.rules);
}
