/**
 * Example workflow script — validates that the API types work as expected.
 * This is not a test — it's a type-checking fixture.
 */
import { defineWorkflow, type FileChangeEvent } from '../index.js';

// The project defines its own state shape.
interface ProjectState {
  compile: {
    status: 'pending' | 'running' | 'success' | 'failed';
    lastRun?: string;
    output?: string;
  };
  test: {
    status: 'pending' | 'running' | 'success' | 'failed';
    passed?: number;
    failed?: number;
  };
  deploy: {
    envId?: string;
    stackName?: string;
    websiteUrl?: string;
    status: 'idle' | 'deploying' | 'active' | 'destroying';
  };
}

export default defineWorkflow<ProjectState>((wf) => {

  // --- Initialize ---
  wf.rule('Initialize workflow state',
    (e) => e.type === 'project:initialize',
    (_events, state) => {
      state.compile = { status: 'pending' };
      state.test = { status: 'pending' };
      state.deploy = { status: 'idle' };
    },
  );

  // --- Compile (typed event — events are narrowed to FileChangeEvent[]) ---
  wf.rule<FileChangeEvent>('Compile TypeScript sources',
    (e) => e.type === 'file:change' && String(e.path).endsWith('.ts'),
    async (events, state) => {
      state.compile.status = 'running';
      // Type narrowing: events[0].path is string, not unknown
      wf.log(`Compiling (triggered by ${events.map(e => e.path).join(', ')})...`);

      const result = await wf.exec('tsc --build');
      state.compile.status = result.exitCode === 0 ? 'success' : 'failed';
      state.compile.lastRun = new Date().toISOString();
      state.compile.output = result.stdout;

      if (result.exitCode === 0) {
        wf.emit({ type: 'compile:success' });
      } else {
        wf.log('Compilation failed', 'error');
      }
    },
  );

  // --- Test ---
  wf.rule('Run tests after successful compile',
    (e) => e.type === 'compile:success',
    async (_events, state) => {
      state.test.status = 'running';

      const result = await wf.exec('vitest run --reporter=json', {
        cwd: 'packages/my-lib',
      });

      state.test.status = result.exitCode === 0 ? 'success' : 'failed';

      if (result.exitCode === 0) {
        wf.emit({ type: 'test:success' });
      }
    },
  );

  // --- Deploy ---
  wf.rule('Deploy dev environment after tests pass',
    (e) => e.type === 'test:success',
    async (_events, state) => {
      // Only auto-deploy if not already active
      if (state.deploy.status === 'active') return;

      state.deploy.status = 'deploying';
      state.deploy.envId = 'dev';

      const result = await wf.exec('cdk deploy AntimatterEnv-dev --outputs-file /tmp/outputs.json', {
        cwd: 'infrastructure',
      });

      if (result.exitCode === 0) {
        state.deploy.status = 'active';
        state.deploy.stackName = 'AntimatterEnv-dev';
        // In practice, parse outputs from file
        wf.emit({ type: 'deploy:success', envId: 'dev' });
        wf.log('Dev environment deployed');
      } else {
        state.deploy.status = 'idle';
        wf.log('Deployment failed', 'error');
      }
    },
  );

  // --- Teardown (manual trigger) ---
  wf.rule('Tear down dev environment',
    (e) => e.type === 'deploy:teardown',
    async (_events, state) => {
      if (!state.deploy.stackName) return;

      state.deploy.status = 'destroying';
      const result = await wf.exec(`cdk destroy ${state.deploy.stackName} --force`, {
        cwd: 'infrastructure',
      });

      if (result.exitCode === 0) {
        state.deploy = { status: 'idle' };
        wf.log('Environment torn down');
      }
    },
  );
});
