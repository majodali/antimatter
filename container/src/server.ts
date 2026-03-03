/**
 * Workspace Container — Main entry point.
 *
 * Runs inside a Fargate task, providing:
 * - Express HTTP server (health checks, sync triggers, non-interactive exec)
 * - WebSocket server (interactive PTY terminal)
 * - S3 sync engine (project files + dependency cache)
 * - Auto-shutdown on idle (no WebSocket connections for 10 minutes)
 */

import express from 'express';
import cors from 'cors';
import { createServer } from 'node:http';
import { WebSocketServer, WebSocket } from 'ws';
import { URL } from 'node:url';
import { PtyManager } from './pty-manager.js';
import { SyncManager } from './sync-manager.js';
import { ConnectionManager } from './connection-manager.js';

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

const PORT = parseInt(process.env.PORT || '8080', 10);
const PROJECT_ID = process.env.PROJECT_ID || '';
const PROJECTS_BUCKET = process.env.PROJECTS_BUCKET || '';
const SESSION_TOKEN = process.env.SESSION_TOKEN || '';
const WORKSPACE_ROOT = '/workspace';

if (!PROJECT_ID) {
  console.error('ERROR: PROJECT_ID environment variable is required');
  process.exit(1);
}

if (!PROJECTS_BUCKET) {
  console.error('ERROR: PROJECTS_BUCKET environment variable is required');
  process.exit(1);
}

console.log(`[workspace] Starting container for project: ${PROJECT_ID}`);
console.log(`[workspace] S3 bucket: ${PROJECTS_BUCKET}`);

// ---------------------------------------------------------------------------
// Services
// ---------------------------------------------------------------------------

const syncManager = new SyncManager({
  projectId: PROJECT_ID,
  bucket: PROJECTS_BUCKET,
  workspaceRoot: WORKSPACE_ROOT,
});

const ptyManager = new PtyManager();

const connectionManager = new ConnectionManager({
  idleTimeoutMs: 10 * 60 * 1000, // 10 minutes
  onShutdown: async () => {
    console.log('[workspace] Idle timeout — syncing back and shutting down');
    try {
      await syncManager.syncBack();
    } catch (err) {
      console.error('[workspace] Sync-back failed during shutdown:', err);
    }
    process.exit(0);
  },
});

// ---------------------------------------------------------------------------
// Express app
// ---------------------------------------------------------------------------

const app = express();
app.use(cors());
app.use(express.json());

// Strip /{projectId} prefix from HTTP paths.
// The ALB routes /{projectId}/* to this container via path-based listener rules.
// Express routes are defined as /health, /exec, etc. without the prefix.
app.use((req, _res, next) => {
  if (PROJECT_ID && req.url.startsWith(`/${PROJECT_ID}/`)) {
    req.url = req.url.slice(`/${PROJECT_ID}`.length);
  } else if (PROJECT_ID && req.url === `/${PROJECT_ID}`) {
    req.url = '/';
  }
  next();
});

app.get('/health', (_req, res) => {
  res.json({ status: 'healthy', projectId: PROJECT_ID, uptime: process.uptime() });
});

app.get('/status', (_req, res) => {
  res.json({
    projectId: PROJECT_ID,
    connections: connectionManager.count,
    uptime: process.uptime(),
    syncState: syncManager.state,
    ptyRunning: ptyManager.isRunning,
  });
});

app.post('/sync', async (_req, res) => {
  try {
    const result = await syncManager.syncBack();
    res.json({ success: true, result });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error: msg });
  }
});

app.post('/sync-pull', async (_req, res) => {
  try {
    const result = await syncManager.syncFromS3();
    res.json({ success: true, result });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error: msg });
  }
});

app.post('/exec', async (req, res) => {
  const { command, timeout = 5 * 60 * 1000, syncBefore = true, syncAfter = true } = req.body;

  if (!command) {
    res.status(400).json({ error: 'command is required' });
    return;
  }

  try {
    if (syncBefore) {
      await syncManager.syncFromS3();
    }

    const { spawn } = await import('node:child_process');
    const projectPath = `${WORKSPACE_ROOT}/${PROJECT_ID}`;

    const result = await new Promise<{ exitCode: number; stdout: string; stderr: string; durationMs: number }>((resolve, reject) => {
      const start = Date.now();
      let stdout = '';
      let stderr = '';

      const proc = spawn('sh', ['-c', command], {
        cwd: projectPath,
        env: { ...process.env, HOME: WORKSPACE_ROOT },
        timeout,
      });

      proc.stdout.on('data', (chunk: Buffer) => { stdout += chunk.toString(); });
      proc.stderr.on('data', (chunk: Buffer) => { stderr += chunk.toString(); });
      proc.on('close', (code) => {
        resolve({ exitCode: code ?? 1, stdout, stderr, durationMs: Date.now() - start });
      });
      proc.on('error', reject);
    });

    if (syncAfter) {
      await syncManager.syncBack();
    }

    res.json(result);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error: msg });
  }
});

app.post('/cache-deps', async (_req, res) => {
  try {
    await syncManager.saveDependencyCache();
    res.json({ success: true });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error: msg });
  }
});

// ---------------------------------------------------------------------------
// HTTP + WebSocket server
// ---------------------------------------------------------------------------

const server = createServer(app);
const wss = new WebSocketServer({ noServer: true });

// Handle WebSocket upgrade
server.on('upgrade', (req, socket, head) => {
  const url = new URL(req.url || '/', `http://${req.headers.host}`);
  const pathParts = url.pathname.split('/').filter(Boolean);

  // Accept both /terminal/{projectId} and /ws/terminal/{projectId}
  // CloudFront forwards /ws/* paths without stripping the prefix.
  const terminalIdx = pathParts.indexOf('terminal');
  if (terminalIdx === -1) {
    socket.destroy();
    return;
  }

  const requestedProjectId = pathParts[terminalIdx + 1];
  if (requestedProjectId !== PROJECT_ID) {
    // Wrong container — reject so ALB retries another target
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
  console.log('[workspace] WebSocket client connected');
  connectionManager.add(ws);

  // Send replay buffer so new tabs see existing terminal output
  const replay = ptyManager.getReplayBuffer();
  if (replay) {
    ws.send(JSON.stringify({ type: 'replay', data: replay }));
  }

  // Send current status
  ws.send(JSON.stringify({ type: 'status', state: syncManager.state }));

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
      }
    } catch {
      // Ignore malformed messages
    }
  });

  ws.on('close', () => {
    console.log('[workspace] WebSocket client disconnected');
    unsubscribe();
    connectionManager.remove(ws);
  });

  ws.on('error', (err) => {
    console.error('[workspace] WebSocket error:', err);
    unsubscribe();
    connectionManager.remove(ws);
  });
});

// ---------------------------------------------------------------------------
// Startup
// ---------------------------------------------------------------------------

async function startup() {
  console.log('[workspace] Performing initial S3 sync...');
  try {
    await syncManager.initialSync();
    console.log('[workspace] Initial sync complete');
  } catch (err) {
    console.error('[workspace] Initial sync failed:', err);
    // Continue anyway — the container should be reachable for health checks
  }

  // Start PTY in the project directory
  const projectPath = `${WORKSPACE_ROOT}/${PROJECT_ID}`;
  ptyManager.start(projectPath);

  server.listen(PORT, () => {
    console.log(`[workspace] Server listening on port ${PORT}`);
    console.log(`[workspace] Project: ${PROJECT_ID}`);
  });
}

startup().catch((err) => {
  console.error('[workspace] Fatal startup error:', err);
  process.exit(1);
});
