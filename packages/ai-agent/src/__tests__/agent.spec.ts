import { describe, it, expect, beforeEach } from 'vitest';
import { Agent } from '../agent.js';
import { MockProvider } from '../providers/mock-provider.js';
import type { AgentConfig, AgentTool, Identifier } from '../types.js';

describe('Agent', () => {
  let config: AgentConfig;
  let provider: MockProvider;

  beforeEach(() => {
    config = {
      id: 'test-agent' as Identifier,
      name: 'Test Agent',
      role: 'custom',
      provider: { type: 'mock' },
    };

    provider = new MockProvider();
  });

  describe('initialization', () => {
    it('should create agent with config', () => {
      const agent = new Agent(config, provider);

      expect(agent.getConfig()).toEqual(config);
    });

    it('should add system prompt to context if provided', () => {
      const configWithPrompt: AgentConfig = {
        ...config,
        systemPrompt: 'You are a test agent.',
      };

      const agent = new Agent(configWithPrompt, provider);
      const context = agent.getContext();

      expect(context.conversationHistory.length).toBe(1);
      expect(context.conversationHistory[0].role).toBe('system');
      expect(context.conversationHistory[0].content).toBe('You are a test agent.');
    });
  });

  describe('chat', () => {
    it('should send message and get response', async () => {
      const agent = new Agent(config, provider);

      provider.registerResponse('Hello', {
        content: 'Hi there!',
        role: 'assistant',
        finishReason: 'stop',
      });

      const result = await agent.chat('Hello');

      expect(result.response.content).toBe('Hi there!');
      expect(result.iterations).toBe(1);
    });

    it('should add messages to conversation history', async () => {
      const agent = new Agent(config, provider);

      await agent.chat('Test message');

      const context = agent.getContext();

      expect(context.conversationHistory.length).toBe(2); // User + assistant
      expect(context.conversationHistory[0].role).toBe('user');
      expect(context.conversationHistory[0].content).toBe('Test message');
      expect(context.conversationHistory[1].role).toBe('assistant');
    });

    it('should handle tool use', async () => {
      const tool: AgentTool = {
        name: 'test-tool',
        description: 'Test tool',
        parameters: [],
        execute: async () => 'Tool result',
      };

      const configWithTools: AgentConfig = {
        ...config,
        tools: new Map([['test-tool', tool]]),
      };

      const agent = new Agent(configWithTools, provider);

      // First response: agent wants to use tool
      provider.registerResponse('Use tool', {
        content: '',
        role: 'assistant',
        finishReason: 'tool_use',
        toolCalls: [
          {
            id: 'call-1',
            name: 'test-tool',
            parameters: {},
          },
        ],
      });

      // Second response after tool execution
      provider.setDefaultResponse({
        content: 'Tool executed successfully',
        role: 'assistant',
        finishReason: 'stop',
      });

      const result = await agent.chat('Use tool');

      expect(result.toolResults).toBeDefined();
      expect(result.toolResults?.length).toBe(1);
      expect(result.toolResults?.[0].content).toBe('Tool result');
      expect(result.iterations).toBe(2);
    });

    it('should handle tool errors', async () => {
      const tool: AgentTool = {
        name: 'error-tool',
        description: 'Tool that errors',
        parameters: [],
        execute: async () => {
          throw new Error('Tool failed');
        },
      };

      const configWithTools: AgentConfig = {
        ...config,
        tools: new Map([['error-tool', tool]]),
      };

      const agent = new Agent(configWithTools, provider);

      provider.registerResponse('Use tool', {
        content: '',
        role: 'assistant',
        finishReason: 'tool_use',
        toolCalls: [
          {
            id: 'call-1',
            name: 'error-tool',
            parameters: {},
          },
        ],
      });

      provider.setDefaultResponse({
        content: 'Handled error',
        role: 'assistant',
        finishReason: 'stop',
      });

      const result = await agent.chat('Use tool');

      expect(result.toolResults).toBeDefined();
      expect(result.toolResults?.[0].isError).toBe(true);
      expect(result.toolResults?.[0].content).toContain('Tool failed');
    });

    it('should handle unknown tools', async () => {
      const agent = new Agent(config, provider);

      provider.registerResponse('Use unknown', {
        content: '',
        role: 'assistant',
        finishReason: 'tool_use',
        toolCalls: [
          {
            id: 'call-1',
            name: 'unknown-tool',
            parameters: {},
          },
        ],
      });

      provider.setDefaultResponse({
        content: 'Done',
        role: 'assistant',
        finishReason: 'stop',
      });

      const result = await agent.chat('Use unknown');

      expect(result.toolResults?.[0].isError).toBe(true);
      expect(result.toolResults?.[0].content).toContain('not found');
    });

    it('should respect max iterations', async () => {
      const agent = new Agent(config, provider);

      // Always return tool use
      provider.setDefaultResponse({
        content: '',
        role: 'assistant',
        finishReason: 'tool_use',
        toolCalls: [
          {
            id: 'call-1',
            name: 'unknown',
            parameters: {},
          },
        ],
      });

      await expect(
        agent.chat({ message: 'Test', maxIterations: 2 }),
      ).rejects.toThrow('Max iterations');
    });
  });

  describe('memory management', () => {
    it('should store and retrieve memory', () => {
      const agent = new Agent(config, provider);

      agent.setMemory('key', 'value');

      expect(agent.getMemory('key')).toBe('value');
    });

    it('should clear memory', () => {
      const agent = new Agent(config, provider);

      agent.setMemory('key', 'value');
      agent.clearMemory();

      expect(agent.getMemory('key')).toBeUndefined();
    });
  });

  describe('history management', () => {
    it('should clear history', async () => {
      const agent = new Agent(config, provider);

      await agent.chat('Test');

      expect(agent.getContext().conversationHistory.length).toBeGreaterThan(0);

      agent.clearHistory();

      expect(agent.getContext().conversationHistory.length).toBe(0);
    });
  });

  describe('reset', () => {
    it('should reset to initial state', async () => {
      const agent = new Agent(config, provider);

      await agent.chat('Test');
      agent.setMemory('key', 'value');

      agent.reset();

      expect(agent.getContext().conversationHistory.length).toBe(0);
      expect(agent.getMemory('key')).toBeUndefined();
    });

    it('should preserve system prompt after reset', async () => {
      const configWithPrompt: AgentConfig = {
        ...config,
        systemPrompt: 'System message',
      };

      const agent = new Agent(configWithPrompt, provider);

      await agent.chat('Test');
      agent.reset();

      const context = agent.getContext();

      expect(context.conversationHistory.length).toBe(1);
      expect(context.conversationHistory[0].role).toBe('system');
    });
  });

  describe('usage statistics', () => {
    it('should return usage stats', async () => {
      const agent = new Agent(config, provider);

      await agent.chat('Test');

      const stats = agent.getUsageStats();

      expect(stats.messageCount).toBeGreaterThan(0);
      expect(stats.maxMessages).toBeDefined();
    });
  });
});
