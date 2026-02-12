import type {
  Identifier,
  BuildTarget,
  BuildResult,
  BuildStatus,
  ToolConfig,
} from '@antimatter/project-model';
import type { BuildContext } from './types.js';
import { BuildExecutionError } from './types.js';
import { DependencyResolver } from './dependency-resolver.js';
import { CacheManager } from './cache-manager.js';
import { parseDiagnostics } from './diagnostic-parser.js';

/**
 * Executes build targets with dependency resolution and caching.
 *
 * Features:
 * - Topological sorting of dependencies
 * - Input-based caching
 * - Diagnostic collection from tool output
 * - Skips dependent targets when builds fail
 */
export class BuildExecutor {
  private readonly cacheManager: CacheManager;

  constructor(private readonly context: BuildContext) {
    this.cacheManager = new CacheManager(
      context.fs,
      context.cacheDir || '.antimatter-cache',
    );
  }

  /**
   * Execute a batch of build targets.
   *
   * Resolves dependencies, checks cache, executes builds, and collects results.
   *
   * @param targets - Build targets to execute
   * @returns Map of target ID to build result
   */
  async executeBatch(
    targets: readonly BuildTarget[],
  ): Promise<ReadonlyMap<Identifier, BuildResult>> {
    // Resolve dependencies to get execution order
    const resolver = new DependencyResolver(targets, this.context.rules);
    const plan = resolver.resolve();

    const results = new Map<Identifier, BuildResult>();
    const failedTargets = new Set<Identifier>();

    // Execute targets in dependency order
    for (const target of plan.targets) {
      // Check if any dependency failed
      const rule = this.context.rules.get(target.ruleId);
      if (!rule) {
        throw new BuildExecutionError(
          `No build rule found for target '${target.id}' (ruleId: '${target.ruleId}')`,
          target.id,
          'execution-failed',
        );
      }

      const dependencies = target.dependsOn || [];
      const hasFailedDependency = dependencies.some((depId) =>
        failedTargets.has(depId),
      );

      if (hasFailedDependency) {
        // Skip this target because a dependency failed
        results.set(target.id, {
          targetId: target.id,
          status: 'skipped',
          diagnostics: [],
          startedAt: new Date().toISOString(),
          finishedAt: new Date().toISOString(),
          durationMs: 0,
        });
        failedTargets.add(target.id);
        continue;
      }

      // Execute target
      const result = await this.executeTarget(target, rule);
      results.set(target.id, result);

      // Track failed targets
      if (result.status === 'failure') {
        failedTargets.add(target.id);
      }
    }

    return results;
  }

  /**
   * Execute a single build target.
   *
   * @param target - Build target to execute
   * @param rule - Build rule for this target
   * @returns Build result
   */
  private async executeTarget(
    target: BuildTarget,
    rule: ReturnType<typeof this.context.rules.get>,
  ): Promise<BuildResult> {
    if (!rule) {
      throw new BuildExecutionError(
        `No build rule found for target '${target.id}'`,
        target.id,
        'execution-failed',
      );
    }

    const startedAt = new Date();

    // Check cache validity
    const isCacheValid = await this.cacheManager.isCacheValid(
      target,
      rule,
      this.context.workspaceRoot,
    );

    if (isCacheValid) {
      // Return cached result
      const finishedAt = new Date();
      return {
        targetId: target.id,
        status: 'cached',
        diagnostics: [],
        startedAt: startedAt.toISOString(),
        finishedAt: finishedAt.toISOString(),
        durationMs: finishedAt.getTime() - startedAt.getTime(),
      };
    }

    // Execute build command
    try {
      // Convert BuildRule.command to ToolConfig
      const toolConfig: ToolConfig = {
        id: rule.id,
        name: rule.name,
        command: rule.command,
        parameters: [], // No parameters for now
        env: target.env,
      };

      // Execute using ToolRunner
      const output = await this.context.runner.run({
        tool: toolConfig,
        parameters: {}, // Empty parameter values
        cwd: this.context.workspaceRoot,
        env: target.env,
      });

      const finishedAt = new Date();

      // Parse diagnostics from output
      const diagnostics = parseDiagnostics(
        output.stdout + '\n' + output.stderr,
        this.context.workspaceRoot,
      );

      // Determine status based on exit code
      const status: BuildStatus =
        output.exitCode === 0 ? 'success' : 'failure';

      const result: BuildResult = {
        targetId: target.id,
        status,
        diagnostics,
        startedAt: startedAt.toISOString(),
        finishedAt: finishedAt.toISOString(),
        durationMs: finishedAt.getTime() - startedAt.getTime(),
      };

      // Save cache if successful
      if (status === 'success') {
        await this.cacheManager.saveCache(
          target,
          rule,
          this.context.workspaceRoot,
        );
      }

      return result;
    } catch (error) {
      const finishedAt = new Date();

      return {
        targetId: target.id,
        status: 'failure',
        diagnostics: [
          {
            file: '',
            line: 0,
            column: 0,
            severity: 'error',
            message:
              error instanceof Error ? error.message : String(error),
          },
        ],
        startedAt: startedAt.toISOString(),
        finishedAt: finishedAt.toISOString(),
        durationMs: finishedAt.getTime() - startedAt.getTime(),
      };
    }
  }
}
