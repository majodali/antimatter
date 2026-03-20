/**
 * antimatter_workspace — Workspace lifecycle management.
 * Calls the Lambda REST API (not the workspace automation API).
 */

import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { AutomationClient } from '../client.js';
import type { McpServerConfig } from '../config.js';

export function registerWorkspaceTool(server: McpServer, client: AutomationClient, config: McpServerConfig): void {
  server.tool(
    'antimatter_workspace',
    'Manage workspace lifecycle: start, stop, or check status of a project workspace.',
    {
      action: z.enum(['start', 'stop', 'status']).describe('Workspace action: start, stop, or status'),
      projectId: z.string().optional().describe('Project ID. Defaults to configured project.'),
    },
    async ({ action, projectId }) => {
      const pid = projectId ?? config.projectId;
      if (!pid) {
        return {
          content: [{ type: 'text' as const, text: 'No project ID configured.' }],
          isError: true,
        };
      }

      try {
        const basePath = `/api/projects/${encodeURIComponent(pid)}/workspace`;
        let result: { status: number; data: unknown };

        switch (action) {
          case 'start':
            result = await client.callLambdaApi('POST', `${basePath}/start`);
            break;
          case 'stop':
            result = await client.callLambdaApi('POST', `${basePath}/stop`);
            break;
          case 'status':
            result = await client.callLambdaApi('GET', `${basePath}/status`);
            break;
        }

        return {
          content: [{ type: 'text' as const, text: JSON.stringify(result.data, null, 2) }],
        };
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        return {
          content: [{ type: 'text' as const, text: `Workspace ${action} failed: ${msg}` }],
          isError: true,
        };
      }
    },
  );
}
