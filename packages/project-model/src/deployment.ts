import type { Identifier, Status, Timestamp } from './common.js';

// ---------------------------------------------------------------------------
// Module definition — what a deployable unit is
// ---------------------------------------------------------------------------

/** A deployable module — what it is, not how it's deployed. */
export interface DeploymentModule {
  readonly id: Identifier;
  readonly name: string;
  readonly type: 'frontend' | 'lambda' | 'infrastructure';
  /** Shell command to build this module (runs on Command Lambda). */
  readonly buildCommand: string;
  /** Shell command to run tests (optional, runs on Command Lambda). */
  readonly testCommand?: string;
  /** Working directory for build/test commands, relative to project root. */
  readonly cwd?: string;
}

// ---------------------------------------------------------------------------
// Packaging — how to bundle a module for deployment
// ---------------------------------------------------------------------------

/** How to package a module's build output for a specific target. */
export interface PackagingStrategy {
  readonly id: Identifier;
  readonly moduleId: Identifier;
  readonly type: 'lambda-zip' | 's3-static';
  readonly config: LambdaZipPackagingConfig | S3StaticPackagingConfig;
}

/** Packaging config for a single-file Lambda bundle. */
export interface LambdaZipPackagingConfig {
  readonly type: 'lambda-zip';
  /** Path to the bundled JS file, relative to project root. */
  readonly bundlePath: string;
}

/** Packaging config for a static site (directory of files). */
export interface S3StaticPackagingConfig {
  readonly type: 's3-static';
  /** Path to the build output directory, relative to project root. */
  readonly outputDir: string;
}

// ---------------------------------------------------------------------------
// Deployment target — where to deploy a packaged artifact
// ---------------------------------------------------------------------------

/** Where and how to deploy a packaged artifact. */
export interface DeploymentTarget {
  readonly id: Identifier;
  readonly moduleId: Identifier;
  readonly packagingId: Identifier;
  readonly type: 'lambda-update' | 's3-upload';
  readonly config: LambdaDeployTargetConfig | S3DeployTargetConfig;
}

/** Deploy to an AWS Lambda function. */
export interface LambdaDeployTargetConfig {
  readonly type: 'lambda-update';
  /** Lambda function name (supports ${ENV_VAR} substitution). */
  readonly functionName: string;
  readonly region: string;
}

/** Deploy to an S3 bucket (with optional CloudFront invalidation). */
export interface S3DeployTargetConfig {
  readonly type: 's3-upload';
  /** S3 bucket name (supports ${ENV_VAR} substitution). */
  readonly bucket: string;
  readonly region: string;
  /** CloudFront distribution ID for cache invalidation (supports ${ENV_VAR} substitution). */
  readonly distributionId?: string;
}

// ---------------------------------------------------------------------------
// Deployment config — full configuration stored in .antimatter/deploy.json
// ---------------------------------------------------------------------------

/** Full deployment configuration for a project. */
export interface DeploymentConfig {
  readonly modules: readonly DeploymentModule[];
  readonly packaging: readonly PackagingStrategy[];
  readonly targets: readonly DeploymentTarget[];
}

// ---------------------------------------------------------------------------
// Deployment results — output of a deployment execution
// ---------------------------------------------------------------------------

/** The type of step in a deployment pipeline. */
export type DeploymentStepType = 'build' | 'test' | 'package' | 'deploy';

/** Progress of a single step within a deployment. */
export interface DeploymentStepProgress {
  readonly step: DeploymentStepType;
  readonly moduleId: Identifier;
  readonly status: Status | 'running' | 'skipped';
  readonly output?: string;
  readonly startedAt?: Timestamp;
  readonly finishedAt?: Timestamp;
  readonly durationMs?: number;
  readonly error?: string;
}

/** The result of deploying a single target. */
export interface DeploymentResult {
  readonly targetId: Identifier;
  readonly moduleId: Identifier;
  readonly status: Status | 'running' | 'skipped';
  readonly steps: readonly DeploymentStepProgress[];
  readonly startedAt: Timestamp;
  readonly finishedAt?: Timestamp;
  readonly durationMs?: number;
  readonly error?: string;
}

/** Progress event emitted during deployment (for SSE streaming). */
export interface DeployProgressEvent {
  readonly type: 'step-started' | 'step-output' | 'step-completed' | 'deploy-complete' | 'deploy-error';
  readonly targetId?: Identifier;
  readonly moduleId?: Identifier;
  readonly step?: DeploymentStepType;
  readonly output?: string;
  readonly result?: DeploymentResult;
  readonly results?: readonly DeploymentResult[];
  readonly error?: string;
  readonly timestamp?: Timestamp;
}
