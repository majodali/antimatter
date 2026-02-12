import type {
  Message,
  AgentResponse,
  ProviderConfig,
  AgentTool,
} from '../types.js';

/**
 * Base interface for AI providers.
 *
 * Providers implement the communication with specific AI services (Claude, GPT, etc.)
 * and handle API-specific details like authentication, rate limiting, and error handling.
 */
export interface Provider {
  /**
   * Send a chat request to the AI provider.
   *
   * @param messages - Conversation history
   * @param options - Provider-specific options
   * @returns Agent response with content and metadata
   */
  chat(
    messages: readonly Message[],
    options?: ChatRequestOptions,
  ): Promise<AgentResponse>;

  /**
   * Count tokens in a set of messages.
   *
   * Used for context window management and cost estimation.
   *
   * @param messages - Messages to count tokens for
   * @returns Estimated token count
   */
  countTokens(messages: readonly Message[]): Promise<number>;

  /**
   * Get the provider's configuration.
   */
  getConfig(): ProviderConfig;
}

/**
 * Options for chat requests to providers.
 */
export interface ChatRequestOptions {
  readonly systemPrompt?: string;
  readonly maxTokens?: number;
  readonly temperature?: number;
  readonly tools?: ReadonlyMap<string, AgentTool>;
  readonly stopSequences?: readonly string[];
}
