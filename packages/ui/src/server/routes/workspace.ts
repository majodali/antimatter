/**
 * Workspace Routes — start, stop, and query EC2 workspace instances.
 *
 * These routes are called by the frontend to manage the per-project
 * EC2 instances that run the full workspace (terminal, file APIs, build, agent).
 */

import { Router } from 'express';
import { WorkspaceEc2Service } from '../services/workspace-ec2-service.js';
import type { WorkspaceEc2ServiceConfig } from '../services/workspace-ec2-service.js';

export function createWorkspaceRouter(config: WorkspaceEc2ServiceConfig): Router {
  const router = Router({ mergeParams: true });
  const service = new WorkspaceEc2Service(config);

  /**
   * POST /start — Start or return an existing workspace instance.
   * Returns connection info including sessionToken for WebSocket auth.
   */
  router.post('/start', async (req, res) => {
    try {
      const projectId = req.params.projectId;
      if (!projectId) {
        return res.status(400).json({ error: 'projectId is required' });
      }

      const info = await service.startWorkspace(projectId);
      res.json(info);
    } catch (error) {
      console.error('[workspace-route] Failed to start workspace:', error);
      res.status(500).json({
        error: 'Failed to start workspace',
        message: error instanceof Error ? error.message : String(error),
      });
    }
  });

  /**
   * GET /status — Get the current status of a project's workspace instance.
   * Used for polling during startup.
   */
  router.get('/status', async (req, res) => {
    try {
      const projectId = req.params.projectId;
      if (!projectId) {
        return res.status(400).json({ error: 'projectId is required' });
      }

      const info = await service.getWorkspaceStatus(projectId);
      if (!info) {
        return res.json({ status: 'STOPPED', projectId });
      }

      res.json(info);
    } catch (error) {
      console.error('[workspace-route] Failed to get workspace status:', error);
      res.status(500).json({
        error: 'Failed to get workspace status',
        message: error instanceof Error ? error.message : String(error),
      });
    }
  });

  /**
   * POST /stop — Stop a project's workspace instance.
   */
  router.post('/stop', async (req, res) => {
    try {
      const projectId = req.params.projectId;
      if (!projectId) {
        return res.status(400).json({ error: 'projectId is required' });
      }

      await service.stopWorkspace(projectId);
      res.json({ success: true });
    } catch (error) {
      console.error('[workspace-route] Failed to stop workspace:', error);
      res.status(500).json({
        error: 'Failed to stop workspace',
        message: error instanceof Error ? error.message : String(error),
      });
    }
  });

  return router;
}
