import type { ToolRunner } from '@antimatter/tool-integration';
import type { AgentTool } from '../types.js';

/**
 * Create a tool that runs tests via ToolRunner.
 */
export function createRunTestsTool(deps: {
  readonly runner: ToolRunner;
  readonly workspaceRoot: string;
}): AgentTool {
  return {
    name: 'runTests',
    description: 'Run the project tests using vitest. Returns JSON with exitCode and output.',
    parameters: [],
    async execute() {
      try {
        const result = await deps.runner.run({
          tool: {
            id: 'vitest',
            name: 'Vitest',
            command: 'vitest run',
            parameters: [],
          },
          parameters: {},
          cwd: deps.workspaceRoot,
        });

        return JSON.stringify({
          exitCode: result.exitCode,
          stdout: result.stdout,
          stderr: result.stderr,
        });
      } catch (error) {
        return JSON.stringify({
          error: `Test execution failed: ${error instanceof Error ? error.message : String(error)}`,
        });
      }
    },
  };
}

/**
 * Create a tool that runs the linter via ToolRunner.
 */
export function createRunLintTool(deps: {
  readonly runner: ToolRunner;
  readonly workspaceRoot: string;
}): AgentTool {
  return {
    name: 'runLint',
    description: 'Run the project linter using eslint. Returns JSON with exitCode and output.',
    parameters: [],
    async execute() {
      try {
        const result = await deps.runner.run({
          tool: {
            id: 'eslint',
            name: 'ESLint',
            command: 'eslint .',
            parameters: [],
          },
          parameters: {},
          cwd: deps.workspaceRoot,
        });

        return JSON.stringify({
          exitCode: result.exitCode,
          stdout: result.stdout,
          stderr: result.stderr,
        });
      } catch (error) {
        return JSON.stringify({
          error: `Lint execution failed: ${error instanceof Error ? error.message : String(error)}`,
        });
      }
    },
  };
}
