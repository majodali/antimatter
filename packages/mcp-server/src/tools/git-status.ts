/**
 * antimatter_git_status — Get workspace git status.
 */

import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { AutomationClient } from '../client.js';

export function registerGitStatusTool(server: McpServer, client: AutomationClient): void {
  server.tool(
    'antimatter_git_status',
    'Get the git status of the Antimatter IDE workspace. Returns staged, modified, and untracked files.',
    {
      projectId: z.string().optional().describe('Override the default project ID'),
    },
    async ({ projectId }) => {
      const result = await client.execute('git.status', {}, projectId);

      if (!result.ok) {
        return {
          content: [{ type: 'text' as const, text: `Error: ${result.error?.message}` }],
          isError: true,
        };
      }

      return {
        content: [{ type: 'text' as const, text: JSON.stringify(result.data, null, 2) }],
      };
    },
  );
}
