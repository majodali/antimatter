import type { Message, ContextState } from '../types.js';

/**
 * Manages conversation context and working memory for agents.
 *
 * Features:
 * - Conversation history with message storage and retrieval
 * - Working memory for storing agent state
 * - Token counting and context window management
 * - Automatic history pruning when context exceeds limits
 */
export class ContextManager {
  private conversationHistory: Message[] = [];
  private workingMemory: Map<string, unknown> = new Map();
  private totalTokens = 0;

  constructor(
    private readonly maxContextTokens: number = 100000,
    private readonly maxConversationLength: number = 100,
  ) {}

  /**
   * Add a message to conversation history.
   *
   * @param message - Message to add
   * @param tokenCount - Optional token count for this message
   */
  addMessage(message: Message, tokenCount?: number): void {
    this.conversationHistory.push(message);

    if (tokenCount) {
      this.totalTokens += tokenCount;
    }

    // Prune if we exceed limits
    this.pruneIfNeeded();
  }

  /**
   * Add multiple messages to conversation history.
   *
   * @param messages - Messages to add
   */
  addMessages(messages: readonly Message[]): void {
    for (const msg of messages) {
      this.conversationHistory.push(msg);
    }
    this.pruneIfNeeded();
  }

  /**
   * Get the current conversation history.
   *
   * @returns All messages in chronological order
   */
  getConversationHistory(): readonly Message[] {
    return [...this.conversationHistory];
  }

  /**
   * Get the last N messages from conversation history.
   *
   * @param count - Number of messages to retrieve
   * @returns Last N messages
   */
  getRecentMessages(count: number): readonly Message[] {
    return this.conversationHistory.slice(-count);
  }

  /**
   * Store a value in working memory.
   *
   * @param key - Memory key
   * @param value - Value to store
   */
  setMemory(key: string, value: unknown): void {
    this.workingMemory.set(key, value);
  }

  /**
   * Retrieve a value from working memory.
   *
   * @param key - Memory key
   * @returns Stored value or undefined
   */
  getMemory<T = unknown>(key: string): T | undefined {
    return this.workingMemory.get(key) as T | undefined;
  }

  /**
   * Check if a key exists in working memory.
   *
   * @param key - Memory key
   * @returns true if key exists
   */
  hasMemory(key: string): boolean {
    return this.workingMemory.has(key);
  }

  /**
   * Delete a value from working memory.
   *
   * @param key - Memory key
   */
  deleteMemory(key: string): void {
    this.workingMemory.delete(key);
  }

  /**
   * Get all working memory as a plain object.
   *
   * @returns Working memory snapshot
   */
  getWorkingMemory(): Readonly<Record<string, unknown>> {
    return Object.fromEntries(this.workingMemory);
  }

  /**
   * Get current context state.
   *
   * @returns Full context state
   */
  getContextState(): ContextState {
    return {
      conversationHistory: this.getConversationHistory(),
      workingMemory: this.getWorkingMemory(),
      totalTokens: this.totalTokens,
    };
  }

  /**
   * Restore context from a saved state.
   *
   * @param state - Context state to restore
   */
  restoreContextState(state: ContextState): void {
    this.conversationHistory = [...state.conversationHistory];
    this.workingMemory = new Map(Object.entries(state.workingMemory));
    this.totalTokens = state.totalTokens;
  }

  /**
   * Update token count.
   *
   * @param tokens - Token count to add
   */
  updateTokenCount(tokens: number): void {
    this.totalTokens += tokens;
  }

  /**
   * Get current token count.
   *
   * @returns Total tokens in context
   */
  getTokenCount(): number {
    return this.totalTokens;
  }

  /**
   * Clear all conversation history.
   */
  clearHistory(): void {
    this.conversationHistory = [];
    this.totalTokens = 0;
  }

  /**
   * Clear all working memory.
   */
  clearMemory(): void {
    this.workingMemory.clear();
  }

  /**
   * Reset context manager to initial state.
   */
  reset(): void {
    this.clearHistory();
    this.clearMemory();
    this.totalTokens = 0;
  }

  /**
   * Prune conversation history if it exceeds limits.
   *
   * Removes oldest messages while preserving system messages.
   */
  private pruneIfNeeded(): void {
    // Check message count limit
    if (this.conversationHistory.length > this.maxConversationLength) {
      const excess =
        this.conversationHistory.length - this.maxConversationLength;

      // Preserve system messages, remove oldest user/assistant messages
      const systemMessages = this.conversationHistory.filter(
        (m) => m.role === 'system',
      );
      const nonSystemMessages = this.conversationHistory.filter(
        (m) => m.role !== 'system',
      );

      // Remove excess from oldest non-system messages
      const pruned = nonSystemMessages.slice(excess);

      this.conversationHistory = [...systemMessages, ...pruned];
    }

    // Check token limit
    if (this.totalTokens > this.maxContextTokens) {
      // Simple pruning: remove oldest messages until under limit
      // In production, this should be more sophisticated (e.g., summarization)
      const targetTokens = Math.floor(this.maxContextTokens * 0.8); // Prune to 80%

      while (
        this.totalTokens > targetTokens &&
        this.conversationHistory.length > 1
      ) {
        const removed = this.conversationHistory.shift();
        if (removed) {
          // Estimate tokens removed (rough approximation)
          const estimatedTokens = Math.ceil(removed.content.length / 4);
          this.totalTokens -= estimatedTokens;
        }
      }
    }
  }

  /**
   * Check if context is nearing capacity.
   *
   * @param threshold - Warning threshold (0-1)
   * @returns true if context exceeds threshold
   */
  isNearingCapacity(threshold = 0.8): boolean {
    const tokenThreshold = this.totalTokens > this.maxContextTokens * threshold;
    const messageThreshold =
      this.conversationHistory.length > this.maxConversationLength * threshold;

    return tokenThreshold || messageThreshold;
  }

  /**
   * Get context usage statistics.
   *
   * @returns Usage metrics
   */
  getUsageStats(): {
    messageCount: number;
    maxMessages: number;
    tokenCount: number;
    maxTokens: number;
    utilizationPercent: number;
  } {
    return {
      messageCount: this.conversationHistory.length,
      maxMessages: this.maxConversationLength,
      tokenCount: this.totalTokens,
      maxTokens: this.maxContextTokens,
      utilizationPercent: Math.round(
        (this.totalTokens / this.maxContextTokens) * 100,
      ),
    };
  }
}
