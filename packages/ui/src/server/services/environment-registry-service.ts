/**
 * EnvironmentRegistryService — tracks deployed CloudFormation infrastructure stacks.
 *
 * Registry is stored as a JSON document in S3 at `environments/registry.json`.
 * Provides list, register, and terminate operations. On list, any environments
 * with status='destroying' are refreshed by checking CloudFormation stack status.
 */

import {
  S3Client,
  GetObjectCommand,
  PutObjectCommand,
} from '@aws-sdk/client-s3';
import {
  CloudFormationClient,
  DeleteStackCommand,
  DescribeStacksCommand,
} from '@aws-sdk/client-cloudformation';
import type {
  InfraEnvironment,
  InfraEnvironmentRegistry,
  InfraEnvironmentOutputs,
} from '@antimatter/project-model';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface EnvironmentRegistryConfig {
  s3Client: S3Client;
  bucket: string;
  cfnClient: CloudFormationClient;
}

export interface RegisterEnvironmentInput {
  envId: string;
  stackName: string;
  outputs: InfraEnvironmentOutputs;
  description?: string;
}

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------

const REGISTRY_KEY = 'environments/registry.json';

export class EnvironmentRegistryService {
  private readonly s3: S3Client;
  private readonly bucket: string;
  private readonly cfn: CloudFormationClient;

  constructor(config: EnvironmentRegistryConfig) {
    this.s3 = config.s3Client;
    this.bucket = config.bucket;
    this.cfn = config.cfnClient;
  }

  // -------------------------------------------------------------------------
  // Public API
  // -------------------------------------------------------------------------

  /** List all environments. Auto-refreshes statuses for any in 'destroying' state. */
  async listEnvironments(): Promise<InfraEnvironment[]> {
    const registry = await this.loadRegistry();

    // Refresh statuses for environments being destroyed
    const destroying = registry.environments.filter((e) => e.status === 'destroying');
    if (destroying.length > 0) {
      const updated = await this.refreshStatuses(registry);
      await this.saveRegistry(updated);
      return [...updated.environments].filter((e) => e.status !== 'destroyed');
    }

    return [...registry.environments].filter((e) => e.status !== 'destroyed');
  }

  /** Register a new environment (or update an existing one by envId). */
  async registerEnvironment(input: RegisterEnvironmentInput): Promise<InfraEnvironment> {
    const registry = await this.loadRegistry();
    const now = new Date().toISOString();

    const existing = registry.environments.find((e) => e.envId === input.envId);

    const env: InfraEnvironment = {
      envId: input.envId,
      stackName: input.stackName,
      status: 'active',
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
      outputs: input.outputs,
      description: input.description,
    };

    const environments = existing
      ? registry.environments.map((e) => (e.envId === input.envId ? env : e))
      : [...registry.environments, env];

    await this.saveRegistry({ ...registry, environments });
    return env;
  }

  /** Initiate termination of an environment's CloudFormation stack. */
  async terminateEnvironment(envId: string): Promise<void> {
    const registry = await this.loadRegistry();
    const env = registry.environments.find((e) => e.envId === envId);

    if (!env) {
      throw new Error(`Environment "${envId}" not found`);
    }
    if (env.status === 'destroying' || env.status === 'destroyed') {
      return; // Already terminating/terminated
    }

    // Update status to destroying
    const environments = registry.environments.map((e) =>
      e.envId === envId
        ? { ...e, status: 'destroying' as const, updatedAt: new Date().toISOString() }
        : e,
    );
    await this.saveRegistry({ ...registry, environments });

    // Fire-and-forget CloudFormation delete
    try {
      await this.cfn.send(new DeleteStackCommand({ StackName: env.stackName }));
    } catch (err) {
      // Update status to failed if delete command itself fails
      const freshRegistry = await this.loadRegistry();
      const envs = freshRegistry.environments.map((e) =>
        e.envId === envId
          ? {
              ...e,
              status: 'failed' as const,
              error: err instanceof Error ? err.message : String(err),
              updatedAt: new Date().toISOString(),
            }
          : e,
      );
      await this.saveRegistry({ ...freshRegistry, environments: envs });
      throw err;
    }
  }

  // -------------------------------------------------------------------------
  // Private helpers
  // -------------------------------------------------------------------------

  private async loadRegistry(): Promise<InfraEnvironmentRegistry> {
    try {
      const result = await this.s3.send(
        new GetObjectCommand({ Bucket: this.bucket, Key: REGISTRY_KEY }),
      );
      const body = await result.Body?.transformToString();
      if (!body) {
        return { version: 1, environments: [] };
      }
      return JSON.parse(body) as InfraEnvironmentRegistry;
    } catch (err: any) {
      if (err.name === 'NoSuchKey' || err.$metadata?.httpStatusCode === 404) {
        return { version: 1, environments: [] };
      }
      throw err;
    }
  }

  private async saveRegistry(registry: InfraEnvironmentRegistry): Promise<void> {
    await this.s3.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: REGISTRY_KEY,
        Body: JSON.stringify(registry, null, 2),
        ContentType: 'application/json',
      }),
    );
  }

  /** Check CloudFormation for current status of environments being destroyed. */
  private async refreshStatuses(
    registry: InfraEnvironmentRegistry,
  ): Promise<InfraEnvironmentRegistry> {
    const environments = await Promise.all(
      registry.environments.map(async (env) => {
        if (env.status !== 'destroying') return env;

        try {
          const result = await this.cfn.send(
            new DescribeStacksCommand({ StackName: env.stackName }),
          );
          const stack = result.Stacks?.[0];

          if (!stack) {
            // Stack no longer exists
            return {
              ...env,
              status: 'destroyed' as const,
              updatedAt: new Date().toISOString(),
            };
          }

          switch (stack.StackStatus) {
            case 'DELETE_COMPLETE':
              return {
                ...env,
                status: 'destroyed' as const,
                updatedAt: new Date().toISOString(),
              };
            case 'DELETE_FAILED':
              return {
                ...env,
                status: 'failed' as const,
                error: stack.StackStatusReason ?? 'Delete failed',
                updatedAt: new Date().toISOString(),
              };
            case 'DELETE_IN_PROGRESS':
              return env; // Still destroying
            default:
              // Unexpected status — mark as failed
              return {
                ...env,
                status: 'failed' as const,
                error: `Unexpected stack status: ${stack.StackStatus}`,
                updatedAt: new Date().toISOString(),
              };
          }
        } catch (err: any) {
          // "Stack does not exist" error means it's been deleted
          if (
            err.message?.includes('does not exist') ||
            err.name === 'ValidationError'
          ) {
            return {
              ...env,
              status: 'destroyed' as const,
              updatedAt: new Date().toISOString(),
            };
          }
          // Other errors — keep current status, don't crash the list
          console.error(`Failed to check status for ${env.stackName}:`, err);
          return env;
        }
      }),
    );

    return { ...registry, environments };
  }
}
