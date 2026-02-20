import { Router } from 'express';
import type { WorkspaceService } from '../services/workspace-service.js';
import type { BuildTarget, BuildRule } from '@antimatter/project-model';

export function createBuildRouter(workspace: WorkspaceService): Router {
  const router = Router();

  // Execute build targets (supports SSE streaming)
  router.post('/execute', async (req, res) => {
    try {
      let { targets, rules } = req.body as {
        targets?: BuildTarget[];
        rules?: BuildRule[];
      };

      // If no targets/rules provided, load from stored config
      if (!targets || !rules || targets.length === 0) {
        const config = await workspace.loadBuildConfig();
        targets = targets && targets.length > 0 ? targets : config.targets;
        rules = rules && rules.length > 0 ? rules : config.rules;
      }

      if (!targets || !rules || targets.length === 0) {
        return res.status(400).json({ error: 'No targets configured. Add build targets via the config editor or provide them in the request body.' });
      }

      const rulesMap = new Map(rules.map((r) => [r.id, r]));

      // Check if client wants SSE streaming
      const wantsSSE = req.headers.accept === 'text/event-stream';

      if (wantsSSE) {
        res.writeHead(200, {
          'Content-Type': 'text/event-stream',
          'Cache-Control': 'no-cache',
          Connection: 'keep-alive',
        });

        const onProgress = (event: any) => {
          res.write(`data: ${JSON.stringify(event)}\n\n`);
        };

        try {
          const resultMap = await workspace.executeBuild(targets, rulesMap, onProgress);
          const results = Array.from(resultMap.values());
          res.write(`data: ${JSON.stringify({ type: 'build-complete', results })}\n\n`);
        } catch (error) {
          res.write(`data: ${JSON.stringify({ type: 'build-error', error: error instanceof Error ? error.message : String(error) })}\n\n`);
        }
        res.end();
      } else {
        const resultMap = await workspace.executeBuild(targets, rulesMap);
        const results = Array.from(resultMap.values());
        res.json({ results });
      }
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

  // Clear build cache
  router.delete('/cache', async (req, res) => {
    try {
      const targetId = req.query.targetId as string | undefined;
      await workspace.clearBuildCache(targetId);
      res.json({ success: true });
    } catch (error) {
      res.status(500).json({
        error: 'Failed to clear build cache',
        message: error instanceof Error ? error.message : String(error),
      });
    }
  });

  // Get build config
  router.get('/config', async (_req, res) => {
    try {
      const config = await workspace.loadBuildConfig();
      res.json(config);
    } catch (error) {
      res.status(500).json({
        error: 'Failed to load build config',
        message: error instanceof Error ? error.message : String(error),
      });
    }
  });

  // Save build config
  router.put('/config', async (req, res) => {
    try {
      const { rules, targets } = req.body as { rules: BuildRule[]; targets: BuildTarget[] };
      if (!rules || !targets) {
        return res.status(400).json({ error: 'Rules and targets are required' });
      }
      await workspace.saveBuildConfig({ rules, targets });
      res.json({ success: true });
    } catch (error) {
      res.status(500).json({
        error: 'Failed to save build config',
        message: error instanceof Error ? error.message : String(error),
      });
    }
  });

  // Get stale targets (for watch mode)
  router.get('/changes', async (req, res) => {
    try {
      const config = await workspace.loadBuildConfig();
      if (config.targets.length === 0 || config.rules.length === 0) {
        return res.json({ staleTargetIds: [] });
      }
      const rulesMap = new Map(config.rules.map((r) => [r.id, r]));
      const staleTargetIds = await workspace.getStaleTargets(config.targets, rulesMap);
      res.json({ staleTargetIds });
    } catch (error) {
      res.status(500).json({
        error: 'Failed to check for changes',
        message: error instanceof Error ? error.message : String(error),
      });
    }
  });

  return router;
}
