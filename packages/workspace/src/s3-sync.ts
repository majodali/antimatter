/**
 * S3 ↔ Local synchronization engine.
 *
 * Operates on raw S3Client + node:fs — no dependency on WorkspaceEnvironment.
 * Uses a content-hash manifest stored on the local side to enable incremental
 * sync (only transfer files that actually changed).
 */

import { readFile, writeFile, mkdir, readdir, unlink } from 'node:fs/promises';
import { join, dirname, relative } from 'node:path';
import type { S3Client } from '@aws-sdk/client-s3';
import {
  ListObjectsV2Command,
  GetObjectCommand,
  PutObjectCommand,
  DeleteObjectCommand,
} from '@aws-sdk/client-s3';
import { hashContent } from '@antimatter/filesystem';
import { asyncPool } from './async-pool.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface SyncManifest {
  readonly syncedAt: string;
  readonly files: Record<string, SyncFileEntry>;
}

export interface SyncFileEntry {
  readonly hash: string;
  readonly size: number;
}

export interface SyncOptions {
  readonly s3Client: S3Client;
  readonly bucket: string;
  /** S3 key prefix — must end with "/" (e.g. "projects/abc/files/"). */
  readonly s3Prefix: string;
  /** Absolute local directory path (e.g. "/mnt/projects/abc"). */
  readonly localPath: string;
  /** Max parallel S3 operations. @default 10 */
  readonly concurrency?: number;
  /** Glob-like prefixes to exclude from sync-back. @default ["node_modules/", ".git/"] */
  readonly excludePatterns?: readonly string[];
}

export interface SyncResult {
  readonly downloaded: number;
  readonly uploaded: number;
  readonly deleted: number;
  readonly durationMs: number;
  readonly errors: readonly SyncError[];
}

export interface SyncError {
  readonly path: string;
  readonly operation: 'download' | 'upload' | 'delete';
  readonly message: string;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const MANIFEST_FILE = '.antimatter-sync.json';
const DEFAULT_CONCURRENCY = 10;
const DEFAULT_EXCLUDE: readonly string[] = ['node_modules/', '.git/'];

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Sync files FROM S3 TO the local directory.
 *
 * 1. List all objects in the S3 prefix (paginated, flat — no delimiter).
 * 2. Read local manifest to identify unchanged files.
 * 3. Download new / changed files.
 * 4. Delete local files that no longer exist in S3.
 * 5. Write updated manifest.
 */
export async function syncFromS3(options: SyncOptions): Promise<SyncResult> {
  const start = Date.now();
  const concurrency = options.concurrency ?? DEFAULT_CONCURRENCY;
  const errors: SyncError[] = [];

  // Ensure local directory exists
  await mkdir(options.localPath, { recursive: true });

  // 1. List ALL objects in S3
  const s3Files = await listS3Objects(options.s3Client, options.bucket, options.s3Prefix);

  // 2. Read existing manifest
  const manifest = await readManifest(options.localPath);
  const manifestFiles = manifest?.files ?? {};

  // 3. Determine which files need downloading
  const toDownload: string[] = [];
  const newManifestFiles: Record<string, SyncFileEntry> = {};

  for (const [relativePath, s3Entry] of s3Files) {
    const existingEntry = manifestFiles[relativePath];
    if (existingEntry && existingEntry.hash === s3Entry.hash && existingEntry.size === s3Entry.size) {
      // File unchanged — keep manifest entry, skip download
      newManifestFiles[relativePath] = existingEntry;
    } else {
      toDownload.push(relativePath);
    }
  }

  // 4. Download files with bounded concurrency
  const downloadResults = await asyncPool(toDownload, concurrency, async (relativePath) => {
    const s3Key = options.s3Prefix + relativePath;
    const localFile = join(options.localPath, ...relativePath.split('/'));

    await mkdir(dirname(localFile), { recursive: true });

    const res = await options.s3Client.send(
      new GetObjectCommand({ Bucket: options.bucket, Key: s3Key }),
    );
    const content = (await res.Body?.transformToString('utf-8')) ?? '';
    await writeFile(localFile, content, 'utf-8');

    const hash = hashContent(content);
    const size = Buffer.byteLength(content, 'utf-8');
    newManifestFiles[relativePath] = { hash, size };
  });

  let downloaded = 0;
  for (const r of downloadResults) {
    if (r.status === 'fulfilled') {
      downloaded++;
    } else {
      errors.push({
        path: toDownload[downloadResults.indexOf(r)],
        operation: 'download',
        message: String(r.reason),
      });
    }
  }

  // 5. Delete local files not in S3 (handle deletions)
  const s3PathSet = new Set(s3Files.keys());
  const toDelete: string[] = [];
  for (const existingPath of Object.keys(manifestFiles)) {
    if (!s3PathSet.has(existingPath)) {
      toDelete.push(existingPath);
    }
  }

  let deleted = 0;
  for (const relativePath of toDelete) {
    try {
      const localFile = join(options.localPath, ...relativePath.split('/'));
      await unlink(localFile);
      deleted++;
    } catch (err: any) {
      if (err.code !== 'ENOENT') {
        errors.push({ path: relativePath, operation: 'delete', message: String(err) });
      } else {
        deleted++; // Already gone — count as success
      }
    }
  }

  // 6. Write manifest
  await writeManifest(options.localPath, {
    syncedAt: new Date().toISOString(),
    files: newManifestFiles,
  });

  return { downloaded, uploaded: 0, deleted, durationMs: Date.now() - start, errors };
}

/**
 * Sync files FROM the local directory TO S3.
 *
 * 1. Walk local directory recursively.
 * 2. Compare each file hash against the manifest.
 * 3. Upload new / changed files to S3.
 * 4. Delete S3 objects for locally-deleted files.
 * 5. Write updated manifest.
 */
export async function syncToS3(options: SyncOptions): Promise<SyncResult> {
  const start = Date.now();
  const concurrency = options.concurrency ?? DEFAULT_CONCURRENCY;
  const excludePatterns = options.excludePatterns ?? DEFAULT_EXCLUDE;
  const errors: SyncError[] = [];

  // 1. Read manifest
  const manifest = await readManifest(options.localPath);
  const manifestFiles = manifest?.files ?? {};

  // 2. Walk local directory
  const localFiles = await walkLocalDirectory(options.localPath, excludePatterns);

  // 3. Determine what to upload
  const toUpload: Array<{ relativePath: string; hash: string; size: number }> = [];
  const newManifestFiles: Record<string, SyncFileEntry> = {};

  for (const [relativePath, fileInfo] of localFiles) {
    const existingEntry = manifestFiles[relativePath];
    if (existingEntry && existingEntry.hash === fileInfo.hash) {
      // Unchanged — keep manifest entry
      newManifestFiles[relativePath] = existingEntry;
    } else {
      toUpload.push({ relativePath, hash: fileInfo.hash, size: fileInfo.size });
    }
  }

  // 4. Upload with bounded concurrency
  const uploadResults = await asyncPool(toUpload, concurrency, async ({ relativePath, hash, size }) => {
    const localFile = join(options.localPath, ...relativePath.split('/'));
    const content = await readFile(localFile, 'utf-8');
    const s3Key = options.s3Prefix + relativePath;

    await options.s3Client.send(
      new PutObjectCommand({
        Bucket: options.bucket,
        Key: s3Key,
        Body: content,
        ContentType: 'application/octet-stream',
      }),
    );

    newManifestFiles[relativePath] = { hash, size };
  });

  let uploaded = 0;
  for (const r of uploadResults) {
    if (r.status === 'fulfilled') {
      uploaded++;
    } else {
      errors.push({
        path: toUpload[uploadResults.indexOf(r)].relativePath,
        operation: 'upload',
        message: String(r.reason),
      });
    }
  }

  // 5. Delete S3 objects for locally-removed files
  const localPathSet = new Set(localFiles.keys());
  const toDelete: string[] = [];
  for (const existingPath of Object.keys(manifestFiles)) {
    if (!localPathSet.has(existingPath)) {
      toDelete.push(existingPath);
    }
  }

  const deleteResults = await asyncPool(toDelete, concurrency, async (relativePath) => {
    const s3Key = options.s3Prefix + relativePath;
    await options.s3Client.send(
      new DeleteObjectCommand({ Bucket: options.bucket, Key: s3Key }),
    );
  });

  let deleted = 0;
  for (const r of deleteResults) {
    if (r.status === 'fulfilled') {
      deleted++;
    } else {
      errors.push({
        path: toDelete[deleteResults.indexOf(r)],
        operation: 'delete',
        message: String(r.reason),
      });
    }
  }

  // 6. Write manifest
  await writeManifest(options.localPath, {
    syncedAt: new Date().toISOString(),
    files: newManifestFiles,
  });

  return { downloaded: 0, uploaded, deleted, durationMs: Date.now() - start, errors };
}

// ---------------------------------------------------------------------------
// Manifest helpers
// ---------------------------------------------------------------------------

export async function readManifest(localPath: string): Promise<SyncManifest | null> {
  const manifestPath = join(localPath, MANIFEST_FILE);
  try {
    const raw = await readFile(manifestPath, 'utf-8');
    return JSON.parse(raw) as SyncManifest;
  } catch {
    return null;
  }
}

export async function writeManifest(localPath: string, manifest: SyncManifest): Promise<void> {
  const manifestPath = join(localPath, MANIFEST_FILE);
  await writeFile(manifestPath, JSON.stringify(manifest, null, 2), 'utf-8');
}

// ---------------------------------------------------------------------------
// Internals
// ---------------------------------------------------------------------------

/**
 * List ALL objects under an S3 prefix (flat, no delimiter) and return a Map
 * of relative-path → { hash (ETag-based), size }.
 */
async function listS3Objects(
  s3Client: S3Client,
  bucket: string,
  prefix: string,
): Promise<Map<string, SyncFileEntry>> {
  const files = new Map<string, SyncFileEntry>();
  let continuationToken: string | undefined;

  do {
    const res = await s3Client.send(
      new ListObjectsV2Command({
        Bucket: bucket,
        Prefix: prefix,
        ContinuationToken: continuationToken,
      }),
    );

    for (const obj of res.Contents ?? []) {
      const key = obj.Key!;
      const relativePath = key.slice(prefix.length);
      // Skip directory markers (keys ending with /) and empty keys
      if (!relativePath || relativePath.endsWith('/')) continue;

      // Use ETag as the hash comparison key for S3 → local sync.
      // ETags are MD5 for non-multipart uploads, which covers all our files.
      const etag = (obj.ETag ?? '').replace(/"/g, '');
      files.set(relativePath, {
        hash: etag,
        size: obj.Size ?? 0,
      });
    }

    continuationToken = res.IsTruncated ? res.NextContinuationToken : undefined;
  } while (continuationToken);

  return files;
}

/**
 * Recursively walk a local directory and return a Map of
 * relative-path → { hash, size } for all regular files.
 */
async function walkLocalDirectory(
  rootPath: string,
  excludePatterns: readonly string[],
): Promise<Map<string, { hash: string; size: number }>> {
  const files = new Map<string, { hash: string; size: number }>();

  async function walk(dir: string): Promise<void> {
    let entries;
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }

    for (const entry of entries) {
      const fullPath = join(dir, entry.name);
      const relativePath = relative(rootPath, fullPath).split('\\').join('/');

      // Check exclude patterns
      if (shouldExclude(relativePath, entry.isDirectory(), excludePatterns)) continue;

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
  }

  await walk(rootPath);
  return files;
}

function shouldExclude(
  relativePath: string,
  isDirectory: boolean,
  excludePatterns: readonly string[],
): boolean {
  // Always exclude the manifest file
  if (relativePath === MANIFEST_FILE) return true;

  for (const pattern of excludePatterns) {
    if (pattern.endsWith('/')) {
      // Directory pattern — match if the path starts with it or a segment matches
      const dirName = pattern.slice(0, -1);
      if (isDirectory && relativePath.split('/').includes(dirName)) return true;
      if (!isDirectory && relativePath.split('/').slice(0, -1).includes(dirName)) return true;
    } else {
      if (relativePath === pattern || relativePath.endsWith('/' + pattern)) return true;
    }
  }
  return false;
}
