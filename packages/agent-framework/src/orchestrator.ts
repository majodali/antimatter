import type { Agent } from './agent.js';
import type { AgentResult, StreamCallbacks, ChatOptions } from './types.js';
import { AgentError } from './types.js';

const HANDOFF_PATTERN = /\[HANDOFF:(\w+)\]/;
const MAX_HANDOFFS = 2;

export class Orchestrator {
  private readonly agents = new Map<string, Agent>();
  private activeRole: string;

  constructor(agents: Array<{ role: string; agent: Agent }>, defaultRole = 'implementer') {
    for (const { role, agent } of agents) {
      this.agents.set(role, agent);
    }
    this.activeRole = defaultRole;
  }

  getActiveRole(): string {
    return this.activeRole;
  }

  getAgent(role: string): Agent | undefined {
    return this.agents.get(role);
  }

  async chat(options: string | ChatOptions): Promise<AgentResult & { agentRole: string }> {
    const chatOptions = typeof options === 'string' ? { message: options } : options;
    let handoffs = 0;
    let currentRole = this.activeRole;

    while (handoffs <= MAX_HANDOFFS) {
      const agent = this.agents.get(currentRole);
      if (!agent) {
        throw new AgentError(
          `No agent found for role: ${currentRole}`,
          'orchestrator',
          'configuration-invalid',
        );
      }

      const result = await agent.chat(chatOptions);

      // Check for handoff signal in the response
      const match = result.response.content.match(HANDOFF_PATTERN);
      if (match && handoffs < MAX_HANDOFFS) {
        const nextRole = match[1];
        if (this.agents.has(nextRole)) {
          // Pass the response as context to the next agent
          handoffs++;
          currentRole = nextRole;
          this.activeRole = nextRole;

          // Feed the previous agent's response as input to the next agent
          const handoffMessage = `Previous agent (${currentRole}) said:\n${result.response.content.replace(HANDOFF_PATTERN, '').trim()}\n\nPlease continue from here.`;
          (chatOptions as any).message = handoffMessage;
          continue;
        }
      }

      this.activeRole = currentRole;
      return { ...result, agentRole: currentRole };
    }

    throw new AgentError(
      `Max handoffs (${MAX_HANDOFFS}) exceeded`,
      'orchestrator',
      'execution-failed',
    );
  }

  async chatStream(
    message: string,
    callbacks: StreamCallbacks & { onHandoff?: (fromRole: string, toRole: string) => void },
    abortSignal?: AbortSignal,
  ): Promise<AgentResult & { agentRole: string }> {
    let handoffs = 0;
    let currentRole = this.activeRole;
    let currentMessage = message;

    while (handoffs <= MAX_HANDOFFS) {
      const agent = this.agents.get(currentRole);
      if (!agent) {
        throw new AgentError(
          `No agent found for role: ${currentRole}`,
          'orchestrator',
          'configuration-invalid',
        );
      }

      const result = await agent.chat({
        message: currentMessage,
        stream: callbacks,
        abortSignal,
      });

      // Check for handoff
      const match = result.response.content.match(HANDOFF_PATTERN);
      if (match && handoffs < MAX_HANDOFFS) {
        const nextRole = match[1];
        if (this.agents.has(nextRole)) {
          const fromRole = currentRole;
          handoffs++;
          currentRole = nextRole;
          this.activeRole = nextRole;

          callbacks.onHandoff?.(fromRole, nextRole);

          currentMessage = `Previous agent (${fromRole}) said:\n${result.response.content.replace(HANDOFF_PATTERN, '').trim()}\n\nPlease continue from here.`;
          continue;
        }
      }

      this.activeRole = currentRole;
      return { ...result, agentRole: currentRole };
    }

    throw new AgentError(
      `Max handoffs (${MAX_HANDOFFS}) exceeded`,
      'orchestrator',
      'execution-failed',
    );
  }
}
