import type { FileSystem } from '@antimatter/filesystem';
import type { ToolRunner } from '@antimatter/tool-integration';
import type { BuildRule, BuildTarget, Identifier } from '@antimatter/project-model';
import { BuildExecutor } from '@antimatter/build-system';
import type { AgentTool } from '../types.js';

export interface RunBuildToolDeps {
  readonly fs: FileSystem;
  readonly runner: ToolRunner;
  readonly rules: ReadonlyMap<Identifier, BuildRule>;
  readonly targets: readonly BuildTarget[];
  readonly workspaceRoot: string;
}

/**
 * Create a tool that runs a build using the BuildExecutor.
 *
 * Returns a JSON summary of build results including status and diagnostics.
 */
export function createRunBuildTool(deps: RunBuildToolDeps): AgentTool {
  return {
    name: 'runBuild',
    description: 'Run the project build. Returns a JSON summary with status and diagnostics for each target.',
    parameters: [],
    async execute() {
      try {
        const context = {
          workspaceRoot: deps.workspaceRoot,
          fs: deps.fs,
          runner: deps.runner,
          rules: deps.rules,
        };
        const executor = new BuildExecutor(context);
        const results = await executor.executeBatch(deps.targets);

        const summary = Array.from(results.entries()).map(([id, result]) => ({
          targetId: id,
          status: result.status,
          durationMs: result.durationMs,
          diagnostics: result.diagnostics,
        }));

        return JSON.stringify({ results: summary });
      } catch (error) {
        return JSON.stringify({
          error: `Build failed: ${error instanceof Error ? error.message : String(error)}`,
        });
      }
    },
  };
}
