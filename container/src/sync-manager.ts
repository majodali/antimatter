/**
 * Sync Manager — handles S3 ↔ local file synchronization for the
 * workspace container. Reuses the sync engine pattern from
 * @antimatter/workspace but self-contained (no external package deps).
 */

import { readFile, writeFile, mkdir, readdir, unlink, stat } from 'node:fs/promises';
import { existsSync, createReadStream, createWriteStream } from 'node:fs';
import { join, dirname, relative } from 'node:path';
import { createHash } from 'node:crypto';
import { pipeline } from 'node:stream/promises';
import { createGzip, createGunzip } from 'node:zlib';
import { S3Client, ListObjectsV2Command, GetObjectCommand, PutObjectCommand, DeleteObjectCommand } from '@aws-sdk/client-s3';
import { Readable } from 'node:stream';
import { execSync } from 'node:child_process';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface SyncManifest {
  readonly syncedAt: string;
  readonly files: Record<string, { hash: string; size: number }>;
}

interface SyncResult {
  downloaded: number;
  uploaded: number;
  deleted: number;
  durationMs: number;
  errors: Array<{ path: string; operation: string; message: string }>;
}

export type SyncState = 'idle' | 'syncing-from-s3' | 'syncing-to-s3' | 'caching-deps' | 'restoring-deps' | 'error';

export interface SyncManagerOptions {
  projectId: string;
  bucket: string;
  workspaceRoot: string;
  region?: string;
  concurrency?: number;
  excludePatterns?: readonly string[];
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const MANIFEST_FILE = '.antimatter-sync.json';
const DEFAULT_CONCURRENCY = 10;
const DEFAULT_EXCLUDE: readonly string[] = ['node_modules/', '.git/', '.pnpm-store/'];
const DEPS_CACHE_KEY_SUFFIX = 'cache/deps.tar.gz';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function hashContent(content: string): string {
  return createHash('sha256').update(content, 'utf-8').digest('hex');
}

async function asyncPool<T, R>(
  items: readonly T[],
  concurrency: number,
  fn: (item: T) => Promise<R>,
): Promise<PromiseSettledResult<R>[]> {
  const results: PromiseSettledResult<R>[] = new Array(items.length);
  let nextIndex = 0;

  async function worker(): Promise<void> {
    while (nextIndex < items.length) {
      const idx = nextIndex++;
      try {
        const value = await fn(items[idx]);
        results[idx] = { status: 'fulfilled', value };
      } catch (reason) {
        results[idx] = { status: 'rejected', reason };
      }
    }
  }

  const workers = Array.from(
    { length: Math.min(concurrency, items.length) },
    () => worker(),
  );
  await Promise.all(workers);
  return results;
}

// ---------------------------------------------------------------------------
// SyncManager
// ---------------------------------------------------------------------------

export class SyncManager {
  private readonly s3Client: S3Client;
  private readonly projectId: string;
  private readonly bucket: string;
  private readonly workspaceRoot: string;
  private readonly concurrency: number;
  private readonly excludePatterns: readonly string[];
  private _state: SyncState = 'idle';

  get state(): SyncState {
    return this._state;
  }

  private get projectPath(): string {
    return join(this.workspaceRoot, this.projectId);
  }

  private get s3Prefix(): string {
    return `projects/${this.projectId}/files/`;
  }

  private get depsCacheKey(): string {
    return `projects/${this.projectId}/${DEPS_CACHE_KEY_SUFFIX}`;
  }

  constructor(options: SyncManagerOptions) {
    this.projectId = options.projectId;
    this.bucket = options.bucket;
    this.workspaceRoot = options.workspaceRoot;
    this.concurrency = options.concurrency ?? DEFAULT_CONCURRENCY;
    this.excludePatterns = options.excludePatterns ?? DEFAULT_EXCLUDE;
    this.s3Client = new S3Client({ region: options.region });
  }

  /**
   * Full initial sync: restore deps cache, then sync project files from S3.
   */
  async initialSync(): Promise<void> {
    await mkdir(this.projectPath, { recursive: true });

    // Try to restore dependency cache first (fast startup)
    try {
      this._state = 'restoring-deps';
      const restored = await this.restoreDependencyCache();
      if (restored) {
        console.log('[sync] Dependency cache restored');
      } else {
        console.log('[sync] No dependency cache found — cold start');
      }
    } catch (err) {
      console.warn('[sync] Failed to restore dependency cache:', err);
    }

    // Then sync project files from S3
    const result = await this.syncFromS3();
    console.log(`[sync] Initial sync: ${result.downloaded} downloaded, ${result.deleted} deleted (${result.durationMs}ms)`);
  }

  /**
   * Pull files from S3 → local.
   */
  async syncFromS3(): Promise<SyncResult> {
    this._state = 'syncing-from-s3';
    try {
      const start = Date.now();
      const errors: SyncResult['errors'] = [];

      await mkdir(this.projectPath, { recursive: true });

      // List all S3 objects
      const s3Files = await this.listS3Objects();

      // Read manifest
      const manifest = await this.readManifest();
      const manifestFiles = manifest?.files ?? {};

      // Determine downloads
      const toDownload: string[] = [];
      const newManifestFiles: Record<string, { hash: string; size: number }> = {};

      for (const [relativePath, s3Entry] of s3Files) {
        const existing = manifestFiles[relativePath];
        if (existing && existing.hash === s3Entry.hash && existing.size === s3Entry.size) {
          newManifestFiles[relativePath] = existing;
        } else {
          toDownload.push(relativePath);
        }
      }

      // Download
      const downloadResults = await asyncPool(toDownload, this.concurrency, async (relativePath) => {
        const s3Key = this.s3Prefix + relativePath;
        const localFile = join(this.projectPath, ...relativePath.split('/'));
        await mkdir(dirname(localFile), { recursive: true });

        const res = await this.s3Client.send(
          new GetObjectCommand({ Bucket: this.bucket, Key: s3Key }),
        );
        const content = (await res.Body?.transformToString('utf-8')) ?? '';
        await writeFile(localFile, content, 'utf-8');

        const hash = hashContent(content);
        const size = Buffer.byteLength(content, 'utf-8');
        newManifestFiles[relativePath] = { hash, size };
      });

      let downloaded = 0;
      for (let i = 0; i < downloadResults.length; i++) {
        if (downloadResults[i].status === 'fulfilled') downloaded++;
        else errors.push({ path: toDownload[i], operation: 'download', message: String((downloadResults[i] as PromiseRejectedResult).reason) });
      }

      // Delete local files not in S3
      const s3PathSet = new Set(s3Files.keys());
      let deleted = 0;
      for (const existingPath of Object.keys(manifestFiles)) {
        if (!s3PathSet.has(existingPath)) {
          try {
            await unlink(join(this.projectPath, ...existingPath.split('/')));
            deleted++;
          } catch (err: any) {
            if (err.code === 'ENOENT') deleted++;
            else errors.push({ path: existingPath, operation: 'delete', message: String(err) });
          }
        }
      }

      await this.writeManifest({ syncedAt: new Date().toISOString(), files: newManifestFiles });
      const result = { downloaded, uploaded: 0, deleted, durationMs: Date.now() - start, errors };
      this._state = 'idle';
      return result;
    } catch (err) {
      this._state = 'error';
      throw err;
    }
  }

  /**
   * Push changed files from local → S3.
   */
  async syncBack(): Promise<SyncResult> {
    this._state = 'syncing-to-s3';
    try {
      const start = Date.now();
      const errors: SyncResult['errors'] = [];

      const manifest = await this.readManifest();
      const manifestFiles = manifest?.files ?? {};

      // Walk local files
      const localFiles = await this.walkLocal();

      // Determine uploads
      const toUpload: Array<{ relativePath: string; hash: string; size: number }> = [];
      const newManifestFiles: Record<string, { hash: string; size: number }> = {};

      for (const [relativePath, fileInfo] of localFiles) {
        const existing = manifestFiles[relativePath];
        if (existing && existing.hash === fileInfo.hash) {
          newManifestFiles[relativePath] = existing;
        } else {
          toUpload.push({ relativePath, ...fileInfo });
        }
      }

      // Upload
      const uploadResults = await asyncPool(toUpload, this.concurrency, async ({ relativePath, hash, size }) => {
        const localFile = join(this.projectPath, ...relativePath.split('/'));
        const content = await readFile(localFile, 'utf-8');
        await this.s3Client.send(
          new PutObjectCommand({
            Bucket: this.bucket,
            Key: this.s3Prefix + relativePath,
            Body: content,
            ContentType: 'application/octet-stream',
          }),
        );
        newManifestFiles[relativePath] = { hash, size };
      });

      let uploaded = 0;
      for (let i = 0; i < uploadResults.length; i++) {
        if (uploadResults[i].status === 'fulfilled') uploaded++;
        else errors.push({ path: toUpload[i].relativePath, operation: 'upload', message: String((uploadResults[i] as PromiseRejectedResult).reason) });
      }

      // Delete S3 objects for locally-removed files
      const localPathSet = new Set(localFiles.keys());
      const toDelete: string[] = [];
      for (const existingPath of Object.keys(manifestFiles)) {
        if (!localPathSet.has(existingPath)) toDelete.push(existingPath);
      }

      const deleteResults = await asyncPool(toDelete, this.concurrency, async (relativePath) => {
        await this.s3Client.send(
          new DeleteObjectCommand({ Bucket: this.bucket, Key: this.s3Prefix + relativePath }),
        );
      });

      let deleted = 0;
      for (let i = 0; i < deleteResults.length; i++) {
        if (deleteResults[i].status === 'fulfilled') deleted++;
        else errors.push({ path: toDelete[i], operation: 'delete', message: String((deleteResults[i] as PromiseRejectedResult).reason) });
      }

      await this.writeManifest({ syncedAt: new Date().toISOString(), files: newManifestFiles });
      const result = { downloaded: 0, uploaded, deleted, durationMs: Date.now() - start, errors };
      this._state = 'idle';
      return result;
    } catch (err) {
      this._state = 'error';
      throw err;
    }
  }

  // ---- Dependency cache ----

  /**
   * Save dependency directories (node_modules, .pnpm-store) as a tar.gz to S3.
   */
  async saveDependencyCache(): Promise<void> {
    this._state = 'caching-deps';
    try {
      const depDirs = ['node_modules', '.pnpm-store'].filter((d) =>
        existsSync(join(this.projectPath, d)),
      );

      if (depDirs.length === 0) {
        console.log('[sync] No dependency directories to cache');
        this._state = 'idle';
        return;
      }

      const tarFile = join(this.workspaceRoot, `deps-${this.projectId}.tar.gz`);

      // Create tar.gz
      console.log(`[sync] Tarring dependency directories: ${depDirs.join(', ')}`);
      execSync(`tar czf ${tarFile} ${depDirs.join(' ')}`, {
        cwd: this.projectPath,
        stdio: 'pipe',
      });

      // Upload to S3
      console.log('[sync] Uploading dependency cache to S3...');
      const fileStream = createReadStream(tarFile);
      await this.s3Client.send(
        new PutObjectCommand({
          Bucket: this.bucket,
          Key: this.depsCacheKey,
          Body: fileStream,
          ContentType: 'application/gzip',
        }),
      );

      // Clean up temp file
      await unlink(tarFile);

      console.log('[sync] Dependency cache saved');
      this._state = 'idle';
    } catch (err) {
      this._state = 'error';
      throw err;
    }
  }

  /**
   * Restore dependency cache from S3.
   * @returns true if cache existed and was restored.
   */
  async restoreDependencyCache(): Promise<boolean> {
    try {
      const res = await this.s3Client.send(
        new GetObjectCommand({ Bucket: this.bucket, Key: this.depsCacheKey }),
      );

      if (!res.Body) return false;

      const tarFile = join(this.workspaceRoot, `deps-${this.projectId}.tar.gz`);

      // Download to temp file
      const body = res.Body as Readable;
      const writeStream = createWriteStream(tarFile);
      await pipeline(body, writeStream);

      // Extract to project directory
      await mkdir(this.projectPath, { recursive: true });
      execSync(`tar xzf ${tarFile}`, {
        cwd: this.projectPath,
        stdio: 'pipe',
      });

      // Clean up temp file
      await unlink(tarFile);

      return true;
    } catch (err: any) {
      if (err.name === 'NoSuchKey' || err.$metadata?.httpStatusCode === 404) {
        return false;
      }
      throw err;
    }
  }

  // ---- Private helpers ----

  private async listS3Objects(): Promise<Map<string, { hash: string; size: number }>> {
    const files = new Map<string, { hash: string; size: number }>();
    let continuationToken: string | undefined;

    do {
      const res = await this.s3Client.send(
        new ListObjectsV2Command({
          Bucket: this.bucket,
          Prefix: this.s3Prefix,
          ContinuationToken: continuationToken,
        }),
      );

      for (const obj of res.Contents ?? []) {
        const key = obj.Key!;
        const relativePath = key.slice(this.s3Prefix.length);
        if (!relativePath || relativePath.endsWith('/')) continue;

        const etag = (obj.ETag ?? '').replace(/"/g, '');
        files.set(relativePath, { hash: etag, size: obj.Size ?? 0 });
      }

      continuationToken = res.IsTruncated ? res.NextContinuationToken : undefined;
    } while (continuationToken);

    return files;
  }

  private async walkLocal(): Promise<Map<string, { hash: string; size: number }>> {
    const files = new Map<string, { hash: string; size: number }>();

    const walk = async (dir: string): Promise<void> => {
      let entries;
      try {
        entries = await readdir(dir, { withFileTypes: true });
      } catch {
        return;
      }

      for (const entry of entries) {
        const fullPath = join(dir, entry.name);
        const relativePath = relative(this.projectPath, fullPath).split('\\').join('/');

        if (this.shouldExclude(relativePath, entry.isDirectory())) continue;

        if (entry.isDirectory()) {
          await walk(fullPath);
        } else if (entry.isFile()) {
          try {
            const content = await readFile(fullPath, 'utf-8');
            const hash = hashContent(content);
            const size = Buffer.byteLength(content, 'utf-8');
            files.set(relativePath, { hash, size });
          } catch {
            // Skip unreadable files
          }
        }
      }
    };

    await walk(this.projectPath);
    return files;
  }

  private shouldExclude(relativePath: string, isDirectory: boolean): boolean {
    if (relativePath === MANIFEST_FILE) return true;

    for (const pattern of this.excludePatterns) {
      if (pattern.endsWith('/')) {
        const dirName = pattern.slice(0, -1);
        if (isDirectory && relativePath.split('/').includes(dirName)) return true;
        if (!isDirectory && relativePath.split('/').slice(0, -1).includes(dirName)) return true;
      } else {
        if (relativePath === pattern || relativePath.endsWith('/' + pattern)) return true;
      }
    }
    return false;
  }

  private async readManifest(): Promise<SyncManifest | null> {
    try {
      const raw = await readFile(join(this.projectPath, MANIFEST_FILE), 'utf-8');
      return JSON.parse(raw) as SyncManifest;
    } catch {
      return null;
    }
  }

  private async writeManifest(manifest: SyncManifest): Promise<void> {
    await writeFile(join(this.projectPath, MANIFEST_FILE), JSON.stringify(manifest, null, 2), 'utf-8');
  }
}
