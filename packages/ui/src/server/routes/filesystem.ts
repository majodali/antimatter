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

export interface FileRouterOptions {
  /** Returns the current explorerIgnore patterns for filtering file tree responses. */
  getExplorerIgnore?: () => string[];
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

  return router;
}
