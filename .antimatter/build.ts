/**
 * Build Automation — declares modules and build rules for the Antimatter project.
 *
 * Modules declare the build artifacts: frontend SPA, API Lambda, workspace server.
 * Rules react to events: project:initialize installs deps, file:change triggers tsc.
 *
 * The esbuild bundler scripts (build-lambda.mjs, build-workspace-server.mjs) are
 * NOT replaced — they contain complex bundling config. Workflow rules call them
 * via wf.exec().
 */
import { defineWorkflow, type FileChangeEvent } from '@antimatter/workflow';

interface BuildState {
  deps: {
    status: 'pending' | 'installing' | 'ready' | 'failed';
    lastRun?: string;
  };
  compile: {
    status: 'pending' | 'running' | 'success' | 'failed';
    lastRun?: string;
  };
}

export default defineWorkflow<BuildState>((wf) => {

  // ---- Module declarations ----

  wf.module('frontend', {
    type: 'frontend',
    build: 'cd packages/ui && npx vite build',
    output: 'packages/ui/dist/client',
    outputType: 'directory',
  });

  wf.module('api-lambda', {
    type: 'lambda',
    build: 'node packages/ui/scripts/build-lambda.mjs',
    output: 'packages/ui/dist-lambda',
    outputType: 'directory',
  });

  wf.module('workspace-server', {
    type: 'lambda',
    build: 'node packages/ui/scripts/build-workspace-server.mjs',
    output: 'packages/ui/dist-workspace',
    outputType: 'directory',
  });

  // ---- Rules ----

  /**
   * project:initialize — runs once when no workflow state exists.
   * Installs dependencies idempotently (--frozen-lockfile).
   */
  wf.rule('project:init', 'Install dependencies on first run',
    (e) => e.type === 'project:initialize',
    async (_events, state) => {
      state.deps = { status: 'installing' };
      state.compile = { status: 'pending' };

      wf.log('Installing dependencies (npm ci)...');
      const result = await wf.exec('npm ci', {
        timeout: 300_000, // 5 minutes — large monorepo
      });

      if (result.exitCode === 0) {
        state.deps.status = 'ready';
        state.deps.lastRun = new Date().toISOString();
        wf.log(`Dependencies installed (${(result.durationMs / 1000).toFixed(1)}s)`);
        wf.emit({ type: 'build:deps-ready' });
      } else {
        state.deps.status = 'failed';
        wf.log(`npm ci failed (exit ${result.exitCode})`, 'error');
        if (result.stderr) {
          wf.log(result.stderr.slice(0, 500), 'error');
        }
      }
    },
  );

  /**
   * compile-on-change — runs tsc --build when TypeScript sources change.
   * Scoped to packages/**\/*.ts to avoid reacting to config files, scripts, etc.
   * Excludes .antimatter/ (workflow files are not project source).
   */
  wf.rule<FileChangeEvent>('compile-on-change', 'Type-check on .ts file change',
    (e) => {
      if (e.type !== 'file:change') return false;
      const path = String(e.path);
      // Only react to TypeScript source files in packages/
      if (!path.startsWith('packages/')) return false;
      if (!path.endsWith('.ts') && !path.endsWith('.tsx')) return false;
      // Skip declaration files and test fixtures
      if (path.endsWith('.d.ts')) return false;
      if (path.includes('__tests__/') || path.includes('.spec.')) return false;
      return true;
    },
    async (events, state) => {
      state.compile.status = 'running';
      wf.log(`Type-checking (${events.length} file(s) changed)...`);

      const result = await wf.exec('npx tsc --build', {
        timeout: 120_000, // 2 minutes
      });

      state.compile.status = result.exitCode === 0 ? 'success' : 'failed';
      state.compile.lastRun = new Date().toISOString();

      if (result.exitCode === 0) {
        wf.log(`Type-check passed (${(result.durationMs / 1000).toFixed(1)}s)`);
      } else {
        wf.log('Type-check failed', 'error');
        // Show first few lines of errors
        const lines = result.stdout.split('\n').filter(l => l.includes('error'));
        for (const line of lines.slice(0, 10)) {
          wf.log(line, 'error');
        }
      }
    },
  );
});
