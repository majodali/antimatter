import { Router } from 'express';
import type { WorkspaceService } from '../services/workspace-service.js';
import type { BuildRule } from '@antimatter/project-model';

export function createBuildRouter(
  workspace: WorkspaceService,
  options?: { onConfigSaved?: (rules: BuildRule[]) => void },
): Router {
  const router = Router();

  // Execute build rules (supports SSE streaming)
  router.post('/execute', async (req, res) => {
    try {
      let { rules } = req.body as {
        rules?: BuildRule[];
      };

      // If no rules provided, load from stored config
      if (!rules || rules.length === 0) {
        const config = await workspace.loadBuildConfig();
        rules = config.rules;
      }

      if (!rules || rules.length === 0) {
        return res.status(400).json({ error: 'No rules configured. Add build rules via the config editor or provide them in the request body.' });
      }

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
          const resultMap = await workspace.executeBuild(rules, onProgress);
          const results = Array.from(resultMap.values());
          res.write(`data: ${JSON.stringify({ type: 'build-complete', results })}\n\n`);
        } catch (error) {
          res.write(`data: ${JSON.stringify({ type: 'build-error', error: error instanceof Error ? error.message : String(error) })}\n\n`);
        }
        res.end();
      } else {
        const resultMap = await workspace.executeBuild(rules);
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
      const ruleId = req.query.ruleId as string | undefined;

      if (ruleId) {
        const result = workspace.getBuildResult(ruleId);
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
      const ruleId = req.query.ruleId as string | undefined;
      await workspace.clearBuildCache(ruleId);
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
      const { rules } = req.body as { rules: BuildRule[] };
      if (!rules) {
        return res.status(400).json({ error: 'Rules are required' });
      }
      await workspace.saveBuildConfig({ rules });
      options?.onConfigSaved?.(rules);
      res.json({ success: true });
    } catch (error) {
      res.status(500).json({
        error: 'Failed to save build config',
        message: error instanceof Error ? error.message : String(error),
      });
    }
  });

  // Get stale rules (for watch mode)
  router.get('/changes', async (req, res) => {
    try {
      const config = await workspace.loadBuildConfig();
      if (config.rules.length === 0) {
        return res.json({ staleRuleIds: [] });
      }
      const staleRuleIds = await workspace.getStaleRules(config.rules);
      res.json({ staleRuleIds });
    } catch (error) {
      res.status(500).json({
        error: 'Failed to check for changes',
        message: error instanceof Error ? error.message : String(error),
      });
    }
  });

  return router;
}
