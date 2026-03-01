import serverlessExpress from '@codegenie/serverless-express';
import express from 'express';
import { spawn } from 'node:child_process';
import {
  writeFileSync,
  readFileSync,
  unlinkSync,
  existsSync,
  mkdirSync,
} from 'node:fs';
import { join } from 'node:path';
import { S3Client } from '@aws-sdk/client-s3';
import { EfsWorkspaceEnvironment } from '@antimatter/workspace';

const EFS_MOUNT_PATH = process.env.EFS_MOUNT_PATH || '/mnt/projects';
const PROJECTS_BUCKET = process.env.PROJECTS_BUCKET || '';
const MAX_EXEC_TIMEOUT_MS = 60_000;

// Shared S3 client for sync operations
const s3Client = new S3Client({});

const app = express();

// Patch mock socket for Lambda compatibility (same as lambda.ts)
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
  res.header(
    'Access-Control-Allow-Headers',
    'Origin, X-Requested-With, Content-Type, Accept, Authorization',
  );
  res.header(
    'Access-Control-Allow-Methods',
    'GET, POST, PUT, DELETE, OPTIONS',
  );
  if (req.method === 'OPTIONS') {
    res.sendStatus(200);
  } else {
    next();
  }
});

const router = express.Router();

// ---- Health check ----

router.post('/health', async (_req, res) => {
  const result: Record<string, unknown> = {
    status: 'ok',
    timestamp: new Date().toISOString(),
    efs: {
      mounted: false,
      mountPath: EFS_MOUNT_PATH,
      writable: false,
    },
    node: {
      version: process.version,
    },
    environment: {
      region: process.env.AWS_REGION ?? 'unknown',
      functionName: process.env.AWS_LAMBDA_FUNCTION_NAME ?? 'unknown',
      memorySize: process.env.AWS_LAMBDA_FUNCTION_MEMORY_SIZE ?? 'unknown',
    },
  };

  try {
    // Check if EFS mount path exists
    const mounted = existsSync(EFS_MOUNT_PATH);
    (result.efs as Record<string, unknown>).mounted = mounted;

    if (mounted) {
      // Ensure projects dir exists, try writing a test file
      const testFile = join(EFS_MOUNT_PATH, `_health_${Date.now()}.tmp`);
      try {
        writeFileSync(testFile, 'health-check');
        const content = readFileSync(testFile, 'utf-8');
        unlinkSync(testFile);
        (result.efs as Record<string, unknown>).writable =
          content === 'health-check';
      } catch (err: any) {
        (result.efs as Record<string, unknown>).writable = false;
        (result.efs as Record<string, unknown>).error = err.message;
      }
    }
  } catch (err: any) {
    (result.efs as Record<string, unknown>).error = err.message;
  }

  res.json(result);
});

// ---- Command execution ----

router.post('/exec', async (req, res) => {
  const {
    command,
    args = [],
    cwd,
    timeout = 30_000,
  } = req.body as {
    command?: string;
    args?: string[];
    cwd?: string;
    timeout?: number;
  };

  if (!command) {
    res.status(400).json({ error: 'Missing required field: command' });
    return;
  }

  const effectiveTimeout = Math.min(timeout, MAX_EXEC_TIMEOUT_MS);

  // Resolve cwd relative to EFS mount
  const workDir = cwd ? join(EFS_MOUNT_PATH, cwd) : EFS_MOUNT_PATH;

  // Ensure working directory exists
  if (!existsSync(workDir)) {
    try {
      mkdirSync(workDir, { recursive: true });
    } catch {
      // Fall back to EFS_MOUNT_PATH
    }
  }

  const startTime = Date.now();

  try {
    const result = await executeCommand(
      command,
      args,
      workDir,
      effectiveTimeout,
    );
    res.json({
      ...result,
      durationMs: Date.now() - startTime,
    });
  } catch (err: any) {
    res.status(500).json({
      error: 'Command execution failed',
      message: err.message,
      durationMs: Date.now() - startTime,
    });
  }
});

function executeCommand(
  command: string,
  args: string[],
  cwd: string,
  timeout: number,
): Promise<{ exitCode: number; stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    // Don't use shell: true — callers who need shell features should
    // explicitly invoke sh -c. Using shell: true causes double-wrapping
    // when the command is already a shell invocation (e.g. sh -c '...').
    const child = spawn(command, args, {
      cwd,
      env: process.env,
    });

    let stdout = '';
    let stderr = '';
    let completed = false;
    let timeoutId: NodeJS.Timeout | undefined;

    if (timeout > 0) {
      timeoutId = setTimeout(() => {
        if (!completed) {
          completed = true;
          child.kill('SIGTERM');
          setTimeout(() => child.kill('SIGKILL'), 1000);
          reject(new Error(`Command timed out after ${timeout}ms`));
        }
      }, timeout);
    }

    child.stdout?.on('data', (data: Buffer) => {
      stdout += data.toString();
    });

    child.stderr?.on('data', (data: Buffer) => {
      stderr += data.toString();
    });

    child.on('close', (code) => {
      if (completed) return;
      completed = true;
      if (timeoutId) clearTimeout(timeoutId);
      resolve({ exitCode: code ?? 0, stdout, stderr });
    });

    child.on('error', (error: Error) => {
      if (completed) return;
      completed = true;
      if (timeoutId) clearTimeout(timeoutId);
      reject(error);
    });
  });
}

// ---- Project-scoped routes (S3 ↔ EFS sync + execution) ----

/** Create an EfsWorkspaceEnvironment for a project. */
function createEfsEnv(projectId: string): EfsWorkspaceEnvironment {
  return new EfsWorkspaceEnvironment({
    efsRootPath: EFS_MOUNT_PATH,
    projectId,
    s3Client,
    bucket: PROJECTS_BUCKET,
    s3Prefix: `projects/${projectId}/files/`,
  });
}

// Sync S3 → EFS
router.post('/projects/:projectId/sync', async (req, res) => {
  const { projectId } = req.params;
  const startTime = Date.now();

  try {
    const env = createEfsEnv(projectId);
    await env.initialize();

    const result = await env.syncFromS3();
    res.json({
      success: true,
      projectId,
      sync: result,
      durationMs: Date.now() - startTime,
    });
  } catch (err: any) {
    res.status(500).json({
      error: 'Sync failed',
      message: err.message,
      durationMs: Date.now() - startTime,
    });
  }
});

// Execute command with auto-sync
router.post('/projects/:projectId/exec', async (req, res) => {
  const { projectId } = req.params;
  const {
    command,
    args = [],
    cwd,
    timeout = 30_000,
    syncBefore = true,
    syncAfter = false,
  } = req.body as {
    command?: string;
    args?: string[];
    cwd?: string;
    timeout?: number;
    syncBefore?: boolean;
    syncAfter?: boolean;
  };

  if (!command) {
    res.status(400).json({ error: 'Missing required field: command' });
    return;
  }

  const startTime = Date.now();

  try {
    const env = createEfsEnv(projectId);

    if (syncBefore) {
      await env.initialize();
    }

    const effectiveTimeout = Math.min(timeout, MAX_EXEC_TIMEOUT_MS);
    const result = await env.execute({
      command,
      args,
      cwd,
      timeout: effectiveTimeout,
    });

    let syncBackResult;
    if (syncAfter) {
      syncBackResult = await env.syncToS3();
    }

    res.json({
      ...result,
      projectId,
      ...(syncBackResult ? { syncBack: syncBackResult } : {}),
      durationMs: Date.now() - startTime,
    });
  } catch (err: any) {
    res.status(500).json({
      error: 'Project command execution failed',
      message: err.message,
      durationMs: Date.now() - startTime,
    });
  }
});

// Sync EFS → S3
router.post('/projects/:projectId/sync-back', async (req, res) => {
  const { projectId } = req.params;
  const startTime = Date.now();

  try {
    const env = createEfsEnv(projectId);
    const result = await env.syncToS3();

    res.json({
      success: true,
      projectId,
      sync: result,
      durationMs: Date.now() - startTime,
    });
  } catch (err: any) {
    res.status(500).json({
      error: 'Sync-back failed',
      message: err.message,
      durationMs: Date.now() - startTime,
    });
  }
});

// Mount at all possible paths.
// Through CloudFront: /api/commands/health → API GW sees /api/commands/health
// Direct API GW:      /commands/health     → API GW sees /commands/health
// Path stripping:     /health              → serverless-express may strip prefix
app.use('/api/commands', router);
app.use('/commands', router);
app.use('/', router);

// ---- Direct Lambda invocation handler ----
// Supports Lambda-to-Lambda invocation without HTTP overhead.
// Detects direct invocations by the presence of an `action` field
// and the absence of API Gateway proxy event fields.

interface DirectInvocationEvent {
  action: 'exec' | 'sync' | 'sync-back';
  projectId: string;
  command?: string;
  args?: string[];
  cwd?: string;
  timeout?: number;
  syncBefore?: boolean;
  syncAfter?: boolean;
}

async function directHandler(event: DirectInvocationEvent) {
  const { action, projectId } = event;

  if (!projectId) {
    return { error: 'Missing required field: projectId' };
  }

  const startTime = Date.now();

  try {
    switch (action) {
      case 'exec': {
        const { command, args = [], cwd, timeout = 30_000, syncBefore = true, syncAfter = false } = event;
        if (!command) {
          return { error: 'Missing required field: command' };
        }

        const env = createEfsEnv(projectId);

        if (syncBefore) {
          await env.initialize();
        }

        const effectiveTimeout = Math.min(timeout, MAX_EXEC_TIMEOUT_MS);
        const result = await env.execute({ command, args, cwd, timeout: effectiveTimeout });

        let syncBackResult;
        if (syncAfter) {
          syncBackResult = await env.syncToS3();
        }

        return {
          ...result,
          projectId,
          ...(syncBackResult ? { syncBack: syncBackResult } : {}),
          durationMs: Date.now() - startTime,
        };
      }

      case 'sync': {
        const env = createEfsEnv(projectId);
        await env.initialize();
        const result = await env.syncFromS3();
        return {
          success: true,
          projectId,
          sync: result,
          durationMs: Date.now() - startTime,
        };
      }

      case 'sync-back': {
        const env = createEfsEnv(projectId);
        const result = await env.syncToS3();
        return {
          success: true,
          projectId,
          sync: result,
          durationMs: Date.now() - startTime,
        };
      }

      default:
        return { error: `Unknown action: ${action}` };
    }
  } catch (err: any) {
    return {
      error: `${action} failed`,
      message: err.message,
      durationMs: Date.now() - startTime,
    };
  }
}

// Export Lambda handler — supports both API Gateway proxy events and
// direct Lambda invocations. Direct invocations have an `action` field
// but no httpMethod or requestContext.
const serverlessExpressHandler = serverlessExpress({ app });

export async function handler(event: any, context: any) {
  if (event.action && !event.httpMethod && !event.requestContext) {
    return directHandler(event as DirectInvocationEvent);
  }
  return serverlessExpressHandler(event, context);
}
