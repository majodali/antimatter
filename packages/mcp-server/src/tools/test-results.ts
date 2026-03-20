/**
 * antimatter_test_results — Get current test results without running tests.
 */

import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { AutomationClient } from '../client.js';

export function registerTestResultsTool(server: McpServer, client: AutomationClient): void {
  server.tool(
    'antimatter_test_results',
    'Get the latest test results from the Antimatter IDE. Returns current run state, pass/fail counts, and per-test details.',
    {
      projectId: z.string().optional().describe('Override the default project ID'),
    },
    async ({ projectId }) => {
      const result = await client.execute('tests.results', {}, projectId);

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
