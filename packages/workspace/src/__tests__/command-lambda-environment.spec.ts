import { describe, it, expect, beforeEach } from 'vitest';
import type { LambdaInvoker } from '../command-lambda-environment.js';
import { CommandLambdaEnvironment } from '../command-lambda-environment.js';

// ---------------------------------------------------------------------------
// Mock Lambda invoker
// ---------------------------------------------------------------------------

function createMockInvoker() {
  const calls: { functionName: string; payload: any }[] = [];
  let nextResponse: any = {};

  const invoker: LambdaInvoker = {
    invoke: async (functionName, payload) => {
      calls.push({ functionName, payload });
      return {
        statusCode: 200,
        functionError: undefined,
        payload: JSON.stringify(nextResponse),
      };
    },
  };

  return {
    invoker,
    calls,
    setResponse(response: any) {
      nextResponse = response;
    },
    setError(errorMessage: string) {
      // Simulate Lambda function error
      nextResponse = { errorMessage };
      (invoker as any)._functionError = errorMessage;
      invoker.invoke = async (functionName, payload) => {
        calls.push({ functionName, payload });
        return {
          statusCode: 200,
          functionError: 'Unhandled',
          payload: JSON.stringify({ errorMessage }),
        };
      };
    },
  };
}

// ---------------------------------------------------------------------------
// Mock S3 client (minimal — CommandLambdaEnvironment delegates file ops to S3)
// ---------------------------------------------------------------------------

function createMockS3() {
  const store = new Map<string, string>();

  return {
    send: async (command: any) => {
      const name = command.constructor.name;

      if (name === 'ListObjectsV2Command') {
        const prefix = command.input.Prefix ?? '';
        const contents = [...store.keys()]
          .filter((k) => k.startsWith(prefix))
          .map((key) => ({
            Key: key,
            Size: Buffer.byteLength(store.get(key)!, 'utf-8'),
          }));
        return { Contents: contents, IsTruncated: false };
      }

      if (name === 'GetObjectCommand') {
        const key = command.input.Key;
        if (!store.has(key)) {
          const err = new Error('NoSuchKey');
          (err as any).name = 'NoSuchKey';
          throw err;
        }
        return {
          Body: { transformToString: async () => store.get(key)! },
          ContentLength: Buffer.byteLength(store.get(key)!, 'utf-8'),
        };
      }

      if (name === 'PutObjectCommand') {
        store.set(command.input.Key, String(command.input.Body));
        return {};
      }

      if (name === 'DeleteObjectCommand') {
        store.delete(command.input.Key);
        return {};
      }

      if (name === 'HeadObjectCommand') {
        const key = command.input.Key;
        if (!store.has(key)) {
          const err = new Error('NotFound');
          (err as any).name = 'NotFound';
          throw err;
        }
        return {
          ContentLength: Buffer.byteLength(store.get(key)!, 'utf-8'),
        };
      }

      throw new Error(`Unhandled S3 command: ${name}`);
    },
    store,
  } as any;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('CommandLambdaEnvironment', () => {
  let mock: ReturnType<typeof createMockInvoker>;
  let s3: ReturnType<typeof createMockS3>;
  let env: CommandLambdaEnvironment;

  beforeEach(() => {
    mock = createMockInvoker();
    s3 = createMockS3();
    env = new CommandLambdaEnvironment({
      projectId: 'test-proj',
      s3Client: s3,
      bucket: 'test-bucket',
      prefix: 'projects/test-proj/files/',
      lambdaInvoker: mock.invoker,
      functionName: 'my-command-function',
    });
  });

  // ---- Identity ----

  it('has correct default id and label', () => {
    expect(env.id).toBe('command-lambda');
    expect(env.label).toBe('command-lambda:test-proj');
  });

  it('supports custom id and label', () => {
    const custom = new CommandLambdaEnvironment({
      projectId: 'p1',
      s3Client: s3,
      bucket: 'b',
      prefix: 'p/',
      lambdaInvoker: mock.invoker,
      functionName: 'fn',
      id: 'custom-id',
      label: 'Custom Label',
    });
    expect(custom.id).toBe('custom-id');
    expect(custom.label).toBe('Custom Label');
  });

  // ---- File operations (delegate to S3) ----

  it('readFile delegates to S3', async () => {
    s3.store.set('projects/test-proj/files/hello.txt', 'world');
    const content = await env.readFile('hello.txt');
    expect(content).toBe('world');
  });

  it('writeFile delegates to S3', async () => {
    await env.writeFile('new.txt', 'content');
    expect(s3.store.get('projects/test-proj/files/new.txt')).toBe('content');
  });

  it('exposes fileSystem', () => {
    expect(env.fileSystem).toBeDefined();
  });

  // ---- Command execution (via Lambda) ----

  it('execute() invokes Command Lambda with correct payload', async () => {
    mock.setResponse({
      exitCode: 0,
      stdout: 'hello\n',
      stderr: '',
      durationMs: 42,
      projectId: 'test-proj',
    });

    const result = await env.execute({ command: 'echo hello' });

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe('hello\n');
    expect(result.stderr).toBe('');
    expect(result.durationMs).toBe(42);

    // Verify the Lambda was called with the right payload
    expect(mock.calls).toHaveLength(1);
    expect(mock.calls[0].functionName).toBe('my-command-function');
    expect(mock.calls[0].payload).toEqual({
      action: 'exec',
      projectId: 'test-proj',
      command: 'echo hello',
      args: undefined,
      cwd: undefined,
      timeout: undefined,
      syncBefore: true,
      syncAfter: true,
    });
  });

  it('execute() passes args, cwd, and timeout', async () => {
    mock.setResponse({ exitCode: 0, stdout: '', stderr: '', durationMs: 10 });

    await env.execute({
      command: 'cat',
      args: ['file.txt'],
      cwd: 'subdir',
      timeout: 5000,
    });

    expect(mock.calls[0].payload.command).toBe('cat');
    expect(mock.calls[0].payload.args).toEqual(['file.txt']);
    expect(mock.calls[0].payload.cwd).toBe('subdir');
    expect(mock.calls[0].payload.timeout).toBe(5000);
  });

  it('execute() uses configured sync options', async () => {
    const noSyncEnv = new CommandLambdaEnvironment({
      projectId: 'p',
      s3Client: s3,
      bucket: 'b',
      prefix: 'p/',
      lambdaInvoker: mock.invoker,
      functionName: 'fn',
      syncBefore: false,
      syncAfter: false,
    });

    mock.setResponse({ exitCode: 0, stdout: '', stderr: '', durationMs: 0 });
    await noSyncEnv.execute({ command: 'ls' });

    expect(mock.calls[0].payload.syncBefore).toBe(false);
    expect(mock.calls[0].payload.syncAfter).toBe(false);
  });

  it('execute() throws on Lambda function error', async () => {
    mock.setError('Out of memory');

    await expect(env.execute({ command: 'big-command' }))
      .rejects.toThrow('Command Lambda error: Out of memory');
  });

  it('execute() throws on application-level error', async () => {
    mock.setResponse({ error: 'exec failed', message: 'Command not found' });

    await expect(env.execute({ command: 'nonexistent' }))
      .rejects.toThrow('Command Lambda: exec failed — Command not found');
  });

  it('execute() handles non-zero exit code without throwing', async () => {
    mock.setResponse({ exitCode: 1, stdout: '', stderr: 'error\n', durationMs: 5 });

    const result = await env.execute({ command: 'false' });
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toBe('error\n');
  });

  // ---- Lifecycle ----

  it('initialize() invokes sync action', async () => {
    mock.setResponse({ success: true, projectId: 'test-proj', sync: { downloaded: 3 }, durationMs: 100 });

    await env.initialize();

    expect(mock.calls).toHaveLength(1);
    expect(mock.calls[0].payload).toEqual({
      action: 'sync',
      projectId: 'test-proj',
    });
  });

  it('dispose() invokes sync-back action', async () => {
    mock.setResponse({ success: true, projectId: 'test-proj', sync: { uploaded: 1 }, durationMs: 50 });

    await env.dispose();

    expect(mock.calls).toHaveLength(1);
    expect(mock.calls[0].payload).toEqual({
      action: 'sync-back',
      projectId: 'test-proj',
    });
  });
});
