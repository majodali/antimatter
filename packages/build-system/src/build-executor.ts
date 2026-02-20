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
    // Resolve dependencies to get execution order with levels
    const resolver = new DependencyResolver(targets, this.context.rules);
    const plan = resolver.resolve();

    const results = new Map<Identifier, BuildResult>();
    const failedTargets = new Set<Identifier>();
    const rebuiltTargets = new Set<Identifier>();
    const maxConcurrency = this.context.maxConcurrency ?? 4;

    // Execute wave by wave — all targets in a wave can run in parallel
    for (const wave of plan.levels) {
      // Filter out targets whose dependencies failed
      const eligible: { target: BuildTarget; rule: NonNullable<ReturnType<typeof this.context.rules.get>> }[] = [];

      for (const target of wave) {
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
          results.set(target.id, {
            targetId: target.id,
            status: 'skipped',
            diagnostics: [],
            startedAt: new Date().toISOString(),
            finishedAt: new Date().toISOString(),
            durationMs: 0,
          });
          failedTargets.add(target.id);
        } else {
          eligible.push({ target, rule });
        }
      }

      // Execute eligible targets in batches of maxConcurrency
      for (let i = 0; i < eligible.length; i += maxConcurrency) {
        const batch = eligible.slice(i, i + maxConcurrency);
        const batchResults = await Promise.all(
          batch.map(({ target, rule }) => {
            // Force rebuild if any dependency was rebuilt (incremental invalidation)
            const forceRebuild = (target.dependsOn || []).some((depId) =>
              rebuiltTargets.has(depId),
            );
            return this.executeTarget(target, rule, forceRebuild);
          }),
        );

        for (const result of batchResults) {
          results.set(result.targetId, result);
          if (result.status === 'failure') {
            failedTargets.add(result.targetId);
          }
          if (result.status === 'success') {
            // This target actually built (not cached), so mark dependents for rebuild
            rebuiltTargets.add(result.targetId);
          }
        }
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
    rule: NonNullable<ReturnType<typeof this.context.rules.get>>,
    forceRebuild = false,
  ): Promise<BuildResult> {
    const startedAt = new Date();
    const onProgress = this.context.onProgress;

    // Check cache validity (skip cache if a dependency was rebuilt)
    if (!forceRebuild) {
      const isCacheValid = await this.cacheManager.isCacheValid(
        target,
        rule,
        this.context.workspaceRoot,
      );

      if (isCacheValid) {
        const finishedAt = new Date();
        const result: BuildResult = {
          targetId: target.id,
          status: 'cached',
          diagnostics: [],
          startedAt: startedAt.toISOString(),
          finishedAt: finishedAt.toISOString(),
          durationMs: finishedAt.getTime() - startedAt.getTime(),
        };
        onProgress?.({ type: 'target-completed', targetId: target.id, result });
        return result;
      }
    }

    // Emit started event
    onProgress?.({ type: 'target-started', targetId: target.id, timestamp: startedAt.toISOString() });

    // Execute build command
    try {
      const toolConfig: ToolConfig = {
        id: rule.id,
        name: rule.name,
        command: rule.command,
        parameters: [],
        env: target.env,
      };

      const output = await this.context.runner.run({
        tool: toolConfig,
        parameters: {},
        cwd: this.context.workspaceRoot,
        env: target.env,
      });

      // Emit output lines
      const fullOutput = output.stdout + '\n' + output.stderr;
      if (onProgress) {
        for (const line of fullOutput.split('\n')) {
          if (line) onProgress({ type: 'target-output', targetId: target.id, line });
        }
      }

      const finishedAt = new Date();
      const diagnostics = parseDiagnostics(fullOutput, this.context.workspaceRoot);
      const status: BuildStatus = output.exitCode === 0 ? 'success' : 'failure';

      const result: BuildResult = {
        targetId: target.id,
        status,
        diagnostics,
        output: fullOutput.trim() || undefined,
        startedAt: startedAt.toISOString(),
        finishedAt: finishedAt.toISOString(),
        durationMs: finishedAt.getTime() - startedAt.getTime(),
      };

      if (status === 'success') {
        await this.cacheManager.saveCache(target, rule, this.context.workspaceRoot);
      }

      onProgress?.({ type: 'target-completed', targetId: target.id, result });
      return result;
    } catch (error) {
      const finishedAt = new Date();
      const result: BuildResult = {
        targetId: target.id,
        status: 'failure',
        diagnostics: [
          {
            file: '',
            line: 0,
            column: 0,
            severity: 'error',
            message: error instanceof Error ? error.message : String(error),
          },
        ],
        startedAt: startedAt.toISOString(),
        finishedAt: finishedAt.toISOString(),
        durationMs: finishedAt.getTime() - startedAt.getTime(),
      };

      onProgress?.({ type: 'target-completed', targetId: target.id, result });
      return result;
    }
  }
}
