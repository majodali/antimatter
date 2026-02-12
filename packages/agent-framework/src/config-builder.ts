import type {
  AgentConfig,
  AgentRole,
  ProviderConfig,
  AgentTool,
  Identifier,
} from './types.js';
import type { Provider } from './providers/base.js';
import { ClaudeProvider } from './providers/claude-provider.js';
import { MockProvider } from './providers/mock-provider.js';
import { Agent } from './agent.js';

/**
 * Fluent API for building agent configurations.
 *
 * Provides a convenient way to configure agents with providers,
 * roles, tools, and context settings.
 *
 * Usage:
 * ```typescript
 * const agent = AgentConfigBuilder
 *   .create('my-agent', 'My Agent')
 *   .withRole('implementer')
 *   .withClaudeProvider({ apiKey: process.env.ANTHROPIC_API_KEY })
 *   .withTool(readFileTool)
 *   .withContextWindow(50000)
 *   .build();
 * ```
 */
export class AgentConfigBuilder {
  private id: Identifier;
  private name: string;
  private role: AgentRole = 'custom';
  private roleDescription?: string;
  private providerConfig?: ProviderConfig;
  private contextWindowSize?: number;
  private maxConversationLength?: number;
  private systemPrompt?: string;
  private tools: Map<string, AgentTool> = new Map();

  private constructor(id: Identifier, name: string) {
    this.id = id;
    this.name = name;
  }

  /**
   * Create a new agent configuration builder.
   *
   * @param id - Agent identifier
   * @param name - Agent display name
   * @returns Builder instance
   */
  static create(id: Identifier, name: string): AgentConfigBuilder {
    return new AgentConfigBuilder(id, name);
  }

  /**
   * Set agent role.
   *
   * @param role - Standard or custom role
   * @param description - Optional role description
   * @returns Builder instance
   */
  withRole(role: AgentRole, description?: string): this {
    this.role = role;
    this.roleDescription = description;
    return this;
  }

  /**
   * Configure Claude provider.
   *
   * @param config - Claude provider configuration
   * @returns Builder instance
   */
  withClaudeProvider(
    config: Omit<ProviderConfig, 'type'> & { apiKey: string },
  ): this {
    this.providerConfig = {
      type: 'claude',
      ...config,
    };
    return this;
  }

  /**
   * Configure mock provider for testing.
   *
   * @param config - Optional mock provider configuration
   * @returns Builder instance
   */
  withMockProvider(config?: Omit<ProviderConfig, 'type'>): this {
    this.providerConfig = {
      type: 'mock',
      ...config,
    };
    return this;
  }

  /**
   * Set custom provider configuration.
   *
   * @param config - Provider configuration
   * @returns Builder instance
   */
  withProvider(config: ProviderConfig): this {
    this.providerConfig = config;
    return this;
  }

  /**
   * Set context window size.
   *
   * @param size - Maximum tokens in context
   * @returns Builder instance
   */
  withContextWindow(size: number): this {
    this.contextWindowSize = size;
    return this;
  }

  /**
   * Set maximum conversation length.
   *
   * @param length - Maximum number of messages
   * @returns Builder instance
   */
  withMaxConversationLength(length: number): this {
    this.maxConversationLength = length;
    return this;
  }

  /**
   * Set system prompt.
   *
   * @param prompt - System prompt text
   * @returns Builder instance
   */
  withSystemPrompt(prompt: string): this {
    this.systemPrompt = prompt;
    return this;
  }

  /**
   * Add a tool to the agent.
   *
   * @param tool - Agent tool
   * @returns Builder instance
   */
  withTool(tool: AgentTool): this {
    this.tools.set(tool.name, tool);
    return this;
  }

  /**
   * Add multiple tools to the agent.
   *
   * @param tools - Array of agent tools
   * @returns Builder instance
   */
  withTools(tools: readonly AgentTool[]): this {
    for (const tool of tools) {
      this.tools.set(tool.name, tool);
    }
    return this;
  }

  /**
   * Build the agent configuration.
   *
   * @returns Agent configuration
   * @throws Error if provider is not configured
   */
  buildConfig(): AgentConfig {
    if (!this.providerConfig) {
      throw new Error('Provider configuration is required');
    }

    return {
      id: this.id,
      name: this.name,
      role: this.role,
      roleDescription: this.roleDescription,
      provider: this.providerConfig,
      contextWindowSize: this.contextWindowSize,
      maxConversationLength: this.maxConversationLength,
      systemPrompt: this.systemPrompt,
      tools: this.tools.size > 0 ? this.tools : undefined,
    };
  }

  /**
   * Build the agent with provider instance.
   *
   * @returns Configured agent instance
   */
  build(): Agent {
    const config = this.buildConfig();
    const provider = this.createProvider(config.provider);
    return new Agent(config, provider);
  }

  /**
   * Create a provider instance from configuration.
   *
   * @param config - Provider configuration
   * @returns Provider instance
   */
  private createProvider(config: ProviderConfig): Provider {
    switch (config.type) {
      case 'claude':
        return new ClaudeProvider(config);
      case 'mock':
        return new MockProvider(config);
      default:
        throw new Error(`Unsupported provider type: ${config.type}`);
    }
  }
}

/**
 * Create role-specific system prompts.
 */
export const RolePrompts: Record<AgentRole, string> = {
  architect: `You are an expert software architect. Your role is to:
- Design system architectures and component structures
- Make high-level technical decisions
- Create implementation plans
- Consider scalability, maintainability, and best practices
- Document architectural decisions and trade-offs`,

  implementer: `You are an expert software developer. Your role is to:
- Write clean, efficient, and well-tested code
- Follow best practices and coding standards
- Implement features according to specifications
- Write comprehensive unit and integration tests
- Document code with clear comments`,

  reviewer: `You are an expert code reviewer. Your role is to:
- Review code for correctness, clarity, and maintainability
- Identify bugs, security issues, and performance problems
- Suggest improvements and best practices
- Ensure code follows style guidelines and standards
- Provide constructive feedback`,

  tester: `You are an expert software tester. Your role is to:
- Design comprehensive test strategies
- Write unit, integration, and end-to-end tests
- Identify edge cases and potential bugs
- Verify functionality meets requirements
- Report issues clearly with reproduction steps`,

  documenter: `You are an expert technical writer. Your role is to:
- Write clear, comprehensive documentation
- Create API references and usage guides
- Explain complex concepts in simple terms
- Maintain consistency in documentation style
- Keep documentation up-to-date with code changes`,

  custom: `You are a helpful AI assistant.`,
};

/**
 * Get system prompt for a role.
 *
 * @param role - Agent role
 * @param customPrompt - Optional custom prompt to append
 * @returns System prompt
 */
export function getRolePrompt(
  role: AgentRole,
  customPrompt?: string,
): string {
  const basePrompt = RolePrompts[role];
  return customPrompt ? `${basePrompt}\n\n${customPrompt}` : basePrompt;
}
