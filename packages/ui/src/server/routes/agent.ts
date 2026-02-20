import { Router } from 'express';
import type { WorkspaceService } from '../services/workspace-service.js';

export function createAgentRouter(workspace: WorkspaceService): Router {
  const router = Router();

  // Chat endpoint — supports both JSON and SSE streaming
  router.post('/chat', async (req, res) => {
    try {
      const { message } = req.body as { message: string };

      if (!message) {
        return res.status(400).json({ error: 'Message is required' });
      }

      const wantsStream = req.headers.accept === 'text/event-stream';

      if (wantsStream) {
        // SSE streaming response
        res.writeHead(200, {
          'Content-Type': 'text/event-stream',
          'Cache-Control': 'no-cache',
          Connection: 'keep-alive',
        });

        const abortController = new AbortController();
        req.on('close', () => abortController.abort());

        try {
          const result = await workspace.chatStream(
            message,
            {
              onText: (delta) => {
                res.write(`data: ${JSON.stringify({ type: 'text', delta })}\n\n`);
              },
              onToolCall: (toolCall) => {
                res.write(`data: ${JSON.stringify({ type: 'tool-call', toolCall })}\n\n`);
              },
              onToolResult: (toolResult) => {
                res.write(`data: ${JSON.stringify({ type: 'tool-result', toolResult })}\n\n`);
              },
              onHandoff: (fromRole, toRole) => {
                res.write(`data: ${JSON.stringify({ type: 'handoff', fromRole, toRole })}\n\n`);
              },
            },
            abortController.signal,
          );

          res.write(
            `data: ${JSON.stringify({
              type: 'done',
              response: result.response.content,
              usage: result.response.usage,
              agentRole: result.agentRole,
            })}\n\n`,
          );
        } catch (error) {
          if (!abortController.signal.aborted) {
            res.write(
              `data: ${JSON.stringify({
                type: 'error',
                error: error instanceof Error ? error.message : String(error),
              })}\n\n`,
            );
          }
        } finally {
          res.end();
        }
      } else {
        // Non-streaming JSON response (backward compatible)
        const result = await workspace.chat(message);
        res.json({
          response: result.response.content,
          usage: result.response.usage,
        });
      }
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

  // Get custom tool definitions
  router.get('/tools', async (req, res) => {
    try {
      const tools = await workspace.getCustomToolDefinitions();
      res.json({ tools });
    } catch (error) {
      res.status(500).json({
        error: 'Failed to get custom tools',
        message: error instanceof Error ? error.message : String(error),
      });
    }
  });

  // Save custom tool definitions
  router.put('/tools', async (req, res) => {
    try {
      const { tools } = req.body as { tools: any[] };
      await workspace.saveCustomToolDefinitions(tools);
      res.json({ success: true });
    } catch (error) {
      res.status(500).json({
        error: 'Failed to save custom tools',
        message: error instanceof Error ? error.message : String(error),
      });
    }
  });

  return router;
}
