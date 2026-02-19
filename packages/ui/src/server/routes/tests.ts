import { Router } from 'express';
import { runAllTests } from '../tests/smoke-tests.js';

export function createTestRouter(): Router {
  const router = Router();

  router.post('/run', async (req, res) => {
    try {
      const { apiBase, frontendBase } = req.body as {
        apiBase?: string;
        frontendBase?: string;
      };
      const response = await runAllTests(apiBase, frontendBase);
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
