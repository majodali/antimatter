/**
 * antimatter_file_read — Read a file from the workspace.
 */

import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { AutomationClient } from '../client.js';

export function registerFileReadTool(server: McpServer, client: AutomationClient): void {
  server.tool(
    'antimatter_file_read',
    'Read a file from the Antimatter IDE workspace. Returns the file content.',
    {
      path: z.string().describe('File path relative to project root (e.g. "src/index.ts")'),
      projectId: z.string().optional().describe('Override the default project ID'),
    },
    async ({ path, projectId }) => {
      const result = await client.execute('file.read', { path }, projectId);

      if (!result.ok) {
        return {
          content: [{ type: 'text' as const, text: `Error reading ${path}: ${result.error?.message}` }],
          isError: true,
        };
      }

      const data = result.data as { path: string; content: string };
      return {
        content: [{ type: 'text' as const, text: data.content }],
      };
    },
  );
}
