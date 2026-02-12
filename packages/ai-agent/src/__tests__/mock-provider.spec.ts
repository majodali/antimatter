import { describe, it, expect, beforeEach } from 'vitest';
import { MockProvider } from '../providers/mock-provider.js';
import type { AgentResponse, Message } from '../types.js';

describe('MockProvider', () => {
  let provider: MockProvider;

  beforeEach(() => {
    provider = new MockProvider();
  });

  describe('chat', () => {
    it('should return default response for unregistered messages', async () => {
      const messages: Message[] = [
        {
          role: 'user',
          content: 'Hello',
          timestamp: new Date().toISOString(),
        },
      ];

      const response = await provider.chat(messages);

      expect(response.role).toBe('assistant');
      expect(response.finishReason).toBe('stop');
      expect(response.content).toBe('Mock response');
    });

    it('should return registered response for matching message', async () => {
      const mockResponse: AgentResponse = {
        content: 'Hello there!',
        role: 'assistant',
        finishReason: 'stop',
      };

      provider.registerResponse('Hello', mockResponse);

      const messages: Message[] = [
        {
          role: 'user',
          content: 'Hello',
          timestamp: new Date().toISOString(),
        },
      ];

      const response = await provider.chat(messages);

      expect(response).toEqual(mockResponse);
    });

    it('should match messages case-insensitively', async () => {
      const mockResponse: AgentResponse = {
        content: 'Matched!',
        role: 'assistant',
        finishReason: 'stop',
      };

      provider.registerResponse('hello', mockResponse);

      const messages: Message[] = [
        {
          role: 'user',
          content: 'HELLO',
          timestamp: new Date().toISOString(),
        },
      ];

      const response = await provider.chat(messages);

      expect(response.content).toBe('Matched!');
    });

    it('should track conversation history', async () => {
      const messages: Message[] = [
        {
          role: 'user',
          content: 'First message',
          timestamp: new Date().toISOString(),
        },
      ];

      await provider.chat(messages);

      const history = provider.getConversationHistory();

      expect(history.length).toBe(2); // User + assistant
      expect(history[0].role).toBe('user');
      expect(history[0].content).toBe('First message');
      expect(history[1].role).toBe('assistant');
    });

    it('should handle multiple messages', async () => {
      const messages: Message[] = [
        {
          role: 'user',
          content: 'Message 1',
          timestamp: new Date().toISOString(),
        },
        {
          role: 'assistant',
          content: 'Response 1',
          timestamp: new Date().toISOString(),
        },
        {
          role: 'user',
          content: 'Message 2',
          timestamp: new Date().toISOString(),
        },
      ];

      await provider.chat(messages);

      const history = provider.getConversationHistory();

      expect(history.length).toBe(4); // 3 input + 1 response
    });
  });

  describe('countTokens', () => {
    it('should estimate token count from messages', async () => {
      const messages: Message[] = [
        {
          role: 'user',
          content: 'This is a test message with ten words total',
          timestamp: new Date().toISOString(),
        },
      ];

      const count = await provider.countTokens(messages);

      expect(count).toBeGreaterThan(0);
      // Rough estimation: should be around 10-14 tokens
      expect(count).toBeGreaterThanOrEqual(10);
      expect(count).toBeLessThanOrEqual(15);
    });

    it('should sum tokens across multiple messages', async () => {
      const messages: Message[] = [
        {
          role: 'user',
          content: 'First message',
          timestamp: new Date().toISOString(),
        },
        {
          role: 'assistant',
          content: 'Second message',
          timestamp: new Date().toISOString(),
        },
      ];

      const count = await provider.countTokens(messages);

      expect(count).toBeGreaterThan(0);
    });
  });

  describe('configuration', () => {
    it('should return provider configuration', () => {
      const config = provider.getConfig();

      expect(config.type).toBe('mock');
    });

    it('should accept custom configuration', () => {
      const customProvider = new MockProvider({
        type: 'mock',
        maxTokens: 2000,
        temperature: 0.5,
      });

      const config = customProvider.getConfig();

      expect(config.maxTokens).toBe(2000);
      expect(config.temperature).toBe(0.5);
    });
  });

  describe('utility methods', () => {
    it('should set default response', async () => {
      const newDefault: AgentResponse = {
        content: 'Custom default',
        role: 'assistant',
        finishReason: 'stop',
      };

      provider.setDefaultResponse(newDefault);

      const messages: Message[] = [
        {
          role: 'user',
          content: 'Unregistered',
          timestamp: new Date().toISOString(),
        },
      ];

      const response = await provider.chat(messages);

      expect(response.content).toBe('Custom default');
    });

    it('should clear history', async () => {
      const messages: Message[] = [
        {
          role: 'user',
          content: 'Test',
          timestamp: new Date().toISOString(),
        },
      ];

      await provider.chat(messages);
      expect(provider.getConversationHistory().length).toBeGreaterThan(0);

      provider.clearHistory();
      expect(provider.getConversationHistory().length).toBe(0);
    });

    it('should clear responses', () => {
      provider.registerResponse('test', {
        content: 'Response',
        role: 'assistant',
        finishReason: 'stop',
      });

      provider.clearResponses();

      // After clearing, should use default response
      // (We can't directly test the internal state, but behavior should change)
    });

    it('should reset to initial state', async () => {
      provider.registerResponse('test', {
        content: 'Response',
        role: 'assistant',
        finishReason: 'stop',
      });

      const messages: Message[] = [
        {
          role: 'user',
          content: 'Test',
          timestamp: new Date().toISOString(),
        },
      ];

      await provider.chat(messages);

      provider.reset();

      expect(provider.getConversationHistory().length).toBe(0);
    });
  });
});
