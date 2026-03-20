/**
 * Configuration for the Antimatter MCP server.
 * Reads from environment variables with sensible defaults.
 */

export interface McpServerConfig {
  readonly baseUrl: string;
  readonly projectId: string;
  readonly tokenFilePath: string;
}

export function loadConfig(): McpServerConfig {
  return {
    baseUrl: process.env.ANTIMATTER_BASE_URL ?? 'https://ide.antimatter.solutions',
    projectId: process.env.ANTIMATTER_PROJECT_ID ?? '',
    tokenFilePath: process.env.ANTIMATTER_TOKEN_FILE ?? './antimatter-tokens.json',
  };
}
