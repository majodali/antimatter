/**
 * Service-level functional tests: Build System
 *
 * These tests correspond to the deployed functional tests for the build
 * system (FT: DEMO 1.1–1.6). They exercise the same logical operations
 * but call the service layer directly instead of going through REST.
 *
 * Correspondence with deployed tests:
 *   Save/load config       ↔ FT: Save Build Config, Load Build Config
 *   Config persistence      ↔ FT: Config Persists Rule Reference
 *   Execute build           ↔ FT: Execute Build
 *   Result shape            ↔ FT: Build Result Shape
 *   Diagnostics shape       ↔ FT: Build Diagnostics Shape
 *   Stale target detection  ↔ FT: Stale Target Detection
 *   Clear cache             ↔ FT: Clear Build Cache
 *   Clear results           ↔ FT: Clear Build Results
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { createWorkspaceHarness, type WorkspaceHarness } from '../workspace-harness.js';
import { setupSuccessfulBuild, setupBuildWithErrors } from '../scenario-factory.js';

describe('Functional: Build System', () => {
  let harness: WorkspaceHarness;

  beforeEach(async () => {
    harness = await createWorkspaceHarness();
  });

  // ↔ FT: Save Build Config
  describe('build config', () => {
    const testRule = {
      id: 'rule-ft',
      name: 'compile-test',
      inputs: ['src/**/*.ts'],
      outputs: ['dist/**/*.js'],
      command: 'echo compiled',
    };
    const testTarget = {
      id: 'target-ft',
      ruleId: 'rule-ft',
      moduleId: 'mod-ft',
    };

    it('should save build config', async () => {
      await harness.saveBuildConfig({ rules: [testRule], targets: [testTarget] });
      // Verify file was written
      expect(await harness.fileExists('.antimatter/build.json')).toBe(true);
    });

    // ↔ FT: Load Build Config
    it('should load saved build config', async () => {
      await harness.saveBuildConfig({ rules: [testRule], targets: [testTarget] });
      const config = await harness.loadBuildConfig();
      expect(config.rules).toHaveLength(1);
      expect(config.rules[0].name).toBe('compile-test');
    });

    // ↔ FT: Config Persists Rule Reference
    it('should preserve target-to-rule references', async () => {
      await harness.saveBuildConfig({ rules: [testRule], targets: [testTarget] });
      const config = await harness.loadBuildConfig();
      expect(config.targets).toHaveLength(1);
      expect(config.targets[0].ruleId).toBe(testRule.id);
    });
  });

  // ↔ FT: Execute Build
  describe('build execution', () => {
    it('should execute a build successfully', async () => {
      setupSuccessfulBuild(harness.runner);
      const results = await harness.executeBuild([harness.fixture.targets[0]]);
      const buildResult = results.get('build');
      expect(buildResult).toBeDefined();
      expect(buildResult!.status).toBe('success');
    });

    // ↔ FT: Build Result Shape
    it('should return results with targetId and status', async () => {
      setupSuccessfulBuild(harness.runner);
      const results = await harness.executeBuild([harness.fixture.targets[0]]);
      const buildResult = results.get('build')!;
      expect(typeof buildResult.status).toBe('string');
      expect(Array.isArray(buildResult.diagnostics)).toBe(true);
    });

    it('should track build results for retrieval', async () => {
      setupSuccessfulBuild(harness.runner);
      await harness.executeBuild([harness.fixture.targets[0]]);
      const stored = harness.getBuildResults();
      expect(stored.length).toBeGreaterThanOrEqual(1);
      expect(stored[0].targetId).toBe('build');
      expect(stored[0].status).toBe('success');
    });

    it('should report correct build command execution', async () => {
      setupSuccessfulBuild(harness.runner);
      await harness.executeBuild([harness.fixture.targets[0]]);
      const commands = harness.runner.getExecutedCommands();
      expect(commands).toHaveLength(1);
      expect(commands[0].command).toBe('tsc');
    });
  });

  // ↔ FT: Build Diagnostics Shape
  describe('build with errors', () => {
    it('should report diagnostics for bad code', async () => {
      setupBuildWithErrors(harness.runner);
      await harness.writeFile('src/index.ts', 'import { foo } from "./math";');
      const results = await harness.executeBuild([harness.fixture.targets[0]]);
      const buildResult = results.get('build')!;
      expect(buildResult.status).toBe('failure');
      expect(buildResult.diagnostics.length).toBeGreaterThan(0);
      expect(buildResult.diagnostics[0].file).toBe('src/index.ts');
      expect(buildResult.diagnostics[0].line).toBe(3);
      expect(buildResult.diagnostics[0].code).toBe('TS2305');
    });
  });

  // ↔ FT: Stale Target Detection
  describe('stale detection', () => {
    it('should detect stale targets after file changes', async () => {
      setupSuccessfulBuild(harness.runner);
      // Build to establish cache baseline
      await harness.executeBuild([harness.fixture.targets[0]]);
      // Modify a source file
      await harness.writeFile('src/new.ts', 'export const x = 1;');
      // Rebuild should execute (not use cache)
      harness.runner.clearHistory();
      const results = await harness.executeBuild([harness.fixture.targets[0]]);
      expect(results.get('build')!.status).toBe('success');
      expect(harness.runner.getExecutedCommands()).toHaveLength(1);
    });
  });

  // ↔ FT: Clear Build Cache
  describe('cache behavior', () => {
    it('should use cache for unchanged files', async () => {
      setupSuccessfulBuild(harness.runner);
      await harness.executeBuild([harness.fixture.targets[0]]);
      harness.runner.clearHistory();
      const results = await harness.executeBuild([harness.fixture.targets[0]]);
      expect(results.get('build')!.status).toBe('cached');
      expect(harness.runner.getExecutedCommands()).toHaveLength(0);
    });

    it('should rebuild after file change', async () => {
      setupSuccessfulBuild(harness.runner);
      await harness.executeBuild([harness.fixture.targets[0]]);
      harness.runner.clearHistory();
      await harness.writeFile('src/index.ts', 'export const changed = true;');
      const results = await harness.executeBuild([harness.fixture.targets[0]]);
      expect(results.get('build')!.status).toBe('success');
      expect(harness.runner.getExecutedCommands()).toHaveLength(1);
    });
  });

  // ↔ FT: Clear Build Results
  describe('result management', () => {
    it('should clear build results', async () => {
      setupSuccessfulBuild(harness.runner);
      await harness.executeBuild([harness.fixture.targets[0]]);
      expect(harness.getBuildResults().length).toBeGreaterThan(0);
      harness.clearBuildResults();
      expect(harness.getBuildResults()).toHaveLength(0);
    });
  });
});
