import type { MockRunner } from '@antimatter/tool-integration';
import type { MockProvider } from '@antimatter/agent-framework';
import type { AgentResponse } from '@antimatter/agent-framework';

/**
 * Configure a MockRunner so that `tsc` returns success.
 */
export function setupSuccessfulBuild(runner: MockRunner): void {
  runner.registerMock('tsc', {
    stdout: 'Compilation successful',
    stderr: '',
    exitCode: 0,
  });
}

/**
 * Configure a MockRunner so that `tsc` returns failure with diagnostics.
 */
export function setupBuildWithErrors(runner: MockRunner): void {
  runner.registerMock('tsc', {
    stdout: '',
    stderr: [
      "src/index.ts(3,10): error TS2305: Module '\"./math\"' has no exported member 'foo'.",
      "src/utils.ts(8,1): error TS1005: ';' expected.",
    ].join('\n'),
    exitCode: 1,
  });
}

/**
 * Configure a MockRunner so that `vitest run` returns failure.
 */
export function setupTestFailure(runner: MockRunner): void {
  runner.registerMock(/vitest/, {
    stdout: [
      'FAIL tests/math.spec.ts',
      '  math',
      '    x should add two numbers',
      '      Expected: 5',
      '      Received: 6',
      '',
      'Tests: 1 failed, 4 passed, 5 total',
    ].join('\n'),
    stderr: '',
    exitCode: 1,
  });
}

/**
 * Register mock provider responses for an agent that reads files.
 */
export function setupAgentFileReadScenario(provider: MockProvider): void {
  const readResponse: AgentResponse = {
    content: 'I will read the file for you.',
    role: 'assistant',
    finishReason: 'tool_use',
    toolCalls: [
      {
        id: 'call-read-1',
        name: 'readFile',
        parameters: { path: 'src/math.ts' },
      },
    ],
  };

  const afterReadResponse: AgentResponse = {
    content: 'Here is the contents of src/math.ts. It contains arithmetic functions: add, subtract, multiply, and divide.',
    role: 'assistant',
    finishReason: 'stop',
  };

  provider.registerResponse('read src/math.ts', readResponse);
  provider.setDefaultResponse(afterReadResponse);
}

/**
 * Register mock provider responses for an agent that runs a build.
 */
export function setupAgentBuildScenario(provider: MockProvider): void {
  const buildResponse: AgentResponse = {
    content: 'I will run the build for you.',
    role: 'assistant',
    finishReason: 'tool_use',
    toolCalls: [
      {
        id: 'call-build-1',
        name: 'runBuild',
        parameters: {},
      },
    ],
  };

  const afterBuildResponse: AgentResponse = {
    content: 'The build completed successfully with no errors.',
    role: 'assistant',
    finishReason: 'stop',
  };

  provider.registerResponse('build the project', buildResponse);
  provider.setDefaultResponse(afterBuildResponse);
}
