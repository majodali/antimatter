import type { Identifier, Timestamp } from './common.js';

// ---------------------------------------------------------------------------
// Pipeline — ordered named stages with custom build/gate commands
// ---------------------------------------------------------------------------

/** A single stage in a deployment pipeline. */
export interface PipelineStage {
  readonly id: Identifier;
  readonly name: string;
  readonly order: number;
  /**
   * Command to build/provision this stage.
   * Receives environment state JSON on stdin. Outputs updated state JSON on stdout.
   */
  readonly buildCommand: string;
  /** Working directory for the build command (relative to project root). */
  readonly cwd?: string;
  /**
   * Optional gate command. Receives environment state JSON on stdin.
   * Exit 0 = pass, non-zero = fail. Stdout captured as gate output.
   */
  readonly gateCommand?: string;
  /** Whether multiple environments can exist at this stage simultaneously. */
  readonly allowMultiple?: boolean;
}

/** A deployment pipeline — an ordered sequence of stages. */
export interface Pipeline {
  readonly id: Identifier;
  readonly name: string;
  readonly stages: readonly PipelineStage[];
}

// ---------------------------------------------------------------------------
// Environment — an instance moving through a pipeline
// ---------------------------------------------------------------------------

/** Status of an environment during its lifecycle. */
export type EnvironmentStatus =
  | 'building'
  | 'ready'
  | 'gate-checking'
  | 'promoting'
  | 'failed'
  | 'destroyed';

/** A deployment environment — accumulates state as it moves through stages. */
export interface Environment {
  readonly id: Identifier;
  readonly name: string;
  readonly pipelineId: Identifier;
  readonly currentStageId: Identifier;
  /**
   * Arbitrary JSON state — accumulated by stage build code.
   * Contains whatever the build code puts there: resource IDs,
   * URLs, config, slot assignments, etc.
   */
  readonly state: Record<string, unknown>;
  readonly status: EnvironmentStatus;
  readonly createdAt: Timestamp;
  readonly updatedAt: Timestamp;
  /** ID of the environment this was promoted from (lineage). */
  readonly promotedFrom?: Identifier;
  /** When this environment should be cleaned up (null = manual). */
  readonly expiresAt?: Timestamp;
}

// ---------------------------------------------------------------------------
// Transition records — history of stage promotions
// ---------------------------------------------------------------------------

/** Record of a stage transition (promotion). */
export interface StageTransition {
  readonly id: Identifier;
  readonly environmentId: Identifier;
  readonly fromStageId: Identifier;
  readonly toStageId: Identifier;
  readonly buildOutput?: string;
  readonly gateOutput?: string;
  readonly gatePassed: boolean;
  readonly timestamp: Timestamp;
}

// ---------------------------------------------------------------------------
// Top-level config — stored in .antimatter/environments.json
// ---------------------------------------------------------------------------

/** Full environment configuration for a project. */
export interface EnvironmentConfig {
  readonly pipeline: Pipeline;
  readonly environments: readonly Environment[];
  readonly transitions: readonly StageTransition[];
}
