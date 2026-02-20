import type { AgentTool, ToolParameter } from '../types.js';
import type { ToolRunner } from '@antimatter/tool-integration';

export interface CustomToolDefinition {
  readonly name: string;
  readonly description: string;
  readonly command: string;
  readonly parameters?: readonly CustomToolParam[];
}

interface CustomToolParam {
  readonly name: string;
  readonly type: 'string' | 'number' | 'boolean';
  readonly description: string;
  readonly required?: boolean;
}

export function createCustomTool(
  def: CustomToolDefinition,
  runner: ToolRunner,
  workspaceRoot: string,
): AgentTool {
  const parameters: ToolParameter[] = (def.parameters ?? []).map((p) => ({
    name: p.name,
    type: p.type,
    description: p.description,
    required: p.required ?? false,
  }));

  return {
    name: def.name,
    description: def.description,
    parameters,
    execute: async (params) => {
      // Substitute {{param}} placeholders in the command
      let command = def.command;
      for (const [key, value] of Object.entries(params)) {
        command = command.replace(new RegExp(`\\{\\{${key}\\}\\}`, 'g'), String(value));
      }

      const result = await runner.run(command, {
        cwd: workspaceRoot,
        timeout: 30000,
      });

      return JSON.stringify({
        exitCode: result.exitCode,
        stdout: result.stdout,
        stderr: result.stderr,
      });
    },
  };
}
