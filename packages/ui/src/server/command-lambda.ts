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

const EFS_MOUNT_PATH = process.env.EFS_MOUNT_PATH || '/mnt/projects';
const MAX_EXEC_TIMEOUT_MS = 60_000;

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

// Mount at all possible paths.
// Through CloudFront: /api/commands/health → API GW sees /api/commands/health
// Direct API GW:      /commands/health     → API GW sees /commands/health
// Path stripping:     /health              → serverless-express may strip prefix
app.use('/api/commands', router);
app.use('/commands', router);
app.use('/', router);

// Export Lambda handler
export const handler = serverlessExpress({ app });
