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
      },
      onError: (message, fatal) => {
        console.error(`[workspace-server] Child error (${projectId}): ${message}`);
        if (fatal) {
          globalEventLogger.error('workspace', `Project ${projectId} fatal error: ${message}`);
        }
      },
      onExit: (code, signal) => {
        console.log(`[workspace-server] Child exited (${projectId}): code=${code}, signal=${signal}`);
        // Auto-respawn
        const child = children.get(projectId);
        if (child && !child.isDead) return; // Already being respawned
        setTimeout(async () => {
          const c = children.get(projectId);
          if (c) {
            const ok = await c.respawn();
            if (ok) {
              // Re-register existing WebSocket connections with the new child
              for (const [connId, conn] of wsConnections) {
                if (conn.projectId === projectId) {
                  c.sendWsConnect(connId);
                }
              }
            }
          }
        }, 100);
      },
      onLog: (level, message) => {
        console.log(`[child:${projectId}] [${level}] ${message}`);
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
          clearInterval(heartbeat);
          wsConnections.delete(connectionId);
          totalConnections = Math.max(0, totalConnections - 1);
          child.sendWsDisconnect(connectionId);
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

async function startup() {
  if (!CHILD_PROCESS_MODE) {
    console.log('[workspace-server] Initializing legacy mode...');
    await initLegacyMode();
  }

  server.listen(PORT, async () => {
    console.log(`[workspace-server] Listening on port ${PORT}`);
    await globalEventLogger.emit('workspace.ready', 'workspace', 'info',
      'Workspace server ready', { port: PORT, mode: CHILD_PROCESS_MODE ? 'child-process' : 'legacy', uptime: process.uptime() });

    if (PROJECT_ID) {
      console.log(`[workspace-server] Primary project: ${PROJECT_ID} (lazy init on first request)`);
    }
  });
}

// Graceful shutdown
process.on('SIGTERM', async () => {
  console.log('[workspace-server] SIGTERM received — shutting down');
  globalEventLogger.info('workspace', 'SIGTERM received — shutting down');

  if (CHILD_PROCESS_MODE) {
    for (const child of children.values()) {
      await child.shutdown();
    }
  } else {
    const contexts = (globalThis as any).__legacyProjectContexts as Map<string, any> | undefined;
    if (contexts) {
      for (const ctx of contexts.values()) {
        await ctx.shutdown();
      }
    }
  }

  await globalEventLogger.shutdown();
  process.exit(0);
});

startup().catch(async (err) => {
  console.error('[workspace-server] Fatal startup error:', err);
  await globalEventLogger.emit('workspace.error', 'workspace', 'error',
    'Fatal startup error', { error: err instanceof Error ? err.message : String(err) });
  process.exit(1);
});
