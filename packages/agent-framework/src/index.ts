// Core types
export type {
  AgentRole,
  AgentConfig,
  Message,
  AgentResponse,
  ToolCall,
  ToolResult,
  ProviderConfig,
  AgentTool,
  ToolParameter,
  ContextState,
  ChatOptions,
  AgentResult,
  StreamCallbacks,
} from './types.js';

// Error classes
export { AgentError, ProviderError, ContextError } from './types.js';

// Provider abstraction
export type { Provider, ChatRequestOptions } from './providers/base.js';

// Provider implementations
export { ClaudeProvider } from './providers/claude-provider.js';
export { MockProvider } from './providers/mock-provider.js';

// Context management
export { ContextManager } from './context/context-manager.js';
export { MemoryStore } from './context/memory-store.js';
export type { PersistentMemory } from './context/memory-store.js';

// Main agent class
export { Agent } from './agent.js';

// Multi-agent orchestration
export { Orchestrator } from './orchestrator.js';

// Configuration builder
export {
  AgentConfigBuilder,
  getRolePrompt,
  RolePrompts,
} from './config-builder.js';

// Agent tools
export {
  createReadFileTool,
  createWriteFileTool,
  createListFilesTool,
  createFileTools,
  createRunBuildTool,
  createRunTestsTool,
  createRunLintTool,
  createCustomTool,
} from './tools/index.js';
export type { RunBuildToolDeps, CustomToolDefinition } from './tools/index.js';

// Convenience function for creating agents
import { AgentConfigBuilder } from './config-builder.js';
import type { Identifier } from '@antimatter/project-model';
import type { AgentRole } from './types.js';

/**
 * Create an agent with Claude provider.
 *
 * Convenience function for quickly creating agents.
 *
 * @param id - Agent identifier
 * @param name - Agent name
 * @param apiKey - Anthropic API key
 * @param role - Optional agent role (defaults to 'custom')
 * @returns Configured agent instance
 */
export function createClaudeAgent(
  id: Identifier,
  name: string,
  apiKey: string,
  role: AgentRole = 'custom',
) {
  return AgentConfigBuilder.create(id, name)
    .withRole(role)
    .withClaudeProvider({ apiKey })
    .build();
}

/**
 * Create an agent with mock provider for testing.
 *
 * @param id - Agent identifier
 * @param name - Agent name
 * @param role - Optional agent role (defaults to 'custom')
 * @returns Configured agent instance
 */
export function createMockAgent(
  id: Identifier,
  name: string,
  role: AgentRole = 'custom',
) {
  return AgentConfigBuilder.create(id, name)
    .withRole(role)
    .withMockProvider()
    .build();
}
