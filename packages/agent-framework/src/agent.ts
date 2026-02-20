import type {
  AgentConfig,
  ChatOptions,
  AgentResult,
  Message,
  AgentResponse,
  AgentTool,
  ToolResult,
  StreamCallbacks,
} from './types.js';
import { AgentError } from './types.js';
import type { Provider } from './providers/base.js';
import { ContextManager } from './context/context-manager.js';

/**
 * Main agent class for AI-powered task execution.
 *
 * Combines:
 * - Provider (Claude, Mock) for AI inference
 * - Context Manager for conversation and memory
 * - Tool System for executing actions
 *
 * Usage:
 * ```typescript
 * const agent = new Agent(config, provider);
 * const result = await agent.chat('Analyze this code');
 * console.log(result.response.content);
 * ```
 */
export class Agent {
  private readonly contextManager: ContextManager;
  private readonly tools: Map<string, AgentTool>;

  constructor(
    private readonly config: AgentConfig,
    private readonly provider: Provider,
  ) {
    this.contextManager = new ContextManager(
      config.contextWindowSize || 100000,
      config.maxConversationLength || 100,
    );

    this.tools = new Map(config.tools || []);

    // Add system prompt to context if provided
    if (config.systemPrompt) {
      this.contextManager.addMessage({
        role: 'system',
        content: config.systemPrompt,
        timestamp: new Date().toISOString(),
      });
    }
  }

  /**
   * Send a chat message and get a response.
   *
   * Handles:
   * - Message formatting
   * - Tool execution
   * - Context management
   * - Multi-turn conversations with tools
   *
   * @param message - User message or chat options
   * @returns Agent result with response and updated context
   */
  async chat(
    message: string | ChatOptions,
  ): Promise<AgentResult> {
    const options = typeof message === 'string' ? { message } : message;

    // Restore context if provided
    if (options.context) {
      this.contextManager.restoreContextState(options.context);
    }

    // Add user message to context
    const userMessage: Message = {
      role: 'user',
      content: options.message,
      timestamp: new Date().toISOString(),
      metadata: options.metadata,
    };
    this.contextManager.addMessage(userMessage);

    // Determine tools to use
    const toolsToUse = options.tools || this.tools;

    // Execute with tool loop
    const result = await this.executeWithTools(
      toolsToUse,
      options.maxIterations || 5,
      options.stream,
      options.abortSignal,
    );

    return result;
  }

  /**
   * Execute agent with tool use loop.
   *
   * Continues calling the agent until:
   * - Agent returns without tool calls
   * - Max iterations reached
   * - Error occurs
   *
   * @param tools - Available tools
   * @param maxIterations - Maximum tool use iterations
   * @returns Agent result
   */
  private async executeWithTools(
    tools: ReadonlyMap<string, AgentTool>,
    maxIterations: number,
    stream?: StreamCallbacks,
    abortSignal?: AbortSignal,
  ): Promise<AgentResult> {
    let iterations = 0;
    const allToolResults: ToolResult[] = [];

    while (iterations < maxIterations) {
      iterations++;

      // Check for abort before each iteration
      if (abortSignal?.aborted) {
        throw new AgentError('Request aborted', this.config.id, 'execution-failed');
      }

      // Get conversation history
      const history = this.contextManager.getConversationHistory();

      // Call provider (prefer streaming when available)
      let response: AgentResponse;
      try {
        const chatOptions = { systemPrompt: this.config.systemPrompt, tools };
        if (stream && this.provider.chatStream) {
          response = await this.provider.chatStream(history, chatOptions, stream, abortSignal);
        } else {
          response = await this.provider.chat(history, chatOptions);
        }
      } catch (error) {
        throw new AgentError(
          `Provider error: ${error instanceof Error ? error.message : String(error)}`,
          this.config.id,
          'execution-failed',
        );
      }

      // Add response to context
      this.contextManager.addMessage({
        role: 'assistant',
        content: response.content,
        timestamp: new Date().toISOString(),
      });

      // Update token count
      if (response.usage) {
        this.contextManager.updateTokenCount(
          response.usage.inputTokens + response.usage.outputTokens,
        );
      }

      // Check if agent wants to use tools
      if (
        response.finishReason === 'tool_use' &&
        response.toolCalls &&
        response.toolCalls.length > 0
      ) {
        // Emit tool call events
        if (stream?.onToolCall) {
          for (const tc of response.toolCalls) {
            stream.onToolCall(tc);
          }
        }

        // Execute tools
        const toolResults = await this.executeTools(
          response.toolCalls,
          tools,
        );
        allToolResults.push(...toolResults);

        // Emit tool result events
        if (stream?.onToolResult) {
          for (const tr of toolResults) {
            stream.onToolResult(tr);
          }
        }

        // Add tool results to context
        for (const result of toolResults) {
          this.contextManager.addMessage({
            role: 'user',
            content: `Tool result (${result.toolCallId}): ${result.content}`,
            timestamp: new Date().toISOString(),
            metadata: {
              toolResult: true,
              toolCallId: result.toolCallId,
              isError: result.isError,
            },
          });
        }

        // Continue loop to get next response
        continue;
      }

      // No more tools to execute, return final result
      return {
        response,
        context: this.contextManager.getContextState(),
        toolResults: allToolResults.length > 0 ? allToolResults : undefined,
        iterations,
      };
    }

    // Max iterations reached
    throw new AgentError(
      `Max iterations (${maxIterations}) reached without completion`,
      this.config.id,
      'execution-failed',
    );
  }

  /**
   * Execute tool calls requested by the agent.
   *
   * @param toolCalls - Tool calls from agent response
   * @param tools - Available tools
   * @returns Tool execution results
   */
  private async executeTools(
    toolCalls: ReadonlyArray<{
      id: string;
      name: string;
      parameters: Record<string, unknown>;
    }>,
    tools: ReadonlyMap<string, AgentTool>,
  ): Promise<ToolResult[]> {
    const results: ToolResult[] = [];

    for (const call of toolCalls) {
      const tool = tools.get(call.name);

      if (!tool) {
        results.push({
          toolCallId: call.id,
          content: `Error: Tool '${call.name}' not found`,
          isError: true,
        });
        continue;
      }

      try {
        const result = await tool.execute(call.parameters);
        results.push({
          toolCallId: call.id,
          content: result,
          isError: false,
        });
      } catch (error) {
        results.push({
          toolCallId: call.id,
          content: `Error executing tool: ${error instanceof Error ? error.message : String(error)}`,
          isError: true,
        });
      }
    }

    return results;
  }

  /**
   * Get agent configuration.
   */
  getConfig(): AgentConfig {
    return this.config;
  }

  /**
   * Get current context state.
   */
  getContext(): ReturnType<typeof this.contextManager.getContextState> {
    return this.contextManager.getContextState();
  }

  /**
   * Get context usage statistics.
   */
  getUsageStats(): ReturnType<typeof this.contextManager.getUsageStats> {
    return this.contextManager.getUsageStats();
  }

  /**
   * Set a value in working memory.
   *
   * @param key - Memory key
   * @param value - Value to store
   */
  setMemory(key: string, value: unknown): void {
    this.contextManager.setMemory(key, value);
  }

  /**
   * Get a value from working memory.
   *
   * @param key - Memory key
   * @returns Stored value or undefined
   */
  getMemory<T = unknown>(key: string): T | undefined {
    return this.contextManager.getMemory<T>(key);
  }

  /**
   * Clear conversation history.
   */
  clearHistory(): void {
    this.contextManager.clearHistory();
  }

  /**
   * Clear working memory.
   */
  clearMemory(): void {
    this.contextManager.clearMemory();
  }

  /**
   * Reset agent to initial state.
   */
  reset(): void {
    this.contextManager.reset();

    // Re-add system prompt if configured
    if (this.config.systemPrompt) {
      this.contextManager.addMessage({
        role: 'system',
        content: this.config.systemPrompt,
        timestamp: new Date().toISOString(),
      });
    }
  }
}
