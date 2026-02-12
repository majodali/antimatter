# @antimatter/agent-framework

AI agent integration and orchestration framework for the Antimatter development environment.

## Overview

The `agent-framework` package provides a flexible system for integrating AI agents into development workflows. It supports multiple AI providers (Claude, Mock), configurable agent roles, context management, and tool-based extensibility.

## Features

- **Multiple AI Providers**: Claude (via Anthropic API) and Mock (for testing)
- **Configurable Roles**: Architect, Implementer, Reviewer, Tester, Documenter, or Custom
- **Context Management**: Conversation history and working memory with automatic pruning
- **Tool System**: Extensible tool framework for agent capabilities
- **Type-Safe**: Full TypeScript support with comprehensive type definitions
- **Testing Support**: Mock provider and comprehensive test utilities

## Installation

```bash
pnpm install @antimatter/agent-framework
```

## Quick Start

### Creating an Agent

```typescript
import { createClaudeAgent } from '@antimatter/agent-framework';

// Create agent with Claude provider
const agent = createClaudeAgent(
  'my-agent',
  'My Agent',
  process.env.ANTHROPIC_API_KEY!,
  'implementer'
);

// Chat with the agent
const result = await agent.chat('Write a function to calculate fibonacci numbers');

console.log(result.response.content);
```

### Using the Configuration Builder

```typescript
import { AgentConfigBuilder } from '@antimatter/agent-framework';

const agent = AgentConfigBuilder
  .create('code-reviewer', 'Code Reviewer')
  .withRole('reviewer')
  .withClaudeProvider({
    apiKey: process.env.ANTHROPIC_API_KEY!,
    model: 'claude-3-5-sonnet-20241022',
    maxTokens: 4096,
    temperature: 0.7,
  })
  .withContextWindow(50000)
  .withSystemPrompt('Focus on code quality and best practices.')
  .build();
```

### Adding Tools

```typescript
import { AgentConfigBuilder } from '@antimatter/agent-framework';
import type { AgentTool } from '@antimatter/agent-framework';

const readFileTool: AgentTool = {
  name: 'read_file',
  description: 'Read contents of a file',
  parameters: [
    {
      name: 'path',
      type: 'string',
      description: 'File path to read',
      required: true,
    },
  ],
  execute: async (params) => {
    const { path } = params as { path: string };
    // Implementation here
    return 'File contents...';
  },
};

const agent = AgentConfigBuilder
  .create('file-agent', 'File Agent')
  .withRole('custom')
  .withClaudeProvider({ apiKey: process.env.ANTHROPIC_API_KEY! })
  .withTool(readFileTool)
  .build();

const result = await agent.chat('Read the file at src/index.ts');
```

### Using Mock Provider for Testing

```typescript
import { createMockAgent, MockProvider } from '@antimatter/agent-framework';

const agent = createMockAgent('test-agent', 'Test Agent');

// Configure mock responses
const provider = agent['provider'] as MockProvider;
provider.registerResponse('Hello', {
  content: 'Hi there!',
  role: 'assistant',
  finishReason: 'stop',
});

const result = await agent.chat('Hello');
// result.response.content === 'Hi there!'
```

## Agent Roles

The framework provides predefined roles with specialized system prompts:

- **architect**: System design and planning
- **implementer**: Code implementation
- **reviewer**: Code review and quality
- **tester**: Testing and validation
- **documenter**: Documentation writing
- **custom**: User-defined role

```typescript
import { getRolePrompt } from '@antimatter/agent-framework';

const prompt = getRolePrompt('implementer', 'Use TypeScript and follow SOLID principles.');
```

## Context Management

Agents automatically manage conversation history and working memory:

```typescript
// Store values in working memory
agent.setMemory('currentFile', 'src/index.ts');

// Retrieve from memory
const file = agent.getMemory<string>('currentFile');

// Get usage statistics
const stats = agent.getUsageStats();
console.log(`Token usage: ${stats.tokenCount}/${stats.maxTokens}`);

// Clear history but preserve memory
agent.clearHistory();

// Reset completely
agent.reset();
```

## Tool System

Create custom tools to extend agent capabilities:

```typescript
import type { AgentTool } from '@antimatter/agent-framework';

const calculatorTool: AgentTool = {
  name: 'calculator',
  description: 'Perform mathematical calculations',
  parameters: [
    {
      name: 'expression',
      type: 'string',
      description: 'Mathematical expression to evaluate',
      required: true,
    },
  ],
  execute: async (params) => {
    const { expression } = params as { expression: string };
    // Safe evaluation logic here
    return String(eval(expression));
  },
};
```

## API Reference

### Core Classes

#### `Agent`

Main agent class for AI-powered task execution.

- `chat(message: string | ChatOptions): Promise<AgentResult>` - Send message and get response
- `getConfig(): AgentConfig` - Get agent configuration
- `getContext(): ContextState` - Get current context state
- `getUsageStats()` - Get token usage statistics
- `setMemory(key: string, value: unknown): void` - Store in working memory
- `getMemory<T>(key: string): T | undefined` - Retrieve from working memory
- `clearHistory(): void` - Clear conversation history
- `clearMemory(): void` - Clear working memory
- `reset(): void` - Reset to initial state

#### `AgentConfigBuilder`

Fluent API for building agent configurations.

- `create(id: Identifier, name: string): AgentConfigBuilder` - Create builder
- `withRole(role: AgentRole, description?: string): this` - Set agent role
- `withClaudeProvider(config): this` - Configure Claude provider
- `withMockProvider(config?): this` - Configure mock provider
- `withContextWindow(size: number): this` - Set context window size
- `withMaxConversationLength(length: number): this` - Set max messages
- `withSystemPrompt(prompt: string): this` - Set system prompt
- `withTool(tool: AgentTool): this` - Add tool
- `withTools(tools: AgentTool[]): this` - Add multiple tools
- `build(): Agent` - Build agent instance

#### `ContextManager`

Manages conversation context and working memory.

- `addMessage(message: Message, tokenCount?: number): void` - Add message
- `getConversationHistory(): readonly Message[]` - Get all messages
- `getRecentMessages(count: number): readonly Message[]` - Get last N messages
- `setMemory(key: string, value: unknown): void` - Store in memory
- `getMemory<T>(key: string): T | undefined` - Retrieve from memory
- `getContextState(): ContextState` - Get full context state
- `restoreContextState(state: ContextState): void` - Restore context
- `getUsageStats()` - Get usage metrics
- `reset(): void` - Reset to initial state

### Providers

#### `ClaudeProvider`

Provider for Anthropic's Claude API.

#### `MockProvider`

Mock provider for testing.

- `registerResponse(userMessage: string, response: AgentResponse): void` - Register mock response
- `setDefaultResponse(response: AgentResponse): void` - Set default response
- `getConversationHistory(): readonly Message[]` - Get conversation history
- `clearHistory(): void` - Clear history
- `reset(): void` - Reset provider

## Error Handling

The framework provides specific error types:

```typescript
import { AgentError, ProviderError, ContextError } from '@antimatter/agent-framework';

try {
  const result = await agent.chat('Task');
} catch (error) {
  if (error instanceof ProviderError) {
    console.error('Provider error:', error.reason);
  } else if (error instanceof AgentError) {
    console.error('Agent error:', error.reason);
  } else if (error instanceof ContextError) {
    console.error('Context error:', error.reason);
  }
}
```

## Testing

The framework includes comprehensive test utilities:

```typescript
import { createMockAgent, MockProvider } from '@antimatter/agent-framework';

describe('My Feature', () => {
  it('should use agent', async () => {
    const agent = createMockAgent('test', 'Test');
    const provider = agent['provider'] as MockProvider;

    provider.registerResponse('Hello', {
      content: 'Response',
      role: 'assistant',
      finishReason: 'stop',
    });

    const result = await agent.chat('Hello');

    expect(result.response.content).toBe('Response');
  });
});
```

## License

MIT
