import { Router } from 'express';
import type { WorkspaceService } from '../services/workspace-service.js';

export interface AgentRouterOptions {
  /** Broadcast a message to all connected WebSocket clients for this project. */
  broadcast?: (msg: object) => void;
}

export function createAgentRouter(workspace: WorkspaceService, options?: AgentRouterOptions): Router {
  const router = Router();

  /**
   * POST /chat — fire-and-forget chat endpoint.
   *
   * Accepts a message, starts processing asynchronously, and returns immediately.
   * Chat events are broadcast over the WebSocket using canonical service-interface
   * event types (agents.chats.*). Falls back to synchronous JSON response when
   * no broadcast function is available (Lambda).
   */
  router.post('/chat', async (req, res) => {
    try {
      const { message } = req.body as { message: string };

      if (!message) {
        return res.status(400).json({ error: 'Message is required' });
      }

      if (options?.broadcast) {
        // Return immediately — events delivered via WebSocket
        res.json({ accepted: true });
        processChatMessage(message, workspace, options.broadcast);
      } else {
        // No broadcast — synchronous JSON response (Lambda/fallback)
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

  // Load persisted chat history from storage
  router.get('/chat/history', async (_req, res) => {
    try {
      const messages = await workspace.loadChatHistory();
      res.json({ messages });
    } catch (error) {
      console.error('Failed to load chat history:', error);
      res.status(500).json({ error: 'Failed to load chat history' });
    }
  });

  // Save chat history to persistent storage
  router.put('/chat/history', async (req, res) => {
    try {
      const { messages } = req.body;
      if (!Array.isArray(messages)) {
        return res.status(400).json({ error: 'messages must be an array' });
      }
      await workspace.saveChatHistory(messages);
      res.json({ success: true });
    } catch (error) {
      console.error('Failed to save chat history:', error);
      res.status(500).json({ error: 'Failed to save chat history' });
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

/**
 * Process a chat message asynchronously, broadcasting events over WebSocket.
 * Extracted so both REST POST and WebSocket send can use the same pipeline.
 *
 * Events use canonical service-interface types:
 * - agents.chats.message  — incremental text delta
 * - agents.chats.toolCall — tool invocation
 * - agents.chats.toolResult — tool execution result
 * - agents.chats.done     — completion with full response + usage
 * - agents.chats.error    — processing error
 */
export function processChatMessage(
  message: string,
  workspace: WorkspaceService,
  broadcast: (msg: object) => void,
): void {
  (async () => {
    try {
      const result = await workspace.chatStream(
        message,
        {
          onText: (delta) => {
            broadcast({ type: 'agents.chats.message', delta });
          },
          onToolCall: (toolCall) => {
            broadcast({ type: 'agents.chats.toolCall', toolCall });
          },
          onToolResult: (toolResult) => {
            broadcast({ type: 'agents.chats.toolResult', toolResult });
          },
          onHandoff: (fromRole, toRole) => {
            broadcast({ type: 'agents.chats.handoff', fromRole, toRole });
          },
        },
      );

      broadcast({
        type: 'agents.chats.done',
        response: result.response.content,
        usage: result.response.usage,
        agentRole: result.agentRole,
      });
    } catch (error) {
      broadcast({
        type: 'agents.chats.error',
        error: error instanceof Error ? error.message : String(error),
      });
    }
  })();
}
