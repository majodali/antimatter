import type { ToolOutput } from '@antimatter/project-model';
import type { ToolRunner, RunToolOptions } from '@antimatter/tool-integration';
import { validateParameters, substituteParameters } from '@antimatter/tool-integration';
import type { WorkspaceEnvironment } from './types.js';

/**
 * Adapts a WorkspaceEnvironment to the ToolRunner interface.
 *
 * This lets existing code that needs a ToolRunner (BuildContext, agent tools)
 * work with any WorkspaceEnvironment without changes.
 */
export class WorkspaceEnvironmentRunnerAdapter implements ToolRunner {
  constructor(private readonly env: WorkspaceEnvironment) {}

  async run(options: RunToolOptions): Promise<ToolOutput> {
    // Validate and substitute parameters (reuse existing logic)
    const validatedParams = validateParameters(options.tool, options.parameters);
    const command = substituteParameters(options.tool.command, validatedParams);

    // Merge environment variables: tool.env + options.env
    const env: Record<string, string> = {};
    if (options.tool.env) {
      Object.assign(env, options.tool.env);
    }
    if (options.env) {
      Object.assign(env, options.env);
    }

    const result = await this.env.execute({
      command,
      cwd: options.cwd,
      env: Object.keys(env).length > 0 ? env : undefined,
      timeout: options.timeout,
    });

    // Map ExecutionResult to ToolOutput
    return {
      exitCode: result.exitCode,
      stdout: result.stdout,
      stderr: result.stderr,
      data: tryParseJson(result.stdout),
    };
  }
}

/**
 * Attempt to parse stdout as JSON if it looks like JSON.
 */
function tryParseJson(stdout: string): unknown {
  const trimmed = stdout.trim();
  if (!trimmed.startsWith('{') && !trimmed.startsWith('[')) {
    return undefined;
  }
  try {
    return JSON.parse(trimmed);
  } catch {
    return undefined;
  }
}
