import { Router } from 'express';
import { runTests } from '../tests/test-runner.js';

export function createTestRouter(): Router {
  const router = Router();

  router.post('/run', async (req, res) => {
    try {
      const { apiBase, frontendBase, suite } = req.body as {
        apiBase?: string;
        frontendBase?: string;
        suite?: 'smoke' | 'functional' | 'all';
      };
      const response = await runTests(suite ?? 'all', apiBase, frontendBase);
      res.json(response);
    } catch (error) {
      res.status(500).json({
        error: 'Test run failed',
        message: error instanceof Error ? error.message : String(error),
      });
    }
  });

  return router;
}
