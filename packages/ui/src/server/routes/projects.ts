import { Router } from 'express';
import { randomUUID } from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import type { S3Client } from '@aws-sdk/client-s3';
import {
  PutObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  ListObjectsV2Command,
  DeleteObjectsCommand,
} from '@aws-sdk/client-s3';
import git from 'isomorphic-git';
import http from 'isomorphic-git/http/node';
import { WorkspaceEc2Service } from '../services/workspace-ec2-service.js';
import type { WorkspaceEc2ServiceConfig } from '../services/workspace-ec2-service.js';

interface ProjectGitConfig {
  repository?: string;    // e.g. "https://github.com/user/repo.git"
  defaultBranch?: string; // e.g. "main"
  userName?: string;      // commit author name
  userEmail?: string;     // commit author email
}

interface ProjectMeta {
  id: string;
  name: string;
  createdAt: string;
  git?: ProjectGitConfig;
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

/** Convert a project name to a filesystem/URL-friendly slug. */
function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, '-')
    .replace(/-{2,}/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 64) || `project-${randomUUID().slice(0, 8)}`;
}

/** Find a unique project ID by checking S3 for collisions. */
async function uniqueProjectId(s3: S3Client, bucket: string, base: string): Promise<string> {
  let candidate = base;
  let suffix = 2;
  while (true) {
    try {
      await s3.send(new HeadObjectCommand({ Bucket: bucket, Key: `projects/${candidate}/meta.json` }));
      // Exists — try next suffix
      candidate = `${base}-${suffix++}`;
    } catch {
      // Doesn't exist — available
      return candidate;
    }
  }
}

export function createProjectRouter(
  s3Client: S3Client,
  bucket: string,
  workspaceConfig?: WorkspaceEc2ServiceConfig | null,
): Router {
  const router = Router();

  // Create project
  router.post('/', async (req, res) => {
    try {
      const { name } = req.body as { name: string };
      if (!name) {
        return res.status(400).json({ error: 'Project name is required' });
      }

      const id = await uniqueProjectId(s3Client, bucket, slugify(name));
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

  // Update project metadata (merge-patch)
  router.patch('/:id', async (req, res) => {
    try {
      const metaKey = `projects/${req.params.id}/meta.json`;

      // Read existing metadata
      const metaRes = await s3Client.send(
        new GetObjectCommand({ Bucket: bucket, Key: metaKey }),
      );
      const body = await metaRes.Body?.transformToString('utf-8');
      if (!body) {
        return res.status(404).json({ error: 'Project not found' });
      }

      const existing = JSON.parse(body) as ProjectMeta;
      const updates = req.body as Partial<Pick<ProjectMeta, 'name' | 'git'>>;

      // Merge updates
      const merged: ProjectMeta = {
        ...existing,
        ...(updates.name ? { name: updates.name } : {}),
        ...(updates.git ? { git: { ...existing.git, ...updates.git } } : {}),
      };

      await s3Client.send(
        new PutObjectCommand({
          Bucket: bucket,
          Key: metaKey,
          Body: JSON.stringify(merged),
          ContentType: 'application/json',
        }),
      );

      res.json(merged);
    } catch (error: any) {
      if (error.name === 'NoSuchKey' || error.$metadata?.httpStatusCode === 404) {
        return res.status(404).json({ error: 'Project not found' });
      }
      res.status(500).json({
        error: 'Failed to update project',
        message: error instanceof Error ? error.message : String(error),
      });
    }
  });

  // Delete project — cascade: clean up ALB routing, then delete S3 data
  router.delete('/:id', async (req, res) => {
    const projectId = req.params.id;
    try {
      // 1. Clean up ALB routing rules for this project (shared instance stays running)
      if (workspaceConfig) {
        try {
          const service = new WorkspaceEc2Service(workspaceConfig);
          await service.deleteProjectRouting(projectId);
          console.log(`[projects] Cleaned up routing for project ${projectId}`);
        } catch (err) {
          // Log but don't fail — routing may not exist
          console.warn(`[projects] Routing cleanup for ${projectId}:`, err instanceof Error ? err.message : err);
        }
      }

      // 2. Delete all S3 objects under the project prefix
      const prefix = `projects/${projectId}/`;
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
      const id = await uniqueProjectId(s3Client, bucket, slugify(projectName));
      const meta: ProjectMeta = {
        id,
        name: projectName,
        createdAt: new Date().toISOString(),
        git: {
          repository: url,
          defaultBranch: 'main',
        },
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
