/**
 * Workspace Server — runs on EC2 instances, providing the full workspace backend.
 *
 * Combines all project-scoped APIs (files, build, agent, deploy, environments)
 * with interactive terminal (WebSocket + PTY) in a single Express server.
 *
 * Lifecycle:
 *  1. EC2 user-data downloads this bundle from S3 and starts it via systemd
 *  2. On first boot, syncs project files from S3 to local EBS
 *  3. Serves APIs on port 8080, proxied by ALB + CloudFront
 *  4. Idle shutdown: stops EC2 instance after 10 min with no WebSocket connections
 */

import express from 'express';
import { createServer } from 'node:http';
import { WebSocketServer, WebSocket } from 'ws';
import { URL } from 'node:url';
import { existsSync, readdirSync, mkdirSync, createWriteStream } from 'node:fs';
import { mkdir } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { pipeline } from 'node:stream/promises';
import { Readable } from 'node:stream';
import {
  S3Client,
  ListObjectsV2Command,
  GetObjectCommand,
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
import { EventBridgeClient } from '@aws-sdk/client-eventbridge';
import { SSMClient, GetParameterCommand } from '@aws-sdk/client-ssm';
import { LocalWorkspaceEnvironment, syncToS3 } from '@antimatter/workspace';
import type { SyncOptions, SyncResult } from '@antimatter/workspace';
import { watchDebounced } from '@antimatter/filesystem';
import type { FileSystem, WatchEvent, Watcher, WorkspacePath } from '@antimatter/filesystem';
import { EventLogger } from './services/event-logger.js';
import { BuildWatcher } from '@antimatter/build-system';
import type { BuildRule, BuildResult } from '@antimatter/project-model';
import { WorkspaceService } from './services/workspace-service.js';
import { createFileRouter } from './routes/filesystem.js';
import { createBuildRouter } from './routes/build.js';
import { createAgentRouter } from './routes/agent.js';
import { createDeployRouter } from './routes/deploy.js';
import { createEnvironmentRouter } from './routes/environments.js';
import { createActivityRouter } from './routes/activity.js';
import { createGitRouter } from './routes/git.js';
import { createEventsRouter } from './routes/events.js';
import { createAuthMiddleware } from './middleware/auth.js';
import type { DeployLambdaClient, DeployCloudfrontClient } from './services/deployment-executor.js';

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

const PORT = parseInt(process.env.PORT || '8080', 10);
const PROJECT_ID = process.env.PROJECT_ID || '';
const PROJECTS_BUCKET = process.env.PROJECTS_BUCKET || '';
const SESSION_TOKEN = process.env.SESSION_TOKEN || '';
const WORKSPACE_ROOT = process.env.WORKSPACE_ROOT || '/workspace/data';
const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY || '';
const IDLE_TIMEOUT_MS = 10 * 60 * 1000; // 10 minutes

if (!PROJECT_ID) {
  console.error('ERROR: PROJECT_ID environment variable is required');
  process.exit(1);
}

console.log(`[workspace-server] Starting for project: ${PROJECT_ID}`);
console.log(`[workspace-server] Workspace root: ${WORKSPACE_ROOT}`);
console.log(`[workspace-server] S3 bucket: ${PROJECTS_BUCKET}`);

// ---------------------------------------------------------------------------
// Event Logger — centralized logging to S3 + EventBridge signaling
// ---------------------------------------------------------------------------

const eventLogger = new EventLogger({
  s3Client: new S3Client({}),
  bucket: PROJECTS_BUCKET,
  source: 'workspace',
  projectId: PROJECT_ID,
  eventBridgeClient: new EventBridgeClient({}),
  eventBusName: process.env.EVENT_BUS_NAME || 'antimatter',
});
eventLogger.startPeriodicFlush(10_000);

// ---------------------------------------------------------------------------
// File Change Notifier — broadcasts filesystem changes to IDE via WebSocket
// ---------------------------------------------------------------------------

const NOISE_PREFIXES = ['/.git/', '/node_modules/', '/.antimatter-cache/'];
const NOISE_FILES = ['/.antimatter-sync.json'];

function isNoiseFile(path: string): boolean {
  return NOISE_PREFIXES.some(p => path.startsWith(p)) || NOISE_FILES.includes(path);
}

class FileChangeNotifier {
  private watcher: Watcher | null = null;
  private onBulkChange: (() => void) | null = null;

  start(
    fs: FileSystem,
    broadcast: (msg: object) => void,
    onBulkChange?: () => void,
  ): void {
    this.onBulkChange = onBulkChange ?? null;
    this.watcher = watchDebounced(
      fs,
      '/' as WorkspacePath,
      (events: readonly WatchEvent[]) => {
        const filtered = events.filter(e => !isNoiseFile(e.path));
        if (filtered.length === 0) return;

        broadcast({
          type: 'file-changes',
          changes: filtered.map(e => ({ type: e.type, path: e.path })),
        });

        // Trigger immediate S3 sync for bulk operations (git checkout, etc.)
        if (filtered.length > 20 && this.onBulkChange) {
          this.onBulkChange();
        }
      },
      300, // debounce ms
    );
  }

  stop(): void {
    this.watcher?.close();
    this.watcher = null;
  }
}

// ---------------------------------------------------------------------------
// S3 Sync Scheduler — periodic workspace → S3 backup
// ---------------------------------------------------------------------------

class S3SyncScheduler {
  private timer: ReturnType<typeof setInterval> | null = null;
  private syncing = false;

  constructor(private readonly syncOptions: SyncOptions) {}

  start(intervalMs = 30_000): void {
    this.timer = setInterval(() => this.sync(), intervalMs);
  }

  async sync(): Promise<SyncResult | null> {
    if (this.syncing) return null;
    this.syncing = true;
    try {
      const result = await syncToS3(this.syncOptions);
      if (result.uploaded > 0 || result.deleted > 0) {
        eventLogger.info('system', `S3 sync: ${result.uploaded} uploaded, ${result.deleted} deleted (${result.durationMs}ms)`,
          { uploaded: result.uploaded, deleted: result.deleted, durationMs: result.durationMs });
      }
      return result;
    } catch (err) {
      eventLogger.error('system', 'S3 sync failed', {
        error: err instanceof Error ? err.message : String(err),
      });
      return null;
    } finally {
      this.syncing = false;
    }
  }

  async shutdown(): Promise<void> {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    // Final sync before shutdown
    await this.sync();
  }
}

// ---------------------------------------------------------------------------
// PTY Manager — shared pseudo-terminal
// ---------------------------------------------------------------------------

// node-pty is a native module, installed separately on EC2
let pty: any;
try {
  pty = require('node-pty');
} catch {
  console.warn('[workspace-server] node-pty not available — terminal disabled');
}

const MAX_REPLAY_BYTES = 50 * 1024;

class PtyManager {
  private shell: any = null;
  private replayBuffer = '';
  private listeners = new Set<(data: string) => void>();

  get isRunning(): boolean {
    return this.shell !== null;
  }

  start(cwd: string): void {
    if (!pty) {
      console.warn('[pty] node-pty not available');
      return;
    }
    if (this.shell) return;

    if (!existsSync(cwd)) {
      mkdirSync(cwd, { recursive: true });
    }

    console.log(`[pty] Starting bash shell in ${cwd}`);

    this.shell = pty.spawn('bash', [], {
      name: 'xterm-256color',
      cols: 120,
      rows: 30,
      cwd,
      env: {
        ...process.env,
        TERM: 'xterm-256color',
        HOME: WORKSPACE_ROOT,
        LANG: 'en_US.UTF-8',
      },
    });

    this.shell.onData((data: string) => {
      this.replayBuffer += data;
      if (this.replayBuffer.length > MAX_REPLAY_BYTES) {
        this.replayBuffer = this.replayBuffer.slice(-MAX_REPLAY_BYTES);
      }
      for (const cb of this.listeners) {
        try { cb(data); } catch { /* ignore */ }
      }
    });

    this.shell.onExit(({ exitCode, signal }: { exitCode: number; signal: number }) => {
      console.log(`[pty] Shell exited: code=${exitCode}, signal=${signal}`);
      this.shell = null;
      setTimeout(() => {
        if (!this.shell) {
          console.log('[pty] Restarting shell...');
          this.start(cwd);
        }
      }, 1000);
    });
  }

  write(data: string): void {
    if (this.shell) this.shell.write(data);
  }

  resize(cols: number, rows: number): void {
    if (this.shell) {
      try { this.shell.resize(cols, rows); } catch { /* ignore */ }
    }
  }

  onData(cb: (data: string) => void): () => void {
    this.listeners.add(cb);
    return () => this.listeners.delete(cb);
  }

  getReplayBuffer(): string {
    return this.replayBuffer;
  }
}

// ---------------------------------------------------------------------------
// Connection Manager — tracks WebSocket connections + idle shutdown
// ---------------------------------------------------------------------------

class ConnectionManager {
  private readonly connections = new Set<WebSocket>();
  private shutdownTimer: ReturnType<typeof setTimeout> | null = null;

  get count(): number {
    return this.connections.size;
  }

  add(ws: WebSocket): void {
    this.connections.add(ws);
    eventLogger.info('workspace', `Client connected (${this.connections.size} total)`);
    if (this.shutdownTimer) {
      clearTimeout(this.shutdownTimer);
      this.shutdownTimer = null;
      console.log(`[connections] Shutdown timer cancelled (${this.connections.size} connected)`);
    }
  }

  remove(ws: WebSocket): void {
    this.connections.delete(ws);
    eventLogger.info('workspace', `Client disconnected (${this.connections.size} remaining)`);
    console.log(`[connections] Client removed (${this.connections.size} remaining)`);

    if (this.connections.size === 0) {
      console.log(`[connections] No connections — starting ${IDLE_TIMEOUT_MS / 1000}s shutdown timer`);
      eventLogger.info('workspace', `No connections — idle shutdown timer started (${IDLE_TIMEOUT_MS / 1000}s)`);
      this.shutdownTimer = setTimeout(async () => {
        console.log('[connections] Idle timeout reached — stopping instance');
        await selfStop();
      }, IDLE_TIMEOUT_MS);
    }
  }
}

// ---------------------------------------------------------------------------
// Build Watcher Manager — auto-triggers builds on file changes
// ---------------------------------------------------------------------------

class BuildWatcherManager {
  private watcher: BuildWatcher | null = null;
  private building = false;
  private rules: BuildRule[] = [];

  constructor(
    private readonly workspace: WorkspaceService,
    private readonly fileSystemGetter: () => import('@antimatter/filesystem').FileSystem,
    private readonly workspaceRoot: string,
    private readonly broadcast: (msg: object) => void,
  ) {}

  /**
   * Load build config and start (or restart) the file watcher.
   */
  async start(): Promise<void> {
    try {
      const config = await this.workspace.loadBuildConfig();
      this.rules = config.rules ?? [];
    } catch {
      console.log('[build-watcher] No build config found — watcher not started');
      return;
    }

    if (this.rules.length === 0) {
      console.log('[build-watcher] No build rules — watcher not started');
      return;
    }

    this.startWatcher();
  }

  /**
   * Restart the watcher with new rules (e.g. after config save).
   */
  async restart(rules: BuildRule[]): Promise<void> {
    this.rules = rules;
    this.stopWatcher();

    if (rules.length > 0) {
      this.startWatcher();
    }
  }

  /**
   * Pause auto-triggering (for agent batch edits).
   */
  hold(): void {
    if (this.watcher) {
      this.watcher.hold();
      console.log('[build-watcher] Build watcher held');
    }
  }

  /**
   * Resume auto-triggering and flush accumulated changes.
   */
  release(): void {
    if (this.watcher) {
      this.watcher.release();
      console.log('[build-watcher] Build watcher released');
    }
  }

  /**
   * Manually trigger a build for specific rules (or all).
   */
  async runBuild(ruleIds?: string[]): Promise<void> {
    const rulesToRun = ruleIds
      ? this.rules.filter((r) => ruleIds.includes(r.id))
      : this.rules;

    if (rulesToRun.length === 0) return;
    await this.executeBuild(rulesToRun);
  }

  stop(): void {
    this.stopWatcher();
  }

  private startWatcher(): void {
    this.stopWatcher();

    const fs = this.fileSystemGetter();
    this.watcher = new BuildWatcher({
      fs,
      workspaceRoot: this.workspaceRoot,
      debounceMs: 500,
      onTriggered: (ruleIds, changedPaths) => {
        console.log(`[build-watcher] Files changed: ${changedPaths.length} files → triggered rules: ${ruleIds.join(', ')}`);
        const triggered = this.rules.filter((r) => ruleIds.includes(r.id));
        this.executeBuild(triggered).catch((err) => {
          console.error('[build-watcher] Auto-build failed:', err);
        });
      },
    });

    this.watcher.setRules(this.rules);
    this.watcher.start();
    console.log(`[build-watcher] Watching ${this.rules.length} rules for file changes`);
  }

  private stopWatcher(): void {
    if (this.watcher) {
      this.watcher.stop();
      this.watcher = null;
    }
  }

  private async executeBuild(rules: BuildRule[]): Promise<void> {
    if (this.building) {
      console.log('[build-watcher] Build already in progress — skipping');
      return;
    }

    this.building = true;
    const ruleIds = rules.map((r) => r.id);
    this.broadcast({ type: 'build-started', ruleIds });

    try {
      const resultMap = await this.workspace.executeBuild(rules, (event) => {
        // Forward build progress events to all WebSocket clients
        this.broadcast(event);
      });

      const results = Array.from(resultMap.values());
      this.broadcast({ type: 'build-complete', results });
    } catch (err) {
      this.broadcast({
        type: 'build-error',
        error: err instanceof Error ? err.message : String(err),
      });
    } finally {
      this.building = false;
    }
  }
}

/**
 * Stop this EC2 instance. Reads instance ID from metadata.
 */
async function selfStop(): Promise<void> {
  try {
    // Get instance ID from EC2 metadata (IMDSv2)
    const tokenRes = await fetch('http://169.254.169.254/latest/api/token', {
      method: 'PUT',
      headers: { 'X-aws-ec2-metadata-token-ttl-seconds': '21600' },
    });
    const token = await tokenRes.text();

    const idRes = await fetch('http://169.254.169.254/latest/meta-data/instance-id', {
      headers: { 'X-aws-ec2-metadata-token': token },
    });
    const instanceId = await idRes.text();

    console.log(`[workspace-server] Stopping instance ${instanceId}...`);

    // Final S3 sync before shutdown
    fileChangeNotifier.stop();
    if (s3SyncScheduler) await s3SyncScheduler.shutdown();

    await eventLogger.emit('workspace.idle.shutdown', 'workspace', 'info',
      `Stopping instance ${instanceId} due to idle timeout`, { instanceId });

    const ec2 = new EC2Client({});
    await ec2.send(new StopInstancesCommand({
      InstanceIds: [instanceId],
    }));
  } catch (err) {
    console.error('[workspace-server] Failed to self-stop:', err);
    // Don't exit — instance will be stopped by the stop command or manually
  }
}

// ---------------------------------------------------------------------------
// S3 Initial Sync — download project files on first boot
// ---------------------------------------------------------------------------

async function initialSyncFromS3(projectPath: string): Promise<void> {
  if (!PROJECTS_BUCKET) {
    console.log('[sync] No S3 bucket configured — skipping sync');
    return;
  }

  // Check if project directory has files (skip sync if not empty)
  if (existsSync(projectPath)) {
    const entries = readdirSync(projectPath);
    if (entries.length > 0) {
      console.log(`[sync] Project directory has ${entries.length} entries — skipping S3 sync`);
      return;
    }
  }

  console.log('[sync] Empty project directory — syncing from S3...');
  const s3 = new S3Client({});
  const prefix = `projects/${PROJECT_ID}/files/`;
  let downloaded = 0;

  try {
    let continuationToken: string | undefined;
    do {
      const result = await s3.send(new ListObjectsV2Command({
        Bucket: PROJECTS_BUCKET,
        Prefix: prefix,
        ContinuationToken: continuationToken,
      }));

      for (const obj of result.Contents ?? []) {
        if (!obj.Key || obj.Key.endsWith('/')) continue;

        const relativePath = obj.Key.slice(prefix.length);
        const localPath = join(projectPath, relativePath);

        // Ensure directory exists
        await mkdir(dirname(localPath), { recursive: true });

        // Download file
        const getResult = await s3.send(new GetObjectCommand({
          Bucket: PROJECTS_BUCKET,
          Key: obj.Key,
        }));

        if (getResult.Body) {
          const stream = getResult.Body as Readable;
          const ws = createWriteStream(localPath);
          await pipeline(stream, ws);
          downloaded++;
        }
      }

      continuationToken = result.NextContinuationToken;
    } while (continuationToken);

    console.log(`[sync] Downloaded ${downloaded} files from S3`);
    eventLogger.info('workspace', `S3 sync complete: ${downloaded} files downloaded`, { downloaded });
  } catch (err) {
    console.error('[sync] S3 sync failed:', err);
    eventLogger.error('workspace', 'S3 initial sync failed', {
      error: err instanceof Error ? err.message : String(err),
    });
    // Continue — workspace can still function with an empty directory
  }
}

// ---------------------------------------------------------------------------
// Express App + Routes
// ---------------------------------------------------------------------------

const projectPath = join(WORKSPACE_ROOT, PROJECT_ID);
const s3Client = new S3Client({});

// Create workspace environment
const env = new LocalWorkspaceEnvironment({
  rootPath: projectPath,
  id: PROJECT_ID,
  label: PROJECT_ID,
});

// WorkspaceService is created lazily after SSM secrets are fetched.
// Until then, use the env var as initial key.
let workspace = new WorkspaceService({
  env,
  anthropicApiKey: ANTHROPIC_API_KEY,
});

// Broadcast a JSON message to all connected WebSocket clients
function broadcastToClients(msg: object): void {
  const data = JSON.stringify(msg);
  for (const client of wss.clients) {
    if (client.readyState === WebSocket.OPEN) {
      client.send(data);
    }
  }
}

// Build watcher — auto-triggers builds on file changes
const buildWatcherManager = new BuildWatcherManager(
  workspace,
  () => env.fileSystem,
  projectPath,
  broadcastToClients,
);

// S3 sync scheduler — periodic workspace → S3 backup
const s3SyncScheduler = PROJECTS_BUCKET
  ? new S3SyncScheduler({
      s3Client: new S3Client({}),
      bucket: PROJECTS_BUCKET,
      s3Prefix: `projects/${PROJECT_ID}/files/`,
      localPath: projectPath,
      excludePatterns: ['node_modules/', '.git/', '.antimatter-cache/', 'dist/', 'dist-lambda/'],
    })
  : null;

// File change notifier — broadcasts filesystem changes to connected IDE clients
const fileChangeNotifier = new FileChangeNotifier();

// Lazy-initialized deployment clients
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

// Strip path prefixes. CloudFront routes:
//   /workspace/{projectId}/api/files/* → this server
//   /ws/terminal/{projectId}           → WebSocket upgrade
// ALB forwards the full path, so we strip the prefix here.
app.use((req, _res, next) => {
  const workspacePrefix = `/workspace/${PROJECT_ID}`;
  if (req.url.startsWith(`${workspacePrefix}/`)) {
    req.url = req.url.slice(workspacePrefix.length);
  } else if (req.url === workspacePrefix) {
    req.url = '/';
  }
  // Also handle /{projectId}/ prefix (ALB health checks)
  if (req.url.startsWith(`/${PROJECT_ID}/`)) {
    req.url = req.url.slice(`/${PROJECT_ID}`.length);
  } else if (req.url === `/${PROJECT_ID}`) {
    req.url = '/';
  }
  next();
});

// Health check
app.get('/health', (_req, res) => {
  res.json({
    status: 'healthy',
    projectId: PROJECT_ID,
    uptime: process.uptime(),
  });
});

// Status
app.get('/status', (_req, res) => {
  res.json({
    projectId: PROJECT_ID,
    connections: connectionManager.count,
    uptime: process.uptime(),
    ptyRunning: ptyManager.isRunning,
  });
});

// ---- Auth middleware for API routes ----
// Cognito config is passed via user-data config.env.
// Health and status endpoints above remain unauthenticated (used by ALB health checks).
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

// Refresh — download latest workspace server from S3 and restart via systemd
app.post('/api/refresh', async (_req, res) => {
  try {
    if (!PROJECTS_BUCKET) {
      return res.status(500).json({ error: 'PROJECTS_BUCKET not configured' });
    }

    console.log('[workspace-server] Refresh requested — downloading latest bundle from S3...');

    const result = await env.execute({
      command: `aws s3 cp "s3://${PROJECTS_BUCKET}/workspace-server/workspace-server.js" /opt/antimatter/workspace-server.js`,
      cwd: '.',
      timeout: 30000,
    });

    if (result.exitCode !== 0) {
      console.error('[workspace-server] Refresh failed:', result.stderr);
      return res.status(500).json({ error: 'Failed to download update', details: result.stderr });
    }

    console.log('[workspace-server] Bundle updated. Exiting for systemd restart...');
    res.json({ success: true, message: 'Update downloaded. Restarting...' });

    // Give response time to flush, then exit — systemd Restart=always restarts us
    setTimeout(() => process.exit(0), 500);
  } catch (err) {
    console.error('[workspace-server] Refresh error:', err);
    res.status(500).json({ error: 'Refresh failed', message: String(err) });
  }
});

// Mount project-scoped API routes
app.use('/api/files', createFileRouter(workspace));
app.use('/api/build', createBuildRouter(workspace, {
  onConfigSaved: (rules) => {
    buildWatcherManager.restart(rules).catch((err) => {
      console.error('[workspace-server] Failed to restart build watcher:', err);
    });
  },
}));
app.use('/api/agent', createAgentRouter(workspace));
app.use('/api/deploy', (req, res, next) => {
  createDeployRouter(
    workspace,
    s3Client,
    {
      bucket: PROJECTS_BUCKET,
      prefix: `projects/${PROJECT_ID}/files/`,
      lambdaClient: getDeployLambdaClient(),
      cloudfrontClient: getDeployCloudfrontClient(),
    },
  )(req, res, next);
});
app.use('/api/environments', createEnvironmentRouter(workspace));
app.use('/api/activity', createActivityRouter(workspace));
app.use('/api/git', createGitRouter(workspace));
app.use('/api/events', createEventsRouter(s3Client, PROJECTS_BUCKET, PROJECT_ID));

// ---------------------------------------------------------------------------
// HTTP + WebSocket server
// ---------------------------------------------------------------------------

const ptyManager = new PtyManager();
const connectionManager = new ConnectionManager();

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
  if (requestedProjectId !== PROJECT_ID) {
    socket.write('HTTP/1.1 421 Misdirected Request\r\n\r\n');
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

  wss.handleUpgrade(req, socket, head, (ws) => {
    wss.emit('connection', ws, req);
  });
});

wss.on('connection', (ws: WebSocket) => {
  console.log('[workspace-server] WebSocket client connected');
  connectionManager.add(ws);

  // Send replay buffer
  const replay = ptyManager.getReplayBuffer();
  if (replay) {
    ws.send(JSON.stringify({ type: 'replay', data: replay }));
  }

  // Send status
  ws.send(JSON.stringify({ type: 'status', state: 'ready' }));

  // Forward PTY output to this client
  const unsubscribe = ptyManager.onData((data) => {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: 'output', data }));
    }
  });

  // Handle messages from client
  ws.on('message', (raw) => {
    try {
      const msg = JSON.parse(raw.toString());

      switch (msg.type) {
        case 'input':
          ptyManager.write(msg.data);
          break;
        case 'resize':
          if (typeof msg.cols === 'number' && typeof msg.rows === 'number') {
            ptyManager.resize(msg.cols, msg.rows);
          }
          break;
        case 'ping':
          ws.send(JSON.stringify({ type: 'pong' }));
          break;

        // --- Build commands ---
        case 'build-run':
          // Manual build trigger: { type: 'build-run', ruleIds?: string[] }
          buildWatcherManager.runBuild(msg.ruleIds).catch((err) => {
            console.error('[workspace-server] Manual build failed:', err);
          });
          break;
        case 'build-config-save':
          // Save config and restart watcher: { type: 'build-config-save', rules: BuildRule[] }
          if (Array.isArray(msg.rules)) {
            workspace.saveBuildConfig({ rules: msg.rules }).then(() => {
              buildWatcherManager.restart(msg.rules);
            }).catch((err) => {
              console.error('[workspace-server] Config save failed:', err);
            });
          }
          break;
        case 'build-hold':
          // Pause auto-build (for agent batch edits)
          buildWatcherManager.hold();
          break;
        case 'build-release':
          // Resume auto-build and flush accumulated changes
          buildWatcherManager.release();
          break;
      }
    } catch {
      // Ignore malformed messages
    }
  });

  ws.on('close', () => {
    console.log('[workspace-server] WebSocket client disconnected');
    unsubscribe();
    connectionManager.remove(ws);
  });

  ws.on('error', (err) => {
    console.error('[workspace-server] WebSocket error:', err);
    unsubscribe();
    connectionManager.remove(ws);
  });
});

// ---------------------------------------------------------------------------
// SSM Secrets
// ---------------------------------------------------------------------------

const ssmClient = new SSMClient({});

async function getSSMSecret(name: string): Promise<string> {
  try {
    const result = await ssmClient.send(
      new GetParameterCommand({
        Name: `/antimatter/secrets/${name}`,
        WithDecryption: true,
      }),
    );
    return result.Parameter?.Value ?? '';
  } catch {
    return '';
  }
}

// ---------------------------------------------------------------------------
// Git Auto-Init
// ---------------------------------------------------------------------------

async function initializeGit(): Promise<void> {
  console.log('[workspace-server] Initializing git repository...');

  try {
    // Fetch GitHub PAT from SSM (fall back to env var)
    const githubPat = (await getSSMSecret('github-pat')) || process.env.GITHUB_PAT || '';

    // Read project metadata from S3 for git config
    let gitConfig: { repository?: string; defaultBranch?: string; userName?: string; userEmail?: string } = {};
    if (PROJECTS_BUCKET) {
      try {
        const metaRes = await s3Client.send(
          new GetObjectCommand({
            Bucket: PROJECTS_BUCKET,
            Key: `projects/${PROJECT_ID}/meta.json`,
          }),
        );
        const body = await metaRes.Body?.transformToString('utf-8');
        if (body) {
          const meta = JSON.parse(body);
          gitConfig = meta.git ?? {};
        }
      } catch (err) {
        console.warn('[workspace-server] Could not read project meta for git config:', err);
      }
    }

    // git init (idempotent — no-op if .git already exists from EBS)
    await env.execute({ command: 'git init', cwd: '.', timeout: 5000 });

    // Set branch name
    const branch = gitConfig.defaultBranch || 'main';
    await env.execute({ command: `git checkout -B ${branch}`, cwd: '.', timeout: 5000 });

    // Set user identity
    if (gitConfig.userName) {
      await env.execute({ command: `git config user.name "${gitConfig.userName}"`, cwd: '.', timeout: 5000 });
    }
    if (gitConfig.userEmail) {
      await env.execute({ command: `git config user.email "${gitConfig.userEmail}"`, cwd: '.', timeout: 5000 });
    }

    // Set remote origin
    if (gitConfig.repository) {
      let remoteUrl = gitConfig.repository;
      // Inject PAT into HTTPS URL for auth
      if (githubPat && remoteUrl.startsWith('https://')) {
        remoteUrl = remoteUrl.replace('https://', `https://x-access-token:${githubPat}@`);
      }

      // Remove existing origin (may not exist — ignore error)
      await env.execute({ command: 'git remote remove origin', cwd: '.', timeout: 5000 }).catch(() => {});
      await env.execute({ command: `git remote add origin ${remoteUrl}`, cwd: '.', timeout: 5000 });
    }

    // Initial commit if no commits exist
    const logResult = await env.execute({ command: 'git log --oneline -1', cwd: '.', timeout: 5000 });
    if (logResult.exitCode !== 0) {
      await env.execute({ command: 'git add -A', cwd: '.', timeout: 30000 });
      await env.execute({ command: 'git commit -m "Initial import" --allow-empty', cwd: '.', timeout: 10000 });
    }

    console.log('[workspace-server] Git repository initialized');
  } catch (err) {
    // Git failure should not prevent workspace from starting
    console.warn('[workspace-server] Git initialization failed (non-fatal):', err);
  }
}

// ---------------------------------------------------------------------------
// Startup
// ---------------------------------------------------------------------------

async function startup() {
  // Ensure project directory exists
  if (!existsSync(projectPath)) {
    mkdirSync(projectPath, { recursive: true });
  }

  // Initial sync from S3 (only if project directory is empty)
  console.log('[workspace-server] Checking for initial S3 sync...');
  await initialSyncFromS3(projectPath);

  // Fetch Anthropic API key from SSM (fall back to env var)
  const ssmAnthropicKey = await getSSMSecret('anthropic-api-key');
  if (ssmAnthropicKey) {
    console.log('[workspace-server] Using Anthropic API key from SSM');
    workspace = new WorkspaceService({ env, anthropicApiKey: ssmAnthropicKey });
  }

  // Initialize git repository with project config from S3
  await initializeGit();

  // Start PTY
  ptyManager.start(projectPath);

  // Start build watcher (loads config and watches for file changes)
  await buildWatcherManager.start();

  // Start file change notifier — broadcasts to IDE clients
  fileChangeNotifier.start(
    env.fileSystem,
    broadcastToClients,
    () => s3SyncScheduler?.sync(), // Trigger immediate S3 sync on bulk changes
  );

  // Start S3 sync scheduler (every 30s)
  s3SyncScheduler?.start(30_000);

  // Start HTTP server
  server.listen(PORT, async () => {
    console.log(`[workspace-server] Listening on port ${PORT}`);
    console.log(`[workspace-server] Project: ${PROJECT_ID}`);
    console.log(`[workspace-server] Project path: ${projectPath}`);

    // Signal that workspace is ready for connections
    await eventLogger.emit('workspace.ready', 'workspace', 'info',
      'Workspace server ready', { port: PORT, uptime: process.uptime() });
  });
}

// Graceful shutdown — sync files and flush events before exit
process.on('SIGTERM', async () => {
  console.log('[workspace-server] SIGTERM received — shutting down');
  eventLogger.info('workspace', 'SIGTERM received — shutting down');
  fileChangeNotifier.stop();
  if (s3SyncScheduler) await s3SyncScheduler.shutdown();
  await eventLogger.shutdown();
  process.exit(0);
});

startup().catch(async (err) => {
  console.error('[workspace-server] Fatal startup error:', err);
  await eventLogger.emit('workspace.error', 'workspace', 'error',
    'Fatal startup error', { error: err instanceof Error ? err.message : String(err) });
  process.exit(1);
});
