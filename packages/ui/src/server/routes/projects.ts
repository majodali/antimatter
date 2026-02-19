import { Router } from 'express';
import { randomUUID } from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import type { S3Client } from '@aws-sdk/client-s3';
import {
  PutObjectCommand,
  GetObjectCommand,
  ListObjectsV2Command,
  DeleteObjectsCommand,
} from '@aws-sdk/client-s3';
import git from 'isomorphic-git';
import http from 'isomorphic-git/http/node';

interface ProjectMeta {
  id: string;
  name: string;
  createdAt: string;
}

const SKIP_DIRS = new Set([
  '.git', 'node_modules', '.next', 'dist', 'build',
  '__pycache__', '.venv', 'target', 'vendor', '.terraform',
]);

const MAX_FILES = 5000;
const MAX_FILE_SIZE = 1024 * 1024; // 1MB

interface WalkedFile {
  relativePath: string;
  absolutePath: string;
}

function walkDirectory(dir: string, base: string = dir): WalkedFile[] {
  const results: WalkedFile[] = [];

  function walk(current: string) {
    if (results.length >= MAX_FILES) return;

    const entries = fs.readdirSync(current, { withFileTypes: true });
    for (const entry of entries) {
      if (results.length >= MAX_FILES) return;

      if (entry.isDirectory()) {
        if (!SKIP_DIRS.has(entry.name)) {
          walk(path.join(current, entry.name));
        }
      } else if (entry.isFile()) {
        const absPath = path.join(current, entry.name);
        try {
          const stat = fs.statSync(absPath);
          if (stat.size <= MAX_FILE_SIZE) {
            results.push({
              relativePath: path.relative(base, absPath).replace(/\\/g, '/'),
              absolutePath: absPath,
            });
          }
        } catch {
          // Skip unreadable files
        }
      }
    }
  }

  walk(dir);
  return results;
}

export function createProjectRouter(s3Client: S3Client, bucket: string): Router {
  const router = Router();

  // Create project
  router.post('/', async (req, res) => {
    try {
      const { name } = req.body as { name: string };
      if (!name) {
        return res.status(400).json({ error: 'Project name is required' });
      }

      const id = randomUUID();
      const meta: ProjectMeta = { id, name, createdAt: new Date().toISOString() };

      await s3Client.send(
        new PutObjectCommand({
          Bucket: bucket,
          Key: `projects/${id}/meta.json`,
          Body: JSON.stringify(meta),
          ContentType: 'application/json',
        }),
      );

      res.json(meta);
    } catch (error) {
      res.status(500).json({
        error: 'Failed to create project',
        message: error instanceof Error ? error.message : String(error),
      });
    }
  });

  // List projects
  router.get('/', async (_req, res) => {
    try {
      const listRes = await s3Client.send(
        new ListObjectsV2Command({
          Bucket: bucket,
          Prefix: 'projects/',
          Delimiter: '/',
        }),
      );

      const projectDirs = (listRes.CommonPrefixes ?? [])
        .map((cp) => cp.Prefix!)
        .filter(Boolean);

      const projects: ProjectMeta[] = [];
      for (const dir of projectDirs) {
        try {
          const metaRes = await s3Client.send(
            new GetObjectCommand({
              Bucket: bucket,
              Key: `${dir}meta.json`,
            }),
          );
          const body = await metaRes.Body?.transformToString('utf-8');
          if (body) {
            projects.push(JSON.parse(body) as ProjectMeta);
          }
        } catch {
          // Skip projects with missing/corrupt metadata
        }
      }

      res.json({ projects });
    } catch (error) {
      res.status(500).json({
        error: 'Failed to list projects',
        message: error instanceof Error ? error.message : String(error),
      });
    }
  });

  // Get project metadata
  router.get('/:id', async (req, res) => {
    try {
      const metaRes = await s3Client.send(
        new GetObjectCommand({
          Bucket: bucket,
          Key: `projects/${req.params.id}/meta.json`,
        }),
      );
      const body = await metaRes.Body?.transformToString('utf-8');
      if (!body) {
        return res.status(404).json({ error: 'Project not found' });
      }
      res.json(JSON.parse(body));
    } catch (error: any) {
      if (error.name === 'NoSuchKey' || error.$metadata?.httpStatusCode === 404) {
        return res.status(404).json({ error: 'Project not found' });
      }
      res.status(500).json({
        error: 'Failed to get project',
        message: error instanceof Error ? error.message : String(error),
      });
    }
  });

  // Delete project (all objects under prefix)
  router.delete('/:id', async (req, res) => {
    try {
      const prefix = `projects/${req.params.id}/`;
      let continuationToken: string | undefined;

      do {
        const listRes = await s3Client.send(
          new ListObjectsV2Command({
            Bucket: bucket,
            Prefix: prefix,
            ContinuationToken: continuationToken,
          }),
        );

        const objects = (listRes.Contents ?? []).map((obj) => ({ Key: obj.Key! }));
        if (objects.length > 0) {
          await s3Client.send(
            new DeleteObjectsCommand({
              Bucket: bucket,
              Delete: { Objects: objects },
            }),
          );
        }

        continuationToken = listRes.IsTruncated
          ? listRes.NextContinuationToken
          : undefined;
      } while (continuationToken);

      res.json({ success: true });
    } catch (error) {
      res.status(500).json({
        error: 'Failed to delete project',
        message: error instanceof Error ? error.message : String(error),
      });
    }
  });

  // Import project from git
  router.post('/import/git', async (req, res) => {
    const cloneDir = `/tmp/clone-${randomUUID()}`;

    try {
      const { url, name } = req.body as { url: string; name?: string };
      if (!url) {
        return res.status(400).json({ error: 'Git URL is required' });
      }

      // Derive project name from URL if not provided
      const projectName =
        name?.trim() ||
        url
          .replace(/\.git$/, '')
          .split('/')
          .pop() || 'imported-project';

      // Clone the repo (shallow)
      fs.mkdirSync(cloneDir, { recursive: true });
      await git.clone({
        fs,
        http,
        dir: cloneDir,
        url,
        depth: 1,
        singleBranch: true,
      });

      // Walk cloned directory
      const files = walkDirectory(cloneDir);

      // Create project in S3
      const id = randomUUID();
      const meta: ProjectMeta = {
        id,
        name: projectName,
        createdAt: new Date().toISOString(),
      };

      await s3Client.send(
        new PutObjectCommand({
          Bucket: bucket,
          Key: `projects/${id}/meta.json`,
          Body: JSON.stringify(meta),
          ContentType: 'application/json',
        }),
      );

      // Upload files in batches of 25
      const BATCH_SIZE = 25;
      for (let i = 0; i < files.length; i += BATCH_SIZE) {
        const batch = files.slice(i, i + BATCH_SIZE);
        await Promise.all(
          batch.map((file) => {
            const content = fs.readFileSync(file.absolutePath, 'utf-8');
            return s3Client.send(
              new PutObjectCommand({
                Bucket: bucket,
                Key: `projects/${id}/files/${file.relativePath}`,
                Body: content,
                ContentType: 'application/octet-stream',
              }),
            );
          }),
        );
      }

      // Clean up clone directory
      fs.rmSync(cloneDir, { recursive: true, force: true });

      res.json({ ...meta, importStats: { totalFiles: files.length } });
    } catch (error) {
      // Clean up on failure
      try {
        fs.rmSync(cloneDir, { recursive: true, force: true });
      } catch {
        // Ignore cleanup errors
      }

      res.status(500).json({
        error: 'Failed to import git repository',
        message: error instanceof Error ? error.message : String(error),
      });
    }
  });

  return router;
}
