/**
 * Integration example showing agent-framework with other Antimatter packages
 *
 * This demonstrates how the agent can interact with:
 * - Filesystem operations
 * - Build system
 * - Tool integration
 *
 * Note: This is a conceptual example showing future integration patterns
 */

import { AgentConfigBuilder, MockProvider } from '../src/index.js';
import type { AgentTool } from '../src/index.js';
import { MemoryFileSystem } from '@antimatter/filesystem';

async function main() {
  console.log('🔗 Integration Example\n');
  console.log('=' .repeat(50));

  // Create a memory filesystem for demonstration
  const fs = new MemoryFileSystem();

  // Simulate some project files
  await fs.writeFile('src/index.ts' as any, 'export const greeting = "Hello";');
  await fs.writeFile('src/utils.ts' as any, 'export function add(a: number, b: number) { return a + b; }');
  await fs.writeFile('README.md' as any, '# My Project\n\nA sample project.');

  console.log('\n📝 Example: Agent with Filesystem Tools\n');

  // Create filesystem tools
  const listFilesTool: AgentTool = {
    name: 'list_files',
    description: 'List files in a directory',
    parameters: [
      {
        name: 'path',
        type: 'string',
        description: 'Directory path',
        required: true,
      },
    ],
    execute: async (params) => {
      const { path } = params as { path: string };
      const entries = await fs.readDirectory(path as any);
      return `Files in ${path}:\n${entries.map(e => `- ${e.name}`).join('\n')}`;
    },
  };

  const readFileTool: AgentTool = {
    name: 'read_file',
    description: 'Read file contents',
    parameters: [
      {
        name: 'path',
        type: 'string',
        description: 'File path',
        required: true,
      },
    ],
    execute: async (params) => {
      const { path } = params as { path: string };
      const content = await fs.readFile(path as any);
      return `Content of ${path}:\n${new TextDecoder().decode(content)}`;
    },
  };

  const writeFileTool: AgentTool = {
    name: 'write_file',
    description: 'Write content to a file',
    parameters: [
      {
        name: 'path',
        type: 'string',
        description: 'File path',
        required: true,
      },
      {
        name: 'content',
        type: 'string',
        description: 'File content',
        required: true,
      },
    ],
    execute: async (params) => {
      const { path, content } = params as { path: string; content: string };
      await fs.writeFile(path as any, content);
      return `Successfully wrote to ${path}`;
    },
  };

  // Create agent with filesystem tools
  const agent = AgentConfigBuilder
    .create('dev-agent', 'Development Agent')
    .withRole('implementer')
    .withMockProvider()
    .withTools([listFilesTool, readFileTool, writeFileTool])
    .withSystemPrompt('You are a helpful development assistant with access to filesystem operations.')
    .build();

  const provider = (agent as any).provider as MockProvider;

  // Scenario 1: List files
  console.log('👤 User: List all files in the src directory\n');

  provider.registerResponse('List all files in the src directory', {
    content: '',
    role: 'assistant',
    finishReason: 'tool_use',
    toolCalls: [
      {
        id: 'call-1',
        name: 'list_files',
        parameters: { path: 'src' },
      },
    ],
  });

  provider.setDefaultResponse({
    content: 'I found 2 TypeScript files in the src directory: index.ts and utils.ts.',
    role: 'assistant',
    finishReason: 'stop',
  });

  const result1 = await agent.chat('List all files in the src directory');
  console.log(`🤖 Agent: ${result1.response.content}`);
  console.log(`   📁 Tool result: ${result1.toolResults?.[0].content}\n`);

  // Scenario 2: Read and analyze a file
  console.log('👤 User: Read the utils.ts file\n');

  provider.registerResponse('Read the utils.ts file', {
    content: '',
    role: 'assistant',
    finishReason: 'tool_use',
    toolCalls: [
      {
        id: 'call-2',
        name: 'read_file',
        parameters: { path: 'src/utils.ts' },
      },
    ],
  });

  provider.setDefaultResponse({
    content: 'The utils.ts file contains a simple add function that takes two numbers and returns their sum.',
    role: 'assistant',
    finishReason: 'stop',
  });

  const result2 = await agent.chat('Read the utils.ts file');
  console.log(`🤖 Agent: ${result2.response.content}`);
  console.log(`   📄 Tool result: ${result2.toolResults?.[0].content?.split('\n')[0]}...\n`);

  // Scenario 3: Create a new file
  console.log('👤 User: Create a new test file\n');

  provider.registerResponse('Create a new test file', {
    content: '',
    role: 'assistant',
    finishReason: 'tool_use',
    toolCalls: [
      {
        id: 'call-3',
        name: 'write_file',
        parameters: {
          path: 'src/utils.test.ts',
          content: 'import { add } from "./utils";\n\ntest("add", () => {\n  expect(add(2, 2)).toBe(4);\n});',
        },
      },
    ],
  });

  provider.setDefaultResponse({
    content: 'I\'ve created a test file for the utils module with a basic test case for the add function.',
    role: 'assistant',
    finishReason: 'stop',
  });

  const result3 = await agent.chat('Create a new test file');
  console.log(`🤖 Agent: ${result3.response.content}`);
  console.log(`   ✅ Tool result: ${result3.toolResults?.[0].content}\n`);

  // Verify the file was created
  const testFileExists = await fs.exists('src/utils.test.ts' as any);
  console.log(`🔍 Verification: Test file exists: ${testFileExists}\n`);

  // Show final statistics
  console.log('=' .repeat(50));
  console.log('\n📊 Session Statistics\n');

  const stats = agent.getUsageStats();
  console.log(`Messages: ${stats.messageCount}/${stats.maxMessages}`);
  console.log(`Total tool executions: ${[result1, result2, result3].filter(r => r.toolResults).length}`);
  console.log(`Files created: 1`);
  console.log(`Files read: 1`);
  console.log(`Directories listed: 1\n`);

  console.log('=' .repeat(50));
  console.log('\n✅ Integration example completed!\n');
  console.log('💡 This demonstrates how agents can interact with:');
  console.log('   - @antimatter/filesystem for file operations');
  console.log('   - @antimatter/tool-integration for running tools');
  console.log('   - @antimatter/build-system for build operations\n');
}

main().catch((error) => {
  console.error('Error running example:', error);
  process.exit(1);
});
