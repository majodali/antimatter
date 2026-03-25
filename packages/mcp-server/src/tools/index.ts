/**
 * Register all Antimatter automation tools on the MCP server.
 *
 * Two categories:
 * 1. Hand-crafted tools — enhanced behavior (polling, special routing)
 * 2. Auto-generated tools — one per service-interface operation
 */

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { AutomationClient } from '../client.js';
import type { McpServerConfig } from '../config.js';

import { registerTestRunTool } from './test-run.js';
import { registerWorkspaceTool } from './workspace.js';
import { registerExecuteTool } from './execute.js';
import { registerGeneratedTools } from './generated.js';

export function registerAllTools(server: McpServer, client: AutomationClient, config: McpServerConfig): void {
  // Hand-crafted tools with enhanced behavior (registered first, take priority)
  registerTestRunTool(server, client);
  registerWorkspaceTool(server, client, config);

  // Auto-generated tools from service-interface operation registry
  // (skips operations that have hand-crafted overrides)
  registerGeneratedTools(server, client, config);

  // Generic fallback for any command not covered above
  registerExecuteTool(server, client);
}
