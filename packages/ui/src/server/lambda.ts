import serverlessExpress from '@codegenie/serverless-express';
import express from 'express';
import { S3Client } from '@aws-sdk/client-s3';
import { S3WorkspaceEnvironment } from '@antimatter/workspace';
import { WorkspaceService } from './services/workspace-service.js';
import { createFileRouter } from './routes/filesystem.js';
import { createBuildRouter } from './routes/build.js';
import { createProjectRouter } from './routes/projects.js';
import { createTestRouter } from './routes/tests.js';
import { createWorkspaceRouter } from './routes/workspace.js';
import { createActivityRouter } from './routes/activity.js';
import { createGitRouter } from './routes/git.js';
import { createEventsRouter } from './routes/events.js';
import { EventLogger } from './services/event-logger.js';
import { EventBridgeClient } from '@aws-sdk/client-eventbridge';
import type { WorkspaceEc2ServiceConfig } from './services/workspace-ec2-service.js';

const app = express();

// Patch mock socket for Lambda compatibility.
// @codegenie/serverless-express creates a ServerlessRequest with a mock socket
// that lacks EventEmitter methods. Express's on-finished/finalhandler expects
// socket.on() to exist, causing "ee2.on is not a function" errors.
app.use((req, _res, next) => {
  if (req.socket && typeof req.socket.on !== 'function') {
    req.socket.on = Function.prototype as any;
    req.socket.removeListener = Function.prototype as any;
  }
  next();
});

// Middleware
app.use(express.json({ limit: '10mb' }));

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

// S3 client singleton + bucket name from environment
const s3Client = new S3Client({});
const projectsBucket = process.env.PROJECTS_BUCKET ?? '';
const eventBridgeClient = new EventBridgeClient({});
const eventBusName = process.env.EVENT_BUS_NAME ?? 'antimatter';

/** Create a project-scoped EventLogger for Lambda requests */
function createEventLogger(projectId: string): EventLogger {
  return new EventLogger({
    s3Client,
    bucket: projectsBucket,
    source: 'lambda',
    projectId,
    eventBridgeClient,
    eventBusName,
  });
}

// API Routes — serverless-express uses event.pathParameters.proxy which strips
// the API Gateway resource prefix (/api), so we mount at both /api/* (for when
// the full path is preserved) and /* (for when it's stripped).
const apiRouter = express.Router();

// Health check
apiRouter.get('/health', (_req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Config endpoint — serves runtime URLs to the frontend
apiRouter.get('/config', (_req, res) => {
  res.json({
    commandUrl: null, // Legacy — commands now run on EC2 workspace instances
    wsBaseUrl: process.env.WORKSPACE_ALB_DNS
      ? `wss://${process.env.WORKSPACE_ALB_DNS}`
      : null,
  });
});

// Project CRUD routes
apiRouter.use('/projects', createProjectRouter(s3Client, projectsBucket));

// Test runner
apiRouter.use('/tests', createTestRouter());

// Project-scoped file routes — S3 fallback for browsing files when no workspace is running.
// When a workspace EC2 instance is active, the frontend routes through /workspace/* instead.
apiRouter.use('/projects/:projectId/files', (req, res, next) => {
  const env = new S3WorkspaceEnvironment({
    s3Client,
    bucket: projectsBucket,
    prefix: `projects/${req.params.projectId}/files/`,
  });
  const ws = new WorkspaceService({ env, anthropicApiKey: process.env.ANTHROPIC_API_KEY });
  createFileRouter(ws)(req, res, next);
});

// Project-scoped build routes — config GET/PUT works via S3; execute routes will
// fail gracefully since S3WorkspaceEnvironment doesn't support command execution.
apiRouter.use('/projects/:projectId/build', (req, res, next) => {
  const env = new S3WorkspaceEnvironment({
    s3Client,
    bucket: projectsBucket,
    prefix: `projects/${req.params.projectId}/files/`,
  });
  const ws = new WorkspaceService({ env, anthropicApiKey: process.env.ANTHROPIC_API_KEY });
  createBuildRouter(ws)(req, res, next);
});

// Project-scoped activity log routes — persisted to S3.
apiRouter.use('/projects/:projectId/activity', (req, res, next) => {
  const env = new S3WorkspaceEnvironment({
    s3Client,
    bucket: projectsBucket,
    prefix: `projects/${req.params.projectId}/files/`,
  });
  const ws = new WorkspaceService({ env });
  createActivityRouter(ws)(req, res, next);
});

// Project-scoped git routes — only functional when workspace is running (EC2).
// On Lambda/S3, execute() throws and routes return 503 gracefully.
apiRouter.use('/projects/:projectId/git', (req, res, next) => {
  const env = new S3WorkspaceEnvironment({
    s3Client,
    bucket: projectsBucket,
    prefix: `projects/${req.params.projectId}/files/`,
  });
  const ws = new WorkspaceService({ env });
  createGitRouter(ws)(req, res, next);
});

// Project-scoped system events — reads JSONL event logs from S3.
apiRouter.use('/projects/:projectId/events', createEventsRouter(s3Client, projectsBucket));

// --- Workspace EC2 instance routes (project-scoped) ---
// Manages EC2 instance lifecycle for workspace sessions.
const workspaceConfig: WorkspaceEc2ServiceConfig | null = process.env.WORKSPACE_LAUNCH_TEMPLATE_ID
  ? {
      launchTemplateId: process.env.WORKSPACE_LAUNCH_TEMPLATE_ID,
      instanceProfileArn: process.env.WORKSPACE_INSTANCE_PROFILE_ARN ?? '',
      subnetIds: (process.env.WORKSPACE_SUBNET_IDS ?? '').split(',').filter(Boolean),
      securityGroupId: process.env.WORKSPACE_SG_ID ?? '',
      listenerArn: process.env.ALB_LISTENER_ARN ?? '',
      vpcId: process.env.VPC_ID ?? '',
      albDns: process.env.WORKSPACE_ALB_DNS ?? '',
      projectsBucket,
    }
  : null;

if (workspaceConfig) {
  apiRouter.use('/projects/:projectId/workspace', createWorkspaceRouter(workspaceConfig, createEventLogger));
}

app.use('/api', apiRouter);
app.use('/', apiRouter);

// Export Lambda handler
export const handler = serverlessExpress({ app });
