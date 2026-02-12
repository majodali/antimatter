import { describe, it, expect } from 'vitest';
import { AgentConfigBuilder, getRolePrompt, RolePrompts } from '../config-builder.js';
import type { AgentTool, Identifier } from '../types.js';

describe('AgentConfigBuilder', () => {
  describe('basic configuration', () => {
    it('should create builder with id and name', () => {
      const builder = AgentConfigBuilder.create('test-agent' as Identifier, 'Test Agent');
      const config = builder.withMockProvider().buildConfig();

      expect(config.id).toBe('test-agent');
      expect(config.name).toBe('Test Agent');
    });

    it('should set role', () => {
      const config = AgentConfigBuilder
        .create('agent' as Identifier, 'Agent')
        .withRole('implementer')
        .withMockProvider()
        .buildConfig();

      expect(config.role).toBe('implementer');
    });

    it('should set role with description', () => {
      const config = AgentConfigBuilder
        .create('agent' as Identifier, 'Agent')
        .withRole('custom', 'Custom role description')
        .withMockProvider()
        .buildConfig();

      expect(config.role).toBe('custom');
      expect(config.roleDescription).toBe('Custom role description');
    });
  });

  describe('provider configuration', () => {
    it('should configure Claude provider', () => {
      const config = AgentConfigBuilder
        .create('agent' as Identifier, 'Agent')
        .withClaudeProvider({ apiKey: 'test-key' })
        .buildConfig();

      expect(config.provider.type).toBe('claude');
      expect(config.provider.apiKey).toBe('test-key');
    });

    it('should configure Claude provider with options', () => {
      const config = AgentConfigBuilder
        .create('agent' as Identifier, 'Agent')
        .withClaudeProvider({
          apiKey: 'test-key',
          model: 'claude-3-opus-20240229',
          maxTokens: 2000,
          temperature: 0.7,
        })
        .buildConfig();

      expect(config.provider.model).toBe('claude-3-opus-20240229');
      expect(config.provider.maxTokens).toBe(2000);
      expect(config.provider.temperature).toBe(0.7);
    });

    it('should configure mock provider', () => {
      const config = AgentConfigBuilder
        .create('agent' as Identifier, 'Agent')
        .withMockProvider()
        .buildConfig();

      expect(config.provider.type).toBe('mock');
    });

    it('should configure mock provider with options', () => {
      const config = AgentConfigBuilder
        .create('agent' as Identifier, 'Agent')
        .withMockProvider({ maxTokens: 1000 })
        .buildConfig();

      expect(config.provider.type).toBe('mock');
      expect(config.provider.maxTokens).toBe(1000);
    });

    it('should throw if provider not configured', () => {
      const builder = AgentConfigBuilder.create('agent' as Identifier, 'Agent');

      expect(() => builder.buildConfig()).toThrow('Provider configuration is required');
    });
  });

  describe('context configuration', () => {
    it('should set context window size', () => {
      const config = AgentConfigBuilder
        .create('agent' as Identifier, 'Agent')
        .withContextWindow(50000)
        .withMockProvider()
        .buildConfig();

      expect(config.contextWindowSize).toBe(50000);
    });

    it('should set max conversation length', () => {
      const config = AgentConfigBuilder
        .create('agent' as Identifier, 'Agent')
        .withMaxConversationLength(200)
        .withMockProvider()
        .buildConfig();

      expect(config.maxConversationLength).toBe(200);
    });

    it('should set system prompt', () => {
      const prompt = 'You are a helpful assistant.';
      const config = AgentConfigBuilder
        .create('agent' as Identifier, 'Agent')
        .withSystemPrompt(prompt)
        .withMockProvider()
        .buildConfig();

      expect(config.systemPrompt).toBe(prompt);
    });
  });

  describe('tool configuration', () => {
    const testTool: AgentTool = {
      name: 'test-tool',
      description: 'Test tool',
      parameters: [],
      execute: async () => 'result',
    };

    it('should add single tool', () => {
      const config = AgentConfigBuilder
        .create('agent' as Identifier, 'Agent')
        .withTool(testTool)
        .withMockProvider()
        .buildConfig();

      expect(config.tools?.has('test-tool')).toBe(true);
    });

    it('should add multiple tools', () => {
      const tool2: AgentTool = {
        name: 'tool2',
        description: 'Tool 2',
        parameters: [],
        execute: async () => 'result2',
      };

      const config = AgentConfigBuilder
        .create('agent' as Identifier, 'Agent')
        .withTools([testTool, tool2])
        .withMockProvider()
        .buildConfig();

      expect(config.tools?.has('test-tool')).toBe(true);
      expect(config.tools?.has('tool2')).toBe(true);
    });

    it('should not include tools if none added', () => {
      const config = AgentConfigBuilder
        .create('agent' as Identifier, 'Agent')
        .withMockProvider()
        .buildConfig();

      expect(config.tools).toBeUndefined();
    });
  });

  describe('fluent API', () => {
    it('should chain multiple configuration calls', () => {
      const config = AgentConfigBuilder
        .create('agent' as Identifier, 'Agent')
        .withRole('implementer')
        .withMockProvider()
        .withContextWindow(50000)
        .withMaxConversationLength(100)
        .withSystemPrompt('Custom prompt')
        .buildConfig();

      expect(config.role).toBe('implementer');
      expect(config.contextWindowSize).toBe(50000);
      expect(config.maxConversationLength).toBe(100);
      expect(config.systemPrompt).toBe('Custom prompt');
    });
  });

  describe('build method', () => {
    it('should build agent with mock provider', () => {
      const agent = AgentConfigBuilder
        .create('agent' as Identifier, 'Agent')
        .withMockProvider()
        .build();

      expect(agent).toBeDefined();
      expect(agent.getConfig().id).toBe('agent');
    });
  });
});

describe('getRolePrompt', () => {
  it('should return base prompt for each role', () => {
    const roles = ['architect', 'implementer', 'reviewer', 'tester', 'documenter', 'custom'] as const;

    for (const role of roles) {
      const prompt = getRolePrompt(role);
      expect(prompt).toBe(RolePrompts[role]);
      expect(prompt.length).toBeGreaterThan(0);
    }
  });

  it('should append custom prompt', () => {
    const custom = 'Additional instructions';
    const prompt = getRolePrompt('implementer', custom);

    expect(prompt).toContain(RolePrompts.implementer);
    expect(prompt).toContain(custom);
  });

  it('should return base prompt when custom is not provided', () => {
    const prompt = getRolePrompt('reviewer');

    expect(prompt).toBe(RolePrompts.reviewer);
  });
});
