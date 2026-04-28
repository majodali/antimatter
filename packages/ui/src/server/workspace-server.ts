/**
 * Workspace Server — Router process.
 *
 * Lightweight parent process that manages per-project child processes (workers).
 * Handles HTTP routing, WebSocket upgrades, auth, and health checks.
 * Proxies HTTP to child UNIX sockets; relays WebSocket via IPC.
 *
 * In LEGACY mode (CHILD_PROCESS_MODE=0), runs the old monolith architecture
 * with ProjectContext in-process for safe rollback.
 *
 * Lifecycle:
 *  1. EC2 user-data downloads this bundle from S3 and starts it via systemd
 *  2. Express server starts on PORT, /health returns immediately
 *  3. First request for a project → spawns a child process (project-worker.js)
 *  4. HTTP requests proxied to child's UNIX socket
 *  5. WebSocket connections upgraded in parent, relayed to child via IPC
 */

import express from 'express';
import { createServer, request as httpRequest } from 'node:http';
import { WebSocketServer, WebSocket } from 'ws';
import { URL } from 'node:url';
import { randomUUID } from 'node:crypto';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readdirSync, unlinkSync, existsSync } from 'node:fs';
import { execSync } from 'node:child_process';
import {
  S3Client,
} from '@aws-sdk/client-s3';
import {
  LambdaClient,
  UpdateFunctionCodeCommand,
  GetFunctionConfigurationCommand,
} from '@aws-sdk/client-lambda';
import {
  CloudFrontClient,
  CreateInvalidationCommand,
} from '@aws-sdk/client-cloudfront';
import { EventBridgeClient } from '@aws-sdk/client-eventbridge';
import { SSMClient } from '@aws-sdk/client-ssm';
import { EventLogger } from './services/event-logger.js';
import { createAuthMiddleware } from './middleware/auth.js';
import { ChildProcessManager } from './child-process-manager.js';
import type { SerializableConfig } from './ipc-types.js';
import { ActivityLog } from './services/activity-log.js';
import { Kinds, type ActivityEvent } from '../shared/activity-types.js';

// Legacy mode imports (only used when CHILD_PROCESS_MODE=0)
import type { DeployLambdaClient, DeployCloudfrontClient } from './services/deployment-executor.js';

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

const PORT = parseInt(process.env.PORT || '8080', 10);
const PROJECT_ID = process.env.PROJECT_ID || '';
const PROJECTS_BUCKET = process.env.PROJECTS_BUCKET || '';
const WEBSITE_BUCKET = process.env.WEBSITE_BUCKET || '';
const SESSION_TOKEN = process.env.SESSION_TOKEN || '';
const WORKSPACE_ROOT = process.env.WORKSPACE_ROOT || '/workspace/data';
const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY || '';
const CHILD_PROCESS_MODE = process.env.CHILD_PROCESS_MODE !== '0'; // default: true

if (PROJECT_ID) {
  console.log(`[workspace-server] Primary project: ${PROJECT_ID}`);
}
console.log(`[workspace-server] Workspace root: ${WORKSPACE_ROOT}`);
console.log(`[workspace-server] S3 bucket: ${PROJECTS_BUCKET}`);
console.log(`[workspace-server] Mode: ${CHILD_PROCESS_MODE ? 'child-process' : 'legacy-monolith'}`);

// ---------------------------------------------------------------------------
// Global Event Logger
// ---------------------------------------------------------------------------

const globalEventLogger = new EventLogger({
  s3Client: new S3Client({}),
  bucket: PROJECTS_BUCKET,
  source: 'workspace',
  projectId: PROJECT_ID || 'server',
  eventBridgeClient: new EventBridgeClient({}),
  eventBusName: process.env.EVENT_BUS_NAME || 'antimatter',
});
globalEventLogger.startPeriodicFlush(10_000);

// ---------------------------------------------------------------------------
// Router Activity Log — captures router:*, child:*, service:* events
// ---------------------------------------------------------------------------

const routerActivityLog = new ActivityLog({
  logPath: '/opt/antimatter/router-activity.jsonl',
  label: 'router-activity',
});
// Initialize asynchronously; don't block startup
routerActivityLog.initialize().catch(err => {
  console.warn('[router-activity] initialize failed:', err);
});

/** Emit a router activity event. Also broadcasts to all connected WS clients. */
function emitActivity(input: Parameters<ActivityLog['emit']>[0]): ActivityEvent {
  const event = routerActivityLog.emit(input);
  // Broadcast to all WebSocket clients (scoped by projectId when set)
  const msg = JSON.stringify({ type: 'activity-event', event });
  for (const [, conn] of wsConnections) {
    if (!event.projectId || conn.projectId === event.projectId) {
      if (conn.ws.readyState === WebSocket.OPEN) conn.ws.send(msg);
    }
  }
  return event;
}

/** Designated "ops project" whose workflow engine receives platform events. */
const OPS_PROJECT_ID = process.env.OPS_PROJECT_ID || 'antimatter';

/** Buffer of ingress events awaiting the ops project to become ready. */
const pendingOpsEvents: Record<string, unknown>[] = [];

/**
 * Emit a platform lifecycle event into the ops project's workflow engine.
 * If the ops project isn't ready yet, the event is buffered.
 */
function emitToOpsProject(event: Record<string, unknown>): void {
  const child = children.get(OPS_PROJECT_ID);
  if (child?.isReady) {
    // Drain any pending first
    while (pendingOpsEvents.length > 0) {
      child.sendIngressEvent(pendingOpsEvents.shift()!);
    }
    child.sendIngressEvent(event);
  } else {
    pendingOpsEvents.push(event);
  }
}

// ---------------------------------------------------------------------------
// Child Process Management (child-process mode)
// ---------------------------------------------------------------------------

const children = new Map<string, ChildProcessManager>();
const childInitPromises = new Map<string, Promise<ChildProcessManager>>();

/** WebSocket connections tracked by the router: connectionId → {ws, projectId}. */
const wsConnections = new Map<string, { ws: WebSocket; projectId: string }>();

/** Total WebSocket connection count (for status reporting). */
let totalConnections = 0;

/** Determine the worker bundle path relative to this file. */
function getWorkerPath(): string {
  // In production (CJS bundle), project-worker.js is alongside workspace-server.js
  try {
    return resolve(dirname(fileURLToPath(import.meta.url)), 'project-worker.js');
  } catch {
    // CJS fallback
    return resolve(__dirname, 'project-worker.js');
  }
}

function createSerializableConfig(projectId: string): SerializableConfig {
  return {
    projectId,
    workspaceRoot: WORKSPACE_ROOT,
    projectsBucket: PROJECTS_BUCKET,
    websiteBucket: WEBSITE_BUCKET,
    anthropicApiKey: ANTHROPIC_API_KEY,
    eventBusName: process.env.EVENT_BUS_NAME || 'antimatter',
    sqsQueueUrl: process.env.SQS_QUEUE_URL || undefined,
    awsRegion: process.env.AWS_REGION || 'us-west-2',
    cognitoUserPoolId: process.env.COGNITO_USER_POOL_ID || undefined,
    cognitoClientId: process.env.COGNITO_CLIENT_ID || undefined,
  };
}

/**
 * Get or create a child process for a project.
 * Uses promise coalescing to prevent duplicate spawns.
 */
async function getOrCreateChild(projectId: string): Promise<ChildProcessManager> {
  const existing = children.get(projectId);
  if (existing?.isReady) return existing;

  const pending = childInitPromises.get(projectId);
  if (pending) return pending;

  const promise = (async () => {
    console.log(`[workspace-server] Spawning child for project: ${projectId}`);
    emitActivity({
      source: 'child', kind: Kinds.ChildSpawn, level: 'info',
      message: `Spawning worker for project ${projectId}`,
      projectId, correlationId: projectId,
    });
    // Notify ops project so it can register/update the worker resource
    emitToOpsProject({
      type: 'worker:spawning',
      projectId,
      spawnedAt: new Date().toISOString(),
    });
    const child = new ChildProcessManager({
      config: createSerializableConfig(projectId),
      workerPath: getWorkerPath(),
      onWsSend: (connectionId, data) => {
        const conn = wsConnections.get(connectionId);
        if (conn?.ws.readyState === WebSocket.OPEN) {
          conn.ws.send(data);
        }
      },
      onWsBroadcast: (projId, data) => {
        // Broadcast to all WebSocket clients for this project
        for (const [, conn] of wsConnections) {
          if (conn.projectId === projId && conn.ws.readyState === WebSocket.OPEN) {
            conn.ws.send(data);
          }
        }
      },
      onConnectionChange: (delta) => {
        totalConnections = Math.max(0, totalConnections + delta);
      },
      onExecHold: () => { /* No idle shutdown — no-op */ },
      onExecRelease: () => { /* No idle shutdown — no-op */ },
      onReady: () => {
        console.log(`[workspace-server] Child ready: ${projectId}`);
        emitActivity({
          source: 'child', kind: Kinds.ChildReady, level: 'info',
          message: `Worker ready: ${projectId}`,
          projectId, correlationId: projectId,
        });
        emitToOpsProject({
          type: 'worker:ready',
          projectId,
          readyAt: new Date().toISOString(),
        });
      },
      onError: (message, fatal) => {
        console.error(`[workspace-server] Child error (${projectId}): ${message}`);
        emitActivity({
          source: 'child', kind: Kinds.ChildError, level: fatal ? 'error' : 'warn',
          message: `Worker error${fatal ? ' (fatal)' : ''}: ${message}`,
          projectId, correlationId: projectId, data: { fatal, message },
        });
        if (fatal) {
          globalEventLogger.error('workspace', `Project ${projectId} fatal error: ${message}`);
        }
      },
      onExit: (code, signal) => {
        console.log(`[workspace-server] Child exited (${projectId}): code=${code}, signal=${signal}`);
        emitActivity({
          source: 'child', kind: Kinds.ChildExit, level: code === 0 ? 'info' : 'warn',
          message: `Worker exited: code=${code}, signal=${signal ?? 'none'}`,
          projectId, correlationId: projectId, data: { code, signal },
        });
        emitToOpsProject({
          type: 'worker:exited',
          projectId,
          code,
          signal,
          exitedAt: new Date().toISOString(),
        });
        // Auto-respawn
        const child = children.get(projectId);
        if (child && !child.isDead) return; // Already being respawned
        setTimeout(async () => {
          const c = children.get(projectId);
          if (c) {
            emitActivity({
              source: 'child', kind: Kinds.ChildRespawn, level: 'warn',
              message: `Respawning worker: ${projectId}`,
              projectId, correlationId: projectId,
            });
            const ok = await c.respawn();
            if (ok) {
              // Re-register existing WebSocket connections with the new child
              for (const [connId, conn] of wsConnections) {
                if (conn.projectId === projectId) {
                  c.sendWsConnect(connId);
                }
              }
            } else {
              emitActivity({
                source: 'child', kind: Kinds.ChildDead, level: 'error',
                message: `Worker dead (too many crashes): ${projectId}`,
                projectId, correlationId: projectId,
              });
            }
          }
        }, 100);
      },
      onLog: (level, message) => {
        console.log(`[child:${projectId}] [${level}] ${message}`);
      },
      onUnresponsive: () => {
        emitActivity({
          source: 'child', kind: Kinds.ChildUnresponsive, level: 'warn',
          message: `Worker unresponsive (heartbeat missed): ${projectId}`,
          projectId, correlationId: projectId,
        });
      },
      onForceRestart: () => {
        emitActivity({
          source: 'child', kind: Kinds.ChildForceRestart, level: 'warn',
          message: `Force-restarting unresponsive worker: ${projectId}`,
          projectId, correlationId: projectId,
        });
      },
      onDeadCooldown: () => {
        emitActivity({
          source: 'child', kind: Kinds.ChildDeadCooldown, level: 'info',
          message: `Dead-state cooldown elapsed — respawn re-enabled: ${projectId}`,
          projectId, correlationId: projectId,
        });
      },
    });

    await child.spawn();
    children.set(projectId, child);
    childInitPromises.delete(projectId);
    return child;
  })();

  childInitPromises.set(projectId, promise);
  return promise;
}

// ---------------------------------------------------------------------------
// HTTP Proxy — forward requests to child's UNIX socket
// ---------------------------------------------------------------------------

function proxyToChild(socketPath: string, url: string, req: express.Request, res: express.Response): void {
  const options = {
    socketPath,
    path: url,
    method: req.method,
    headers: { ...req.headers, host: 'localhost' },
  };

  const proxyReq = httpRequest(options, (proxyRes) => {
    res.writeHead(proxyRes.statusCode || 500, proxyRes.headers);
    proxyRes.pipe(res, { end: true });
  });

  proxyReq.on('error', (err) => {
    console.error(`[proxy] Error proxying to ${socketPath}:`, err.message);
    if (!res.headersSent) {
      res.status(502).json({ error: 'Project worker unavailable', message: err.message });
    }
  });

  // Forward request body
  if (req.readable) {
    req.pipe(proxyReq, { end: true });
  } else {
    // Body already parsed by express.json()
    if (req.body && Object.keys(req.body).length > 0) {
      const bodyStr = JSON.stringify(req.body);
      proxyReq.setHeader('Content-Type', 'application/json');
      proxyReq.setHeader('Content-Length', Buffer.byteLength(bodyStr));
      proxyReq.end(bodyStr);
    } else {
      proxyReq.end();
    }
  }
}

// ---------------------------------------------------------------------------
// Legacy Mode — in-process monolith (for rollback)
// ---------------------------------------------------------------------------

let legacyGetOrCreateContext: ((projectId: string) => Promise<any>) | null = null;

async function initLegacyMode(): Promise<void> {
  // Dynamic import to avoid loading ProjectContext when in child-process mode
  const { ProjectContext } = await import('./project-context.js');

  const projectContexts = new Map<string, InstanceType<typeof ProjectContext>>();
  const contextInitPromises = new Map<string, Promise<InstanceType<typeof ProjectContext>>>();

  // Lazy-initialized deployment clients
  let deployLambdaClient: DeployLambdaClient | undefined;
  let deployCloudfrontClient: DeployCloudfrontClient | undefined;

  function getDeployLambdaClient(): DeployLambdaClient {
    if (!deployLambdaClient) {
      const client = new LambdaClient({});
      deployLambdaClient = {
        async updateFunctionCode(params: any) {
          return client.send(new UpdateFunctionCodeCommand(params));
        },
        async getFunctionConfiguration(params: any) {
          return client.send(new GetFunctionConfigurationCommand(params));
        },
      };
    }
    return deployLambdaClient;
  }

  function getDeployCloudfrontClient(): DeployCloudfrontClient {
    if (!deployCloudfrontClient) {
      const client = new CloudFrontClient({});
      deployCloudfrontClient = {
        async createInvalidation(params: any) {
          return client.send(new CreateInvalidationCommand(params));
        },
      };
    }
    return deployCloudfrontClient;
  }

  const sharedConfig = {
    workspaceRoot: WORKSPACE_ROOT,
    projectsBucket: PROJECTS_BUCKET,
    websiteBucket: WEBSITE_BUCKET,
    anthropicApiKey: ANTHROPIC_API_KEY,
    s3Client: new S3Client({}),
    ssmClient: new SSMClient({}),
    eventBridgeClient: new EventBridgeClient({}),
    eventBusName: process.env.EVENT_BUS_NAME || 'antimatter',
    sqsQueueUrl: process.env.SQS_QUEUE_URL || undefined,
    getDeployLambdaClient,
    getDeployCloudfrontClient,
    onExecStart: () => {},
    onExecEnd: () => {},
  };

  legacyGetOrCreateContext = async (projectId: string) => {
    const existing = projectContexts.get(projectId);
    if (existing) return existing;
    const pending = contextInitPromises.get(projectId);
    if (pending) return pending;
    const promise = (async () => {
      const ctx = new ProjectContext(projectId, sharedConfig);
      await ctx.initialize();
      projectContexts.set(projectId, ctx);
      contextInitPromises.delete(projectId);
      return ctx;
    })();
    contextInitPromises.set(projectId, promise);
    return promise;
  };

  // Store for shutdown
  (globalThis as any).__legacyProjectContexts = projectContexts;
}

// ---------------------------------------------------------------------------
// Route Parsing
// ---------------------------------------------------------------------------

function parseProjectRoute(url: string): { projectId: string | null; strippedUrl: string } {
  // Match /workspace/{projectId}/...
  const workspaceMatch = url.match(/^\/workspace\/([^/?]+)(\/.*)?$/);
  if (workspaceMatch) {
    return {
      projectId: decodeURIComponent(workspaceMatch[1]),
      strippedUrl: workspaceMatch[2] || '/',
    };
  }

  // Backward compat: /{PROJECT_ID}/... prefix
  if (PROJECT_ID) {
    if (url.startsWith(`/${PROJECT_ID}/`)) {
      return { projectId: PROJECT_ID, strippedUrl: url.slice(`/${PROJECT_ID}`.length) };
    }
    if (url === `/${PROJECT_ID}`) {
      return { projectId: PROJECT_ID, strippedUrl: '/' };
    }
  }

  // Backward compat: bare /api/* routes → primary project
  if (PROJECT_ID && url.startsWith('/api/')) {
    return { projectId: PROJECT_ID, strippedUrl: url };
  }

  return { projectId: null, strippedUrl: url };
}

// ---------------------------------------------------------------------------
// Express App
// ---------------------------------------------------------------------------

const app = express();

// CORS
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept, Authorization');
  res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  if (req.method === 'OPTIONS') {
    res.sendStatus(200);
  } else {
    next();
  }
});
app.use(express.json({ limit: '10mb' }));

// ---- Service request logging ----
// Skip health checks (ALB pings /health every 10s — would flood the log)
app.use((req, res, next) => {
  if (req.url === '/health' || req.url === '/status') return next();
  const requestId = randomUUID();
  (req as any).__activityId = requestId;
  const start = Date.now();
  emitActivity({
    source: 'service', kind: Kinds.ServiceRequest, level: 'debug',
    message: `${req.method} ${req.url}`,
    correlationId: requestId,
    data: { method: req.method, url: req.url },
  });
  res.on('finish', () => {
    const durationMs = Date.now() - start;
    const status = res.statusCode;
    emitActivity({
      source: 'service',
      kind: status >= 500 ? Kinds.ServiceError : Kinds.ServiceResponse,
      level: status >= 500 ? 'error' : status >= 400 ? 'warn' : 'debug',
      message: `${req.method} ${req.url} → ${status} (${durationMs}ms)`,
      correlationId: requestId,
      data: { method: req.method, url: req.url, status, durationMs },
    });
  });
  next();
});

// ---- Global endpoints ----

app.get('/health', (_req, res) => {
  res.json({
    status: 'healthy',
    mode: CHILD_PROCESS_MODE ? 'child-process' : 'legacy',
    projects: CHILD_PROCESS_MODE
      ? [...children.keys()].map(id => ({ id, ready: children.get(id)?.isReady }))
      : [],
    primaryProject: PROJECT_ID || null,
    uptime: process.uptime(),
  });
});

app.get('/status', (_req, res) => {
  res.json({
    mode: CHILD_PROCESS_MODE ? 'child-process' : 'legacy',
    projects: [...children.keys()],
    totalConnections,
    uptime: process.uptime(),
  });
});

// ---- Auth middleware ----
const COGNITO_USER_POOL_ID = process.env.COGNITO_USER_POOL_ID || '';
const COGNITO_CLIENT_ID = process.env.COGNITO_CLIENT_ID || '';

if (COGNITO_USER_POOL_ID && COGNITO_CLIENT_ID) {
  console.log('[workspace-server] Auth middleware enabled');
  // Auth applies to /api routes and /workspace/*/api routes
  app.use('/api', createAuthMiddleware({
    userPoolId: COGNITO_USER_POOL_ID,
    region: process.env.AWS_REGION ?? 'us-west-2',
    clientId: COGNITO_CLIENT_ID,
  }));
}

// ---- Internal management endpoints ----

app.delete('/internal/project-context/:projectId', async (req, res) => {
  const { projectId } = req.params;
  if (CHILD_PROCESS_MODE) {
    const child = children.get(projectId);
    if (!child) return res.status(404).json({ error: 'No active child for this project' });
    await child.shutdown();
    children.delete(projectId);
    res.json({ success: true });
  } else {
    res.status(501).json({ error: 'Legacy mode — use legacy shutdown' });
  }
});

app.get('/internal/project-contexts', (_req, res) => {
  if (CHILD_PROCESS_MODE) {
    const contexts = [...children.entries()].map(([id, child]) => ({
      projectId: id,
      state: child.isReady ? 'ready' : child.isDead ? 'dead' : 'initializing',
    }));
    res.json({ contexts });
  } else {
    res.json({ contexts: [] });
  }
});

// ---- Router activity log — queryable via HTTP ----

app.get('/internal/activity', (req, res) => {
  const limit = parseInt((req.query.limit as string) ?? '500', 10);
  const since = req.query.since as string | undefined;
  const source = req.query.source as any;
  const kind = req.query.kind as string | undefined;
  const correlationId = req.query.correlationId as string | undefined;
  const projectId = req.query.projectId as string | undefined;
  const events = routerActivityLog.list({ limit, since, source, kind, correlationId, projectId });
  res.json({ events });
});

// ---- Dynamic project routing ----

app.use(async (req, res, next) => {
  const { projectId, strippedUrl } = parseProjectRoute(req.url);
  if (!projectId) return next();

  if (CHILD_PROCESS_MODE) {
    // Child-process mode: proxy to child's UNIX socket
    try {
      const child = await getOrCreateChild(projectId);
      if (!child.isReady) {
        return res.status(503).json({ error: 'Project initializing', retryAfter: 5 });
      }
      proxyToChild(child.getSocketPath(), strippedUrl, req, res);
    } catch (err) {
      console.error(`[workspace-server] Failed to get child for ${projectId}:`, err);
      res.status(503).json({ error: 'Failed to initialize project', message: String(err) });
    }
  } else {
    // Legacy mode: in-process routing
    try {
      const ctx = await legacyGetOrCreateContext!(projectId);
      req.url = strippedUrl;
      ctx.router(req, res, next);
    } catch (err) {
      console.error(`[workspace-server] Legacy context error for ${projectId}:`, err);
      res.status(500).json({ error: 'Failed to initialize project', message: String(err) });
    }
  }
});

// ---------------------------------------------------------------------------
// HTTP + WebSocket Server
// ---------------------------------------------------------------------------

const server = createServer(app);
const wss = new WebSocketServer({ noServer: true });

server.on('upgrade', async (req, socket, head) => {
  const url = new URL(req.url || '/', `http://${req.headers.host}`);
  const pathParts = url.pathname.split('/').filter(Boolean);

  const terminalIdx = pathParts.indexOf('terminal');
  if (terminalIdx === -1) { socket.destroy(); return; }

  const requestedProjectId = pathParts[terminalIdx + 1];
  if (!requestedProjectId) { socket.destroy(); return; }

  // Validate session token
  const token = url.searchParams.get('token');
  if (SESSION_TOKEN && token !== SESSION_TOKEN) {
    socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
    socket.destroy();
    return;
  }

  if (CHILD_PROCESS_MODE) {
    // Child-process mode: upgrade in parent, relay via IPC
    try {
      const child = await getOrCreateChild(requestedProjectId);
      if (!child.isReady) {
        socket.write('HTTP/1.1 503 Service Unavailable\r\n\r\n');
        socket.destroy();
        return;
      }

      wss.handleUpgrade(req, socket, head, (ws) => {
        const connectionId = randomUUID();
        wsConnections.set(connectionId, { ws, projectId: requestedProjectId });
        totalConnections++;

        emitActivity({
          source: 'router', kind: Kinds.RouterWsConnect, level: 'info',
          message: `WebSocket connected: ${requestedProjectId}`,
          projectId: requestedProjectId, correlationId: connectionId,
        });

        // Tell child about the new connection
        child.sendWsConnect(connectionId);

        // Relay client messages to child
        ws.on('message', (raw) => {
          child.sendWsMessage(connectionId, raw.toString());
        });

        // Heartbeat (stays in parent — needs actual WebSocket object)
        const heartbeat = setInterval(() => {
          if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: 'heartbeat' }));
        }, 20_000);

        const cleanup = () => {
          if (!wsConnections.has(connectionId)) return; // Already cleaned up
          clearInterval(heartbeat);
          wsConnections.delete(connectionId);
          totalConnections = Math.max(0, totalConnections - 1);
          child.sendWsDisconnect(connectionId);
          emitActivity({
            source: 'router', kind: Kinds.RouterWsDisconnect, level: 'info',
            message: `WebSocket disconnected: ${requestedProjectId}`,
            projectId: requestedProjectId, correlationId: connectionId,
          });
        };

        ws.on('close', cleanup);
        ws.on('error', cleanup);
      });
    } catch (err) {
      console.error(`[workspace-server] WebSocket child error for ${requestedProjectId}:`, err);
      socket.write('HTTP/1.1 503 Service Unavailable\r\n\r\n');
      socket.destroy();
    }
  } else {
    // Legacy mode: direct connection
    try {
      const ctx = await legacyGetOrCreateContext!(requestedProjectId);
      wss.handleUpgrade(req, socket, head, (ws) => {
        ctx.handleConnection(ws);
      });
    } catch (err) {
      console.error(`[workspace-server] WebSocket legacy error for ${requestedProjectId}:`, err);
      socket.write('HTTP/1.1 500 Internal Server Error\r\n\r\n');
      socket.destroy();
    }
  }
});

// ---------------------------------------------------------------------------
// Startup
// ---------------------------------------------------------------------------

/**
 * Clean up orphaned workers + sockets from a previous Router instance.
 * Called at startup to prevent "address in use" / stale socket issues.
 */
function reapOrphans(): { sockets: string[]; pids: number[] } {
  const reaped = { sockets: [] as string[], pids: [] as number[] };
  // 1. Stale UNIX sockets
  try {
    for (const file of readdirSync('/tmp')) {
      if (file.startsWith('am-') && file.endsWith('.sock')) {
        const path = `/tmp/${file}`;
        try { unlinkSync(path); reaped.sockets.push(path); } catch { /* ignore */ }
      }
    }
  } catch { /* /tmp missing, skip */ }

  // 2. Orphaned worker AND stuck Router processes from a prior generation.
  //    pgrep matches by full cmdline; we filter out our own PID so we never self-kill.
  for (const pattern of ['project-worker.js', 'workspace-server.js']) {
    try {
      const out = execSync(`pgrep -f ${pattern}`, { encoding: 'utf-8' });
      const pids = out.trim().split('\n').filter(Boolean).map(p => parseInt(p, 10))
        .filter(p => p && p !== process.pid);
      for (const pid of pids) {
        try { process.kill(pid, 'SIGKILL'); reaped.pids.push(pid); } catch { /* ignore */ }
      }
    } catch { /* pgrep found nothing or not available */ }
  }

  return reaped;
}

/**
 * Bind the HTTP server to PORT, retrying once on EADDRINUSE after killing
 * whichever process holds the port. The reaper covers most cases by name
 * pattern; this is a last-resort heal-in-place against any other holder.
 */
async function listenWithRetry(port: number, maxRetries = 1): Promise<void> {
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      await new Promise<void>((resolve, reject) => {
        const onError = (err: NodeJS.ErrnoException) => {
          server.removeListener('listening', onListening);
          reject(err);
        };
        const onListening = () => {
          server.removeListener('error', onError);
          resolve();
        };
        server.once('error', onError);
        server.once('listening', onListening);
        server.listen(port);
      });
      return;
    } catch (err: unknown) {
      const code = (err as NodeJS.ErrnoException)?.code;
      if (code !== 'EADDRINUSE' || attempt === maxRetries) throw err;
      console.warn(`[workspace-server] Port ${port} in use — searching for holder`);
      try {
        const out = execSync(`ss -ltnp 'sport = :${port}'`, { encoding: 'utf-8' });
        const m = out.match(/pid=(\d+)/);
        if (m) {
          const pid = parseInt(m[1], 10);
          if (pid && pid !== process.pid) {
            console.warn(`[workspace-server] Killing PID ${pid} holding port ${port}`);
            try { process.kill(pid, 'SIGKILL'); } catch { /* ignore */ }
          }
        }
      } catch { /* ss failed; fall through to delay + retry */ }
      await new Promise(r => setTimeout(r, 500));
    }
  }
}

async function startup() {
  // Reap orphans before anything else — prevents stuck state from previous runs
  const reaped = reapOrphans();
  if (reaped.sockets.length > 0 || reaped.pids.length > 0) {
    console.log(`[workspace-server] Reaped orphans: ${reaped.sockets.length} sockets, ${reaped.pids.length} processes`);
  }

  if (!CHILD_PROCESS_MODE) {
    console.log('[workspace-server] Initializing legacy mode...');
    await initLegacyMode();
  }

  await listenWithRetry(PORT);
  console.log(`[workspace-server] Listening on port ${PORT}`);
  emitActivity({
    source: 'router', kind: Kinds.RouterStart, level: 'info',
    message: `Router listening on port ${PORT}`,
    data: { port: PORT, mode: CHILD_PROCESS_MODE ? 'child-process' : 'legacy' },
  });
  if (reaped.sockets.length > 0 || reaped.pids.length > 0) {
    emitActivity({
      source: 'router', kind: Kinds.RouterReapOrphans, level: 'warn',
      message: `Reaped orphans at startup: ${reaped.sockets.length} sockets, ${reaped.pids.length} processes`,
      data: reaped,
    });
  }
  await globalEventLogger.emit('workspace.ready', 'workspace', 'info',
    'Workspace server ready', { port: PORT, mode: CHILD_PROCESS_MODE ? 'child-process' : 'legacy', uptime: process.uptime() });

  if (PROJECT_ID) {
    console.log(`[workspace-server] Primary project: ${PROJECT_ID} (lazy init on first request)`);
  }
}

// Graceful shutdown — bounded by a hard 30s outer timeout so systemd never
// has to escalate to SIGKILL of the cgroup just because cleanup hung.
process.on('SIGTERM', async () => {
  console.log('[workspace-server] SIGTERM received — shutting down');
  globalEventLogger.info('workspace', 'SIGTERM received — shutting down');
  emitActivity({
    source: 'router', kind: Kinds.RouterShutdown, level: 'info',
    message: 'Router shutting down (SIGTERM)',
  });

  const HARD_TIMEOUT_MS = 30_000;
  const forceExit = setTimeout(() => {
    console.error(`[workspace-server] Shutdown exceeded ${HARD_TIMEOUT_MS}ms — forcing exit`);
    process.exit(1);
  }, HARD_TIMEOUT_MS);
  forceExit.unref();

  try {
    if (CHILD_PROCESS_MODE) {
      // Parallel — each ChildProcessManager.shutdown() has its own 10s internal timeout.
      await Promise.all([...children.values()].map(c => c.shutdown()));
    } else {
      const contexts = (globalThis as any).__legacyProjectContexts as Map<string, any> | undefined;
      if (contexts) {
        await Promise.all([...contexts.values()].map(ctx => ctx.shutdown()));
      }
    }
    await globalEventLogger.shutdown();
  } catch (err) {
    console.error('[workspace-server] Error during shutdown:', err);
  }

  clearTimeout(forceExit);
  process.exit(0);
});

startup().catch(async (err) => {
  console.error('[workspace-server] Fatal startup error:', err);
  await globalEventLogger.emit('workspace.error', 'workspace', 'error',
    'Fatal startup error', { error: err instanceof Error ? err.message : String(err) });
  process.exit(1);
});
