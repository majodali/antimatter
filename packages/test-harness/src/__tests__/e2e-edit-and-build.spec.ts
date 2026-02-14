import { describe, it, expect, beforeEach } from 'vitest';
import { createWorkspaceHarness, type WorkspaceHarness } from '../workspace-harness.js';
import { setupSuccessfulBuild, setupBuildWithErrors } from '../scenario-factory.js';

describe('E2E: Edit File & Build', () => {
  let harness: WorkspaceHarness;

  beforeEach(async () => {
    harness = await createWorkspaceHarness();
  });

  describe('successful build', () => {
    it('should build successfully after writing a file', async () => {
      setupSuccessfulBuild(harness.runner);

      await harness.writeFile('src/index.ts', 'export const updated = true;');

      // Only run the compile target (not the test target which depends on it)
      const results = await harness.executeBuild([harness.fixture.targets[0]]);

      const buildResult = results.get('build');
      expect(buildResult).toBeDefined();
      expect(buildResult!.status).toBe('success');
      expect(buildResult!.diagnostics).toHaveLength(0);
    });

    it('should report correct execution of build command', async () => {
      setupSuccessfulBuild(harness.runner);

      const results = await harness.executeBuild([harness.fixture.targets[0]]);
      expect(results.get('build')!.status).toBe('success');

      const commands = harness.runner.getExecutedCommands();
      expect(commands).toHaveLength(1);
      expect(commands[0].command).toBe('tsc');
    });
  });

  describe('build with errors', () => {
    it('should report diagnostics for bad code', async () => {
      setupBuildWithErrors(harness.runner);

      await harness.writeFile('src/index.ts', 'import { foo } from "./math";');

      const results = await harness.executeBuild([harness.fixture.targets[0]]);
      const buildResult = results.get('build')!;

      expect(buildResult.status).toBe('failure');
      expect(buildResult.diagnostics.length).toBeGreaterThan(0);

      const diag = buildResult.diagnostics[0];
      expect(diag.file).toBe('src/index.ts');
      expect(diag.line).toBe(3);
      expect(diag.code).toBe('TS2305');
    });
  });

  describe('build cache behavior', () => {
    it('should cache on unchanged files', async () => {
      setupSuccessfulBuild(harness.runner);

      // First build
      const results1 = await harness.executeBuild([harness.fixture.targets[0]]);
      expect(results1.get('build')!.status).toBe('success');
      expect(harness.runner.getExecutedCommands()).toHaveLength(1);

      harness.runner.clearHistory();

      // Second build — should be cached
      const results2 = await harness.executeBuild([harness.fixture.targets[0]]);
      expect(results2.get('build')!.status).toBe('cached');
      expect(harness.runner.getExecutedCommands()).toHaveLength(0);
    });

    it('should rebuild when files change', async () => {
      setupSuccessfulBuild(harness.runner);

      // First build
      await harness.executeBuild([harness.fixture.targets[0]]);
      harness.runner.clearHistory();

      // Modify a file
      await harness.writeFile('src/index.ts', 'export const changed = true;');

      // Second build — should rebuild
      const results = await harness.executeBuild([harness.fixture.targets[0]]);
      expect(results.get('build')!.status).toBe('success');
      expect(harness.runner.getExecutedCommands()).toHaveLength(1);
    });
  });
});
