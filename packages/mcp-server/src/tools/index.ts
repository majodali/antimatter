/**
 * Register all Antimatter automation tools on the MCP server.
 */

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { AutomationClient } from '../client.js';
import type { McpServerConfig } from '../config.js';

import { registerExecuteTool } from './execute.js';
import { registerTestRunTool } from './test-run.js';
import { registerTestResultsTool } from './test-results.js';
import { registerTestListTool } from './test-list.js';
import { registerClientRefreshTool } from './client-refresh.js';
import { registerFileReadTool } from './file-read.js';
import { registerGitStatusTool } from './git-status.js';
import { registerWorkspaceTool } from './workspace.js';

export function registerAllTools(server: McpServer, client: AutomationClient, config: McpServerConfig): void {
  registerTestRunTool(server, client);
  registerTestResultsTool(server, client);
  registerTestListTool(server, client);
  registerClientRefreshTool(server, client);
  registerFileReadTool(server, client);
  registerGitStatusTool(server, client);
  registerWorkspaceTool(server, client, config);
  registerExecuteTool(server, client);
}
