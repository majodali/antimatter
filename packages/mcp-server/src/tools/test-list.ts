/**
 * antimatter_test_list — List available test modules.
 */

import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { AutomationClient } from '../client.js';

export function registerTestListTool(server: McpServer, client: AutomationClient): void {
  server.tool(
    'antimatter_test_list',
    'List all available functional test modules in the Antimatter IDE, including their IDs and feature areas.',
    {
      projectId: z.string().optional().describe('Override the default project ID'),
    },
    async ({ projectId }) => {
      const result = await client.execute('tests.list', {}, projectId);

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
