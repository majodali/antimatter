import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, writeFile, rm, readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { hashContent } from '@antimatter/filesystem';
import { EfsWorkspaceEnvironment } from '../efs-workspace-environment.js';

// ---------------------------------------------------------------------------
// Mock S3 client (same pattern as sync tests)
// ---------------------------------------------------------------------------

function createMockS3(files: Record<string, string> = {}) {
  const store = new Map(Object.entries(files));

  const client = {
    send: async (command: any) => {
      const name = command.constructor.name;

      if (name === 'ListObjectsV2Command') {
        const prefix = command.input.Prefix ?? '';
        const contents = [...store.keys()]
          .filter((k) => k.startsWith(prefix))
          .map((key) => {
            const content = store.get(key)!;
            return {
              Key: key,
              Size: Buffer.byteLength(content, 'utf-8'),
              ETag: `"${hashContent(content)}"`,
            };
          });
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

      throw new Error(`Unhandled S3 command: ${name}`);
    },
  } as any;

  return { client, store };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('EfsWorkspaceEnvironment', () => {
  let efsRoot: string;

  beforeEach(async () => {
    efsRoot = await mkdtemp(join(tmpdir(), 'efs-env-'));
  });

  afterEach(async () => {
    await rm(efsRoot, { recursive: true, force: true });
  });

  function createEnv(
    s3Files: Record<string, string> = {},
    projectId = 'test-proj',
  ) {
    const { client, store } = createMockS3(s3Files);
    const env = new EfsWorkspaceEnvironment({
      efsRootPath: efsRoot,
      projectId,
      s3Client: client,
      bucket: 'test-bucket',
      s3Prefix: `projects/${projectId}/files/`,
    });
    return { env, store };
  }

  // ---- Identity ----

  it('has correct id and label defaults', () => {
    const { env } = createEnv();
    expect(env.id).toBe('efs');
    expect(env.label).toBe('efs:test-proj');
  });

  it('supports custom id and label', () => {
    const { client } = createMockS3();
    const env = new EfsWorkspaceEnvironment({
      efsRootPath: efsRoot,
      projectId: 'p1',
      s3Client: client,
      bucket: 'b',
      s3Prefix: 'p/',
      id: 'custom-id',
      label: 'Custom Label',
    });
    expect(env.id).toBe('custom-id');
    expect(env.label).toBe('Custom Label');
  });

  // ---- Lifecycle: initialize ----

  it('initialize() creates project directory and syncs from S3', async () => {
    const { env } = createEnv({
      'projects/test-proj/files/hello.txt': 'Hello from S3',
      'projects/test-proj/files/src/main.ts': 'export default 42;',
    });

    await env.initialize();

    // Project directory should exist
    expect(existsSync(env.projectPath)).toBe(true);

    // Files should be synced
    const hello = await env.readFile('hello.txt');
    expect(hello).toBe('Hello from S3');

    const main = await env.readFile('src/main.ts');
    expect(main).toBe('export default 42;');
  });

  it('initialize() is idempotent', async () => {
    const { env } = createEnv({
      'projects/test-proj/files/a.txt': 'content',
    });

    await env.initialize();
    await env.initialize(); // Second call should not error

    expect(await env.readFile('a.txt')).toBe('content');
  });

  // ---- File operations ----

  it('file operations work after initialize', async () => {
    const { env } = createEnv({
      'projects/test-proj/files/existing.txt': 'original',
    });
    await env.initialize();

    // readFile
    expect(await env.readFile('existing.txt')).toBe('original');

    // writeFile + readFile
    await env.writeFile('new.txt', 'created locally');
    expect(await env.readFile('new.txt')).toBe('created locally');

    // exists
    expect(await env.exists('existing.txt')).toBe(true);
    expect(await env.exists('nope.txt')).toBe(false);

    // deleteFile
    await env.deleteFile('existing.txt');
    expect(await env.exists('existing.txt')).toBe(false);

    // mkdir + readDirectory
    await env.mkdir('sub');
    await env.writeFile('sub/child.txt', 'nested');
    const entries = await env.readDirectory('sub');
    expect(entries.some((e) => e.name === 'child.txt')).toBe(true);

    // stat
    const st = await env.stat('new.txt');
    expect(st.isFile).toBe(true);
  });

  // ---- Command execution ----

  it('execute() runs commands against the EFS project directory', async () => {
    const { env } = createEnv({
      'projects/test-proj/files/data.txt': 'secret-value',
    });
    await env.initialize();

    // The working directory should be the project path on EFS
    const result = await env.execute({
      command: 'node',
      args: ['-e', 'console.log(require("fs").readFileSync("data.txt","utf-8"))'],
    });

    expect(result.exitCode).toBe(0);
    expect(result.stdout.trim()).toBe('secret-value');
  });

  // ---- Lifecycle: dispose (sync back) ----

  it('dispose() syncs changed files back to S3', async () => {
    const { env, store } = createEnv({
      'projects/test-proj/files/original.txt': 'v1',
    });
    await env.initialize();

    // Modify a file locally
    await env.writeFile('original.txt', 'v2');
    // Create a new file
    await env.writeFile('added.txt', 'new file');

    await env.dispose();

    // Verify S3 has the changes
    expect(store.get('projects/test-proj/files/original.txt')).toBe('v2');
    expect(store.get('projects/test-proj/files/added.txt')).toBe('new file');
  });

  // ---- fileSystem property ----

  it('exposes fileSystem for backward compatibility', async () => {
    const { env } = createEnv({
      'projects/test-proj/files/f.txt': 'fs-compat',
    });
    await env.initialize();

    const fs = env.fileSystem;
    expect(fs).toBeDefined();
    const content = await fs.readTextFile('f.txt');
    expect(content).toBe('fs-compat');
  });

  // ---- Sync methods (public) ----

  it('syncFromS3() and syncToS3() are callable directly', async () => {
    const { env } = createEnv({
      'projects/test-proj/files/a.txt': 'content',
    });
    await env.initialize();

    const fromResult = await env.syncFromS3();
    expect(fromResult.downloaded).toBe(0); // Already synced

    const toResult = await env.syncToS3();
    expect(toResult.uploaded).toBe(0); // Nothing changed
  });
});
