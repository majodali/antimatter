import { Router } from 'express';
import type { WorkspaceService } from '../services/workspace-service.js';

export function createActivityRouter(workspace: WorkspaceService): Router {
  const router = Router();

  // GET / — load activity log from persistent storage
  router.get('/', async (_req, res) => {
    try {
      const events = await workspace.loadActivityLog();
      res.json({ events });
    } catch (error) {
      console.error('Failed to load activity log:', error);
      res.status(500).json({ error: 'Failed to load activity log' });
    }
  });

  // PUT / — save activity log to persistent storage
  router.put('/', async (req, res) => {
    try {
      const { events } = req.body;
      if (!Array.isArray(events)) {
        return res.status(400).json({ error: 'events must be an array' });
      }
      await workspace.saveActivityLog(events);
      res.json({ success: true });
    } catch (error) {
      console.error('Failed to save activity log:', error);
      res.status(500).json({ error: 'Failed to save activity log' });
    }
  });

  return router;
}
