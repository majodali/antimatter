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
import { createTestResultsRouter } from './routes/test-results.js';
import { createAuthMiddleware } from './middleware/auth.js';
import { EventLogger } from './services/event-logger.js';
import { EventBridgeClient } from '@aws-sdk/client-eventbridge';
import { CloudFormationClient } from '@aws-sdk/client-cloudformation';
import type { WorkspaceEc2ServiceConfig } from './services/workspace-ec2-service.js';
import { EnvironmentRegistryService } from './services/environment-registry-service.js';
import { createInfraEnvironmentRouter } from './routes/infra-environments.js';
import { createAdminRouter } from './routes/admin.js';
import { EC2Client } from '@aws-sdk/client-ec2';

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

// Workspace EC2 config — used by workspace routes and project delete cascade.
const workspaceConfig: WorkspaceEc2ServiceConfig | null = process.env.WORKSPACE_LAUNCH_TEMPLATE_ID
  ? {
      launchTemplateId: process.env.WORKSPACE_LAUNCH_TEMPLATE_ID,
      instanceProfileArn: process.env.WORKSPACE_INSTANCE_PROFILE_ARN ?? '',
      subnetIds: (process.env.WORKSPACE_SUBNET_IDS ?? '').split(',').filter(Boolean),
      securityGroupId: process.env.WORKSPACE_SG_ID ?? '',
      targetGroupArn: process.env.WORKSPACE_TARGET_GROUP_ARN ?? '',
      albDns: process.env.WORKSPACE_ALB_DNS ?? '',
      projectsBucket,
      sharedMode: process.env.WORKSPACE_SHARED_MODE === 'true',
      s3FilesFileSystemId: process.env.S3_FILES_FS_ID || undefined,
      sqsQueueUrl: process.env.SQS_QUEUE_URL || undefined,
      envId: process.env.WORKSPACE_ENV_ID || undefined,
    }
  : null;

// Project CRUD routes (workspaceConfig passed for cascade cleanup on delete)
apiRouter.use('/projects', createProjectRouter(s3Client, projectsBucket, workspaceConfig));

// Test runner
apiRouter.use('/tests', createTestRouter());
apiRouter.use('/test-results', createTestResultsRouter());

// Deployed environment registry — system-level (not project-scoped)
const envRegistry = new EnvironmentRegistryService({
  s3Client, bucket: projectsBucket, cfnClient,
});
apiRouter.use('/infra-environments', createInfraEnvironmentRouter(envRegistry));

// Secrets management — SSM Parameter Store
apiRouter.use('/secrets', createSecretsRouter(ssmClient, clearSecretCache));

// Admin (POE — stepmother) operations: host restart, instance lifecycle,
// project worker restart. Runs in Lambda so it can act from *outside* the
// workspace EC2 instance.
{
  const ec2Client = new EC2Client({});
  const adminEventLogger = createEventLogger('admin');
  apiRouter.use('/admin', createAdminRouter({
    ec2Client,
    ssmClient,
    eventLogger: adminEventLogger,
    albDns: process.env.WORKSPACE_ALB_DNS ?? '',
    projectsBucket,
  }));
}

// Project-scoped file routes — writes to S3 and, when the workspace is running,
// forwards mutations to the workspace server so file watchers and workflow rules trigger.
apiRouter.use('/projects/:projectId/files', async (req, res, next) => {
  try {
    const projectId = req.params.projectId;
    const env = new S3WorkspaceEnvironment({
      s3Client,
      bucket: projectsBucket,
      prefix: `projects/${projectId}/files/`,
    });
    const anthropicApiKey = await getAnthropicKey();
    const ws = new WorkspaceService({ env, anthropicApiKey });

    // Build a best-effort workspace forwarder when workspace is running.
    // getWorkspaceStatus() also ensures ALB target registration as a side effect.
    let workspaceForwarder: import('./routes/filesystem.js').WorkspaceForwarder | undefined;
    if (workspaceConfig) {
      const { WorkspaceEc2Service } = await import('./services/workspace-ec2-service.js');
      const svc = new WorkspaceEc2Service(workspaceConfig);
      const status = await svc.getWorkspaceStatus(projectId);
      if (status?.status === 'RUNNING' && workspaceConfig.albDns) {
        const albBase = `http://${workspaceConfig.albDns}/workspace/${encodeURIComponent(projectId)}/api/files`;
        const authHeader = req.headers.authorization;
        workspaceForwarder = async (route, method, body, query) => {
          const qs = query ? '?' + new URLSearchParams(query).toString() : '';
          const url = `${albBase}${route}${qs}`;
          const headers: Record<string, string> = {};
          if (authHeader) headers['Authorization'] = authHeader;
          if (body) headers['Content-Type'] = 'application/json';
          await fetch(url, {
            method,
            headers,
            body: body ? JSON.stringify(body) : undefined,
          });
        };
      }
    }

    createFileRouter(ws, { workspaceForwarder })(req, res, next);
  } catch (err) {
    next(err);
  }
});

// Project-scoped build routes — config GET/PUT works via S3; execute routes will
// fail gracefully since S3WorkspaceEnvironment doesn't support command execution.
apiRouter.use('/projects/:projectId/build', async (req, res, next) => {
  try {
    const env = new S3WorkspaceEnvironment({
      s3Client,
      bucket: projectsBucket,
      prefix: `projects/${req.params.projectId}/files/`,
    });
    const anthropicApiKey = await getAnthropicKey();
    const ws = new WorkspaceService({ env, anthropicApiKey });
    createBuildRouter(ws)(req, res, next);
  } catch (err) {
    next(err);
  }
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

// Workspace EC2 instance routes (project-scoped).
if (workspaceConfig) {
  apiRouter.use('/projects/:projectId/workspace', createWorkspaceRouter(workspaceConfig, createEventLogger));
}

app.use('/api', apiRouter);
app.use('/', apiRouter);

// ---- JSON catch-all for unmatched routes ----
// Express default 404 returns HTML. CloudFront's custom error pages intercept
// 404 responses and replace them with index.html (200), causing clients to
// receive HTML when they expect JSON. Use 400 (not 404) to avoid interception.
app.use((_req, res) => {
  res.status(400).json({ error: 'Not Found', message: 'The requested API endpoint does not exist' });
});

// ---- JSON error handler ----
// Catches unhandled errors from async middleware (e.g. S3WorkspaceEnvironment constructor,
// getAnthropicKey). Returns JSON instead of Express's default HTML error page.
app.use((err: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  console.error('[lambda] Unhandled error:', err.message);
  res.status(500).json({ error: 'Internal Server Error', message: err.message });
});

// Export Lambda handler
export const handler = serverlessExpress({ app });
