import type {
  Identifier,
  BuildRule,
  BuildResult,
  BuildStatus,
  ToolConfig,
} from '@antimatter/project-model';
import type { BuildContext } from './types.js';
import { DependencyResolver } from './dependency-resolver.js';
import { CacheManager } from './cache-manager.js';
import { parseDiagnostics } from './diagnostic-parser.js';

/**
 * Executes build rules with dependency resolution and caching.
 *
 * Features:
 * - Topological sorting of dependencies
 * - Input-based caching
 * - Diagnostic collection from tool output
 * - Skips dependent rules when builds fail
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
   * Execute a batch of build rules.
   *
   * Resolves dependencies, checks cache, executes builds, and collects results.
   *
   * @param rules - Build rules to execute
   * @returns Map of rule ID to build result
   */
  async executeBatch(
    rules: readonly BuildRule[],
  ): Promise<ReadonlyMap<Identifier, BuildResult>> {
    // Resolve dependencies to get execution order with levels
    const resolver = new DependencyResolver(rules);
    const plan = resolver.resolve();

    const results = new Map<Identifier, BuildResult>();
    const failedRules = new Set<Identifier>();
    const rebuiltRules = new Set<Identifier>();
    const maxConcurrency = this.context.maxConcurrency ?? 4;

    // Execute wave by wave — all rules in a wave can run in parallel
    for (const wave of plan.levels) {
      // Filter out rules whose dependencies failed
      const eligible: BuildRule[] = [];

      for (const rule of wave) {
        const dependencies = rule.dependsOn || [];
        const hasFailedDependency = dependencies.some((depId) =>
          failedRules.has(depId),
        );

        if (hasFailedDependency) {
          results.set(rule.id, {
            ruleId: rule.id,
            status: 'skipped',
            diagnostics: [],
            startedAt: new Date().toISOString(),
            finishedAt: new Date().toISOString(),
            durationMs: 0,
          });
          failedRules.add(rule.id);
        } else {
          eligible.push(rule);
        }
      }

      // Execute eligible rules in batches of maxConcurrency
      for (let i = 0; i < eligible.length; i += maxConcurrency) {
        const batch = eligible.slice(i, i + maxConcurrency);
        const batchResults = await Promise.all(
          batch.map((rule) => {
            // Force rebuild if any dependency was rebuilt (incremental invalidation)
            const forceRebuild = (rule.dependsOn || []).some((depId) =>
              rebuiltRules.has(depId),
            );
            return this.executeRule(rule, forceRebuild);
          }),
        );

        for (const result of batchResults) {
          results.set(result.ruleId, result);
          if (result.status === 'failure') {
            failedRules.add(result.ruleId);
          }
          if (result.status === 'success') {
            // This rule actually built (not cached), so mark dependents for rebuild
            rebuiltRules.add(result.ruleId);
          }
        }
      }
    }

    return results;
  }

  /**
   * Execute a single build rule.
   *
   * @param rule - Build rule to execute
   * @param forceRebuild - Force rebuild even if cache is valid
   * @returns Build result
   */
  private async executeRule(
    rule: BuildRule,
    forceRebuild = false,
  ): Promise<BuildResult> {
    const startedAt = new Date();
    const onProgress = this.context.onProgress;

    // Check cache validity (skip cache if a dependency was rebuilt)
    if (!forceRebuild) {
      const isCacheValid = await this.cacheManager.isCacheValid(
        rule,
        this.context.workspaceRoot,
      );

      if (isCacheValid) {
        const finishedAt = new Date();
        const result: BuildResult = {
          ruleId: rule.id,
          status: 'cached',
          diagnostics: [],
          startedAt: startedAt.toISOString(),
          finishedAt: finishedAt.toISOString(),
          durationMs: finishedAt.getTime() - startedAt.getTime(),
        };
        onProgress?.({ type: 'rule-completed', ruleId: rule.id, result });
        return result;
      }
    }

    // Emit started event
    onProgress?.({ type: 'rule-started', ruleId: rule.id, timestamp: startedAt.toISOString() });

    // Execute build command
    try {
      const toolConfig: ToolConfig = {
        id: rule.id,
        name: rule.name,
        command: rule.command,
        parameters: [],
        env: rule.env,
      };

      const output = await this.context.runner.run({
        tool: toolConfig,
        parameters: {},
        cwd: this.context.workspaceRoot,
        env: rule.env,
      });

      // Emit output lines
      const fullOutput = output.stdout + '\n' + output.stderr;
      if (onProgress) {
        for (const line of fullOutput.split('\n')) {
          if (line) onProgress({ type: 'rule-output', ruleId: rule.id, line });
        }
      }

      const finishedAt = new Date();
      const diagnostics = parseDiagnostics(fullOutput, this.context.workspaceRoot);
      const status: BuildStatus = output.exitCode === 0 ? 'success' : 'failure';

      const result: BuildResult = {
        ruleId: rule.id,
        status,
        diagnostics,
        output: fullOutput.trim() || undefined,
        startedAt: startedAt.toISOString(),
        finishedAt: finishedAt.toISOString(),
        durationMs: finishedAt.getTime() - startedAt.getTime(),
      };

      if (status === 'success') {
        await this.cacheManager.saveCache(rule, this.context.workspaceRoot);
      }

      onProgress?.({ type: 'rule-completed', ruleId: rule.id, result });
      return result;
    } catch (error) {
      const finishedAt = new Date();
      const result: BuildResult = {
        ruleId: rule.id,
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

      onProgress?.({ type: 'rule-completed', ruleId: rule.id, result });
      return result;
    }
  }
}
