import { Router } from 'express';
import { createAgent, createMockAgent } from '@antimatter/agent-framework';
import type { Message } from '@antimatter/agent-framework';

const router = Router();

// Create agent based on environment
const agent =
  process.env.ANTHROPIC_API_KEY
    ? createAgent('assistant', 'AI Assistant', 'claude')
    : createMockAgent('assistant', 'AI Assistant (Mock)', 'custom');

// Configure mock agent with sample responses if using mock
if (!process.env.ANTHROPIC_API_KEY) {
  const provider = (agent as any).provider;
  provider.registerResponse('hello', {
    content:
      'Hello! I\'m your AI assistant. I can help you with:\n\n- **Code review** - I can analyze your code for issues\n- **Documentation** - I can help write clear documentation\n- **Testing** - I can suggest test cases\n- **Refactoring** - I can recommend improvements\n\nWhat would you like help with?',
    role: 'assistant',
    finishReason: 'stop',
  });

  provider.registerResponse('help', {
    content:
      'I can assist with various development tasks:\n\n```typescript\n// Example: I can help explain code\nfunction fibonacci(n: number): number {\n  if (n <= 1) return n;\n  return fibonacci(n - 1) + fibonacci(n - 2);\n}\n```\n\nJust ask me anything about your code!',
    role: 'assistant',
    finishReason: 'stop',
  });

  provider.setDefaultResponse({
    content:
      'I understand you\'re asking about that. While I\'m currently in demo mode with limited responses, in the full version I can:\n\n- Analyze code and suggest improvements\n- Help write tests and documentation\n- Explain complex concepts\n- Assist with debugging\n\nTry saying "hello" or "help" to see example responses!',
    role: 'assistant',
    finishReason: 'stop',
  });
}

// Chat endpoint
router.post('/chat', async (req, res) => {
  try {
    const { message } = req.body as { message: string };

    if (!message) {
      return res.status(400).json({ error: 'Message is required' });
    }

    // Send to agent
    const result = await agent.chat(message);

    res.json({
      response: result.response.content,
      usage: result.usage,
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
    const history = agent.getConversationHistory();
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
    agent.clearConversation();
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({
      error: 'Failed to clear conversation history',
      message: error instanceof Error ? error.message : String(error),
    });
  }
});

export { router as agentRouter };
