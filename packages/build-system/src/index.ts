// Re-export types from @antimatter/project-model
export type {
  BuildRule,
  BuildTarget,
  BuildResult,
  BuildStatus,
} from '@antimatter/project-model';

// Export error classes and types
export { BuildExecutionError, CacheError } from './types.js';
export type { BuildContext } from './types.js';

// Export main classes
export { BuildExecutor } from './build-executor.js';
export { CacheManager } from './cache-manager.js';
export { DependencyResolver } from './dependency-resolver.js';
export { MockBuildExecutor } from './mock-build-executor.js';

// Export utility functions
export { parseDiagnostics } from './diagnostic-parser.js';
export { expandGlobs, matchesAnyGlob, globToRegex } from './glob-matcher.js';

// Import types for convenience function
import type { Identifier, BuildRule, BuildTarget, BuildResult } from '@antimatter/project-model';
import type { FileSystem } from '@antimatter/filesystem';
import type { ToolRunner } from '@antimatter/tool-integration';
import { BuildExecutor } from './build-executor.js';

/**
 * Convenience function to execute a build.
 *
 * Creates a BuildExecutor instance and executes the specified targets.
 *
 * @param options - Build execution options
 * @returns Map of target ID to build result
 *
 * @example
 * ```typescript
 * import { executeBuild } from '@antimatter/build-system';
 * import { MemoryFileSystem } from '@antimatter/filesystem';
 * import { MockRunner } from '@antimatter/tool-integration';
 *
 * const results = await executeBuild({
 *   targets: [{ id: 'build', ruleId: 'compile', moduleId: 'app' }],
 *   rules: new Map([['compile', {
 *     id: 'compile',
 *     name: 'Compile',
 *     inputs: ['src/**\/*.ts'],
 *     outputs: ['dist/**\/*.js'],
 *     command: 'tsc',
 *   }]]),
 *   workspaceRoot: '/',
 *   fs: new MemoryFileSystem(),
 *   runner: new MockRunner(),
 * });
 * ```
 */
export async function executeBuild(options: {
  /** Build targets to execute */
  readonly targets: readonly BuildTarget[];
  /** Map of build rules by ID */
  readonly rules: ReadonlyMap<Identifier, BuildRule>;
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
    rules: options.rules,
    cacheDir: options.cacheDir,
  });

  return executor.executeBatch(options.targets);
}
