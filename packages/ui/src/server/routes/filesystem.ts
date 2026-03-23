import { Router } from 'express';
import type { WorkspaceService } from '../services/workspace-service.js';

interface FileNode {
  name: string;
  path: string;
  isDirectory: boolean;
  children?: FileNode[];
}

/**
 * Recursively filter a file tree against the explorerIgnore patterns.
 * Directories matching a pattern are removed along with all their children.
 */
function filterTree(nodes: FileNode[], ignorePatterns: string[]): FileNode[] {
  return nodes
    .filter(node => {
      const normalized = node.path.startsWith('/') ? node.path.slice(1) : node.path;
      // For directories, check if name/ matches any ignore prefix
      if (node.isDirectory) {
        return !ignorePatterns.some(p => node.name + '/' === p || normalized + '/' === p || normalized.startsWith(p));
      }
      // For files, check if the full path starts with any ignore prefix
      return !ignorePatterns.some(p => normalized.startsWith(p));
    })
    .map(node => {
      if (node.children) {
        return { ...node, children: filterTree(node.children, ignorePatterns) };
      }
      return node;
    });
}

/**
 * Forwards a mutation request to the workspace server via ALB.
 * Called best-effort after the local (S3) write succeeds.
 */
export type WorkspaceForwarder = (
  route: string,
  method: string,
  body?: Record<string, unknown>,
  query?: Record<string, string>,
) => Promise<void>;

/**
 * Callback to notify the workflow engine of file mutations.
 * Called after successful write/delete/mkdir/move/copy operations.
 * The path is workspace-relative (e.g. 'src/validator.ts').
 * The type is 'change' for writes/mkdir/move/copy, 'delete' for deletions.
 */
export type FileChangeNotify = (
  paths: { path: string; type: 'change' | 'delete' }[],
) => void;

export interface FileRouterOptions {
  /** Returns the current explorerIgnore patterns for filtering file tree responses. */
  getExplorerIgnore?: () => string[];
  /**
   * When provided, mutation routes (write, delete, mkdir) forward the operation
   * to the workspace server after the local (S3) write succeeds. Best-effort:
   * if forwarding fails, the local write still succeeds and the workspace will
   * pick up the change on the next S3 sync cycle.
   */
  workspaceForwarder?: WorkspaceForwarder;
  /**
   * When provided, mutation routes emit file:change/file:delete events directly
   * to the workflow engine. This ensures workflow rules trigger reliably even
   * when the filesystem watcher (inotify) doesn't detect the change.
   * The workflow manager should deduplicate against watcher-sourced events.
   */
  onFileChange?: FileChangeNotify;
}

export function createFileRouter(workspace: WorkspaceService, options?: FileRouterOptions): Router {
  const router = Router();

  // Get recursive directory tree
  router.get('/tree', async (req, res) => {
    try {
      const path = (req.query.path as string) || '/';
      const tree = await workspace.getDirectoryTreeRecursive(path);
      const ignorePatterns = options?.getExplorerIgnore?.() ?? [];
      const filtered = ignorePatterns.length > 0 ? filterTree(tree, ignorePatterns) : tree;
      res.json({ tree: filtered });
    } catch (error) {
      res.status(500).json({
        error: 'Failed to get directory tree',
        message: error instanceof Error ? error.message : String(error),
      });
    }
  });

  // List directory contents
  router.get('/list', async (req, res) => {
    try {
      const path = (req.query.path as string) || '/';
      const entries = await workspace.getDirectoryTree(path);
      res.json({ entries });
    } catch (error) {
      res.status(500).json({
        error: 'Failed to list directory',
        message: error instanceof Error ? error.message : String(error),
      });
    }
  });

  // Read file contents
  router.get('/read', async (req, res) => {
    try {
      const path = req.query.path as string;
      if (!path) {
        return res.status(400).json({ error: 'Path parameter is required' });
      }
      const content = await workspace.readFile(path);
      res.json({ path, content });
    } catch (error) {
      res.status(500).json({
        error: 'Failed to read file',
        message: error instanceof Error ? error.message : String(error),
      });
    }
  });

  // Write file contents
  router.post('/write', async (req, res) => {
    try {
      const { path, content } = req.body;
      if (!path || content === undefined) {
        return res.status(400).json({ error: 'Path and content are required' });
      }
      await workspace.writeFile(path, content);
      // Notify workflow engine of the mutation (deduplicates with watcher events)
      options?.onFileChange?.([{ path, type: 'change' }]);
      // Best-effort forward to workspace server so file watcher + workflow trigger
      options?.workspaceForwarder?.('/write', 'POST', { path, content }).catch(err => {
        console.warn('[file-router] Workspace forward failed for write:', err.message ?? err);
      });
      res.json({ success: true, path });
    } catch (error) {
      res.status(500).json({
        error: 'Failed to write file',
        message: error instanceof Error ? error.message : String(error),
      });
    }
  });

  // Create directory
  router.post('/mkdir', async (req, res) => {
    try {
      const { path } = req.body;
      if (!path) {
        return res.status(400).json({ error: 'Path is required' });
      }
      await workspace.mkdir(path);
      options?.onFileChange?.([{ path, type: 'change' }]);
      options?.workspaceForwarder?.('/mkdir', 'POST', { path }).catch(err => {
        console.warn('[file-router] Workspace forward failed for mkdir:', err.message ?? err);
      });
      res.json({ success: true, path });
    } catch (error) {
      res.status(500).json({
        error: 'Failed to create directory',
        message: error instanceof Error ? error.message : String(error),
      });
    }
  });

  // Delete file
  router.delete('/delete', async (req, res) => {
    try {
      const path = req.query.path as string;
      if (!path) {
        return res.status(400).json({ error: 'Path parameter is required' });
      }
      await workspace.deleteFile(path);
      options?.onFileChange?.([{ path, type: 'delete' }]);
      options?.workspaceForwarder?.('/delete', 'DELETE', undefined, { path }).catch(err => {
        console.warn('[file-router] Workspace forward failed for delete:', err.message ?? err);
      });
      res.json({ success: true, path });
    } catch (error) {
      res.status(500).json({
        error: 'Failed to delete file',
        message: error instanceof Error ? error.message : String(error),
      });
    }
  });

  // Check if file exists
  router.get('/exists', async (req, res) => {
    try {
      const path = req.query.path as string;
      if (!path) {
        return res.status(400).json({ error: 'Path parameter is required' });
      }
      const exists = await workspace.fileExists(path);
      res.json({ path, exists });
    } catch (error) {
      res.status(500).json({
        error: 'Failed to check file existence',
        message: error instanceof Error ? error.message : String(error),
      });
    }
  });

  // Move/rename files or directories (supports batch)
  router.post('/move', async (req, res) => {
    try {
      const { entries } = req.body;
      if (!Array.isArray(entries) || entries.length === 0) {
        return res.status(400).json({ error: 'entries array is required' });
      }
      let moved = 0;
      const errors: string[] = [];
      for (const { src, dest } of entries) {
        try {
          await workspace.move(src, dest);
          moved++;
        } catch (err) {
          errors.push(`${src} → ${dest}: ${err instanceof Error ? err.message : String(err)}`);
        }
      }
      if (moved > 0) {
        const changes = entries.map((e: any) => [
          { path: e.src, type: 'delete' as const },
          { path: e.dest, type: 'change' as const },
        ]).flat();
        options?.onFileChange?.(changes);
      }
      options?.workspaceForwarder?.('/move', 'POST', { entries }).catch(err => {
        console.warn('[file-router] Workspace forward failed for move:', err.message ?? err);
      });
      res.json({ moved, errors });
    } catch (error) {
      res.status(500).json({
        error: 'Failed to move files',
        message: error instanceof Error ? error.message : String(error),
      });
    }
  });

  // Copy files or directories (supports batch)
  router.post('/copy', async (req, res) => {
    try {
      const { entries } = req.body;
      if (!Array.isArray(entries) || entries.length === 0) {
        return res.status(400).json({ error: 'entries array is required' });
      }
      let copied = 0;
      const errors: string[] = [];
      for (const { src, dest } of entries) {
        try {
          await workspace.copy(src, dest);
          copied++;
        } catch (err) {
          errors.push(`${src} → ${dest}: ${err instanceof Error ? err.message : String(err)}`);
        }
      }
      if (copied > 0) {
        const changes = entries.map((e: any) => ({ path: e.dest, type: 'change' as const }));
        options?.onFileChange?.(changes);
      }
      options?.workspaceForwarder?.('/copy', 'POST', { entries }).catch(err => {
        console.warn('[file-router] Workspace forward failed for copy:', err.message ?? err);
      });
      res.json({ copied, errors });
    } catch (error) {
      res.status(500).json({
        error: 'Failed to copy files',
        message: error instanceof Error ? error.message : String(error),
      });
    }
  });

  return router;
}
