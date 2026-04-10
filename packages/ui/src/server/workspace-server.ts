/**
 * Workspace Server — runs on EC2 instances, providing the full workspace backend.
 *
 * Supports multiple projects per server. Each project gets its own ProjectContext
 * with isolated: file system, PTY terminal, S3 sync, workflow engine, and WebSocket
 * connections. Projects are lazy-initialized on first request.
 *
 * Lifecycle:
 *  1. EC2 user-data downloads this bundle from S3 and starts it via systemd
 *  2. If PROJECT_ID env var is set, that project is auto-initialized (backward compat)
 *  3. Additional projects are initialized on demand via /workspace/{projectId}/* routes
 *  4. Idle shutdown: stops EC2 instance after 10 min with no WebSocket connections
 */

import express from 'express';
import { createServer } from 'node:http';
import { WebSocketServer, WebSocket } from 'ws';
import { URL } from 'node:url';
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
import {
  EC2Client,
  StopInstancesCommand,
} from '@aws-sdk/client-ec2';
import {
  ElasticLoadBalancingV2Client,
  DeregisterTargetsCommand,
} from '@aws-sdk/client-elastic-load-balancing-v2';
import { EventBridgeClient } from '@aws-sdk/client-eventbridge';
import { SSMClient } from '@aws-sdk/client-ssm';
import { EventLogger } from './services/event-logger.js';
import { createAuthMiddleware } from './middleware/auth.js';
import type { DeployLambdaClient, DeployCloudfrontClient } from './services/deployment-executor.js';
import { ProjectContext } from './project-context.js';
import type { SharedConfig } from './project-context.js';

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
const IDLE_TIMEOUT_MS = parseInt(process.env.IDLE_TIMEOUT_MS || '0', 10) || 60 * 60 * 1000; // default 1 hour, 0 = disabled

// PROJECT_ID is now optional — server starts empty and loads projects on demand.
// If set, that project is auto-initialized on startup (backward compat).
if (PROJECT_ID) {
  console.log(`[workspace-server] Primary project: ${PROJECT_ID}`);
}
console.log(`[workspace-server] Workspace root: ${WORKSPACE_ROOT}`);
console.log(`[workspace-server] S3 bucket: ${PROJECTS_BUCKET}`);

// ---------------------------------------------------------------------------
// Global Event Logger — for server-wide events (not project-scoped)
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
// Lazy-initialized deployment clients (shared across all projects)
// ---------------------------------------------------------------------------

let deployLambdaClient: DeployLambdaClient | undefined;
let deployCloudfrontClient: DeployCloudfrontClient | undefined;

function getDeployLambdaClient(): DeployLambdaClient {
  if (!deployLambdaClient) {
    const client = new LambdaClient({});
    deployLambdaClient = {
      async updateFunctionCode(params) {
        const res = await client.send(new UpdateFunctionCodeCommand({
          FunctionName: params.FunctionName,
          ZipFile: params.ZipFile,
        }));
        return { FunctionName: res.FunctionName, LastUpdateStatus: res.LastUpdateStatus };
      },
      async getFunctionConfiguration(params) {
        const res = await client.send(new GetFunctionConfigurationCommand({
          FunctionName: params.FunctionName,
        }));
        return { LastUpdateStatus: res.LastUpdateStatus, State: res.State };
      },
    };
  }
  return deployLambdaClient;
}

function getDeployCloudfrontClient(): DeployCloudfrontClient {
  if (!deployCloudfrontClient) {
    const client = new CloudFrontClient({});
    deployCloudfrontClient = {
      async createInvalidation(params) {
        const res = await client.send(new CreateInvalidationCommand({
          DistributionId: params.DistributionId,
          InvalidationBatch: params.InvalidationBatch,
        }));
        return { Invalidation: { Id: res.Invalidation?.Id } };
      },
    };
  }
  return deployCloudfrontClient;
}

// ---------------------------------------------------------------------------
// Connection Manager — global idle shutdown across all projects
// ---------------------------------------------------------------------------

class ConnectionManager {
  private totalConnections = 0;
  private shutdownTimer: ReturnType<typeof setTimeout> | null = null;
  private workflowHoldCount = 0;
  private holdSafetyTimer: ReturnType<typeof setTimeout> | null = null;
  private static readonly MAX_HOLD_DURATION_MS = 30 * 60 * 1000; // 30 minutes

  get count(): number { return this.totalConnections; }

  private get isHeld(): boolean { return this.workflowHoldCount > 0; }

  add(): void {
    this.totalConnections++;
    globalEventLogger.info('workspace', `Client connected (${this.totalConnections} total)`);
    if (this.shutdownTimer) {
      clearTimeout(this.shutdownTimer);
      this.shutdownTimer = null;
      console.log(`[connections] Shutdown timer cancelled (${this.totalConnections} connected)`);
    }
  }

  remove(): void {
    this.totalConnections = Math.max(0, this.totalConnections - 1);
    globalEventLogger.info('workspace', `Client disconnected (${this.totalConnections} remaining)`);
    console.log(`[connections] Client removed (${this.totalConnections} remaining)`);
    if (this.totalConnections === 0 && !this.isHeld) {
      this.startShutdownTimer();
    }
  }

  holdShutdown(): void {
    this.workflowHoldCount++;
    console.log(`[connections] Shutdown hold acquired (count: ${this.workflowHoldCount})`);
    if (this.shutdownTimer) {
      clearTimeout(this.shutdownTimer);
      this.shutdownTimer = null;
      console.log('[connections] Shutdown timer cancelled (workflow hold active)');
    }
    if (!this.holdSafetyTimer) {
      this.holdSafetyTimer = setTimeout(() => {
        console.warn(`[connections] Max hold duration exceeded — force releasing all holds`);
        this.workflowHoldCount = 0;
        this.holdSafetyTimer = null;
        if (this.totalConnections === 0) this.startShutdownTimer();
      }, ConnectionManager.MAX_HOLD_DURATION_MS);
    }
  }

  releaseShutdown(): void {
    if (this.workflowHoldCount > 0) this.workflowHoldCount--;
    console.log(`[connections] Shutdown hold released (count: ${this.workflowHoldCount})`);
    if (this.workflowHoldCount === 0 && this.holdSafetyTimer) {
      clearTimeout(this.holdSafetyTimer);
      this.holdSafetyTimer = null;
    }
    if (this.workflowHoldCount === 0 && this.totalConnections === 0) {
      this.startShutdownTimer();
    }
  }

  private startShutdownTimer(): void {
    if (process.env.IDLE_TIMEOUT_MS === '0') {
      console.log('[connections] No connections — idle shutdown disabled');
      return;
    }
    console.log(`[connections] No connections — starting ${IDLE_TIMEOUT_MS / 1000}s shutdown timer`);
    globalEventLogger.info('workspace', `No connections — idle shutdown timer started (${IDLE_TIMEOUT_MS / 1000}s)`);
    this.shutdownTimer = setTimeout(async () => {
      console.log('[connections] Idle timeout reached — stopping instance');
      await selfStop();
    }, IDLE_TIMEOUT_MS);
  }
}

const connectionManager = new ConnectionManager();

// ---------------------------------------------------------------------------
// Project Context Management — lazy initialization with promise coalescing
// ---------------------------------------------------------------------------

const projectContexts = new Map<string, ProjectContext>();
const contextInitPromises = new Map<string, Promise<ProjectContext>>();

const sharedConfig: SharedConfig = {
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
  onExecStart: () => connectionManager.holdShutdown(),
  onExecEnd: () => connectionManager.releaseShutdown(),
};

/**
 * Get or create a ProjectContext for the given project ID.
 * Uses promise coalescing to prevent duplicate initializations.
 */
async function getOrCreateContext(projectId: string): Promise<ProjectContext> {
  // Already initialized
  const existing = projectContexts.get(projectId);
  if (existing) return existing;

  // In-progress initialization — coalesce concurrent requests
  const pending = contextInitPromises.get(projectId);
  if (pending) return pending;

  // New context — initialize
  const promise = (async () => {
    console.log(`[workspace-server] Creating context for project: ${projectId}`);
    const ctx = new ProjectContext(projectId, sharedConfig);
    await ctx.initialize();
    projectContexts.set(projectId, ctx);
    contextInitPromises.delete(projectId);
    return ctx;
  })();

  contextInitPromises.set(projectId, promise);
  return promise;
}

// ---------------------------------------------------------------------------
// Self-Stop — stops this EC2 instance on idle timeout
// ---------------------------------------------------------------------------

async function selfStop(): Promise<void> {
  try {
    const tokenRes = await fetch('http://169.254.169.254/latest/api/token', {
      method: 'PUT',
      headers: { 'X-aws-ec2-metadata-token-ttl-seconds': '21600' },
    });
    const token = await tokenRes.text();

    const idRes = await fetch('http://169.254.169.254/latest/meta-data/instance-id', {
      headers: { 'X-aws-ec2-metadata-token': token },
    });
    const instanceId = await idRes.text();

    // Get our private IP for ALB deregistration
    const ipRes = await fetch('http://169.254.169.254/latest/meta-data/local-ipv4', {
      headers: { 'X-aws-ec2-metadata-token': token },
    });
    const privateIp = await ipRes.text();

    console.log(`[workspace-server] Stopping instance ${instanceId}...`);

    // Deregister from ALB target group FIRST so traffic stops arriving immediately
    const targetGroupArn = process.env.WORKSPACE_TARGET_GROUP_ARN;
    if (targetGroupArn && privateIp) {
      try {
        const elbv2 = new ElasticLoadBalancingV2Client({});
        await elbv2.send(new DeregisterTargetsCommand({
          TargetGroupArn: targetGroupArn,
          Targets: [{ Id: privateIp, Port: PORT }],
        }));
        console.log(`[workspace-server] Deregistered from ALB target group`);
      } catch (albErr) {
        console.error('[workspace-server] Failed to deregister from ALB:', albErr);
        // Continue with shutdown — stale target will be cleaned up by health checks
      }
    }

    // Shutdown all project contexts (stops file watchers, PTYs, flushes S3 sync)
    for (const ctx of projectContexts.values()) {
      await ctx.shutdown();
    }

    await globalEventLogger.emit('workspace.idle.shutdown', 'workspace', 'info',
      `Stopping instance ${instanceId} due to idle timeout`, { instanceId });

    const ec2 = new EC2Client({});
    await ec2.send(new StopInstancesCommand({ InstanceIds: [instanceId] }));
  } catch (err) {
    console.error('[workspace-server] Failed to self-stop:', err);
  }
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

// ---- Global endpoints (no project context needed) ----

app.get('/health', (_req, res) => {
  res.json({
    status: 'healthy',
    projects: [...projectContexts.keys()],
    primaryProject: PROJECT_ID || null,
    uptime: process.uptime(),
  });
});

app.get('/status', (_req, res) => {
  const projectStatuses: Record<string, { connections: number }> = {};
  for (const [id, ctx] of projectContexts) {
    projectStatuses[id] = { connections: ctx.connections.size };
  }
  res.json({
    projects: projectStatuses,
    totalConnections: connectionManager.count,
    uptime: process.uptime(),
  });
});

// ---- Auth middleware for API routes ----
const COGNITO_USER_POOL_ID = process.env.COGNITO_USER_POOL_ID || '';
const COGNITO_CLIENT_ID = process.env.COGNITO_CLIENT_ID || '';

if (COGNITO_USER_POOL_ID && COGNITO_CLIENT_ID) {
  console.log('[workspace-server] Auth middleware enabled');
  app.use('/api', createAuthMiddleware({
    userPoolId: COGNITO_USER_POOL_ID,
    region: process.env.AWS_REGION ?? 'us-west-2',
    clientId: COGNITO_CLIENT_ID,
  }));
}

// ---- Internal project context management ----

/** Shut down a single project's context (PTY, sync, watcher) without stopping the server. */
app.delete('/internal/project-context/:projectId', async (req, res) => {
  const { projectId } = req.params;
  const ctx = projectContexts.get(projectId);
  if (!ctx) {
    return res.status(404).json({ error: 'No active context for this project' });
  }
  await ctx.shutdown();
  projectContexts.delete(projectId);
  console.log(`[workspace-server] Project context ${projectId} removed`);
  res.json({ success: true });
});

/** List active project contexts. */
app.get('/internal/project-contexts', (_req, res) => {
  const contexts = [...projectContexts.keys()].map(id => ({
    projectId: id,
    connections: projectContexts.get(id)!.connections.size,
  }));
  res.json({ contexts });
});

// ---- Dynamic project routing ----
// Parses project ID from URL, strips prefix, and delegates to the project's router.

app.use((req, res, next) => {
  let projectId: string | null = null;
  let strippedUrl: string | null = null;

  // Match /workspace/{projectId}/...
  const workspaceMatch = req.url.match(/^\/workspace\/([^/?]+)(\/.*)?$/);
  if (workspaceMatch) {
    projectId = decodeURIComponent(workspaceMatch[1]);
    strippedUrl = workspaceMatch[2] || '/';
  }

  // Backward compat: /{PROJECT_ID}/... prefix (ALB health checks use this)
  if (!projectId && PROJECT_ID) {
    if (req.url.startsWith(`/${PROJECT_ID}/`)) {
      projectId = PROJECT_ID;
      strippedUrl = req.url.slice(`/${PROJECT_ID}`.length);
    } else if (req.url === `/${PROJECT_ID}`) {
      projectId = PROJECT_ID;
      strippedUrl = '/';
    }
  }

  // Backward compat: bare /api/* routes → primary project (single-project mode)
  if (!projectId && PROJECT_ID && req.url.startsWith('/api/')) {
    projectId = PROJECT_ID;
    strippedUrl = req.url; // Don't strip — router expects /api/*
  }

  if (!projectId) return next(); // No project ID found → fall through (404)

  // Get or create project context and delegate to its router
  getOrCreateContext(projectId)
    .then(ctx => {
      req.url = strippedUrl!;
      ctx.router(req, res, next);
    })
    .catch(err => {
      console.error(`[workspace-server] Failed to get context for ${projectId}:`, err);
      res.status(500).json({ error: 'Failed to initialize project', message: String(err) });
    });
});

// ---------------------------------------------------------------------------
// HTTP + WebSocket Server
// ---------------------------------------------------------------------------

const server = createServer(app);
const wss = new WebSocketServer({ noServer: true });

// Handle WebSocket upgrade
server.on('upgrade', (req, socket, head) => {
  const url = new URL(req.url || '/', `http://${req.headers.host}`);
  const pathParts = url.pathname.split('/').filter(Boolean);

  // Accept /terminal/{projectId}, /ws/terminal/{projectId},
  // and /workspace/{projectId}/ws/terminal/{projectId}
  const terminalIdx = pathParts.indexOf('terminal');
  if (terminalIdx === -1) {
    socket.destroy();
    return;
  }

  const requestedProjectId = pathParts[terminalIdx + 1];
  if (!requestedProjectId) {
    socket.destroy();
    return;
  }

  // Validate session token
  const token = url.searchParams.get('token');
  if (SESSION_TOKEN && token !== SESSION_TOKEN) {
    socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
    socket.destroy();
    return;
  }

  // Get or create project context, then upgrade
  getOrCreateContext(requestedProjectId)
    .then(ctx => {
      wss.handleUpgrade(req, socket, head, (ws) => {
        // Track in global connection manager (for idle shutdown)
        connectionManager.add();

        // Delegate to project context for connection handling
        ctx.handleConnection(ws);

        // Track disconnection in global connection manager
        const onClose = () => { connectionManager.remove(); };
        ws.on('close', onClose);
        ws.on('error', onClose);
      });
    })
    .catch(err => {
      console.error(`[workspace-server] WebSocket context error for ${requestedProjectId}:`, err);
      socket.write('HTTP/1.1 500 Internal Server Error\r\n\r\n');
      socket.destroy();
    });
});

// ---------------------------------------------------------------------------
// Startup
// ---------------------------------------------------------------------------

async function startup() {
  // Start HTTP server FIRST so health checks pass and the ALB registers us.
  // Project initialization happens async afterwards — it can consume
  // significant memory (esbuild bundling of .antimatter/*.ts) and time,
  // and shouldn't block the listener or cause health check failures.
  server.listen(PORT, async () => {
    console.log(`[workspace-server] Listening on port ${PORT}`);

    await globalEventLogger.emit('workspace.ready', 'workspace', 'info',
      'Workspace server ready', { port: PORT, uptime: process.uptime() });

    // Project initialization is lazy — triggered by first HTTP/WebSocket request.
    // Even with esbuild.transform() (fast), the full ProjectContext init includes
    // file watchers, S3 sync, git, and workflow manager which can block the event
    // loop. Lazy init keeps health checks responsive from the start.
    if (PROJECT_ID) {
      console.log(`[workspace-server] Primary project: ${PROJECT_ID} (lazy init on first request)`);
    }
  });
}

// Graceful shutdown
process.on('SIGTERM', async () => {
  console.log('[workspace-server] SIGTERM received — shutting down');
  globalEventLogger.info('workspace', 'SIGTERM received — shutting down');

  // Shutdown all project contexts
  for (const ctx of projectContexts.values()) {
    await ctx.shutdown();
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
