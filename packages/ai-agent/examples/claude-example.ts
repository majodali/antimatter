/**
 * Example using real Claude API
 *
 * To run this example:
 * 1. Set ANTHROPIC_API_KEY environment variable
 * 2. Run: npx tsx examples/claude-example.ts
 *
 * This example demonstrates:
 * - Creating agent with Claude provider
 * - Real AI conversations
 * - Token usage tracking
 */

import { createClaudeAgent, AgentConfigBuilder } from '../src/index.js';

async function main() {
  // Check for API key
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    console.error('❌ Error: ANTHROPIC_API_KEY environment variable not set');
    console.log('\nTo run this example:');
    console.log('  Windows: set ANTHROPIC_API_KEY=your-key-here');
    console.log('  Linux/Mac: export ANTHROPIC_API_KEY=your-key-here');
    console.log('\nThen run: npx tsx examples/claude-example.ts\n');
    process.exit(1);
  }

  console.log('🤖 Claude API Example\n');
  console.log('=' .repeat(50));

  // Example 1: Simple conversation
  console.log('\n📝 Example 1: Simple Conversation\n');

  const agent = createClaudeAgent(
    'assistant',
    'My Assistant',
    apiKey,
    'custom'
  );

  const result1 = await agent.chat('Hello! Please respond with a short greeting.');

  console.log('User: Hello! Please respond with a short greeting.');
  console.log(`Claude: ${result1.response.content}`);
  console.log(`\n📊 Tokens used: ${result1.response.usage?.inputTokens} in + ${result1.response.usage?.outputTokens} out\n`);

  // Example 2: Code review agent
  console.log('=' .repeat(50));
  console.log('\n📝 Example 2: Code Review\n');

  const reviewer = createClaudeAgent(
    'code-reviewer',
    'Code Reviewer',
    apiKey,
    'reviewer'
  );

  const codeToReview = `
function add(a, b) {
  return a + b;
}
`.trim();

  const result2 = await reviewer.chat(
    `Please review this JavaScript function in one sentence:\n\n${codeToReview}`
  );

  console.log('User: Review this function...');
  console.log(`Claude: ${result2.response.content}`);
  console.log(`\n📊 Tokens used: ${result2.response.usage?.inputTokens} in + ${result2.response.usage?.outputTokens} out\n`);

  // Example 3: Multi-turn conversation
  console.log('=' .repeat(50));
  console.log('\n📝 Example 3: Multi-turn Conversation\n');

  const chatAgent = AgentConfigBuilder
    .create('chat', 'Chat Agent')
    .withRole('custom')
    .withClaudeProvider({
      apiKey,
      model: 'claude-3-5-sonnet-20241022',
      maxTokens: 1024,
      temperature: 0.7,
    })
    .withSystemPrompt('You are a helpful assistant. Keep responses brief.')
    .build();

  const msg1 = await chatAgent.chat('What is 2 + 2?');
  console.log('User: What is 2 + 2?');
  console.log(`Claude: ${msg1.response.content}\n`);

  const msg2 = await chatAgent.chat('Now multiply that by 3');
  console.log('User: Now multiply that by 3');
  console.log(`Claude: ${msg2.response.content}\n`);

  // Show context
  const context = chatAgent.getContext();
  console.log(`📊 Conversation has ${context.conversationHistory.length} messages`);
  console.log(`💾 Total tokens: ${context.totalTokens}\n`);

  // Example 4: Usage statistics
  console.log('=' .repeat(50));
  console.log('\n📝 Example 4: Final Statistics\n');

  const stats = chatAgent.getUsageStats();
  console.log('Agent Statistics:');
  console.log(`  - Messages: ${stats.messageCount}/${stats.maxMessages}`);
  console.log(`  - Tokens: ${stats.tokenCount}/${stats.maxTokens}`);
  console.log(`  - Utilization: ${stats.utilizationPercent}%\n`);

  console.log('=' .repeat(50));
  console.log('\n✅ All examples completed successfully!\n');
}

main().catch((error) => {
  console.error('Error running example:', error);
  if (error.name === 'ProviderError') {
    console.error(`\nProvider error: ${error.message}`);
    console.error(`Reason: ${error.reason}`);
  }
  process.exit(1);
});
