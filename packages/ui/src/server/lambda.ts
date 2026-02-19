import serverlessExpress from '@codegenie/serverless-express';
import express from 'express';
import { S3Client } from '@aws-sdk/client-s3';
import { S3FileSystem } from '@antimatter/filesystem';
import { WorkspaceService } from './services/workspace-service.js';
import { createFileRouter } from './routes/filesystem.js';
import { createBuildRouter } from './routes/build.js';
import { createAgentRouter } from './routes/agent.js';
import { createProjectRouter } from './routes/projects.js';
import { createTestRouter } from './routes/tests.js';

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

// Legacy shared workspace service (for non-project-scoped routes)
const workspace = new WorkspaceService({
  workspaceRoot: '/tmp',
  anthropicApiKey: process.env.ANTHROPIC_API_KEY,
});

// API Routes — serverless-express uses event.pathParameters.proxy which strips
// the API Gateway resource prefix (/api), so we mount at both /api/* (for when
// the full path is preserved) and /* (for when it's stripped).
const apiRouter = express.Router();

// Legacy (non-project-scoped) routes
apiRouter.use('/files', createFileRouter(workspace));
apiRouter.use('/build', createBuildRouter(workspace));
apiRouter.use('/agent', createAgentRouter(workspace));
apiRouter.get('/health', (_req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Project CRUD routes
apiRouter.use('/projects', createProjectRouter(s3Client, projectsBucket));

// Test runner
apiRouter.use('/tests', createTestRouter());

// Project-scoped routes — create a per-request WorkspaceService backed by S3
apiRouter.use('/projects/:projectId/files', (req, res, next) => {
  const fs = new S3FileSystem({
    s3Client,
    bucket: projectsBucket,
    prefix: `projects/${req.params.projectId}/files/`,
  });
  const ws = new WorkspaceService({
    fs,
    anthropicApiKey: process.env.ANTHROPIC_API_KEY,
  });
  createFileRouter(ws)(req, res, next);
});

apiRouter.use('/projects/:projectId/build', (req, res, next) => {
  const fs = new S3FileSystem({
    s3Client,
    bucket: projectsBucket,
    prefix: `projects/${req.params.projectId}/files/`,
  });
  const ws = new WorkspaceService({
    fs,
    anthropicApiKey: process.env.ANTHROPIC_API_KEY,
  });
  createBuildRouter(ws)(req, res, next);
});

apiRouter.use('/projects/:projectId/agent', (req, res, next) => {
  const fs = new S3FileSystem({
    s3Client,
    bucket: projectsBucket,
    prefix: `projects/${req.params.projectId}/files/`,
  });
  const ws = new WorkspaceService({
    fs,
    anthropicApiKey: process.env.ANTHROPIC_API_KEY,
  });
  createAgentRouter(ws)(req, res, next);
});

app.use('/api', apiRouter);
app.use('/', apiRouter);

// Export Lambda handler
export const handler = serverlessExpress({ app });
