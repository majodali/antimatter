/**
 * RestTransport — browser-side HTTP transport adapter for the ServiceClient.
 *
 * Sends commands and queries as REST requests, routing to either the workspace
 * server (via ALB) or the Lambda API depending on operation context and
 * workspace availability.
 *
 * Handles:
 *  - Auth token injection (Cognito)
 *  - Workspace-aware URL routing
 *  - Non-JSON response detection (CloudFront fallback pages)
 *  - Error normalization to ServiceResponse
 */

import type { TransportAdapter, ServiceResponse, Operation } from '@antimatter/service-interface';
import { getExecutionContext } from '@antimatter/service-interface';
import { getAccessToken } from './auth.js';

// ---------------------------------------------------------------------------
// Workspace routing state
// ---------------------------------------------------------------------------

const activeWorkspaceProjectIds = new Set<string>();

export function setActiveWorkspace(projectId: string): void {
  activeWorkspaceProjectIds.add(projectId);
}

export function clearActiveWorkspace(projectId: string): void {
  activeWorkspaceProjectIds.delete(projectId);
}

export function getActiveWorkspace(): string | null {
  const first = activeWorkspaceProjectIds.values().next();
  return first.done ? null : first.value;
}

export function hasActiveWorkspace(projectId: string): boolean {
  return activeWorkspaceProjectIds.has(projectId);
}

// ---------------------------------------------------------------------------
// URL resolution
// ---------------------------------------------------------------------------

/**
 * Maps an operation type + projectId to a REST URL.
 *
 * Workspace operations route to `/workspace/{pid}/api/{service}/...` when the
 * workspace is active, otherwise fall back to `/api/projects/{pid}/{service}/...`.
 * Platform operations always go to `/api/...`.
 */
function resolveUrl(operation: Operation, projectId?: string): string {
  const type = operation.type;
  const context = getExecutionContext(type);
  const namespace = type.slice(0, type.indexOf('.'));

  // --- Platform operations (no workspace routing) ---
  if (context === 'platform') {
    return resolvePlatformUrl(type, namespace, operation, projectId);
  }

  // --- Workspace operations ---
  // When no projectId, fall back to legacy bare /api path (single-project compat).
  if (!projectId) {
    return resolveServiceUrl(type, namespace, '/api', operation);
  }

  const useWorkspace = activeWorkspaceProjectIds.has(projectId);
  const base = useWorkspace
    ? `/workspace/${projectId}/api`
    : `/api/projects/${projectId}`;

  return resolveServiceUrl(type, namespace, base, operation);
}

/**
 * Platform URL patterns — project CRUD, auth, secrets, infra, etc.
 */
function resolvePlatformUrl(
  type: string,
  namespace: string,
  operation: Operation,
  projectId?: string,
): string {
  const op = operation as Record<string, unknown>;

  switch (type) {
    // Projects
    case 'projects.list':     return '/api/projects';
    case 'projects.create':   return '/api/projects';
    case 'projects.get':      return `/api/projects/${op.projectId}`;
    case 'projects.delete':   return `/api/projects/${op.projectId}`;
    case 'projects.import':   return '/api/projects/import/git';

    // Workspace lifecycle (platform context — routed through Lambda)
    case 'workspaces.start':  return `/api/projects/${op.projectId}/workspace/start`;
    case 'workspaces.stop':   return `/api/projects/${op.projectId}/workspace/stop`;
    case 'workspaces.status': return `/api/projects/${op.projectId}/workspace/status`;

    // Auth
    case 'auth.currentUser':  return '/api/auth/me';

    // Observability
    case 'observability.events.list':
      return projectId
        ? `/api/projects/${projectId}/events`
        : '/api/events';

    default:
      // Generic fallback: /api/{namespace}
      return `/api/${namespace}`;
  }
}

/**
 * Workspace/project-scoped URL patterns.
 */
function resolveServiceUrl(
  type: string,
  namespace: string,
  base: string,
  operation: Operation,
): string {
  const op = operation as Record<string, unknown>;

  switch (namespace) {
    case 'files': {
      const sub = type.slice('files.'.length);
      switch (sub) {
        case 'read':             return `${base}/files/read?path=${enc(op.path)}`;
        case 'tree':             return `${base}/files/tree?path=${enc(op.path ?? '/')}`;
        case 'exists':           return `${base}/files/exists?path=${enc(op.path)}`;
        case 'write':            return `${base}/files/write`;
        case 'delete':           return `${base}/files/delete?path=${enc(op.path)}`;
        case 'mkdir':            return `${base}/files/mkdir`;
        case 'move':             return `${base}/files/move`;
        case 'copy':             return `${base}/files/copy`;
        case 'annotate':         return `${base}/files/annotate`;
        case 'clearAnnotations': return `${base}/files/clearAnnotations`;
        case 'annotations':      return `${base}/files/annotations`;
        default:                 return `${base}/files/${sub}`;
      }
    }

    case 'projects': {
      // VCS operations are project-scoped workspace ops
      const sub = type.slice('projects.'.length);
      switch (sub) {
        case 'status':    return `${base}/git/status`;
        case 'stage':     return `${base}/git/stage`;
        case 'unstage':   return `${base}/git/unstage`;
        case 'commit':    return `${base}/git/commit`;
        case 'push':      return `${base}/git/push`;
        case 'pull':      return `${base}/git/pull`;
        case 'log':       return `${base}/git/log?limit=${op.limit ?? 20}`;
        case 'remote':    return `${base}/git/remotes`;
        case 'setRemote': return `${base}/git/remote/add`;
        default:          return `${base}/git/${sub}`;
      }
    }

    case 'builds': {
      const sub = type.slice('builds.'.length);
      switch (sub) {
        case 'triggers.invoke':     return `${base}/workflow/emit`;
        case 'configurations.set':  return `${base}/build/config`;
        case 'rules.list':          return `${base}/build/config`;
        case 'results.list':        return `${base}/build/results`;
        case 'configurations.list': return `${base}/build/config`;
        case 'triggers.list':       return `${base}/workflow/triggers`;
        default:                    return `${base}/build/${sub}`;
      }
    }

    case 'tests': {
      const sub = type.slice('tests.'.length);
      switch (sub) {
        case 'run':      return `${base}/tests/run`;
        case 'list':     return `${base}/tests/list`;
        case 'results':  return `${base}/tests/results`;
        case 'runners':  return `${base}/tests/runners`;
        case 'register': return `${base}/tests/register`;
        default:         return `${base}/tests/${sub}`;
      }
    }

    case 'workspaces': {
      const sub = type.slice('workspaces.'.length);
      switch (sub) {
        case 'start':            return `${base}/workspace/start`;
        case 'stop':             return `${base}/workspace/stop`;
        case 'status':           return `${base}/workspace/status`;
        case 'terminals.create': return `${base}/workspace/terminals`;
        case 'terminals.close':  return `${base}/workspace/terminals/close`;
        case 'terminals.list':   return `${base}/workspace/terminals`;
        default:                 return `${base}/workspace/${sub}`;
      }
    }

    case 'agents': {
      const sub = type.slice('agents.'.length);
      switch (sub) {
        case 'chats.create':  return `${base}/agent/chat`;
        case 'chats.send':    return `${base}/agent/chat`;
        case 'chats.delete':  return `${base}/agent/history`;
        case 'chats.list':    return `${base}/agent/chat/sessions`;
        case 'chats.get':     return `${base}/agent/chat/sessions/${op.sessionId}`;
        case 'chats.history': return `${base}/agent/chat/history`;
        default:              return `${base}/agent/${sub}`;
      }
    }

    case 'deployedResources': {
      const sub = type.slice('deployedResources.'.length);
      return `${base}/deploy/${sub}`;
    }

    case 'clients': {
      const sub = type.slice('clients.'.length);
      switch (sub) {
        case 'automation.execute': return `${base}/automation/execute`;
        case 'list':               return `${base}/automation/clients`;
        default:                   return `${base}/automation/${sub}`;
      }
    }

    default:
      return `${base}/${namespace}`;
  }
}

function enc(v: unknown): string {
  return encodeURIComponent(String(v ?? ''));
}

// ---------------------------------------------------------------------------
// HTTP method resolution
// ---------------------------------------------------------------------------

function resolveMethod(type: string, context?: string): string {
  // Queries are always GET
  if (context === 'query') return 'GET';

  // Some command patterns map to specific HTTP methods
  if (type.endsWith('.delete') || type === 'agents.chats.delete') return 'DELETE';
  if (type === 'builds.configurations.set') return 'PUT';

  // Commands default to POST
  return 'POST';
}

// ---------------------------------------------------------------------------
// Body extraction — strip `type` and `projectId` from the operation
// ---------------------------------------------------------------------------

function extractBody(operation: Operation): Record<string, unknown> | undefined {
  const { type, projectId, ...rest } = operation as Record<string, unknown>;
  // Don't send a body for GET/DELETE requests with no meaningful params
  if (Object.keys(rest).length === 0) return undefined;
  return rest;
}

// ---------------------------------------------------------------------------
// RestTransport implementation
// ---------------------------------------------------------------------------

export class RestTransport implements TransportAdapter {
  get available(): boolean {
    return true; // REST is always available
  }

  async sendCommand(command: Operation, projectId?: string): Promise<ServiceResponse> {
    return this.send(command, projectId, 'command');
  }

  async sendQuery(query: Operation, projectId?: string): Promise<ServiceResponse> {
    return this.send(query, projectId, 'query');
  }

  private async send(
    operation: Operation,
    projectId: string | undefined,
    kind: 'command' | 'query',
  ): Promise<ServiceResponse> {
    const url = resolveUrl(operation, projectId);
    const method = resolveMethod(operation.type, kind);

    const token = await getAccessToken();
    const headers: Record<string, string> = {};
    if (token) headers['Authorization'] = `Bearer ${token}`;

    let init: RequestInit = { method, headers };

    if (method !== 'GET' && method !== 'DELETE') {
      const body = extractBody(operation);
      if (body) {
        headers['Content-Type'] = 'application/json';
        init.body = JSON.stringify(body);
      }
    }

    try {
      const res = await fetch(url, init);

      // Guard against non-JSON responses (CloudFront serving index.html for 404s)
      const contentType = res.headers.get('content-type') ?? '';
      if (!contentType.includes('json')) {
        return {
          ok: false,
          error: {
            code: 'unavailable',
            message: 'Server returned an unexpected response. You may need to restart your workspace.',
          },
        };
      }

      const json = await res.json();

      if (!res.ok) {
        return {
          ok: false,
          error: {
            code: json.code ?? 'execution-error',
            message: json.message ?? json.error ?? res.statusText,
            details: json.details,
          },
        };
      }

      // The existing API returns raw data objects, not ServiceResponse envelopes.
      // Wrap them in the canonical shape.
      return { ok: true, data: json };
    } catch (err) {
      return {
        ok: false,
        error: {
          code: 'unavailable',
          message: err instanceof Error ? err.message : 'Network error',
        },
      };
    }
  }
}
