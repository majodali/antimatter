import serverlessExpress from '@codegenie/serverless-express';
import express from 'express';
import { S3Client } from '@aws-sdk/client-s3';
import { LambdaClient, UpdateFunctionCodeCommand, GetFunctionConfigurationCommand } from '@aws-sdk/client-lambda';
import { CloudFrontClient, CreateInvalidationCommand } from '@aws-sdk/client-cloudfront';
import { S3WorkspaceEnvironment, CommandLambdaEnvironment, AwsLambdaInvoker } from '@antimatter/workspace';
import { WorkspaceService } from './services/workspace-service.js';
import { createFileRouter } from './routes/filesystem.js';
import { createBuildRouter } from './routes/build.js';
import { createAgentRouter } from './routes/agent.js';
import { createDeployRouter } from './routes/deploy.js';
import { createEnvironmentRouter } from './routes/environments.js';
import { createProjectRouter } from './routes/projects.js';
import { createTestRouter } from './routes/tests.js';
import type { DeployLambdaClient, DeployCloudfrontClient } from './services/deployment-executor.js';

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
const commandFunctionName = process.env.COMMAND_FUNCTION_NAME ?? '';

// Lambda invoker for Command Lambda (lazy-initialized, only when needed)
let lambdaInvoker: AwsLambdaInvoker | undefined;

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

// Helper: create a per-request WorkspaceService for a project.
// When COMMAND_FUNCTION_NAME is set (deployed with Command Lambda),
// uses CommandLambdaEnvironment so build/test/lint execution is routed
// to the Command Lambda (which has VPC + EFS). Otherwise falls back to
// S3WorkspaceEnvironment (file browsing only, no command execution).
function createProjectWorkspace(projectId: string): WorkspaceService {
  const env = commandFunctionName
    ? new CommandLambdaEnvironment({
        projectId,
        s3Client,
        bucket: projectsBucket,
        prefix: `projects/${projectId}/files/`,
        lambdaInvoker: (lambdaInvoker ??= new AwsLambdaInvoker()),
        functionName: commandFunctionName,
      })
    : new S3WorkspaceEnvironment({
        s3Client,
        bucket: projectsBucket,
        prefix: `projects/${projectId}/files/`,
      });
  return new WorkspaceService({
    env,
    anthropicApiKey: process.env.ANTHROPIC_API_KEY,
  });
}

// Project-scoped routes — create a per-request WorkspaceService backed by S3
apiRouter.use('/projects/:projectId/files', (req, res, next) => {
  createFileRouter(createProjectWorkspace(req.params.projectId))(req, res, next);
});

apiRouter.use('/projects/:projectId/build', (req, res, next) => {
  createBuildRouter(createProjectWorkspace(req.params.projectId))(req, res, next);
});

apiRouter.use('/projects/:projectId/agent', (req, res, next) => {
  createAgentRouter(createProjectWorkspace(req.params.projectId))(req, res, next);
});

// --- Deployment route (project-scoped) ---
// Lazy-initialized AWS SDK clients for deployment operations
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

apiRouter.use('/projects/:projectId/deploy', (req, res, next) => {
  const projectId = req.params.projectId;
  createDeployRouter(
    createProjectWorkspace(projectId),
    s3Client,
    {
      bucket: projectsBucket,
      prefix: `projects/${projectId}/files/`,
      lambdaClient: getDeployLambdaClient(),
      cloudfrontClient: getDeployCloudfrontClient(),
    },
  )(req, res, next);
});

// --- Environment routes (project-scoped) ---
apiRouter.use('/projects/:projectId/environments', (req, res, next) => {
  createEnvironmentRouter(createProjectWorkspace(req.params.projectId))(req, res, next);
});

app.use('/api', apiRouter);
app.use('/', apiRouter);

// Export Lambda handler
export const handler = serverlessExpress({ app });
