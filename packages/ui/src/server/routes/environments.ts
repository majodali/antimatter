import { Router } from 'express';
import type { WorkspaceService } from '../services/workspace-service.js';
import { EnvironmentManager } from '../services/environment-manager.js';

export function createEnvironmentRouter(workspace: WorkspaceService): Router {
  const router = Router();
  const manager = new EnvironmentManager(workspace);

  // ---------------------------------------------------------------------------
  // Pipeline config
  // ---------------------------------------------------------------------------

  // GET /pipeline — get pipeline configuration
  router.get('/pipeline', async (_req, res) => {
    try {
      const pipeline = await manager.getPipeline();
      res.json(pipeline);
    } catch (error) {
      res.status(500).json({
        error: 'Failed to load pipeline',
        message: error instanceof Error ? error.message : String(error),
      });
    }
  });

  // PUT /pipeline — save pipeline configuration
  router.put('/pipeline', async (req, res) => {
    try {
      const pipeline = req.body;
      if (!pipeline.id || !pipeline.name || !Array.isArray(pipeline.stages)) {
        return res.status(400).json({
          error: 'Pipeline must have id, name, and stages array',
        });
      }
      await manager.savePipeline(pipeline);
      res.json({ success: true });
    } catch (error) {
      res.status(500).json({
        error: 'Failed to save pipeline',
        message: error instanceof Error ? error.message : String(error),
      });
    }
  });

  // ---------------------------------------------------------------------------
  // Full config (pipeline + environments + transitions)
  // ---------------------------------------------------------------------------

  // GET /config — get full environment config
  router.get('/config', async (_req, res) => {
    try {
      const config = await manager.loadConfig();
      res.json(config);
    } catch (error) {
      res.status(500).json({
        error: 'Failed to load environment config',
        message: error instanceof Error ? error.message : String(error),
      });
    }
  });

  // PUT /config — save full environment config
  router.put('/config', async (req, res) => {
    try {
      const { pipeline, environments, transitions } = req.body;
      if (!pipeline || !environments || !transitions) {
        return res.status(400).json({
          error: 'pipeline, environments, and transitions are required',
        });
      }
      await manager.saveConfig({ pipeline, environments, transitions });
      res.json({ success: true });
    } catch (error) {
      res.status(500).json({
        error: 'Failed to save environment config',
        message: error instanceof Error ? error.message : String(error),
      });
    }
  });

  // ---------------------------------------------------------------------------
  // Environment CRUD
  // ---------------------------------------------------------------------------

  // GET / — list all environments
  router.get('/', async (_req, res) => {
    try {
      const environments = await manager.listEnvironments();
      res.json({ environments });
    } catch (error) {
      res.status(500).json({
        error: 'Failed to list environments',
        message: error instanceof Error ? error.message : String(error),
      });
    }
  });

  // POST / — create a new environment
  router.post('/', async (req, res) => {
    try {
      const { name, stageId } = req.body as { name?: string; stageId?: string };
      if (!name) {
        return res.status(400).json({ error: 'name is required' });
      }
      const env = await manager.createEnvironment(name, stageId);
      res.status(201).json(env);
    } catch (error) {
      res.status(500).json({
        error: 'Failed to create environment',
        message: error instanceof Error ? error.message : String(error),
      });
    }
  });

  // GET /:envId — get a single environment
  router.get('/:envId', async (req, res) => {
    try {
      const env = await manager.getEnvironment(req.params.envId);
      if (!env) {
        return res.status(404).json({ error: 'Environment not found' });
      }
      res.json(env);
    } catch (error) {
      res.status(500).json({
        error: 'Failed to get environment',
        message: error instanceof Error ? error.message : String(error),
      });
    }
  });

  // DELETE /:envId — destroy an environment
  router.delete('/:envId', async (req, res) => {
    try {
      await manager.destroyEnvironment(req.params.envId);
      res.json({ success: true });
    } catch (error) {
      res.status(500).json({
        error: 'Failed to destroy environment',
        message: error instanceof Error ? error.message : String(error),
      });
    }
  });

  // ---------------------------------------------------------------------------
  // Stage execution
  // ---------------------------------------------------------------------------

  // POST /:envId/build — run stage build (with optional SSE streaming)
  router.post('/:envId/build', async (req, res) => {
    try {
      const { stageId } = req.body as { stageId?: string };

      // If no stageId, use the environment's current stage
      let targetStageId = stageId;
      if (!targetStageId) {
        const env = await manager.getEnvironment(req.params.envId);
        if (!env) return res.status(404).json({ error: 'Environment not found' });
        targetStageId = env.currentStageId;
      }

      const result = await manager.buildStage(req.params.envId, targetStageId);
      res.json(result);
    } catch (error) {
      res.status(500).json({
        error: 'Stage build failed',
        message: error instanceof Error ? error.message : String(error),
      });
    }
  });

  // POST /:envId/gate — run stage gate check
  router.post('/:envId/gate', async (req, res) => {
    try {
      const { stageId } = req.body as { stageId?: string };

      let targetStageId = stageId;
      if (!targetStageId) {
        const env = await manager.getEnvironment(req.params.envId);
        if (!env) return res.status(404).json({ error: 'Environment not found' });
        targetStageId = env.currentStageId;
      }

      const result = await manager.checkGate(req.params.envId, targetStageId);
      res.json(result);
    } catch (error) {
      res.status(500).json({
        error: 'Gate check failed',
        message: error instanceof Error ? error.message : String(error),
      });
    }
  });

  // POST /:envId/promote — gate + build next stage
  router.post('/:envId/promote', async (req, res) => {
    try {
      const transition = await manager.promote(req.params.envId);
      res.json(transition);
    } catch (error) {
      res.status(500).json({
        error: 'Promotion failed',
        message: error instanceof Error ? error.message : String(error),
      });
    }
  });

  // ---------------------------------------------------------------------------
  // Transitions
  // ---------------------------------------------------------------------------

  // GET /transitions — get all transitions (optionally filter by envId)
  router.get('/transitions/all', async (req, res) => {
    try {
      const envId = req.query.envId as string | undefined;
      const transitions = await manager.getTransitions(envId);
      res.json({ transitions });
    } catch (error) {
      res.status(500).json({
        error: 'Failed to get transitions',
        message: error instanceof Error ? error.message : String(error),
      });
    }
  });

  return router;
}
