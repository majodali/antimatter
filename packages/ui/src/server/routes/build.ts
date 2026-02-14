import { Router } from 'express';
import type { WorkspaceService } from '../services/workspace-service.js';
import type { BuildTarget, BuildRule } from '@antimatter/project-model';

export function createBuildRouter(workspace: WorkspaceService): Router {
  const router = Router();

  // Execute build targets
  router.post('/execute', async (req, res) => {
    try {
      const { targets, rules } = req.body as {
        targets: BuildTarget[];
        rules: BuildRule[];
      };

      if (!targets || !rules) {
        return res.status(400).json({ error: 'Targets and rules are required' });
      }

      // Convert rules array to map
      const rulesMap = new Map(rules.map((r) => [r.id, r]));

      const resultMap = await workspace.executeBuild(targets, rulesMap);
      const results = Array.from(resultMap.values());

      res.json({ results });
    } catch (error) {
      res.status(500).json({
        error: 'Failed to execute build',
        message: error instanceof Error ? error.message : String(error),
      });
    }
  });

  // Get build results
  router.get('/results', async (req, res) => {
    try {
      const targetId = req.query.targetId as string | undefined;

      if (targetId) {
        const result = workspace.getBuildResult(targetId);
        if (!result) {
          return res.status(404).json({ error: 'Build result not found' });
        }
        res.json({ result });
      } else {
        const results = workspace.getAllBuildResults();
        res.json({ results });
      }
    } catch (error) {
      res.status(500).json({
        error: 'Failed to get build results',
        message: error instanceof Error ? error.message : String(error),
      });
    }
  });

  // Clear build results
  router.delete('/results', async (req, res) => {
    try {
      workspace.clearBuildResults();
      res.json({ success: true });
    } catch (error) {
      res.status(500).json({
        error: 'Failed to clear build results',
        message: error instanceof Error ? error.message : String(error),
      });
    }
  });

  return router;
}
