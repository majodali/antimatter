import { Router } from 'express';
import { LocalFileSystem } from '@antimatter/filesystem';
import { SubprocessRunner } from '@antimatter/tool-integration';
import type { BuildTarget, BuildRule, BuildResult } from '@antimatter/project-model';

const router = Router();
const fs = new LocalFileSystem();
const runner = new SubprocessRunner();

// In-memory storage for build results (in production, this would be persisted)
const buildResults = new Map<string, BuildResult>();

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

    // Convert arrays to maps for the build executor
    const rulesMap = new Map(rules.map((r) => [r.id, r]));

    // For now, simulate build execution
    // When @antimatter/build-system is ready, use:
    // const { executeBuild } = await import('@antimatter/build-system');
    // const results = await executeBuild({ targets, rules: rulesMap, workspaceRoot: process.cwd(), fs, runner });

    // Simulate results
    const results = targets.map((target) => ({
      targetId: target.id,
      status: 'success' as const,
      startedAt: new Date().toISOString(),
      finishedAt: new Date(Date.now() + 1000).toISOString(),
      durationMs: 1000,
      diagnostics: [],
    }));

    // Store results
    results.forEach((result) => {
      buildResults.set(result.targetId, result);
    });

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
      const result = buildResults.get(targetId);
      if (!result) {
        return res.status(404).json({ error: 'Build result not found' });
      }
      res.json({ result });
    } else {
      // Return all results
      const results = Array.from(buildResults.values());
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
    buildResults.clear();
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({
      error: 'Failed to clear build results',
      message: error instanceof Error ? error.message : String(error),
    });
  }
});

export { router as buildRouter };
