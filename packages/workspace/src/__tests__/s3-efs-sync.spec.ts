import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, readFile, writeFile, mkdir, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { hashContent } from '@antimatter/filesystem';
import { syncFromS3, syncToS3, readManifest } from '../s3-efs-sync.js';

// ---------------------------------------------------------------------------
// Helpers: mock S3Client
// ---------------------------------------------------------------------------

/** In-memory S3 bucket for testing. Keys → content strings. */
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
            // Simulate ETag as MD5 — we just use a content hash for testing
            const etag = hashContent(content);
            return {
              Key: key,
              Size: Buffer.byteLength(content, 'utf-8'),
              ETag: `"${etag}"`,
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
          Body: {
            transformToString: async () => store.get(key)!,
          },
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
// Test suite
// ---------------------------------------------------------------------------

describe('S3-EFS Sync', () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'sync-test-'));
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  // ---- syncFromS3 ----

  describe('syncFromS3', () => {
    it('downloads all files on fresh sync (no manifest)', async () => {
      const { client } = createMockS3({
        'proj/files/src/main.ts': 'console.log("hello");',
        'proj/files/package.json': '{"name":"test"}',
      });

      const result = await syncFromS3({
        s3Client: client,
        bucket: 'test-bucket',
        s3Prefix: 'proj/files/',
        localPath: tempDir,
      });

      expect(result.downloaded).toBe(2);
      expect(result.errors).toEqual([]);

      const main = await readFile(join(tempDir, 'src', 'main.ts'), 'utf-8');
      expect(main).toBe('console.log("hello");');

      const pkg = await readFile(join(tempDir, 'package.json'), 'utf-8');
      expect(pkg).toBe('{"name":"test"}');

      const manifest = await readManifest(tempDir);
      expect(manifest).not.toBeNull();
      expect(Object.keys(manifest!.files)).toHaveLength(2);
      expect(manifest!.files['src/main.ts']).toBeDefined();
    });

    it('skips unchanged files on incremental sync', async () => {
      const { client } = createMockS3({
        'proj/files/a.txt': 'hello',
        'proj/files/b.txt': 'world',
      });

      // First sync — downloads both
      const r1 = await syncFromS3({
        s3Client: client,
        bucket: 'b',
        s3Prefix: 'proj/files/',
        localPath: tempDir,
      });
      expect(r1.downloaded).toBe(2);

      // Second sync — no changes, should skip both
      const r2 = await syncFromS3({
        s3Client: client,
        bucket: 'b',
        s3Prefix: 'proj/files/',
        localPath: tempDir,
      });
      expect(r2.downloaded).toBe(0);
    });

    it('handles S3-side deletions', async () => {
      const { client, store } = createMockS3({
        'proj/files/a.txt': 'hello',
        'proj/files/b.txt': 'world',
      });

      // First sync
      await syncFromS3({
        s3Client: client,
        bucket: 'b',
        s3Prefix: 'proj/files/',
        localPath: tempDir,
      });

      // Delete b.txt from S3
      store.delete('proj/files/b.txt');

      // Second sync — should delete b.txt locally
      const result = await syncFromS3({
        s3Client: client,
        bucket: 'b',
        s3Prefix: 'proj/files/',
        localPath: tempDir,
      });

      expect(result.deleted).toBe(1);
      expect(existsSync(join(tempDir, 'b.txt'))).toBe(false);
      expect(existsSync(join(tempDir, 'a.txt'))).toBe(true);
    });

    it('handles empty project', async () => {
      const { client } = createMockS3({});

      const result = await syncFromS3({
        s3Client: client,
        bucket: 'b',
        s3Prefix: 'proj/files/',
        localPath: tempDir,
      });

      expect(result.downloaded).toBe(0);
      expect(result.deleted).toBe(0);
      const manifest = await readManifest(tempDir);
      expect(manifest).not.toBeNull();
      expect(Object.keys(manifest!.files)).toHaveLength(0);
    });

    it('creates nested subdirectories', async () => {
      const { client } = createMockS3({
        'p/f/src/components/ui/Button.tsx': '<button/>',
      });

      const result = await syncFromS3({
        s3Client: client,
        bucket: 'b',
        s3Prefix: 'p/f/',
        localPath: tempDir,
      });

      expect(result.downloaded).toBe(1);
      const content = await readFile(
        join(tempDir, 'src', 'components', 'ui', 'Button.tsx'),
        'utf-8',
      );
      expect(content).toBe('<button/>');
    });

    it('downloads changed files', async () => {
      const { client, store } = createMockS3({
        'proj/files/a.txt': 'v1',
      });

      // First sync
      await syncFromS3({
        s3Client: client,
        bucket: 'b',
        s3Prefix: 'proj/files/',
        localPath: tempDir,
      });
      expect(await readFile(join(tempDir, 'a.txt'), 'utf-8')).toBe('v1');

      // Modify on S3
      store.set('proj/files/a.txt', 'v2');

      // Second sync — should detect change and re-download
      const result = await syncFromS3({
        s3Client: client,
        bucket: 'b',
        s3Prefix: 'proj/files/',
        localPath: tempDir,
      });
      expect(result.downloaded).toBe(1);
      expect(await readFile(join(tempDir, 'a.txt'), 'utf-8')).toBe('v2');
    });
  });

  // ---- syncToS3 ----

  describe('syncToS3', () => {
    it('uploads new local files', async () => {
      const { client, store } = createMockS3({});

      // Create local files
      await writeFile(join(tempDir, 'hello.txt'), 'hello world');

      const result = await syncToS3({
        s3Client: client,
        bucket: 'b',
        s3Prefix: 'proj/files/',
        localPath: tempDir,
      });

      expect(result.uploaded).toBe(1);
      expect(store.get('proj/files/hello.txt')).toBe('hello world');
    });

    it('uploads changed files', async () => {
      const { client, store } = createMockS3({
        'proj/files/a.txt': 'original',
      });

      // Initial sync from S3 (creates manifest)
      await syncFromS3({
        s3Client: client,
        bucket: 'b',
        s3Prefix: 'proj/files/',
        localPath: tempDir,
      });

      // Modify locally
      await writeFile(join(tempDir, 'a.txt'), 'modified');

      // Sync back
      const result = await syncToS3({
        s3Client: client,
        bucket: 'b',
        s3Prefix: 'proj/files/',
        localPath: tempDir,
      });

      expect(result.uploaded).toBe(1);
      expect(store.get('proj/files/a.txt')).toBe('modified');
    });

    it('deletes S3 files for locally-removed files', async () => {
      const { client, store } = createMockS3({
        'proj/files/a.txt': 'keep',
        'proj/files/b.txt': 'remove',
      });

      // Sync from S3
      await syncFromS3({
        s3Client: client,
        bucket: 'b',
        s3Prefix: 'proj/files/',
        localPath: tempDir,
      });

      // Delete b.txt locally
      const { unlink } = await import('node:fs/promises');
      await unlink(join(tempDir, 'b.txt'));

      // Sync back
      const result = await syncToS3({
        s3Client: client,
        bucket: 'b',
        s3Prefix: 'proj/files/',
        localPath: tempDir,
      });

      expect(result.deleted).toBe(1);
      expect(store.has('proj/files/b.txt')).toBe(false);
      expect(store.has('proj/files/a.txt')).toBe(true);
    });

    it('skips excluded patterns', async () => {
      const { client, store } = createMockS3({});

      // Create local files including node_modules
      await mkdir(join(tempDir, 'node_modules', 'pkg'), { recursive: true });
      await writeFile(join(tempDir, 'node_modules', 'pkg', 'index.js'), 'module');
      await writeFile(join(tempDir, 'src.ts'), 'code');

      const result = await syncToS3({
        s3Client: client,
        bucket: 'b',
        s3Prefix: 'proj/files/',
        localPath: tempDir,
      });

      expect(result.uploaded).toBe(1); // Only src.ts
      expect(store.has('proj/files/src.ts')).toBe(true);
      expect(store.has('proj/files/node_modules/pkg/index.js')).toBe(false);
    });

    it('skips unchanged files', async () => {
      const { client } = createMockS3({
        'proj/files/a.txt': 'hello',
      });

      // Sync from S3
      await syncFromS3({
        s3Client: client,
        bucket: 'b',
        s3Prefix: 'proj/files/',
        localPath: tempDir,
      });

      // Sync back without changes
      const result = await syncToS3({
        s3Client: client,
        bucket: 'b',
        s3Prefix: 'proj/files/',
        localPath: tempDir,
      });

      expect(result.uploaded).toBe(0);
      expect(result.deleted).toBe(0);
    });
  });

  // ---- Manifest ----

  describe('manifest', () => {
    it('readManifest returns null when no manifest exists', async () => {
      const manifest = await readManifest(tempDir);
      expect(manifest).toBeNull();
    });

    it('manifest is excluded from sync-back', async () => {
      const { client, store } = createMockS3({
        'proj/files/a.txt': 'hello',
      });

      // Sync from S3 (creates manifest)
      await syncFromS3({
        s3Client: client,
        bucket: 'b',
        s3Prefix: 'proj/files/',
        localPath: tempDir,
      });

      // Sync back — manifest should not be uploaded
      await syncToS3({
        s3Client: client,
        bucket: 'b',
        s3Prefix: 'proj/files/',
        localPath: tempDir,
      });

      expect(store.has('proj/files/.antimatter-sync.json')).toBe(false);
    });
  });
});
