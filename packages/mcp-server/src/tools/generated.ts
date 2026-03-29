/**
 * Auto-generated MCP tools from the service-interface operation registry.
 *
 * Each registered operation in ALL_OPERATIONS becomes an MCP tool named
 * `antimatter_{operation_type}` (dots replaced with underscores).
 *
 * Hand-crafted tools listed in HAND_CRAFTED_OPS are skipped — they provide
 * enhanced behavior (polling, special routing) beyond simple REST dispatch.
 */

import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { ALL_OPERATIONS, getOperationMeta } from '@antimatter/service-interface';
import type { AutomationClient } from '../client.js';
import type { McpServerConfig } from '../config.js';

// ---------------------------------------------------------------------------
// Operations with hand-crafted tool overrides (skip auto-generation)
// ---------------------------------------------------------------------------

const HAND_CRAFTED_OPS = new Set([
  // test-run.ts has polling with exponential backoff
  'tests.run',
  // workspace.ts routes to Lambda for start/stop (not automation API)
  'workspaces.start',
  'workspaces.stop',
  'workspaces.status',
]);

// Operations defined in service-interface but not yet implemented on the server.
// These are skipped to avoid registering tools that would always fail.
const NOT_YET_AVAILABLE = new Set([
  // Agent chat — works via REST+WebSocket but not automation API
  'agents.chats.create',
  'agents.chats.send',
  'agents.chats.delete',
  'agents.chats.list',
  'agents.chats.get',
  'agents.chats.history',
  // Deployed resources — not implemented
  'deployedResources.register',
  'deployedResources.deregister',
  'deployedResources.update',
  'deployedResources.list',
  'deployedResources.get',
  // Terminals — not exposed via automation API
  'workspaces.terminals.create',
  'workspaces.terminals.close',
  'workspaces.terminals.list',
  // Tests
  'tests.register',
  'tests.runners',
  // Auth
  'auth.currentUser',
  // Build config (no direct automation command)
  'builds.configurations.set',
  'builds.configurations.list',
  'builds.rules.list',
  'builds.triggers.list',
  // Observability
  'observability.events.list',
  // Client automation
  'clients.list',
  'clients.automation.execute',
]);

// ---------------------------------------------------------------------------
// Service-interface → automation command name translation
// ---------------------------------------------------------------------------
// The service-interface uses plural namespaces (files.write, projects.status)
// while the automation API uses singular names (file.write, git.status).
// This map translates for workspace/browser operations dispatched via automation API.

const AUTOMATION_COMMAND_MAP: Record<string, string> = {
  // Files
  'files.read':             'file.read',
  'files.write':            'file.write',
  'files.delete':           'file.delete',
  'files.mkdir':            'file.mkdir',
  'files.tree':             'file.tree',
  'files.move':             'file.move',
  'files.copy':             'file.copy',
  'files.exists':           'file.exists',
  // Git (projects.* VCS operations map to git.*)
  'projects.status':        'git.status',
  'projects.stage':         'git.stage',
  'projects.unstage':       'git.unstage',
  'projects.commit':        'git.commit',
  'projects.push':          'git.push',
  'projects.pull':          'git.pull',
  // Build/workflow
  'builds.triggers.invoke': 'workflow.emit',
  'builds.results.list':    'build.results',
  // Tests (browser-relayed)
  'tests.list':             'tests.list',
  'tests.results':          'tests.results',
  // Editor (browser-relayed)
  'clients.automation.execute': 'commands.list',
  // Workflow
  'workflow.state':         'workflow.state',
  'workflow.errors':        'workflow.errors',
  // Client
  'clients.list':           'commands.list',
};

// ---------------------------------------------------------------------------
// Platform operations that go through Lambda REST, not automation API
// ---------------------------------------------------------------------------

/** Maps platform operation types to Lambda REST endpoints. */
function getPlatformRoute(opType: string, params: Record<string, unknown>): { method: string; path: string; body?: Record<string, unknown> } | null {
  switch (opType) {
    case 'projects.list':
      return { method: 'GET', path: '/api/projects' };
    case 'projects.create':
      return { method: 'POST', path: '/api/projects', body: params };
    case 'projects.delete':
      return { method: 'DELETE', path: `/api/projects/${params.projectId ?? ''}` };
    case 'projects.get':
      return { method: 'GET', path: `/api/projects/${params.projectId ?? ''}` };
    case 'projects.import':
      return { method: 'POST', path: '/api/projects/import/git', body: params };
    case 'auth.currentUser':
      return { method: 'GET', path: '/api/auth/me' };
    default:
      return null;
  }
}

// ---------------------------------------------------------------------------
// Tool name conversion
// ---------------------------------------------------------------------------

/** Convert operation type to MCP tool name: 'files.write' → 'antimatter_files_write' */
function toToolName(opType: string): string {
  return `antimatter_${opType.replace(/\./g, '_')}`;
}

// ---------------------------------------------------------------------------
// Auto-registration
// ---------------------------------------------------------------------------

export function registerGeneratedTools(
  server: McpServer,
  client: AutomationClient,
  config: McpServerConfig,
): void {
  let registered = 0;

  for (const [opType, meta] of Object.entries(ALL_OPERATIONS)) {
    // Skip hand-crafted overrides and unimplemented operations
    if (HAND_CRAFTED_OPS.has(opType)) continue;
    if (NOT_YET_AVAILABLE.has(opType)) continue;

    const toolName = toToolName(opType);

    // Build parameter schema: operation params + optional projectId override
    const baseParams = (meta.params ?? {}) as Record<string, z.ZodTypeAny>;
    const paramSchema = {
      ...baseParams,
      projectId: z.string().optional().describe('Override the default project ID'),
    };

    server.tool(toolName, meta.description, paramSchema, async (params) => {
      const { projectId, ...opParams } = params;
      const pid = projectId ?? config.projectId;

      try {
        // Platform operations go direct to Lambda REST
        if (meta.context === 'platform') {
          const route = getPlatformRoute(opType, { ...opParams, projectId: pid });
          if (route) {
            const result = await client.callLambdaApi(route.method, route.path, route.body);
            return {
              content: [{ type: 'text' as const, text: JSON.stringify(result.data, null, 2) }],
            };
          }
        }

        // Workspace and browser operations go through automation API
        // Translate service-interface operation type to automation command name
        const automationCmd = AUTOMATION_COMMAND_MAP[opType] ?? opType;
        const result = await client.execute(automationCmd, opParams, pid);

        if (!result.ok) {
          return {
            content: [{
              type: 'text' as const,
              text: `Error: ${result.error?.message ?? 'Unknown error'}\nCode: ${result.error?.code ?? 'unknown'}`,
            }],
            isError: true,
          };
        }

        return {
          content: [{ type: 'text' as const, text: JSON.stringify(result.data ?? result, null, 2) }],
        };
      } catch (err) {
        return {
          content: [{
            type: 'text' as const,
            text: `Failed: ${err instanceof Error ? err.message : String(err)}`,
          }],
          isError: true,
        };
      }
    });

    registered++;
  }

  console.error(`[mcp] Registered ${registered} auto-generated tools from service-interface`);
}
