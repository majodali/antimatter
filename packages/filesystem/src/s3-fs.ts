import type {
  S3Client,
  GetObjectCommandOutput,
} from '@aws-sdk/client-s3';
import {
  GetObjectCommand,
  PutObjectCommand,
  DeleteObjectCommand,
  HeadObjectCommand,
  ListObjectsV2Command,
  CopyObjectCommand,
} from '@aws-sdk/client-s3';
import type { Timestamp } from '@antimatter/project-model';
import { normalizePath } from './path-utils.js';
import type {
  FileSystem,
  FileContent,
  FileStat,
  FileEntry,
  WorkspacePath,
  WatchListener,
  Watcher,
} from './types.js';

export interface S3FileSystemOptions {
  readonly s3Client: S3Client;
  readonly bucket: string;
  /** S3 key prefix (e.g. "projects/abc123/files/"). Must end with "/" or be empty. */
  readonly prefix: string;
}

export class S3FileSystem implements FileSystem {
  private readonly s3: S3Client;
  private readonly bucket: string;
  private readonly prefix: string;

  constructor(options: S3FileSystemOptions) {
    this.s3 = options.s3Client;
    this.bucket = options.bucket;
    this.prefix = options.prefix;
  }

  private key(path: WorkspacePath): string {
    const normalized = normalizePath(path);
    return this.prefix + normalized;
  }

  async readFile(path: WorkspacePath): Promise<FileContent> {
    const text = await this.readTextFile(path);
    return new TextEncoder().encode(text);
  }

  async readTextFile(path: WorkspacePath): Promise<string> {
    try {
      const res: GetObjectCommandOutput = await this.s3.send(
        new GetObjectCommand({ Bucket: this.bucket, Key: this.key(path) }),
      );
      return (await res.Body?.transformToString('utf-8')) ?? '';
    } catch (err: any) {
      if (err.name === 'NoSuchKey' || err.$metadata?.httpStatusCode === 404) {
        throw new Error(`ENOENT: no such file or directory, open '${path}'`);
      }
      throw err;
    }
  }

  async writeFile(
    path: WorkspacePath,
    content: FileContent | string,
  ): Promise<void> {
    const body = typeof content === 'string' ? content : Buffer.from(content);
    await this.s3.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: this.key(path),
        Body: body,
        ContentType: 'application/octet-stream',
      }),
    );
  }

  async deleteFile(path: WorkspacePath): Promise<void> {
    await this.s3.send(
      new DeleteObjectCommand({ Bucket: this.bucket, Key: this.key(path) }),
    );
  }

  async exists(path: WorkspacePath): Promise<boolean> {
    try {
      await this.s3.send(
        new HeadObjectCommand({ Bucket: this.bucket, Key: this.key(path) }),
      );
      return true;
    } catch {
      return false;
    }
  }

  async stat(path: WorkspacePath): Promise<FileStat> {
    try {
      const res = await this.s3.send(
        new HeadObjectCommand({ Bucket: this.bucket, Key: this.key(path) }),
      );
      const mtime = (res.LastModified?.toISOString() ??
        new Date().toISOString()) as Timestamp;
      return {
        size: res.ContentLength ?? 0,
        modifiedAt: mtime,
        createdAt: mtime,
        isDirectory: false,
        isFile: true,
      };
    } catch {
      throw new Error(`ENOENT: no such file or directory, stat '${path}'`);
    }
  }

  async readDirectory(path: WorkspacePath): Promise<readonly FileEntry[]> {
    const normalized = normalizePath(path);
    const prefix =
      normalized === '' ? this.prefix : this.prefix + normalized + '/';

    const entries = new Map<string, FileEntry>();
    let continuationToken: string | undefined;

    do {
      const res = await this.s3.send(
        new ListObjectsV2Command({
          Bucket: this.bucket,
          Prefix: prefix,
          Delimiter: '/',
          ContinuationToken: continuationToken,
        }),
      );

      // Files directly in this directory
      for (const obj of res.Contents ?? []) {
        const key = obj.Key!;
        const name = key.slice(prefix.length);
        if (name && !name.includes('/')) {
          entries.set(name, { name, isDirectory: false });
        }
      }

      // Subdirectories
      for (const cp of res.CommonPrefixes ?? []) {
        const dirKey = cp.Prefix!;
        const name = dirKey.slice(prefix.length).replace(/\/$/, '');
        if (name) {
          entries.set(name, { name, isDirectory: true });
        }
      }

      continuationToken = res.IsTruncated
        ? res.NextContinuationToken
        : undefined;
    } while (continuationToken);

    return [...entries.values()].sort((a, b) => a.name.localeCompare(b.name));
  }

  async mkdir(path: WorkspacePath): Promise<void> {
    const normalized = normalizePath(path);
    await this.s3.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: this.prefix + normalized + '/',
        Body: '',
      }),
    );
  }

  async copyFile(src: WorkspacePath, dest: WorkspacePath): Promise<void> {
    await this.s3.send(
      new CopyObjectCommand({
        Bucket: this.bucket,
        CopySource: `${this.bucket}/${this.key(src)}`,
        Key: this.key(dest),
      }),
    );
  }

  async rename(src: WorkspacePath, dest: WorkspacePath): Promise<void> {
    await this.copyFile(src, dest);
    await this.deleteFile(src);
  }

  watch(_path: WorkspacePath, _listener: WatchListener): Watcher {
    // No-op watcher — Lambda is stateless
    return { close: () => {} };
  }
}
