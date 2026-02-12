import type {
  Message,
  AgentResponse,
  ProviderConfig,
} from '../types.js';
import type { Provider, ChatRequestOptions } from './base.js';

/**
 * Mock provider for testing.
 *
 * Allows registering predefined responses and tracking conversation history.
 * Useful for unit tests and development without calling real AI APIs.
 *
 * Usage:
 * ```typescript
 * const mock = new MockProvider();
 * mock.registerResponse('Hello', {
 *   content: 'Hi there!',
 *   role: 'assistant',
 *   finishReason: 'stop',
 * });
 * const response = await mock.chat([{ role: 'user', content: 'Hello', timestamp: new Date().toISOString() }]);
 * ```
 */
export class MockProvider implements Provider {
  private readonly responses = new Map<string, AgentResponse>();
  private readonly conversationHistory: Message[] = [];
  private defaultResponse: AgentResponse;

  constructor(private readonly config: ProviderConfig = { type: 'mock' }) {
    this.defaultResponse = {
      content: 'Mock response',
      role: 'assistant',
      finishReason: 'stop',
      usage: {
        inputTokens: 10,
        outputTokens: 5,
      },
    };
  }

  /**
   * Register a mock response for a specific user message.
   *
   * When the user sends a message matching `userMessage`, the provider
   * will return the registered response.
   *
   * @param userMessage - User message to match (case-insensitive)
   * @param response - Response to return
   */
  registerResponse(userMessage: string, response: AgentResponse): void {
    this.responses.set(userMessage.toLowerCase().trim(), response);
  }

  /**
   * Set the default response for unregistered messages.
   *
   * @param response - Default response
   */
  setDefaultResponse(response: AgentResponse): void {
    this.defaultResponse = response;
  }

  /**
   * Send a chat request.
   *
   * Returns a registered response if the last user message matches,
   * otherwise returns the default response.
   */
  async chat(
    messages: readonly Message[],
    _options?: ChatRequestOptions,
  ): Promise<AgentResponse> {
    // Store messages in history
    for (const msg of messages) {
      this.conversationHistory.push(msg);
    }

    // Find the last user message
    const lastUserMessage = [...messages]
      .reverse()
      .find((m) => m.role === 'user');

    if (!lastUserMessage) {
      return this.defaultResponse;
    }

    // Look up registered response
    const key = lastUserMessage.content.toLowerCase().trim();
    const response = this.responses.get(key) || this.defaultResponse;

    // Store assistant response in history
    this.conversationHistory.push({
      role: 'assistant',
      content: response.content,
      timestamp: new Date().toISOString(),
    });

    return response;
  }

  /**
   * Count tokens in messages.
   *
   * Mock implementation uses simple word count estimation.
   */
  async countTokens(messages: readonly Message[]): Promise<number> {
    let totalWords = 0;
    for (const msg of messages) {
      // Rough estimation: 1 token ≈ 0.75 words
      const words = msg.content.split(/\s+/).length;
      totalWords += words;
    }
    return Math.ceil(totalWords * 1.33); // Convert words to tokens
  }

  /**
   * Get provider configuration.
   */
  getConfig(): ProviderConfig {
    return this.config;
  }

  /**
   * Get conversation history.
   *
   * @returns All messages sent to and received from the provider
   */
  getConversationHistory(): readonly Message[] {
    return [...this.conversationHistory];
  }

  /**
   * Clear conversation history.
   */
  clearHistory(): void {
    this.conversationHistory.length = 0;
  }

  /**
   * Clear all registered responses.
   */
  clearResponses(): void {
    this.responses.clear();
  }

  /**
   * Reset provider to initial state.
   */
  reset(): void {
    this.clearHistory();
    this.clearResponses();
  }
}
