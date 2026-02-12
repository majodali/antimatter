import { Router } from 'express';
import { LocalFileSystem } from '@antimatter/filesystem';
import type { WorkspacePath } from '@antimatter/filesystem';

const router = Router();
const fs = new LocalFileSystem();

// List directory contents
router.get('/list', async (req, res) => {
  try {
    const path = (req.query.path as string) || '/';
    const entries = await fs.scanDirectory(path as WorkspacePath);
    res.json({ entries });
  } catch (error) {
    res.status(500).json({
      error: 'Failed to list directory',
      message: error instanceof Error ? error.message : String(error)
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
    const content = await fs.readFile(path as WorkspacePath);
    res.json({ path, content });
  } catch (error) {
    res.status(500).json({
      error: 'Failed to read file',
      message: error instanceof Error ? error.message : String(error)
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
    await fs.writeFile(path as WorkspacePath, content);
    res.json({ success: true, path });
  } catch (error) {
    res.status(500).json({
      error: 'Failed to write file',
      message: error instanceof Error ? error.message : String(error)
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
    await fs.deleteFile(path as WorkspacePath);
    res.json({ success: true, path });
  } catch (error) {
    res.status(500).json({
      error: 'Failed to delete file',
      message: error instanceof Error ? error.message : String(error)
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
    const exists = await fs.exists(path as WorkspacePath);
    res.json({ path, exists });
  } catch (error) {
    res.status(500).json({
      error: 'Failed to check file existence',
      message: error instanceof Error ? error.message : String(error)
    });
  }
});

export { router as fileRouter };
