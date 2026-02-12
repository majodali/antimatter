/**
 * Simple example demonstrating @antimatter/agent-framework
 *
 * This example shows:
 * - Creating an agent with mock provider
 * - Having a conversation
 * - Using working memory
 * - Checking usage statistics
 */

import {
  createMockAgent,
  AgentConfigBuilder,
  MockProvider,
} from '../src/index.js';
import type { AgentTool } from '../src/index.js';

async function main() {
  console.log('🤖 Agent Framework Example\n');
  console.log('=' .repeat(50));

  // Example 1: Simple conversation with mock provider
  console.log('\n📝 Example 1: Simple Conversation\n');

  const agent = createMockAgent('chat-agent', 'Chat Agent', 'custom');

  // Configure mock responses (since we're not using real API)
  const provider = (agent as any).provider as MockProvider;
  provider.registerResponse('Hello', {
    content: 'Hi there! I\'m your AI assistant. How can I help you today?',
    role: 'assistant',
    finishReason: 'stop',
  });
  provider.registerResponse('What can you do?', {
    content: 'I can help with code reviews, implementation, testing, documentation, and architecture design!',
    role: 'assistant',
    finishReason: 'stop',
  });

  // Have a conversation
  let result = await agent.chat('Hello');
  console.log('User: Hello');
  console.log(`Agent: ${result.response.content}\n`);

  result = await agent.chat('What can you do?');
  console.log('User: What can you do?');
  console.log(`Agent: ${result.response.content}\n`);

  // Check conversation history
  const context = agent.getContext();
  console.log(`📊 Conversation has ${context.conversationHistory.length} messages`);
  console.log(`💾 Token count: ${context.totalTokens}\n`);

  // Example 2: Agent with working memory
  console.log('=' .repeat(50));
  console.log('\n📝 Example 2: Working Memory\n');

  agent.setMemory('user_preference', 'TypeScript');
  agent.setMemory('project_name', 'Antimatter');

  console.log('Stored in memory:');
  console.log(`  - User preference: ${agent.getMemory('user_preference')}`);
  console.log(`  - Project name: ${agent.getMemory('project_name')}\n`);

  // Example 3: Agent with tools
  console.log('=' .repeat(50));
  console.log('\n📝 Example 3: Agent with Tools\n');

  const calculatorTool: AgentTool = {
    name: 'calculator',
    description: 'Perform mathematical calculations',
    parameters: [
      {
        name: 'expression',
        type: 'string',
        description: 'Math expression to evaluate',
        required: true,
      },
    ],
    execute: async (params) => {
      const { expression } = params as { expression: string };
      // Simple safe evaluation for demo
      const result = eval(expression);
      return `Result: ${result}`;
    },
  };

  const toolAgent = AgentConfigBuilder
    .create('tool-agent', 'Tool Agent')
    .withRole('custom')
    .withMockProvider()
    .withTool(calculatorTool)
    .build();

  const toolProvider = (toolAgent as any).provider as MockProvider;

  // Simulate agent wanting to use tool
  toolProvider.registerResponse('Calculate 2 + 2', {
    content: '',
    role: 'assistant',
    finishReason: 'tool_use',
    toolCalls: [
      {
        id: 'call-1',
        name: 'calculator',
        parameters: { expression: '2 + 2' },
      },
    ],
  });

  // Then provide final response
  toolProvider.setDefaultResponse({
    content: 'The answer is 4!',
    role: 'assistant',
    finishReason: 'stop',
  });

  const toolResult = await toolAgent.chat('Calculate 2 + 2');
  console.log('User: Calculate 2 + 2');
  console.log(`Agent: ${toolResult.response.content}`);
  console.log(`Tool was called: ${toolResult.toolResults?.[0].content}`);
  console.log(`Iterations: ${toolResult.iterations}\n`);

  // Example 4: Role-based agent
  console.log('=' .repeat(50));
  console.log('\n📝 Example 4: Specialized Roles\n');

  const reviewer = createMockAgent(
    'code-reviewer',
    'Code Reviewer',
    'reviewer'
  );

  const reviewerProvider = (reviewer as any).provider as MockProvider;
  reviewerProvider.registerResponse('Review this code', {
    content: 'Code review: The code looks good! Consider adding error handling and unit tests.',
    role: 'assistant',
    finishReason: 'stop',
  });

  const reviewResult = await reviewer.chat('Review this code');
  console.log(`Role: ${reviewer.getConfig().role}`);
  console.log('User: Review this code');
  console.log(`Agent: ${reviewResult.response.content}\n`);

  // Example 5: Usage statistics
  console.log('=' .repeat(50));
  console.log('\n📝 Example 5: Usage Statistics\n');

  const stats = agent.getUsageStats();
  console.log('Agent Statistics:');
  console.log(`  - Messages: ${stats.messageCount}/${stats.maxMessages}`);
  console.log(`  - Tokens: ${stats.tokenCount}/${stats.maxTokens}`);
  console.log(`  - Utilization: ${stats.utilizationPercent}%\n`);

  console.log('=' .repeat(50));
  console.log('\n✅ All examples completed successfully!\n');
}

main().catch((error) => {
  console.error('Error running example:', error);
  process.exit(1);
});
