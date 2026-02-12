import { describe, it, expect, beforeEach } from 'vitest';
import { ContextManager } from '../context/context-manager.js';
import type { Message } from '../types.js';

describe('ContextManager', () => {
  let manager: ContextManager;

  beforeEach(() => {
    manager = new ContextManager(1000, 10);
  });

  describe('message management', () => {
    it('should add and retrieve messages', () => {
      const message: Message = {
        role: 'user',
        content: 'Hello',
        timestamp: new Date().toISOString(),
      };

      manager.addMessage(message);

      const history = manager.getConversationHistory();

      expect(history.length).toBe(1);
      expect(history[0]).toEqual(message);
    });

    it('should add multiple messages', () => {
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
      ];

      manager.addMessages(messages);

      const history = manager.getConversationHistory();

      expect(history.length).toBe(2);
    });

    it('should get recent messages', () => {
      const messages: Message[] = Array.from({ length: 5 }, (_, i) => ({
        role: 'user' as const,
        content: `Message ${i}`,
        timestamp: new Date().toISOString(),
      }));

      manager.addMessages(messages);

      const recent = manager.getRecentMessages(2);

      expect(recent.length).toBe(2);
      expect(recent[0].content).toBe('Message 3');
      expect(recent[1].content).toBe('Message 4');
    });

    it('should clear history', () => {
      const message: Message = {
        role: 'user',
        content: 'Test',
        timestamp: new Date().toISOString(),
      };

      manager.addMessage(message);
      expect(manager.getConversationHistory().length).toBe(1);

      manager.clearHistory();
      expect(manager.getConversationHistory().length).toBe(0);
    });
  });

  describe('working memory', () => {
    it('should store and retrieve values', () => {
      manager.setMemory('key1', 'value1');
      manager.setMemory('key2', 42);

      expect(manager.getMemory('key1')).toBe('value1');
      expect(manager.getMemory('key2')).toBe(42);
    });

    it('should check if key exists', () => {
      manager.setMemory('exists', true);

      expect(manager.hasMemory('exists')).toBe(true);
      expect(manager.hasMemory('missing')).toBe(false);
    });

    it('should delete values', () => {
      manager.setMemory('key', 'value');
      expect(manager.hasMemory('key')).toBe(true);

      manager.deleteMemory('key');
      expect(manager.hasMemory('key')).toBe(false);
    });

    it('should get all memory as object', () => {
      manager.setMemory('a', 1);
      manager.setMemory('b', 2);

      const memory = manager.getWorkingMemory();

      expect(memory).toEqual({ a: 1, b: 2 });
    });

    it('should clear all memory', () => {
      manager.setMemory('key1', 'value1');
      manager.setMemory('key2', 'value2');

      manager.clearMemory();

      expect(manager.getWorkingMemory()).toEqual({});
    });
  });

  describe('context state', () => {
    it('should get complete context state', () => {
      const message: Message = {
        role: 'user',
        content: 'Test',
        timestamp: new Date().toISOString(),
      };

      manager.addMessage(message, 10);
      manager.setMemory('key', 'value');

      const state = manager.getContextState();

      expect(state.conversationHistory.length).toBe(1);
      expect(state.workingMemory).toEqual({ key: 'value' });
      expect(state.totalTokens).toBe(10);
    });

    it('should restore context state', () => {
      const state = {
        conversationHistory: [
          {
            role: 'user' as const,
            content: 'Restored',
            timestamp: new Date().toISOString(),
          },
        ],
        workingMemory: { restored: true },
        totalTokens: 50,
      };

      manager.restoreContextState(state);

      const newState = manager.getContextState();

      expect(newState.conversationHistory.length).toBe(1);
      expect(newState.conversationHistory[0].content).toBe('Restored');
      expect(newState.workingMemory).toEqual({ restored: true });
      expect(newState.totalTokens).toBe(50);
    });
  });

  describe('token management', () => {
    it('should track token count', () => {
      manager.updateTokenCount(100);
      expect(manager.getTokenCount()).toBe(100);

      manager.updateTokenCount(50);
      expect(manager.getTokenCount()).toBe(150);
    });

    it('should update token count when adding messages', () => {
      const message: Message = {
        role: 'user',
        content: 'Test',
        timestamp: new Date().toISOString(),
      };

      manager.addMessage(message, 25);

      expect(manager.getTokenCount()).toBe(25);
    });
  });

  describe('context pruning', () => {
    it('should prune when message count exceeds limit', () => {
      const maxMessages = 5;
      const pruningManager = new ContextManager(10000, maxMessages);

      // Add more messages than the limit
      for (let i = 0; i < 10; i++) {
        pruningManager.addMessage({
          role: 'user',
          content: `Message ${i}`,
          timestamp: new Date().toISOString(),
        });
      }

      const history = pruningManager.getConversationHistory();

      expect(history.length).toBeLessThanOrEqual(maxMessages);
    });

    it('should preserve system messages when pruning', () => {
      const pruningManager = new ContextManager(10000, 3);

      pruningManager.addMessage({
        role: 'system',
        content: 'System message',
        timestamp: new Date().toISOString(),
      });

      // Add many user messages
      for (let i = 0; i < 5; i++) {
        pruningManager.addMessage({
          role: 'user',
          content: `User ${i}`,
          timestamp: new Date().toISOString(),
        });
      }

      const history = pruningManager.getConversationHistory();
      const systemMessages = history.filter((m) => m.role === 'system');

      expect(systemMessages.length).toBe(1);
      expect(systemMessages[0].content).toBe('System message');
    });
  });

  describe('usage statistics', () => {
    it('should return usage stats', () => {
      manager.addMessage(
        {
          role: 'user',
          content: 'Test',
          timestamp: new Date().toISOString(),
        },
        100,
      );

      const stats = manager.getUsageStats();

      expect(stats.messageCount).toBe(1);
      expect(stats.maxMessages).toBe(10);
      expect(stats.tokenCount).toBe(100);
      expect(stats.maxTokens).toBe(1000);
      expect(stats.utilizationPercent).toBe(10);
    });

    it('should check if nearing capacity', () => {
      expect(manager.isNearingCapacity(0.8)).toBe(false);

      // Add 900 tokens (90% of 1000)
      manager.updateTokenCount(900);

      expect(manager.isNearingCapacity(0.8)).toBe(true);
    });
  });

  describe('reset', () => {
    it('should reset to initial state', () => {
      manager.addMessage({
        role: 'user',
        content: 'Test',
        timestamp: new Date().toISOString(),
      });
      manager.setMemory('key', 'value');
      manager.updateTokenCount(100);

      manager.reset();

      expect(manager.getConversationHistory().length).toBe(0);
      expect(manager.getWorkingMemory()).toEqual({});
      expect(manager.getTokenCount()).toBe(0);
    });
  });
});
