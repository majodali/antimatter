import type { Identifier } from '@antimatter/project-model';

// Re-export Identifier for convenience
export type { Identifier } from '@antimatter/project-model';

/**
 * Standard agent roles for different development tasks.
 */
export type AgentRole =
  | 'architect' // System design and planning
  | 'implementer' // Code implementation
  | 'reviewer' // Code review and quality
  | 'tester' // Testing and validation
  | 'documenter' // Documentation writing
  | 'custom'; // User-defined role

/**
 * Message in a conversation.
 */
export interface Message {
  readonly role: 'user' | 'assistant' | 'system';
  readonly content: string;
  readonly timestamp: string;
  readonly metadata?: Readonly<Record<string, unknown>>;
}

/**
 * Response from an AI provider.
 */
export interface AgentResponse {
  readonly content: string;
  readonly role: 'assistant';
  readonly finishReason: 'stop' | 'max_tokens' | 'tool_use' | 'error';
  readonly usage?: {
    readonly inputTokens: number;
    readonly outputTokens: number;
  };
  readonly toolCalls?: readonly ToolCall[];
}

/**
 * Tool call requested by the agent.
 */
export interface ToolCall {
  readonly id: string;
  readonly name: string;
  readonly parameters: Readonly<Record<string, unknown>>;
}

/**
 * Result of a tool execution.
 */
export interface ToolResult {
  readonly toolCallId: string;
  readonly content: string;
  readonly isError?: boolean;
}

/**
 * Configuration for an AI provider.
 */
export interface ProviderConfig {
  readonly type: 'claude' | 'mock';
  readonly apiKey?: string;
  readonly model?: string;
  readonly maxTokens?: number;
  readonly temperature?: number;
  readonly options?: Readonly<Record<string, unknown>>;
}

/**
 * Configuration for an agent.
 */
export interface AgentConfig {
  readonly id: Identifier;
  readonly name: string;
  readonly role: AgentRole;
  readonly roleDescription?: string;
  readonly provider: ProviderConfig;
  readonly contextWindowSize?: number;
  readonly maxConversationLength?: number;
  readonly systemPrompt?: string;
  readonly tools?: ReadonlyMap<string, AgentTool>;
}

/**
 * Agent tool definition.
 */
export interface AgentTool {
  readonly name: string;
  readonly description: string;
  readonly parameters: ReadonlyArray<ToolParameter>;
  readonly execute: (
    params: Readonly<Record<string, unknown>>,
  ) => Promise<string>;
}

/**
 * Tool parameter definition.
 */
export interface ToolParameter {
  readonly name: string;
  readonly type: 'string' | 'number' | 'boolean' | 'object' | 'array';
  readonly description: string;
  readonly required: boolean;
  readonly default?: unknown;
}

/**
 * Context state for an agent conversation.
 */
export interface ContextState {
  readonly conversationHistory: readonly Message[];
  readonly workingMemory: Readonly<Record<string, unknown>>;
  readonly totalTokens: number;
}

/**
 * Callbacks for streaming chat responses.
 */
export interface StreamCallbacks {
  readonly onText?: (delta: string) => void;
  readonly onToolCall?: (toolCall: ToolCall) => void;
  readonly onToolResult?: (toolResult: ToolResult) => void;
}

/**
 * Options for chat requests.
 */
export interface ChatOptions {
  readonly message: string;
  readonly context?: ContextState;
  readonly tools?: ReadonlyMap<string, AgentTool>;
  readonly maxIterations?: number;
  readonly metadata?: Readonly<Record<string, unknown>>;
  readonly stream?: StreamCallbacks;
  readonly abortSignal?: AbortSignal;
}

/**
 * Result from agent execution.
 */
export interface AgentResult {
  readonly response: AgentResponse;
  readonly context: ContextState;
  readonly toolResults?: readonly ToolResult[];
  readonly iterations: number;
}

/**
 * Base error class for agent framework errors.
 */
export class AgentError extends Error {
  constructor(
    message: string,
    public readonly agentId: Identifier,
    public readonly reason:
      | 'configuration-invalid'
      | 'execution-failed'
      | 'tool-failed',
  ) {
    super(message);
    this.name = 'AgentError';
  }
}

/**
 * Error from an AI provider.
 */
export class ProviderError extends Error {
  constructor(
    message: string,
    public readonly provider: string,
    public readonly reason:
      | 'auth-failed'
      | 'rate-limit'
      | 'invalid-request'
      | 'api-error'
      | 'network-error',
    public readonly originalError?: Error,
  ) {
    super(message);
    this.name = 'ProviderError';
  }
}

/**
 * Error from context management.
 */
export class ContextError extends Error {
  constructor(
    message: string,
    public readonly reason:
      | 'context-too-large'
      | 'invalid-state'
      | 'storage-failed',
  ) {
    super(message);
    this.name = 'ContextError';
  }
}
