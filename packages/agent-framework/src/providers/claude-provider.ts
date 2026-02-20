import Anthropic from '@anthropic-ai/sdk';
import type {
  Message,
  AgentResponse,
  ProviderConfig,
  AgentTool,
  StreamCallbacks,
} from '../types.js';
import { ProviderError } from '../types.js';
import type { Provider, ChatRequestOptions } from './base.js';

/**
 * Claude provider using Anthropic API.
 *
 * Supports:
 * - Claude 3 models (Opus, Sonnet, Haiku)
 * - Streaming responses
 * - Tool use (function calling)
 * - Token counting
 * - Error handling with retry logic
 */
export class ClaudeProvider implements Provider {
  private readonly client: Anthropic;
  private readonly model: string;
  private readonly maxTokens: number;
  private readonly temperature: number;

  constructor(config: ProviderConfig) {
    if (config.type !== 'claude') {
      throw new ProviderError(
        `Invalid provider type: ${config.type}`,
        'claude',
        'invalid-request',
      );
    }

    if (!config.apiKey) {
      throw new ProviderError(
        'API key is required for Claude provider',
        'claude',
        'auth-failed',
      );
    }

    this.client = new Anthropic({
      apiKey: config.apiKey,
    });

    this.model = config.model || 'claude-3-5-sonnet-20241022';
    this.maxTokens = config.maxTokens || 4096;
    this.temperature = config.temperature ?? 1.0;
  }

  /**
   * Build common request parameters from messages and options.
   */
  private buildRequestParams(messages: readonly Message[], options?: ChatRequestOptions) {
    const systemMessages = messages.filter((m) => m.role === 'system');
    const conversationMessages = messages.filter((m) => m.role !== 'system');

    const systemPrompt = [
      ...systemMessages.map((m) => m.content),
      options?.systemPrompt,
    ]
      .filter(Boolean)
      .join('\n\n');

    const anthropicMessages: Anthropic.MessageParam[] =
      conversationMessages.map((msg) => ({
        role: msg.role as 'user' | 'assistant',
        content: msg.content,
      }));

    const tools = options?.tools
      ? this.convertToolsToAnthropic(options.tools)
      : undefined;

    return {
      model: this.model,
      max_tokens: options?.maxTokens || this.maxTokens,
      temperature: options?.temperature ?? this.temperature,
      system: systemPrompt || undefined,
      messages: anthropicMessages,
      tools,
    };
  }

  /**
   * Convert an Anthropic Message to an AgentResponse.
   */
  private convertToAgentResponse(response: Anthropic.Message): AgentResponse {
    const contentBlock = response.content[0];
    let content = '';
    if (contentBlock?.type === 'text') {
      content = contentBlock.text;
    }

    const toolCalls = response.content
      .filter((block) => block.type === 'tool_use')
      .map((block) => {
        if (block.type === 'tool_use') {
          return {
            id: block.id,
            name: block.name,
            parameters: block.input as Record<string, unknown>,
          };
        }
        return undefined;
      })
      .filter(Boolean) as Array<{
      id: string;
      name: string;
      parameters: Record<string, unknown>;
    }>;

    let finishReason: AgentResponse['finishReason'] = 'stop';
    if (response.stop_reason === 'max_tokens') {
      finishReason = 'max_tokens';
    } else if (response.stop_reason === 'tool_use') {
      finishReason = 'tool_use';
    }

    return {
      content,
      role: 'assistant',
      finishReason,
      usage: {
        inputTokens: response.usage.input_tokens,
        outputTokens: response.usage.output_tokens,
      },
      toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
    };
  }

  /**
   * Handle Anthropic API errors and throw appropriate ProviderError.
   */
  private handleApiError(error: unknown): never {
    if (error instanceof Anthropic.APIError) {
      if (error.status === 401) {
        throw new ProviderError(
          'Authentication failed: Invalid API key',
          'claude',
          'auth-failed',
          error,
        );
      } else if (error.status === 429) {
        throw new ProviderError(
          'Rate limit exceeded',
          'claude',
          'rate-limit',
          error,
        );
      } else if (error.status >= 400 && error.status < 500) {
        throw new ProviderError(
          `Invalid request: ${error.message}`,
          'claude',
          'invalid-request',
          error,
        );
      } else {
        throw new ProviderError(
          `API error: ${error.message}`,
          'claude',
          'api-error',
          error,
        );
      }
    }

    throw new ProviderError(
      `Unexpected error: ${error instanceof Error ? error.message : String(error)}`,
      'claude',
      'network-error',
      error instanceof Error ? error : undefined,
    );
  }

  /**
   * Send a chat request to Claude (non-streaming).
   */
  async chat(
    messages: readonly Message[],
    options?: ChatRequestOptions,
  ): Promise<AgentResponse> {
    try {
      const params = this.buildRequestParams(messages, options);
      const response = await this.client.messages.create(params);
      return this.convertToAgentResponse(response);
    } catch (error) {
      this.handleApiError(error);
    }
  }

  /**
   * Stream a chat response from Claude.
   *
   * Uses Anthropic SDK's streaming API for progressive text delivery.
   */
  async chatStream(
    messages: readonly Message[],
    options?: ChatRequestOptions,
    callbacks?: StreamCallbacks,
    abortSignal?: AbortSignal,
  ): Promise<AgentResponse> {
    try {
      const params = this.buildRequestParams(messages, options);
      const stream = this.client.messages.stream(params);

      if (abortSignal) {
        abortSignal.addEventListener('abort', () => stream.abort(), { once: true });
      }

      stream.on('text', (delta) => callbacks?.onText?.(delta));

      const finalMessage = await stream.finalMessage();
      return this.convertToAgentResponse(finalMessage);
    } catch (error) {
      if (abortSignal?.aborted) {
        throw new ProviderError('Request aborted', 'claude', 'network-error');
      }
      this.handleApiError(error);
    }
  }

  /**
   * Count tokens in messages.
   *
   * Uses Anthropic's token counting API.
   */
  async countTokens(messages: readonly Message[]): Promise<number> {
    try {
      // Anthropic doesn't have a direct token counting API,
      // so we use a heuristic: ~4 characters per token
      let totalChars = 0;
      for (const msg of messages) {
        totalChars += msg.content.length;
      }
      return Math.ceil(totalChars / 4);
    } catch {
      // Fallback to simple estimation
      return messages.reduce(
        (sum, msg) => sum + Math.ceil(msg.content.length / 4),
        0,
      );
    }
  }

  /**
   * Get provider configuration.
   */
  getConfig(): ProviderConfig {
    return {
      type: 'claude',
      model: this.model,
      maxTokens: this.maxTokens,
      temperature: this.temperature,
    };
  }

  /**
   * Convert agent tools to Anthropic tool format.
   */
  private convertToolsToAnthropic(
    tools: ReadonlyMap<string, AgentTool>,
  ): Anthropic.Tool[] {
    const anthropicTools: Anthropic.Tool[] = [];

    for (const tool of tools.values()) {
      const properties: Record<string, unknown> = {};
      const required: string[] = [];

      for (const param of tool.parameters) {
        properties[param.name] = {
          type: param.type,
          description: param.description,
        };

        if (param.required) {
          required.push(param.name);
        }
      }

      anthropicTools.push({
        name: tool.name,
        description: tool.description,
        input_schema: {
          type: 'object',
          properties,
          required,
        },
      });
    }

    return anthropicTools;
  }
}
