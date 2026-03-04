import type { Timestamp } from './common.js';

// ---------------------------------------------------------------------------
// Deployed Environment Registry — tracks CloudFormation stacks
// ---------------------------------------------------------------------------

/** Status of a deployed infrastructure environment. */
export type InfraEnvironmentStatus = 'active' | 'destroying' | 'destroyed' | 'failed';

/** CloudFormation stack outputs captured at registration time. */
export interface InfraEnvironmentOutputs {
  readonly websiteUrl?: string;
  readonly apiUrl?: string;
  readonly distributionId?: string;
  readonly dataBucketName?: string;
  readonly commandFunctionArn?: string;
  readonly workspaceLaunchTemplateId?: string;
  readonly workspaceAlbDns?: string;
}

/**
 * A deployed infrastructure environment — a CloudFormation stack representing
 * a running instance of the Antimatter system. Multiple environments exist
 * primarily so users can review and test without interrupting build activity.
 */
export interface InfraEnvironment {
  readonly envId: string;
  readonly stackName: string;
  readonly status: InfraEnvironmentStatus;
  readonly createdAt: Timestamp;
  readonly updatedAt: Timestamp;
  readonly outputs: InfraEnvironmentOutputs;
  readonly description?: string;
  readonly error?: string;
}

/** Top-level registry document stored in S3. */
export interface InfraEnvironmentRegistry {
  readonly version: 1;
  readonly environments: readonly InfraEnvironment[];
}
