/**
 * Deployment pipeline executor.
 *
 * Orchestrates the build → package → deploy pipeline for each deployment target.
 * Build/test commands run via WorkspaceEnvironment (routed to Command Lambda).
 * AWS SDK deploy calls run directly on the API Lambda.
 */

import type { S3Client } from '@aws-sdk/client-s3';
import { GetObjectCommand, PutObjectCommand, ListObjectsV2Command } from '@aws-sdk/client-s3';
import type { WorkspaceEnvironment } from '@antimatter/workspace';
import type {
  DeploymentConfig,
  DeploymentModule,
  DeploymentTarget,
  PackagingStrategy,
  DeploymentResult,
  DeploymentStepProgress,
  DeployProgressEvent,
  DeploymentStepType,
  LambdaZipPackagingConfig,
  S3StaticPackagingConfig,
  LambdaDeployTargetConfig,
  S3DeployTargetConfig,
} from '@antimatter/project-model';
import { createZipFromFile } from './deployers/zip-util.js';

// ---------------------------------------------------------------------------
// Interfaces for AWS SDK clients (thin abstractions for testability)
// ---------------------------------------------------------------------------

/** Minimal interface for Lambda update operations. */
export interface DeployLambdaClient {
  updateFunctionCode(params: {
    FunctionName: string;
    ZipFile: Buffer;
  }): Promise<{ FunctionName?: string; LastUpdateStatus?: string }>;

  getFunctionConfiguration(params: {
    FunctionName: string;
  }): Promise<{ LastUpdateStatus?: string; State?: string }>;
}

/** Minimal interface for CloudFront invalidation. */
export interface DeployCloudfrontClient {
  createInvalidation(params: {
    DistributionId: string;
    InvalidationBatch: {
      CallerReference: string;
      Paths: { Quantity: number; Items: string[] };
    };
  }): Promise<{ Invalidation?: { Id?: string } }>;
}

// ---------------------------------------------------------------------------
// Executor options
// ---------------------------------------------------------------------------

export interface DeploymentExecutorOptions {
  /** WorkspaceEnvironment for build/test commands (Command Lambda). */
  readonly env: WorkspaceEnvironment;
  /** S3 client for reading build artifacts and uploading frontend files. */
  readonly s3Client: S3Client;
  /** S3 data bucket where project files live. */
  readonly projectsBucket: string;
  /** S3 prefix for project files (e.g. "projects/{id}/files/"). */
  readonly projectPrefix: string;
  /** Lambda client for Lambda function code updates. */
  readonly lambdaClient?: DeployLambdaClient;
  /** CloudFront client for cache invalidation. */
  readonly cloudfrontClient?: DeployCloudfrontClient;
  /** Callback for streaming progress events. */
  readonly onProgress?: (event: DeployProgressEvent) => void;
}

// ---------------------------------------------------------------------------
// MIME types for S3 upload
// ---------------------------------------------------------------------------

const MIME_TYPES: Record<string, string> = {
  '.html': 'text/html',
  '.css': 'text/css',
  '.js': 'application/javascript',
  '.mjs': 'application/javascript',
  '.json': 'application/json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.map': 'application/json',
  '.txt': 'text/plain',
  '.xml': 'application/xml',
  '.webp': 'image/webp',
};

function getContentType(key: string): string {
  const ext = key.slice(key.lastIndexOf('.')).toLowerCase();
  return MIME_TYPES[ext] ?? 'application/octet-stream';
}

// ---------------------------------------------------------------------------
// Variable substitution
// ---------------------------------------------------------------------------

/**
 * Resolve ${ENV_VAR} patterns in a string from process environment.
 * Falls back to the AWS_LAMBDA_FUNCTION_NAME runtime variable for self-reference.
 */
export function resolveEnvVars(value: string): string {
  return value.replace(/\$\{([^}]+)\}/g, (_match, varName: string) => {
    const resolved = process.env[varName];
    if (resolved === undefined) {
      throw new Error(`Environment variable ${varName} is not set (needed for deploy config)`);
    }
    return resolved;
  });
}

// ---------------------------------------------------------------------------
// Deployment Executor
// ---------------------------------------------------------------------------

export class DeploymentExecutor {
  private readonly env: WorkspaceEnvironment;
  private readonly s3Client: S3Client;
  private readonly projectsBucket: string;
  private readonly projectPrefix: string;
  private readonly lambdaClient?: DeployLambdaClient;
  private readonly cloudfrontClient?: DeployCloudfrontClient;
  private readonly onProgress?: (event: DeployProgressEvent) => void;

  constructor(options: DeploymentExecutorOptions) {
    this.env = options.env;
    this.s3Client = options.s3Client;
    this.projectsBucket = options.projectsBucket;
    this.projectPrefix = options.projectPrefix;
    this.lambdaClient = options.lambdaClient;
    this.cloudfrontClient = options.cloudfrontClient;
    this.onProgress = options.onProgress;
  }

  /**
   * Deploy one or more targets from the given config.
   * If targetIds is specified, only those targets are deployed.
   * In dryRun mode, build and package steps run but the actual deploy is skipped.
   */
  async deployAll(
    config: DeploymentConfig,
    targetIds?: string[],
    dryRun = false,
  ): Promise<DeploymentResult[]> {
    const results: DeploymentResult[] = [];

    // Resolve which targets to deploy
    const targets = targetIds
      ? config.targets.filter((t) => targetIds.includes(t.id))
      : [...config.targets];

    // Build lookup maps
    const modulesMap = new Map(config.modules.map((m) => [m.id, m]));
    const packagingMap = new Map(config.packaging.map((p) => [p.id, p]));

    // Deploy targets sequentially (dependencies may matter)
    for (const target of targets) {
      const module = modulesMap.get(target.moduleId);
      const packaging = packagingMap.get(target.packagingId);

      if (!module) {
        results.push(this.errorResult(target.id, target.moduleId, `Module "${target.moduleId}" not found`));
        continue;
      }
      if (!packaging) {
        results.push(this.errorResult(target.id, target.moduleId, `Packaging "${target.packagingId}" not found`));
        continue;
      }

      const result = await this.deployTarget(target, module, packaging, dryRun);
      results.push(result);
    }

    this.emitProgress({
      type: 'deploy-complete',
      results,
    });

    return results;
  }

  /**
   * Deploy a single target through the full pipeline.
   */
  async deployTarget(
    target: DeploymentTarget,
    module: DeploymentModule,
    packaging: PackagingStrategy,
    dryRun: boolean,
  ): Promise<DeploymentResult> {
    const startedAt = new Date().toISOString();
    const steps: DeploymentStepProgress[] = [];

    try {
      // --- Build step ---
      const buildStep = await this.runBuildStep(module);
      steps.push(buildStep);
      if (buildStep.status === 'failed') {
        return this.makeResult(target, module, 'failed', steps, startedAt, buildStep.error);
      }

      // --- Test step (optional) ---
      if (module.testCommand) {
        const testStep = await this.runTestStep(module);
        steps.push(testStep);
        if (testStep.status === 'failed') {
          return this.makeResult(target, module, 'failed', steps, startedAt, testStep.error);
        }
      }

      // --- Package step ---
      const packageStep = await this.runPackageStep(module, packaging);
      steps.push(packageStep);
      if (packageStep.status === 'failed') {
        return this.makeResult(target, module, 'failed', steps, startedAt, packageStep.error);
      }

      // --- Deploy step ---
      if (dryRun) {
        steps.push({
          step: 'deploy',
          moduleId: module.id,
          status: 'skipped',
          output: 'Dry run — deploy step skipped',
          startedAt: new Date().toISOString(),
          finishedAt: new Date().toISOString(),
          durationMs: 0,
        });
        return this.makeResult(target, module, 'success', steps, startedAt);
      }

      const deployStep = await this.runDeployStep(target, packaging);
      steps.push(deployStep);
      if (deployStep.status === 'failed') {
        return this.makeResult(target, module, 'failed', steps, startedAt, deployStep.error);
      }

      return this.makeResult(target, module, 'success', steps, startedAt);
    } catch (err) {
      const error = err instanceof Error ? err.message : String(err);
      this.emitProgress({
        type: 'deploy-error',
        targetId: target.id,
        moduleId: module.id,
        error,
      });
      return this.makeResult(target, module, 'failed', steps, startedAt, error);
    }
  }

  // ---------------------------------------------------------------------------
  // Pipeline steps
  // ---------------------------------------------------------------------------

  private async runBuildStep(module: DeploymentModule): Promise<DeploymentStepProgress> {
    return this.runCommandStep('build', module, module.buildCommand);
  }

  private async runTestStep(module: DeploymentModule): Promise<DeploymentStepProgress> {
    return this.runCommandStep('test', module, module.testCommand!);
  }

  private async runCommandStep(
    step: DeploymentStepType,
    module: DeploymentModule,
    command: string,
  ): Promise<DeploymentStepProgress> {
    const stepStartedAt = new Date().toISOString();

    this.emitProgress({
      type: 'step-started',
      targetId: module.id,
      moduleId: module.id,
      step,
      timestamp: stepStartedAt,
    });

    try {
      // Parse command into command + args (shell-style split)
      const parts = command.split(/\s+/);
      const cmd = parts[0];
      const args = parts.slice(1);

      const result = await this.env.execute({
        command: cmd,
        args,
        cwd: module.cwd,
        timeout: 300_000, // 5 minute timeout for builds
      });

      const output = [result.stdout, result.stderr].filter(Boolean).join('\n');

      this.emitProgress({
        type: 'step-output',
        moduleId: module.id,
        step,
        output,
      });

      const finishedAt = new Date().toISOString();

      if (result.exitCode !== 0) {
        const stepResult: DeploymentStepProgress = {
          step,
          moduleId: module.id,
          status: 'failed',
          output,
          startedAt: stepStartedAt,
          finishedAt,
          durationMs: result.durationMs,
          error: `Command exited with code ${result.exitCode}`,
        };

        this.emitProgress({
          type: 'step-completed',
          moduleId: module.id,
          step,
          output: `Failed (exit code ${result.exitCode})`,
        });

        return stepResult;
      }

      const stepResult: DeploymentStepProgress = {
        step,
        moduleId: module.id,
        status: 'success',
        output,
        startedAt: stepStartedAt,
        finishedAt,
        durationMs: result.durationMs,
      };

      this.emitProgress({
        type: 'step-completed',
        moduleId: module.id,
        step,
        output: `Success (${result.durationMs}ms)`,
      });

      return stepResult;
    } catch (err) {
      const error = err instanceof Error ? err.message : String(err);
      return {
        step,
        moduleId: module.id,
        status: 'failed',
        error,
        startedAt: stepStartedAt,
        finishedAt: new Date().toISOString(),
      };
    }
  }

  private async runPackageStep(
    module: DeploymentModule,
    packaging: PackagingStrategy,
  ): Promise<DeploymentStepProgress> {
    const stepStartedAt = new Date().toISOString();
    const startTime = Date.now();

    this.emitProgress({
      type: 'step-started',
      moduleId: module.id,
      step: 'package',
      timestamp: stepStartedAt,
    });

    try {
      // Verify the build artifacts exist in S3
      if (packaging.config.type === 'lambda-zip') {
        const config = packaging.config as LambdaZipPackagingConfig;
        const key = `${this.projectPrefix}${config.bundlePath}`;
        await this.s3Client.send(new GetObjectCommand({
          Bucket: this.projectsBucket,
          Key: key,
        }));
      } else if (packaging.config.type === 's3-static') {
        const config = packaging.config as S3StaticPackagingConfig;
        const prefix = `${this.projectPrefix}${config.outputDir}`;
        const listRes = await this.s3Client.send(new ListObjectsV2Command({
          Bucket: this.projectsBucket,
          Prefix: prefix.endsWith('/') ? prefix : `${prefix}/`,
          MaxKeys: 1,
        }));
        if (!listRes.Contents || listRes.Contents.length === 0) {
          throw new Error(`No build artifacts found at ${config.outputDir}`);
        }
      }

      const durationMs = Date.now() - startTime;

      this.emitProgress({
        type: 'step-completed',
        moduleId: module.id,
        step: 'package',
        output: `Package verified (${durationMs}ms)`,
      });

      return {
        step: 'package',
        moduleId: module.id,
        status: 'success',
        output: 'Build artifacts verified in S3',
        startedAt: stepStartedAt,
        finishedAt: new Date().toISOString(),
        durationMs,
      };
    } catch (err) {
      const error = err instanceof Error ? err.message : String(err);

      this.emitProgress({
        type: 'step-completed',
        moduleId: module.id,
        step: 'package',
        output: `Package failed: ${error}`,
      });

      return {
        step: 'package',
        moduleId: module.id,
        status: 'failed',
        error,
        startedAt: stepStartedAt,
        finishedAt: new Date().toISOString(),
        durationMs: Date.now() - startTime,
      };
    }
  }

  private async runDeployStep(
    target: DeploymentTarget,
    packaging: PackagingStrategy,
  ): Promise<DeploymentStepProgress> {
    const stepStartedAt = new Date().toISOString();
    const startTime = Date.now();

    this.emitProgress({
      type: 'step-started',
      targetId: target.id,
      moduleId: target.moduleId,
      step: 'deploy',
      timestamp: stepStartedAt,
    });

    try {
      let output: string;

      if (target.type === 'lambda-update') {
        output = await this.deployToLambda(
          target.config as LambdaDeployTargetConfig,
          packaging.config as LambdaZipPackagingConfig,
        );
      } else if (target.type === 's3-upload') {
        output = await this.deployToS3(
          target.config as S3DeployTargetConfig,
          packaging.config as S3StaticPackagingConfig,
        );
      } else {
        throw new Error(`Unknown deployment type: ${target.type}`);
      }

      const durationMs = Date.now() - startTime;

      this.emitProgress({
        type: 'step-completed',
        targetId: target.id,
        moduleId: target.moduleId,
        step: 'deploy',
        output: `Deployed (${durationMs}ms)`,
      });

      return {
        step: 'deploy',
        moduleId: target.moduleId,
        status: 'success',
        output,
        startedAt: stepStartedAt,
        finishedAt: new Date().toISOString(),
        durationMs,
      };
    } catch (err) {
      const error = err instanceof Error ? err.message : String(err);

      this.emitProgress({
        type: 'step-completed',
        targetId: target.id,
        moduleId: target.moduleId,
        step: 'deploy',
        output: `Deploy failed: ${error}`,
      });

      return {
        step: 'deploy',
        moduleId: target.moduleId,
        status: 'failed',
        error,
        startedAt: stepStartedAt,
        finishedAt: new Date().toISOString(),
        durationMs: Date.now() - startTime,
      };
    }
  }

  // ---------------------------------------------------------------------------
  // Deploy implementations
  // ---------------------------------------------------------------------------

  private async deployToLambda(
    targetConfig: LambdaDeployTargetConfig,
    packagingConfig: LambdaZipPackagingConfig,
  ): Promise<string> {
    if (!this.lambdaClient) {
      throw new Error('Lambda client not configured — cannot deploy Lambda functions');
    }

    const functionName = resolveEnvVars(targetConfig.functionName);

    // Read the bundle from S3
    const key = `${this.projectPrefix}${packagingConfig.bundlePath}`;
    const getRes = await this.s3Client.send(new GetObjectCommand({
      Bucket: this.projectsBucket,
      Key: key,
    }));
    const bodyBytes = await getRes.Body?.transformToByteArray();
    if (!bodyBytes) {
      throw new Error(`Failed to read bundle from S3: ${key}`);
    }

    // Determine the handler filename from the bundle path
    const bundleFilename = packagingConfig.bundlePath.split('/').pop() ?? 'index.js';

    // Create a zip archive containing the bundle
    const zipBuffer = createZipFromFile(bundleFilename, Buffer.from(bodyBytes));

    // Update the Lambda function code
    this.emitProgress({
      type: 'step-output',
      moduleId: '',
      step: 'deploy',
      output: `Updating Lambda function ${functionName} (${(zipBuffer.length / 1024).toFixed(1)} KB zip)...`,
    });

    const updateRes = await this.lambdaClient.updateFunctionCode({
      FunctionName: functionName,
      ZipFile: zipBuffer,
    });

    // Wait for the function to become active (up to 60 seconds)
    const maxWait = 60_000;
    const startTime = Date.now();
    let lastStatus = updateRes.LastUpdateStatus ?? 'Unknown';

    while (lastStatus === 'InProgress' && Date.now() - startTime < maxWait) {
      await new Promise((r) => setTimeout(r, 2000));
      const getConfig = await this.lambdaClient.getFunctionConfiguration({
        FunctionName: functionName,
      });
      lastStatus = getConfig.LastUpdateStatus ?? 'Unknown';
    }

    if (lastStatus !== 'Successful') {
      throw new Error(`Lambda update did not complete successfully. Status: ${lastStatus}`);
    }

    return `Lambda ${functionName} updated successfully`;
  }

  private async deployToS3(
    targetConfig: S3DeployTargetConfig,
    packagingConfig: S3StaticPackagingConfig,
  ): Promise<string> {
    const bucket = resolveEnvVars(targetConfig.bucket);
    const distributionId = targetConfig.distributionId
      ? resolveEnvVars(targetConfig.distributionId)
      : undefined;

    // List all files in the build output directory from the data bucket
    const sourcePrefix = `${this.projectPrefix}${packagingConfig.outputDir}`;
    const normalizedPrefix = sourcePrefix.endsWith('/') ? sourcePrefix : `${sourcePrefix}/`;

    let allKeys: string[] = [];
    let continuationToken: string | undefined;

    do {
      const listRes = await this.s3Client.send(new ListObjectsV2Command({
        Bucket: this.projectsBucket,
        Prefix: normalizedPrefix,
        ContinuationToken: continuationToken,
      }));

      const keys = (listRes.Contents ?? [])
        .map((obj) => obj.Key!)
        .filter(Boolean);
      allKeys = allKeys.concat(keys);

      continuationToken = listRes.IsTruncated
        ? listRes.NextContinuationToken
        : undefined;
    } while (continuationToken);

    if (allKeys.length === 0) {
      throw new Error(`No files found at ${packagingConfig.outputDir}`);
    }

    this.emitProgress({
      type: 'step-output',
      step: 'deploy',
      output: `Uploading ${allKeys.length} files to s3://${bucket}...`,
    });

    // Copy each file from data bucket to website bucket
    const BATCH_SIZE = 25;
    for (let i = 0; i < allKeys.length; i += BATCH_SIZE) {
      const batch = allKeys.slice(i, i + BATCH_SIZE);
      await Promise.all(
        batch.map(async (sourceKey) => {
          // Read from data bucket
          const getRes = await this.s3Client.send(new GetObjectCommand({
            Bucket: this.projectsBucket,
            Key: sourceKey,
          }));
          const body = await getRes.Body?.transformToByteArray();
          if (!body) return;

          // Determine destination key (relative to outputDir)
          const destKey = sourceKey.slice(normalizedPrefix.length);
          const contentType = getContentType(destKey);

          // Upload to website bucket
          await this.s3Client.send(new PutObjectCommand({
            Bucket: bucket,
            Key: destKey,
            Body: body,
            ContentType: contentType,
          }));
        }),
      );
    }

    // Invalidate CloudFront cache
    if (distributionId && this.cloudfrontClient) {
      this.emitProgress({
        type: 'step-output',
        step: 'deploy',
        output: `Invalidating CloudFront distribution ${distributionId}...`,
      });

      await this.cloudfrontClient.createInvalidation({
        DistributionId: distributionId,
        InvalidationBatch: {
          CallerReference: `deploy-${Date.now()}`,
          Paths: {
            Quantity: 1,
            Items: ['/*'],
          },
        },
      });
    }

    return `Uploaded ${allKeys.length} files to s3://${bucket}${distributionId ? ` + CloudFront invalidation` : ''}`;
  }

  // ---------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------

  private emitProgress(event: DeployProgressEvent): void {
    this.onProgress?.(event);
  }

  private makeResult(
    target: DeploymentTarget,
    module: DeploymentModule,
    status: 'success' | 'failed',
    steps: DeploymentStepProgress[],
    startedAt: string,
    error?: string,
  ): DeploymentResult {
    const finishedAt = new Date().toISOString();
    const durationMs = new Date(finishedAt).getTime() - new Date(startedAt).getTime();

    const result: DeploymentResult = {
      targetId: target.id,
      moduleId: module.id,
      status,
      steps,
      startedAt,
      finishedAt,
      durationMs,
      error,
    };

    this.emitProgress({
      type: 'step-completed',
      targetId: target.id,
      moduleId: module.id,
      result,
    });

    return result;
  }

  private errorResult(targetId: string, moduleId: string, error: string): DeploymentResult {
    return {
      targetId,
      moduleId,
      status: 'failed',
      steps: [],
      startedAt: new Date().toISOString(),
      finishedAt: new Date().toISOString(),
      durationMs: 0,
      error,
    };
  }
}
