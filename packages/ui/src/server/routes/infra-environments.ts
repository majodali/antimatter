import { Router } from 'express';
import type { EnvironmentRegistryService } from '../services/environment-registry-service.js';

export function createInfraEnvironmentRouter(
  registry: EnvironmentRegistryService,
): Router {
  const router = Router();

  // GET / — list all environments (auto-refreshes 'destroying' statuses)
  router.get('/', async (_req, res) => {
    try {
      const environments = await registry.listEnvironments();
      res.json({ environments });
    } catch (error) {
      res.status(500).json({
        error: 'Failed to list environments',
        message: error instanceof Error ? error.message : String(error),
      });
    }
  });

  // POST / — register a new environment
  router.post('/', async (req, res) => {
    try {
      const { envId, stackName, outputs, description } = req.body;
      if (!envId || !stackName) {
        return res.status(400).json({
          error: 'envId and stackName are required',
        });
      }
      const env = await registry.registerEnvironment({
        envId,
        stackName,
        outputs: outputs ?? {},
        description,
      });
      res.status(201).json(env);
    } catch (error) {
      res.status(500).json({
        error: 'Failed to register environment',
        message: error instanceof Error ? error.message : String(error),
      });
    }
  });

  // POST /:envId/terminate — initiate CloudFormation stack deletion
  router.post('/:envId/terminate', async (req, res) => {
    try {
      await registry.terminateEnvironment(req.params.envId);
      res.json({ success: true });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const status = message.includes('not found') ? 404 : 500;
      res.status(status).json({
        error: 'Failed to terminate environment',
        message,
      });
    }
  });

  return router;
}
