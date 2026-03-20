/**
 * antimatter_client_refresh — Hard-refresh the IDE browser tab.
 */

import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { AutomationClient } from '../client.js';

export function registerClientRefreshTool(server: McpServer, client: AutomationClient): void {
  server.tool(
    'antimatter_client_refresh',
    'Reload the Antimatter IDE browser tab. Use after deploying frontend changes to pick up new code.',
    {
      hard: z.boolean().optional().describe('Force hard refresh (bypass cache). Default: true'),
      projectId: z.string().optional().describe('Override the default project ID'),
    },
    async ({ hard, projectId }) => {
      const result = await client.execute('client.refresh', { hard: hard ?? true }, projectId);

      if (!result.ok) {
        return {
          content: [{ type: 'text' as const, text: `Error: ${result.error?.message}` }],
          isError: true,
        };
      }

      return {
        content: [{ type: 'text' as const, text: 'IDE browser tab is refreshing.' }],
      };
    },
  );
}
