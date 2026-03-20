/**
 * antimatter_execute — Generic automation command execution.
 * Fallback for any command not covered by a purpose-built tool.
 */

import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { AutomationClient } from '../client.js';

export function registerExecuteTool(server: McpServer, client: AutomationClient): void {
  server.tool(
    'antimatter_execute',
    'Execute any Antimatter IDE automation command. Use for commands not covered by other antimatter_* tools. Available commands: file.read, file.write, file.delete, file.mkdir, file.tree, git.status, git.stage, git.unstage, git.commit, git.push, git.pull, build.run, workflow.state, workflow.errors, workflow.emit, editor.open, editor.active, editor.tabs, editor.close, tests.run, tests.list, tests.results, client.refresh, commands.list',
    {
      command: z.string().describe('The automation command to execute (e.g. "editor.tabs", "workflow.state")'),
      params: z.record(z.unknown()).optional().describe('Command parameters as key-value pairs'),
      projectId: z.string().optional().describe('Override the default project ID'),
    },
    async ({ command, params, projectId }) => {
      const result = await client.execute(command, params, projectId);

      if (!result.ok) {
        return {
          content: [{ type: 'text' as const, text: `Error (${result.error?.code}): ${result.error?.message}` }],
          isError: true,
        };
      }

      return {
        content: [{ type: 'text' as const, text: JSON.stringify(result.data, null, 2) }],
      };
    },
  );
}
