import type { WorkspaceService } from './workspace-service.js';
import type {
  Pipeline,
  PipelineStage,
  Environment,
  EnvironmentStatus,
  EnvironmentConfig,
  StageTransition,
} from '@antimatter/project-model';

/**
 * Manages deployment environments and their progression through pipeline stages.
 *
 * The EnvironmentManager is a thin pipeline framework. It provides:
 * 1. Pipeline definition — ordered named stages
 * 2. State storage — arbitrary JSON per environment
 * 3. Promotion flow — run gate → run next stage's build → store updated state
 * 4. Environment lifecycle — create, promote, destroy
 *
 * It does NOT provide built-in provisioning, resource management, traffic switching,
 * or data sync. Those are all implemented by the project's stage build/gate code.
 */
export class EnvironmentManager {
  constructor(private readonly workspace: WorkspaceService) {}

  // ---------------------------------------------------------------------------
  // Config CRUD
  // ---------------------------------------------------------------------------

  async loadConfig(): Promise<EnvironmentConfig> {
    return this.workspace.loadEnvironmentConfig() as Promise<EnvironmentConfig>;
  }

  async saveConfig(config: EnvironmentConfig): Promise<void> {
    await this.workspace.saveEnvironmentConfig(config);
  }

  // ---------------------------------------------------------------------------
  // Pipeline
  // ---------------------------------------------------------------------------

  async getPipeline(): Promise<Pipeline> {
    const config = await this.loadConfig();
    return config.pipeline;
  }

  async savePipeline(pipeline: Pipeline): Promise<void> {
    const config = await this.loadConfig();
    await this.saveConfig({ ...config, pipeline });
  }

  // ---------------------------------------------------------------------------
  // Environment CRUD
  // ---------------------------------------------------------------------------

  async createEnvironment(name: string, stageId?: string): Promise<Environment> {
    const config = await this.loadConfig();
    const pipeline = config.pipeline;

    if (!pipeline.stages.length) {
      throw new Error('Pipeline has no stages defined');
    }

    // Default to the first stage (lowest order)
    const sortedStages = [...pipeline.stages].sort((a, b) => a.order - b.order);
    const targetStageId = stageId ?? sortedStages[0].id;

    // Verify stage exists
    const stage = pipeline.stages.find((s) => s.id === targetStageId);
    if (!stage) {
      throw new Error(`Stage "${targetStageId}" not found in pipeline`);
    }

    const now = new Date().toISOString();
    const env: Environment = {
      id: `env-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      name,
      pipelineId: pipeline.id,
      currentStageId: targetStageId,
      state: {},
      status: 'ready',
      createdAt: now,
      updatedAt: now,
    };

    const environments = [...config.environments, env];
    await this.saveConfig({ ...config, environments });
    return env;
  }

  async getEnvironment(envId: string): Promise<Environment | null> {
    const config = await this.loadConfig();
    return config.environments.find((e) => e.id === envId) ?? null;
  }

  async listEnvironments(): Promise<readonly Environment[]> {
    const config = await this.loadConfig();
    return config.environments;
  }

  async destroyEnvironment(envId: string): Promise<void> {
    const config = await this.loadConfig();
    const envIndex = config.environments.findIndex((e) => e.id === envId);
    if (envIndex === -1) {
      throw new Error(`Environment "${envId}" not found`);
    }

    const environments = config.environments.map((e) =>
      e.id === envId
        ? { ...e, status: 'destroyed' as EnvironmentStatus, updatedAt: new Date().toISOString() }
        : e,
    );
    await this.saveConfig({ ...config, environments });
  }

  // ---------------------------------------------------------------------------
  // Stage execution
  // ---------------------------------------------------------------------------

  /**
   * Run a stage's build command. Passes the environment's current state as stdin,
   * captures stdout as updated state JSON.
   */
  async buildStage(
    envId: string,
    stageId: string,
  ): Promise<{ state: Record<string, unknown>; output: string }> {
    const config = await this.loadConfig();
    const env = config.environments.find((e) => e.id === envId);
    if (!env) throw new Error(`Environment "${envId}" not found`);

    const stage = config.pipeline.stages.find((s) => s.id === stageId);
    if (!stage) throw new Error(`Stage "${stageId}" not found`);

    if (!this.workspace.env) {
      throw new Error('No workspace environment available for command execution');
    }

    // Update status to building
    await this.updateEnvironmentStatus(config, envId, 'building');

    try {
      const result = await this.workspace.env.execute({
        command: stage.buildCommand,
        cwd: stage.cwd,
        stdin: JSON.stringify(env.state),
      });

      if (result.exitCode !== 0) {
        await this.updateEnvironmentStatus(config, envId, 'failed');
        throw new Error(
          `Stage build failed (exit ${result.exitCode}): ${result.stderr || result.stdout}`,
        );
      }

      // Parse updated state from stdout
      let newState: Record<string, unknown>;
      try {
        newState = JSON.parse(result.stdout);
      } catch {
        // If stdout isn't valid JSON, keep existing state and store stdout as _lastBuildOutput
        newState = { ...env.state, _lastBuildOutput: result.stdout };
      }

      // Update environment with new state
      const updatedConfig = await this.loadConfig();
      const environments = updatedConfig.environments.map((e) =>
        e.id === envId
          ? {
              ...e,
              state: newState,
              status: 'ready' as EnvironmentStatus,
              currentStageId: stageId,
              updatedAt: new Date().toISOString(),
            }
          : e,
      );
      await this.saveConfig({ ...updatedConfig, environments });

      return { state: newState, output: result.stdout };
    } catch (err) {
      // Re-read config to avoid stale writes
      const freshConfig = await this.loadConfig();
      await this.updateEnvironmentStatus(freshConfig, envId, 'failed');
      throw err;
    }
  }

  /**
   * Run a stage's gate command. Passes the environment's current state as stdin.
   * Exit 0 = pass, non-zero = fail.
   */
  async checkGate(
    envId: string,
    stageId: string,
  ): Promise<{ passed: boolean; output: string }> {
    const config = await this.loadConfig();
    const env = config.environments.find((e) => e.id === envId);
    if (!env) throw new Error(`Environment "${envId}" not found`);

    const stage = config.pipeline.stages.find((s) => s.id === stageId);
    if (!stage) throw new Error(`Stage "${stageId}" not found`);

    if (!stage.gateCommand) {
      // No gate defined — auto-pass
      return { passed: true, output: 'No gate command defined — auto-pass' };
    }

    if (!this.workspace.env) {
      throw new Error('No workspace environment available for command execution');
    }

    // Update status to gate-checking
    await this.updateEnvironmentStatus(config, envId, 'gate-checking');

    const result = await this.workspace.env.execute({
      command: stage.gateCommand,
      cwd: stage.cwd,
      stdin: JSON.stringify(env.state),
    });

    const passed = result.exitCode === 0;

    // Restore status
    const freshConfig = await this.loadConfig();
    await this.updateEnvironmentStatus(freshConfig, envId, passed ? 'ready' : 'failed');

    return { passed, output: result.stdout || result.stderr || '' };
  }

  /**
   * Promote an environment to the next stage: check current gate → build next stage → record transition.
   */
  async promote(envId: string): Promise<StageTransition> {
    const config = await this.loadConfig();
    const env = config.environments.find((e) => e.id === envId);
    if (!env) throw new Error(`Environment "${envId}" not found`);

    const pipeline = config.pipeline;
    const sortedStages = [...pipeline.stages].sort((a, b) => a.order - b.order);
    const currentIndex = sortedStages.findIndex((s) => s.id === env.currentStageId);

    if (currentIndex === -1) {
      throw new Error(`Current stage "${env.currentStageId}" not found in pipeline`);
    }
    if (currentIndex >= sortedStages.length - 1) {
      throw new Error('Environment is already at the final stage');
    }

    const currentStage = sortedStages[currentIndex];
    const nextStage = sortedStages[currentIndex + 1];

    // Update status to promoting
    await this.updateEnvironmentStatus(config, envId, 'promoting');

    // 1. Check gate on current stage
    let gateOutput = '';
    let gatePassed = true;

    if (currentStage.gateCommand) {
      const gateResult = await this.checkGate(envId, currentStage.id);
      gateOutput = gateResult.output;
      gatePassed = gateResult.passed;

      if (!gatePassed) {
        const transition: StageTransition = {
          id: `tr-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
          environmentId: envId,
          fromStageId: currentStage.id,
          toStageId: nextStage.id,
          gateOutput,
          gatePassed: false,
          timestamp: new Date().toISOString(),
        };

        const freshConfig = await this.loadConfig();
        const transitions = [...freshConfig.transitions, transition];
        await this.saveConfig({ ...freshConfig, transitions });

        throw new Error(`Gate check failed for stage "${currentStage.name}": ${gateOutput}`);
      }
    }

    // 2. Run next stage's build
    const buildResult = await this.buildStage(envId, nextStage.id);

    // 3. Record transition
    const transition: StageTransition = {
      id: `tr-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      environmentId: envId,
      fromStageId: currentStage.id,
      toStageId: nextStage.id,
      buildOutput: buildResult.output,
      gateOutput,
      gatePassed: true,
      timestamp: new Date().toISOString(),
    };

    const freshConfig = await this.loadConfig();
    const transitions = [...freshConfig.transitions, transition];
    await this.saveConfig({ ...freshConfig, transitions });

    return transition;
  }

  // ---------------------------------------------------------------------------
  // Transitions
  // ---------------------------------------------------------------------------

  async getTransitions(envId?: string): Promise<readonly StageTransition[]> {
    const config = await this.loadConfig();
    if (envId) {
      return config.transitions.filter((t) => t.environmentId === envId);
    }
    return config.transitions;
  }

  // ---------------------------------------------------------------------------
  // Private helpers
  // ---------------------------------------------------------------------------

  private async updateEnvironmentStatus(
    config: EnvironmentConfig,
    envId: string,
    status: EnvironmentStatus,
  ): Promise<void> {
    const environments = config.environments.map((e) =>
      e.id === envId ? { ...e, status, updatedAt: new Date().toISOString() } : e,
    );
    await this.saveConfig({ ...config, environments });
  }
}
