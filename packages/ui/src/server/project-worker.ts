/**
 * Project Worker — child process entry point for a single project.
 *
 * Spawned by the Router (parent) via child_process.fork(). Runs a full
 * ProjectContext with its own Express server on a UNIX socket. All HTTP
 * traffic is proxied from the Router; WebSocket messages are relayed via IPC.
 *
 * Lifecycle:
 *  1. Router forks this process
 *  2. Worker waits for 'initialize' IPC message with SerializableConfig
 *  3. Creates AWS SDK clients locally, builds SharedConfig
 *  4. Creates and initializes ProjectContext
 *  5. Starts Express on a UNIX socket
 *  6. Sends 'ready' IPC message back to Router
 *  7. Handles ws-connect/ws-message/ws-disconnect via IPC relay
 *  8. On 'shutdown' message, gracefully stops and exits
 */

import express from 'express';
import { createServer } from 'node:http';
import { existsSync, unlinkSync } from 'node:fs';
import { S3Client } from '@aws-sdk/client-s3';
import { SSMClient } from '@aws-sdk/client-ssm';
import { EventBridgeClient } from '@aws-sdk/client-eventbridge';
import {
  LambdaClient,
  UpdateFunctionCodeCommand,
  GetFunctionConfigurationCommand,
} from '@aws-sdk/client-lambda';
import {
  CloudFrontClient,
  CreateInvalidationCommand,
} from '@aws-sdk/client-cloudfront';
import { EventLogger } from './services/event-logger.js';
import { ProjectContext } from './project-context.js';
import type { SharedConfig } from './project-context.js';
import type { DeployLambdaClient, DeployCloudfrontClient } from './services/deployment-executor.js';
import type { ParentMessage, ChildMessage, SerializableConfig } from './ipc-types.js';

// ---------------------------------------------------------------------------
// IPC helpers
// ---------------------------------------------------------------------------

function sendToParent(msg: ChildMessage): void {
  if (process.send) {
    process.send(msg);
  }
}

function log(level: 'info' | 'warn' | 'error', message: string): void {
  sendToParent({ type: 'log', level, message });
  if (level === 'error') console.error(`[worker] ${message}`);
  else console.log(`[worker] ${message}`);
}

// ---------------------------------------------------------------------------
// SharedConfig factory — creates AWS SDK clients locally in the worker
// ---------------------------------------------------------------------------

function createSharedConfig(config: SerializableConfig): SharedConfig {
  const region = config.awsRegion || 'us-west-2';
  const s3Client = new S3Client({ region });
  const ssmClient = new SSMClient({ region });
  const eventBridgeClient = new EventBridgeClient({ region });

  let deployLambdaClient: DeployLambdaClient | null = null;
  let deployCloudfrontClient: DeployCloudfrontClient | null = null;

  return {
    workspaceRoot: config.workspaceRoot,
    projectsBucket: config.projectsBucket,
    websiteBucket: config.websiteBucket || '',
    anthropicApiKey: config.anthropicApiKey || '',
    s3Client,
    ssmClient,
    eventBridgeClient,
    eventBusName: config.eventBusName || 'antimatter',
    getDeployLambdaClient: () => {
      if (!deployLambdaClient) {
        const lambdaClient = new LambdaClient({ region });
        deployLambdaClient = {
          updateFunctionCode: (params: any) => lambdaClient.send(new UpdateFunctionCodeCommand(params)),
          getFunctionConfiguration: (params: any) => lambdaClient.send(new GetFunctionConfigurationCommand(params)),
        };
      }
      return deployLambdaClient;
    },
    getDeployCloudfrontClient: () => {
      if (!deployCloudfrontClient) {
        const cfClient = new CloudFrontClient({ region });
        deployCloudfrontClient = {
          createInvalidation: (params: any) => cfClient.send(new CreateInvalidationCommand(params)),
        };
      }
      return deployCloudfrontClient;
    },
    onExecStart: () => sendToParent({ type: 'exec-hold' }),
    onExecEnd: () => sendToParent({ type: 'exec-release' }),
  };
}

// ---------------------------------------------------------------------------
// Worker state
// ---------------------------------------------------------------------------

let projectContext: ProjectContext | null = null;
let httpServer: ReturnType<typeof createServer> | null = null;

// ---------------------------------------------------------------------------
// Initialize — called on 'initialize' IPC message
// ---------------------------------------------------------------------------

async function initialize(config: SerializableConfig): Promise<void> {
  const projectId = config.projectId;
  const socketPath = `/tmp/am-${projectId}.sock`;

  log('info', `Initializing project: ${projectId}`);

  // Clean up stale socket file from previous run
  if (existsSync(socketPath)) {
    try { unlinkSync(socketPath); } catch { /* ignore */ }
  }

  // Create SharedConfig with local AWS clients
  const sharedConfig = createSharedConfig(config);

  // Create ProjectContext with IPC broadcast function
  projectContext = new ProjectContext(projectId, {
    ...sharedConfig,
    broadcastFn: (msg: object) => {
      sendToParent({ type: 'ws-broadcast', data: JSON.stringify(msg) });
    },
  });

  // Initialize the project (S3 sync, git, workflow engine, etc.)
  await projectContext.initialize();

  // Create Express app with the project's router
  const app = express();
  app.use(express.json({ limit: '10mb' }));
  app.get('/health', (_req, res) => res.json({ status: 'healthy', project: projectId }));
  app.use('/', projectContext.router);

  // Start HTTP server on UNIX socket
  httpServer = createServer(app);
  await new Promise<void>((resolve, reject) => {
    httpServer!.listen(socketPath, () => {
      log('info', `Listening on ${socketPath}`);
      resolve();
    });
    httpServer!.on('error', reject);
  });

  // Notify Router that we're ready
  sendToParent({ type: 'ready', socketPath });
}

// ---------------------------------------------------------------------------
// WebSocket relay — virtual connections tracked by connectionId
// ---------------------------------------------------------------------------

function handleWsConnect(connectionId: string): void {
  if (!projectContext) return;
  const initialMessages = projectContext.handleClientConnect(connectionId);
  // Send initial messages back to the specific client
  for (const msg of initialMessages) {
    sendToParent({ type: 'ws-send', connectionId, data: JSON.stringify(msg) });
  }
  sendToParent({ type: 'connection-change', delta: 1 });
}

function handleWsMessage(connectionId: string, data: string): void {
  if (!projectContext) return;
  projectContext.handleClientMessage(connectionId, data);
}

function handleWsDisconnect(connectionId: string): void {
  if (!projectContext) return;
  projectContext.handleClientDisconnect(connectionId);
  sendToParent({ type: 'connection-change', delta: -1 });
}

function handleIngressEvent(event: Record<string, unknown>): void {
  if (!projectContext?.workflowManager) return;
  projectContext.workflowManager.emitEvent(event as any).catch((err: unknown) => {
    log('error', `Error processing ingress event ${event.type}: ${err instanceof Error ? err.message : String(err)}`);
  });
}

// ---------------------------------------------------------------------------
// Graceful shutdown
// ---------------------------------------------------------------------------

async function shutdown(): Promise<void> {
  log('info', 'Shutting down...');
  if (projectContext) {
    await projectContext.shutdown();
  }
  if (httpServer) {
    httpServer.close();
  }
  process.exit(0);
}

// ---------------------------------------------------------------------------
// IPC message handler
// ---------------------------------------------------------------------------

// Heartbeat — track last parent contact. If no ping/message for HEARTBEAT_TIMEOUT,
// exit. Router will respawn.
let lastParentContact = Date.now();
const HEARTBEAT_TIMEOUT_MS = 2 * 60 * 1000; // 120s

setInterval(() => {
  if (Date.now() - lastParentContact > HEARTBEAT_TIMEOUT_MS) {
    log('error', `No parent contact in ${HEARTBEAT_TIMEOUT_MS / 1000}s — exiting for respawn`);
    process.exit(2);
  }
}, 30_000);

process.on('message', async (msg: ParentMessage) => {
  lastParentContact = Date.now();
  try {
    switch (msg.type) {
      case 'initialize':
        await initialize(msg.config);
        break;
      case 'ws-connect':
        handleWsConnect(msg.connectionId);
        break;
      case 'ws-message':
        handleWsMessage(msg.connectionId, msg.data);
        break;
      case 'ws-disconnect':
        handleWsDisconnect(msg.connectionId);
        break;
      case 'ingress-event':
        handleIngressEvent(msg.event);
        break;
      case 'heartbeat-ping':
        sendToParent({ type: 'heartbeat-pong' });
        break;
      case 'shutdown':
        await shutdown();
        break;
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    log('error', `Error handling ${msg.type}: ${message}`);
    sendToParent({ type: 'error', message, fatal: msg.type === 'initialize' });
  }
});

// Handle uncaught errors — report to parent, don't crash silently
process.on('uncaughtException', (err) => {
  log('error', `Uncaught exception: ${err.message}`);
  sendToParent({ type: 'error', message: err.message, fatal: true });
  process.exit(1);
});

process.on('unhandledRejection', (reason) => {
  const message = reason instanceof Error ? reason.message : String(reason);
  log('error', `Unhandled rejection: ${message}`);
  sendToParent({ type: 'error', message });
});

log('info', 'Worker process started, waiting for initialize message...');
