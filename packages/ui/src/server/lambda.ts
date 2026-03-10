import serverlessExpress from '@codegenie/serverless-express';
import express from 'express';
import { S3Client } from '@aws-sdk/client-s3';
import { SSMClient, GetParameterCommand } from '@aws-sdk/client-ssm';
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
import { createSecretsRouter } from './routes/secrets.js';
import { createAuthMiddleware } from './middleware/auth.js';
import { EventLogger } from './services/event-logger.js';
import { EventBridgeClient } from '@aws-sdk/client-eventbridge';
import { CloudFormationClient } from '@aws-sdk/client-cloudformation';
import type { WorkspaceEc2ServiceConfig } from './services/workspace-ec2-service.js';
import { EnvironmentRegistryService } from './services/environment-registry-service.js';
import { createInfraEnvironmentRouter } from './routes/infra-environments.js';

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
  res.header('Access-Control-Allow-Origin', 'https://ide.antimatter.solutions');
  res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept, Authorization');
  res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  if (req.method === 'OPTIONS') {
    res.sendStatus(200);
  } else {
    next();
  }
});

// AWS client singletons
const s3Client = new S3Client({});
const ssmClient = new SSMClient({});
const projectsBucket = process.env.PROJECTS_BUCKET ?? '';
const eventBridgeClient = new EventBridgeClient({});
const eventBusName = process.env.EVENT_BUS_NAME ?? 'antimatter';
const cfnClient = new CloudFormationClient({});

// Cached SSM secret fetch — persists across Lambda invocations (cold start only)
let cachedAnthropicKey: string | undefined;

async function getAnthropicKey(): Promise<string> {
  if (cachedAnthropicKey === undefined) {
    try {
      const result = await ssmClient.send(
        new GetParameterCommand({
          Name: '/antimatter/secrets/anthropic-api-key',
          WithDecryption: true,
        }),
      );
      cachedAnthropicKey = result.Parameter?.Value ?? '';
    } catch {
      // Fall back to env var for backward compatibility
      cachedAnthropicKey = process.env.ANTHROPIC_API_KEY ?? '';
    }
  }
  return cachedAnthropicKey;
}

/** Clear cached secrets — called when secrets are updated via the API */
export function clearSecretCache(name?: string): void {
  if (!name || name === 'anthropic-api-key') {
    cachedAnthropicKey = undefined;
  }
}

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

// ---- Public routes (no auth required) ----

// Health check
apiRouter.get('/health', (_req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Config endpoint — serves runtime URLs to the frontend
apiRouter.get('/config', (_req, res) => {
  res.json({
    wsBaseUrl: process.env.WORKSPACE_ALB_DNS
      ? `wss://${process.env.WORKSPACE_ALB_DNS}`
      : null,
  });
});

// Auth config — serves Cognito configuration to the frontend (before login)
apiRouter.get('/auth/config', (_req, res) => {
  res.json({
    userPoolId: process.env.COGNITO_USER_POOL_ID ?? '',
    clientId: process.env.COGNITO_CLIENT_ID ?? '',
    region: process.env.AWS_REGION ?? 'us-west-2',
    domain: process.env.COGNITO_DOMAIN ?? '',
    redirectUri: 'https://ide.antimatter.solutions/',
  });
});

// ---- Auth middleware — all routes below require a valid Cognito JWT ----

if (process.env.COGNITO_USER_POOL_ID && process.env.COGNITO_CLIENT_ID) {
  apiRouter.use(createAuthMiddleware({
    userPoolId: process.env.COGNITO_USER_POOL_ID,
    region: process.env.AWS_REGION ?? 'us-west-2',
    clientId: process.env.COGNITO_CLIENT_ID,
  }));
}

// ---- Protected routes ----

// Project CRUD routes
apiRouter.use('/projects', createProjectRouter(s3Client, projectsBucket));

// Test runner
apiRouter.use('/tests', createTestRouter());

// Deployed environment registry — system-level (not project-scoped)
const envRegistry = new EnvironmentRegistryService({
  s3Client, bucket: projectsBucket, cfnClient,
});
apiRouter.use('/infra-environments', createInfraEnvironmentRouter(envRegistry));

// Secrets management — SSM Parameter Store
apiRouter.use('/secrets', createSecretsRouter(ssmClient, clearSecretCache));

// Project-scoped file routes — S3 fallback for browsing files when no workspace is running.
// When a workspace EC2 instance is active, the frontend routes through /workspace/* instead.
apiRouter.use('/projects/:projectId/files', async (req, res, next) => {
  const env = new S3WorkspaceEnvironment({
    s3Client,
    bucket: projectsBucket,
    prefix: `projects/${req.params.projectId}/files/`,
  });
  const anthropicApiKey = await getAnthropicKey();
  const ws = new WorkspaceService({ env, anthropicApiKey });
  createFileRouter(ws)(req, res, next);
});

// Project-scoped build routes — config GET/PUT works via S3; execute routes will
// fail gracefully since S3WorkspaceEnvironment doesn't support command execution.
apiRouter.use('/projects/:projectId/build', async (req, res, next) => {
  const env = new S3WorkspaceEnvironment({
    s3Client,
    bucket: projectsBucket,
    prefix: `projects/${req.params.projectId}/files/`,
  });
  const anthropicApiKey = await getAnthropicKey();
  const ws = new WorkspaceService({ env, anthropicApiKey });
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
