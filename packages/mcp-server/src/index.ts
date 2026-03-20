#!/usr/bin/env node

/**
 * Antimatter IDE MCP Server
 *
 * Bridges Claude Code tool calls to the Antimatter IDE automation API.
 * Handles Cognito authentication, token refresh, and provides purpose-built
 * tools for test execution, file operations, and IDE control.
 *
 * Transport: stdio (JSON-RPC over stdin/stdout)
 * Logging: stderr only (stdout reserved for MCP protocol)
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { loadConfig } from './config.js';
import { AutomationClient } from './client.js';
import { registerAllTools } from './tools/index.js';

const config = loadConfig();
const client = new AutomationClient(config);

const server = new McpServer({
  name: 'antimatter-ide',
  version: '0.1.0',
});

registerAllTools(server, client, config);

async function main(): Promise<void> {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error(`[antimatter-mcp] Server running`);
  console.error(`[antimatter-mcp] Base URL: ${config.baseUrl}`);
  console.error(`[antimatter-mcp] Project ID: ${config.projectId || '(not set)'}`);
  console.error(`[antimatter-mcp] Token file: ${config.tokenFilePath}`);
}

main().catch((error) => {
  console.error('[antimatter-mcp] Fatal error:', error);
  process.exit(1);
});
