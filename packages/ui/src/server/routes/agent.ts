import { Router } from 'express';
import type { WorkspaceService } from '../services/workspace-service.js';

export function createAgentRouter(workspace: WorkspaceService): Router {
  const router = Router();

  // Chat endpoint
  router.post('/chat', async (req, res) => {
    try {
      const { message } = req.body as { message: string };

      if (!message) {
        return res.status(400).json({ error: 'Message is required' });
      }

      const result = await workspace.chat(message);

      res.json({
        response: result.response.content,
        usage: result.response.usage,
      });
    } catch (error) {
      res.status(500).json({
        error: 'Failed to process chat message',
        message: error instanceof Error ? error.message : String(error),
      });
    }
  });

  // Get conversation history
  router.get('/history', async (req, res) => {
    try {
      const history = workspace.getConversationHistory();
      res.json({ history });
    } catch (error) {
      res.status(500).json({
        error: 'Failed to get conversation history',
        message: error instanceof Error ? error.message : String(error),
      });
    }
  });

  // Clear conversation history
  router.delete('/history', async (req, res) => {
    try {
      workspace.clearConversationHistory();
      res.json({ success: true });
    } catch (error) {
      res.status(500).json({
        error: 'Failed to clear conversation history',
        message: error instanceof Error ? error.message : String(error),
      });
    }
  });

  return router;
}
