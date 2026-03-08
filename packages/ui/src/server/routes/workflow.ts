import { Router } from 'express';
import type { WorkflowManager } from '../services/workflow-manager.js';

export function createWorkflowRouter(workflowManager: WorkflowManager): Router {
  const router = Router();

  // GET /state — current workflow state
  router.get('/state', (_req, res) => {
    try {
      const state = workflowManager.getState();
      res.json(state ?? { version: 0, state: null, updatedAt: null });
    } catch (error) {
      res.status(500).json({
        error: 'Failed to get workflow state',
        message: error instanceof Error ? error.message : String(error),
      });
    }
  });

  // POST /emit — manually emit a custom event
  router.post('/emit', async (req, res) => {
    try {
      const { event } = req.body as { event?: { type: string; [key: string]: unknown } };
      if (!event?.type) {
        return res.status(400).json({ error: 'event.type is required' });
      }
      const result = await workflowManager.emitEvent(event);
      res.json({ result });
    } catch (error) {
      res.status(500).json({
        error: 'Failed to emit workflow event',
        message: error instanceof Error ? error.message : String(error),
      });
    }
  });

  // GET /declarations — modules, targets, environments, rules + accumulated ruleResults
  router.get('/declarations', (_req, res) => {
    try {
      const declarations = workflowManager.getDeclarations();
      const persisted = workflowManager.getState();
      res.json({
        ...declarations,
        ruleResults: persisted?.ruleResults ?? {},
      });
    } catch (error) {
      res.status(500).json({
        error: 'Failed to get workflow declarations',
        message: error instanceof Error ? error.message : String(error),
      });
    }
  });

  // POST /run-rule/:ruleId — manually run a specific rule (skips predicate)
  router.post('/run-rule/:ruleId', async (req, res) => {
    try {
      const { ruleId } = req.params;
      if (!ruleId) {
        return res.status(400).json({ error: 'ruleId is required' });
      }
      const result = await workflowManager.runRule(ruleId);
      res.json({ result });
    } catch (error) {
      res.status(500).json({
        error: 'Failed to run workflow rule',
        message: error instanceof Error ? error.message : String(error),
      });
    }
  });

  // POST /reload — reload the workflow definition and state
  router.post('/reload', async (_req, res) => {
    try {
      await workflowManager.start();
      res.json({ success: true });
    } catch (error) {
      res.status(500).json({
        error: 'Failed to reload workflow',
        message: error instanceof Error ? error.message : String(error),
      });
    }
  });

  return router;
}
