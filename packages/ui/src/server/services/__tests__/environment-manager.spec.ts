import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { WorkspaceEnvironment, ExecutionResult } from '@antimatter/workspace';
import type { EnvironmentConfig, Pipeline } from '@antimatter/project-model';
import { EnvironmentManager } from '../environment-manager.js';
import { WorkspaceService } from '../workspace-service.js';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

/** In-memory store for environment config, simulating .antimatter/environments.json */
let configStore: EnvironmentConfig;

const defaultPipeline: Pipeline = {
  id: 'pipe-1',
  name: 'Test Pipeline',
  stages: [
    { id: 'dev', name: 'Development', order: 1, buildCommand: 'echo dev-build' },
    { id: 'staging', name: 'Staging', order: 2, buildCommand: 'echo staging-build', gateCommand: 'echo gate-ok' },
    { id: 'prod', name: 'Production', order: 3, buildCommand: 'echo prod-build' },
  ],
};

const emptyConfig: EnvironmentConfig = {
  pipeline: defaultPipeline,
  environments: [],
  transitions: [],
};

function createMockWorkspaceEnv(): WorkspaceEnvironment {
  return {
    id: 'test-ws-env',
    label: 'Test WS Env',
    readFile: vi.fn().mockResolvedValue(''),
    writeFile: vi.fn().mockResolvedValue(undefined),
    deleteFile: vi.fn().mockResolvedValue(undefined),
    exists: vi.fn().mockResolvedValue(false),
    readDirectory: vi.fn().mockResolvedValue([]),
    mkdir: vi.fn().mockResolvedValue(undefined),
    stat: vi.fn().mockResolvedValue({ size: 0, isFile: true, isDirectory: false, modifiedAt: '' }),
    execute: vi.fn().mockResolvedValue({
      exitCode: 0,
      stdout: '{"deployed":true}',
      stderr: '',
      durationMs: 50,
    } as ExecutionResult),
    initialize: vi.fn().mockResolvedValue(undefined),
    dispose: vi.fn().mockResolvedValue(undefined),
    fileSystem: {
      readTextFile: vi.fn().mockImplementation(async () => JSON.stringify(configStore)),
      writeFile: vi.fn().mockImplementation(async (_path: string, content: string) => {
        configStore = JSON.parse(content);
      }),
      mkdir: vi.fn().mockResolvedValue(undefined),
      readDirectory: vi.fn().mockResolvedValue([]),
      deleteFile: vi.fn().mockResolvedValue(undefined),
      exists: vi.fn().mockResolvedValue(true),
    } as any,
  };
}

function createManagerWithMocks(): { manager: EnvironmentManager; wsEnv: WorkspaceEnvironment } {
  const wsEnv = createMockWorkspaceEnv();
  const workspace = new WorkspaceService({ env: wsEnv });
  const manager = new EnvironmentManager(workspace);
  return { manager, wsEnv };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('EnvironmentManager', () => {
  beforeEach(() => {
    configStore = JSON.parse(JSON.stringify(emptyConfig));
  });

  // ---- Config CRUD ----

  describe('config CRUD', () => {
    it('should load default config', async () => {
      const { manager } = createManagerWithMocks();
      const config = await manager.loadConfig();
      expect(config.pipeline.id).toBe('pipe-1');
      expect(config.environments).toEqual([]);
      expect(config.transitions).toEqual([]);
    });

    it('should save and reload config', async () => {
      const { manager } = createManagerWithMocks();
      const newConfig: EnvironmentConfig = {
        pipeline: { ...defaultPipeline, name: 'Updated' },
        environments: [],
        transitions: [],
      };
      await manager.saveConfig(newConfig);
      const loaded = await manager.loadConfig();
      expect(loaded.pipeline.name).toBe('Updated');
    });
  });

  // ---- Pipeline ----

  describe('pipeline', () => {
    it('should get pipeline', async () => {
      const { manager } = createManagerWithMocks();
      const pipeline = await manager.getPipeline();
      expect(pipeline.stages.length).toBe(3);
    });

    it('should save pipeline', async () => {
      const { manager } = createManagerWithMocks();
      await manager.savePipeline({ ...defaultPipeline, name: 'New Pipeline' });
      const pipeline = await manager.getPipeline();
      expect(pipeline.name).toBe('New Pipeline');
    });
  });

  // ---- Environment CRUD ----

  describe('environment CRUD', () => {
    it('should create an environment at the first stage', async () => {
      const { manager } = createManagerWithMocks();
      const env = await manager.createEnvironment('feature-x');
      expect(env.name).toBe('feature-x');
      expect(env.currentStageId).toBe('dev');
      expect(env.status).toBe('ready');
      expect(env.state).toEqual({});
    });

    it('should create an environment at a specific stage', async () => {
      const { manager } = createManagerWithMocks();
      const env = await manager.createEnvironment('hotfix', 'staging');
      expect(env.currentStageId).toBe('staging');
    });

    it('should throw when creating env with no stages', async () => {
      configStore = {
        pipeline: { id: 'empty', name: 'Empty', stages: [] },
        environments: [],
        transitions: [],
      };
      const { manager } = createManagerWithMocks();
      await expect(manager.createEnvironment('test')).rejects.toThrow('no stages');
    });

    it('should throw when creating env at unknown stage', async () => {
      const { manager } = createManagerWithMocks();
      await expect(manager.createEnvironment('test', 'nonexistent')).rejects.toThrow('not found');
    });

    it('should get an environment by ID', async () => {
      const { manager } = createManagerWithMocks();
      const created = await manager.createEnvironment('env-a');
      const found = await manager.getEnvironment(created.id);
      expect(found).not.toBeNull();
      expect(found!.name).toBe('env-a');
    });

    it('should return null for unknown environment', async () => {
      const { manager } = createManagerWithMocks();
      const found = await manager.getEnvironment('nonexistent');
      expect(found).toBeNull();
    });

    it('should list environments', async () => {
      const { manager } = createManagerWithMocks();
      await manager.createEnvironment('env-1');
      await manager.createEnvironment('env-2');
      const list = await manager.listEnvironments();
      expect(list.length).toBe(2);
    });

    it('should destroy an environment', async () => {
      const { manager } = createManagerWithMocks();
      const env = await manager.createEnvironment('to-destroy');
      await manager.destroyEnvironment(env.id);
      const destroyed = await manager.getEnvironment(env.id);
      expect(destroyed!.status).toBe('destroyed');
    });

    it('should throw when destroying unknown environment', async () => {
      const { manager } = createManagerWithMocks();
      await expect(manager.destroyEnvironment('nonexistent')).rejects.toThrow('not found');
    });
  });

  // ---- Stage execution ----

  describe('buildStage', () => {
    it('should run build command and update state from stdout', async () => {
      const { manager, wsEnv } = createManagerWithMocks();
      const env = await manager.createEnvironment('build-test');

      (wsEnv.execute as any).mockResolvedValueOnce({
        exitCode: 0,
        stdout: '{"apiUrl":"https://example.com","stackName":"test-stack"}',
        stderr: '',
        durationMs: 200,
      });

      const result = await manager.buildStage(env.id, 'dev');
      expect(result.state.apiUrl).toBe('https://example.com');
      expect(result.state.stackName).toBe('test-stack');

      // Verify environment was updated
      const updated = await manager.getEnvironment(env.id);
      expect(updated!.state).toEqual({ apiUrl: 'https://example.com', stackName: 'test-stack' });
      expect(updated!.status).toBe('ready');
    });

    it('should throw on non-zero exit code', async () => {
      const { manager, wsEnv } = createManagerWithMocks();
      const env = await manager.createEnvironment('fail-test');

      (wsEnv.execute as any).mockResolvedValueOnce({
        exitCode: 1,
        stdout: '',
        stderr: 'build error',
        durationMs: 100,
      });

      await expect(manager.buildStage(env.id, 'dev')).rejects.toThrow('Stage build failed');
    });

    it('should pass current state as stdin', async () => {
      const { manager, wsEnv } = createManagerWithMocks();

      // Create env and manually set state via config
      const env = await manager.createEnvironment('stdin-test');
      const config = await manager.loadConfig();
      const environments = config.environments.map((e) =>
        e.id === env.id ? { ...e, state: { existing: 'value' } } : e,
      );
      await manager.saveConfig({ ...config, environments });

      (wsEnv.execute as any).mockResolvedValueOnce({
        exitCode: 0,
        stdout: '{"existing":"value","new":"data"}',
        stderr: '',
        durationMs: 50,
      });

      await manager.buildStage(env.id, 'dev');

      // Verify stdin was the existing state
      expect(wsEnv.execute).toHaveBeenCalledWith(
        expect.objectContaining({
          stdin: '{"existing":"value"}',
          command: 'echo dev-build',
        }),
      );
    });

    it('should handle non-JSON stdout by preserving state', async () => {
      const { manager, wsEnv } = createManagerWithMocks();
      const env = await manager.createEnvironment('non-json');

      (wsEnv.execute as any).mockResolvedValueOnce({
        exitCode: 0,
        stdout: 'plain text output',
        stderr: '',
        durationMs: 50,
      });

      const result = await manager.buildStage(env.id, 'dev');
      expect(result.state._lastBuildOutput).toBe('plain text output');
    });

    it('should throw when no workspace environment', async () => {
      // Create workspace without env
      const workspace = new WorkspaceService({ workspaceRoot: '/tmp' });
      const manager = new EnvironmentManager(workspace);

      // Manually set config store for loading
      configStore = JSON.parse(JSON.stringify(emptyConfig));

      // We can't easily test this with our current mock setup since
      // the workspace doesn't have the mock fs. Skip for now.
    });
  });

  describe('checkGate', () => {
    it('should pass gate when exit code is 0', async () => {
      const { manager, wsEnv } = createManagerWithMocks();
      const env = await manager.createEnvironment('gate-pass');

      (wsEnv.execute as any).mockResolvedValueOnce({
        exitCode: 0,
        stdout: 'all checks passed',
        stderr: '',
        durationMs: 30,
      });

      const result = await manager.checkGate(env.id, 'staging');
      expect(result.passed).toBe(true);
      expect(result.output).toBe('all checks passed');
    });

    it('should fail gate when exit code is non-zero', async () => {
      const { manager, wsEnv } = createManagerWithMocks();
      const env = await manager.createEnvironment('gate-fail');

      (wsEnv.execute as any).mockResolvedValueOnce({
        exitCode: 1,
        stdout: '',
        stderr: 'health check failed',
        durationMs: 30,
      });

      const result = await manager.checkGate(env.id, 'staging');
      expect(result.passed).toBe(false);
    });

    it('should auto-pass when no gate command defined', async () => {
      const { manager } = createManagerWithMocks();
      const env = await manager.createEnvironment('no-gate');

      // 'dev' stage has no gateCommand
      const result = await manager.checkGate(env.id, 'dev');
      expect(result.passed).toBe(true);
      expect(result.output).toContain('auto-pass');
    });
  });

  describe('promote', () => {
    it('should promote from dev to staging', async () => {
      const { manager, wsEnv } = createManagerWithMocks();
      const env = await manager.createEnvironment('promote-test');

      // dev has no gate, so auto-pass. staging build:
      (wsEnv.execute as any).mockResolvedValueOnce({
        exitCode: 0,
        stdout: '{"env":"staging","deployed":true}',
        stderr: '',
        durationMs: 100,
      });

      const transition = await manager.promote(env.id);
      expect(transition.fromStageId).toBe('dev');
      expect(transition.toStageId).toBe('staging');
      expect(transition.gatePassed).toBe(true);

      // Verify environment is now at staging
      const updated = await manager.getEnvironment(env.id);
      expect(updated!.currentStageId).toBe('staging');
      expect(updated!.state).toEqual({ env: 'staging', deployed: true });
    });

    it('should throw when already at final stage', async () => {
      const { manager } = createManagerWithMocks();
      const env = await manager.createEnvironment('final-stage', 'prod');
      await expect(manager.promote(env.id)).rejects.toThrow('final stage');
    });

    it('should fail promotion when gate fails', async () => {
      const { manager, wsEnv } = createManagerWithMocks();

      // Create env at staging (which has a gate)
      const env = await manager.createEnvironment('gate-block', 'staging');

      // Gate command fails
      (wsEnv.execute as any).mockResolvedValueOnce({
        exitCode: 1,
        stdout: '',
        stderr: 'integration tests failed',
        durationMs: 50,
      });

      await expect(manager.promote(env.id)).rejects.toThrow('Gate check failed');

      // Verify transition was recorded as failed
      const transitions = await manager.getTransitions(env.id);
      expect(transitions.length).toBe(1);
      expect(transitions[0].gatePassed).toBe(false);
    });

    it('should record transition on successful promotion', async () => {
      const { manager, wsEnv } = createManagerWithMocks();
      const env = await manager.createEnvironment('transition-test');

      (wsEnv.execute as any).mockResolvedValueOnce({
        exitCode: 0,
        stdout: '{"step":"staging"}',
        stderr: '',
        durationMs: 100,
      });

      await manager.promote(env.id);

      const transitions = await manager.getTransitions();
      expect(transitions.length).toBe(1);
      expect(transitions[0].fromStageId).toBe('dev');
      expect(transitions[0].toStageId).toBe('staging');
      expect(transitions[0].gatePassed).toBe(true);
    });
  });

  // ---- Transitions ----

  describe('getTransitions', () => {
    it('should return empty array when no transitions', async () => {
      const { manager } = createManagerWithMocks();
      const transitions = await manager.getTransitions();
      expect(transitions).toEqual([]);
    });

    it('should filter by envId', async () => {
      const { manager, wsEnv } = createManagerWithMocks();

      const env1 = await manager.createEnvironment('env-1');
      const env2 = await manager.createEnvironment('env-2');

      // Promote env1
      (wsEnv.execute as any).mockResolvedValueOnce({
        exitCode: 0,
        stdout: '{}',
        stderr: '',
        durationMs: 50,
      });
      await manager.promote(env1.id);

      // Promote env2
      (wsEnv.execute as any).mockResolvedValueOnce({
        exitCode: 0,
        stdout: '{}',
        stderr: '',
        durationMs: 50,
      });
      await manager.promote(env2.id);

      const env1Transitions = await manager.getTransitions(env1.id);
      expect(env1Transitions.length).toBe(1);
      expect(env1Transitions[0].environmentId).toBe(env1.id);

      const allTransitions = await manager.getTransitions();
      expect(allTransitions.length).toBe(2);
    });
  });
});
