/**
 * wf.utils.aws — AWS operational utilities for workflow rules.
 *
 * High-level convenience wrappers around the AWS SDK with automatic tracing
 * (emits workflow:util:start/end activity events per call). Plus an escape
 * hatch via `wf.utils.aws.sdk.*` for operations we don't wrap.
 *
 * Every utility:
 *  - Accepts an optional `environment` parameter (for future env-var resolution)
 *  - Emits a workflow:util:* trace span for the Activity Panel
 *  - Uses the current invocation/rule/operation IDs from the runtime
 *  - Throws on AWS API errors (rule author catches or propagates)
 */

import {
  LambdaClient,
  InvokeCommand,
  UpdateFunctionCodeCommand,
  GetFunctionConfigurationCommand,
} from '@aws-sdk/client-lambda';
import {
  CloudFrontClient,
  CreateInvalidationCommand,
  GetInvalidationCommand,
} from '@aws-sdk/client-cloudfront';
import {
  CloudWatchLogsClient,
  FilterLogEventsCommand,
  DescribeLogStreamsCommand,
} from '@aws-sdk/client-cloudwatch-logs';
import {
  CloudFormationClient,
  DescribeStacksCommand,
  DescribeStackEventsCommand,
} from '@aws-sdk/client-cloudformation';
import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  ListObjectsV2Command,
  DeleteObjectCommand,
} from '@aws-sdk/client-s3';
import {
  SSMClient,
  GetParameterCommand,
  PutParameterCommand,
  DeleteParameterCommand,
} from '@aws-sdk/client-ssm';
import {
  EC2Client,
  DescribeInstancesCommand,
  RebootInstancesCommand,
  StartInstancesCommand,
  StopInstancesCommand,
} from '@aws-sdk/client-ec2';
import type { ActivityLog } from '../activity-log.js';
import { Kinds } from '../../../shared/activity-types.js';

// ---------------------------------------------------------------------------
// Context + tracing
// ---------------------------------------------------------------------------

export interface AwsUtilsContext {
  readonly projectId: string;
  readonly region: string;
  /** Activity log for trace emission. Optional — when missing, calls are untraced. */
  readonly activityLog?: ActivityLog;
  /** Returns current invocation ID from the runtime (or null outside rules). */
  readonly getTraceContext: () => {
    invocationId: string | null;
    ruleId: string | null;
    operationId: string | null;
    environment: string | null;
  };
}

/** Wrap a function call with activity tracing — emits util:start/end. */
async function traced<T>(
  ctx: AwsUtilsContext,
  command: string,
  params: Record<string, unknown>,
  env: string | undefined,
  fn: () => Promise<T>,
): Promise<T> {
  const tctx = ctx.getTraceContext();
  const utilId = `util-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
  const parent = tctx.ruleId ?? tctx.invocationId ?? undefined;
  const environment = env ?? tctx.environment ?? undefined;
  const operationId = tctx.operationId ?? undefined;
  const start = Date.now();

  ctx.activityLog?.emit({
    source: 'workflow', kind: Kinds.WorkflowUtilStart, level: 'info',
    message: command,
    projectId: ctx.projectId,
    correlationId: utilId,
    parentId: parent,
    operationId,
    environment,
    data: { command, params },
  });

  try {
    const result = await fn();
    const durationMs = Date.now() - start;
    ctx.activityLog?.emit({
      source: 'workflow', kind: Kinds.WorkflowUtilEnd, level: 'info',
      message: `${command} OK (${durationMs}ms)`,
      projectId: ctx.projectId,
      correlationId: utilId,
      parentId: parent,
      operationId,
      environment,
      data: { durationMs, status: 'ok' },
    });
    return result;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    const durationMs = Date.now() - start;
    ctx.activityLog?.emit({
      source: 'workflow', kind: Kinds.WorkflowUtilEnd, level: 'error',
      message: `${command} FAILED: ${msg}`,
      projectId: ctx.projectId,
      correlationId: utilId,
      parentId: parent,
      operationId,
      environment,
      data: { durationMs, status: 'error', error: msg },
    });
    throw err;
  }
}

// ---------------------------------------------------------------------------
// Client factory (escape hatch)
// ---------------------------------------------------------------------------

function clientFactory(ctx: AwsUtilsContext) {
  return {
    /** Return a raw LambdaClient (untraced). */
    lambda: (opts?: ConstructorParameters<typeof LambdaClient>[0]) =>
      new LambdaClient({ region: ctx.region, ...(opts ?? {}) }),
    /** Return a raw CloudFrontClient (untraced). */
    cloudfront: (opts?: ConstructorParameters<typeof CloudFrontClient>[0]) =>
      new CloudFrontClient({ region: ctx.region, ...(opts ?? {}) }),
    /** Return a raw CloudWatchLogsClient (untraced). */
    cloudwatchLogs: (opts?: ConstructorParameters<typeof CloudWatchLogsClient>[0]) =>
      new CloudWatchLogsClient({ region: ctx.region, ...(opts ?? {}) }),
    /** Return a raw CloudFormationClient (untraced). */
    cfn: (opts?: ConstructorParameters<typeof CloudFormationClient>[0]) =>
      new CloudFormationClient({ region: ctx.region, ...(opts ?? {}) }),
    /** Return a raw S3Client (untraced). */
    s3: (opts?: ConstructorParameters<typeof S3Client>[0]) =>
      new S3Client({ region: ctx.region, ...(opts ?? {}) }),
    /** Return a raw SSMClient (untraced). */
    ssm: (opts?: ConstructorParameters<typeof SSMClient>[0]) =>
      new SSMClient({ region: ctx.region, ...(opts ?? {}) }),
    /** Return a raw EC2Client (untraced). */
    ec2: (opts?: ConstructorParameters<typeof EC2Client>[0]) =>
      new EC2Client({ region: ctx.region, ...(opts ?? {}) }),
  };
}

// ---------------------------------------------------------------------------
// Lambda
// ---------------------------------------------------------------------------

function lambdaUtils(ctx: AwsUtilsContext) {
  return {
    /** Invoke a Lambda function synchronously. Returns the parsed JSON payload. */
    invoke: async (params: {
      functionName: string;
      payload?: unknown;
      /** 'RequestResponse' (sync) or 'Event' (async fire-and-forget). Default 'RequestResponse'. */
      invocationType?: 'RequestResponse' | 'Event';
      environment?: string;
    }): Promise<unknown> => {
      return traced(ctx, `aws.lambda.invoke(${params.functionName})`, params, params.environment, async () => {
        const client = new LambdaClient({ region: ctx.region });
        const result = await client.send(new InvokeCommand({
          FunctionName: params.functionName,
          InvocationType: params.invocationType ?? 'RequestResponse',
          Payload: params.payload !== undefined
            ? Buffer.from(JSON.stringify(params.payload))
            : undefined,
        }));
        if (!result.Payload) return undefined;
        const text = Buffer.from(result.Payload).toString('utf-8');
        try { return JSON.parse(text); } catch { return text; }
      });
    },

    /** Update a Lambda function's code from a zip Buffer. */
    updateCode: async (params: {
      functionName: string;
      zipFile: Buffer;
      environment?: string;
    }): Promise<{ lastUpdateStatus?: string; codeSha256?: string }> => {
      return traced(ctx, `aws.lambda.updateCode(${params.functionName})`, { functionName: params.functionName, bytes: params.zipFile.length }, params.environment, async () => {
        const client = new LambdaClient({ region: ctx.region });
        const result = await client.send(new UpdateFunctionCodeCommand({
          FunctionName: params.functionName,
          ZipFile: params.zipFile,
        }));
        return { lastUpdateStatus: result.LastUpdateStatus, codeSha256: result.CodeSha256 };
      });
    },

    /** Get a Lambda function's current configuration. */
    getConfig: async (params: { functionName: string; environment?: string }): Promise<Record<string, unknown>> => {
      return traced(ctx, `aws.lambda.getConfig(${params.functionName})`, params, params.environment, async () => {
        const client = new LambdaClient({ region: ctx.region });
        const result = await client.send(new GetFunctionConfigurationCommand({
          FunctionName: params.functionName,
        }));
        return result as unknown as Record<string, unknown>;
      });
    },
  };
}

// ---------------------------------------------------------------------------
// CloudFront
// ---------------------------------------------------------------------------

function cloudfrontUtils(ctx: AwsUtilsContext) {
  return {
    /** Create an invalidation for one or more paths. Returns invalidation ID. */
    invalidate: async (params: {
      distributionId: string;
      paths?: string[]; // default ['/*']
      environment?: string;
    }): Promise<{ id?: string; status?: string }> => {
      const paths = params.paths ?? ['/*'];
      return traced(ctx, `aws.cloudfront.invalidate(${params.distributionId})`, { paths }, params.environment, async () => {
        const client = new CloudFrontClient({ region: ctx.region });
        const result = await client.send(new CreateInvalidationCommand({
          DistributionId: params.distributionId,
          InvalidationBatch: {
            CallerReference: `wf-${Date.now()}`,
            Paths: { Quantity: paths.length, Items: paths },
          },
        }));
        return { id: result.Invalidation?.Id, status: result.Invalidation?.Status };
      });
    },

    /** Check the status of an invalidation. */
    getInvalidation: async (params: {
      distributionId: string;
      invalidationId: string;
      environment?: string;
    }): Promise<{ status?: string }> => {
      return traced(ctx, `aws.cloudfront.getInvalidation(${params.invalidationId})`, params, params.environment, async () => {
        const client = new CloudFrontClient({ region: ctx.region });
        const result = await client.send(new GetInvalidationCommand({
          DistributionId: params.distributionId,
          Id: params.invalidationId,
        }));
        return { status: result.Invalidation?.Status };
      });
    },
  };
}

// ---------------------------------------------------------------------------
// CloudWatch Logs
// ---------------------------------------------------------------------------

function cloudwatchUtils(ctx: AwsUtilsContext) {
  return {
    /**
     * Fetch recent log events from a log group (and optionally a specific stream).
     * Returns events sorted oldest → newest.
     */
    tailLogs: async (params: {
      logGroup: string;
      logStreamPrefix?: string;
      /** Relative time string ('-10m', '-1h') or absolute ISO. Default '-10m'. */
      since?: string;
      limit?: number; // default 100
      filterPattern?: string;
      environment?: string;
    }): Promise<Array<{ timestamp: string; message: string; stream?: string }>> => {
      const limit = params.limit ?? 100;
      const since = params.since ?? '-10m';
      const startTimeMs = parseTimeOffset(since);
      return traced(ctx, `aws.cloudwatch.tailLogs(${params.logGroup})`, { since, limit, filter: params.filterPattern }, params.environment, async () => {
        const client = new CloudWatchLogsClient({ region: ctx.region });
        const result = await client.send(new FilterLogEventsCommand({
          logGroupName: params.logGroup,
          logStreamNamePrefix: params.logStreamPrefix,
          startTime: startTimeMs,
          limit,
          filterPattern: params.filterPattern,
        }));
        return (result.events ?? []).map(e => ({
          timestamp: new Date(e.timestamp ?? 0).toISOString(),
          message: e.message ?? '',
          stream: e.logStreamName,
        }));
      });
    },

    /** List log streams in a log group. */
    listStreams: async (params: {
      logGroup: string;
      prefix?: string;
      limit?: number;
      environment?: string;
    }): Promise<Array<{ name: string; lastEventTime?: string }>> => {
      return traced(ctx, `aws.cloudwatch.listStreams(${params.logGroup})`, params, params.environment, async () => {
        const client = new CloudWatchLogsClient({ region: ctx.region });
        const result = await client.send(new DescribeLogStreamsCommand({
          logGroupName: params.logGroup,
          logStreamNamePrefix: params.prefix,
          limit: params.limit ?? 50,
          orderBy: 'LastEventTime',
          descending: true,
        }));
        return (result.logStreams ?? []).map(s => ({
          name: s.logStreamName ?? '',
          lastEventTime: s.lastEventTimestamp ? new Date(s.lastEventTimestamp).toISOString() : undefined,
        }));
      });
    },
  };
}

/** Parse time offsets like '-10m', '-1h', '-2d' or absolute ISO. Returns ms timestamp. */
function parseTimeOffset(spec: string): number {
  if (spec.startsWith('-')) {
    const m = spec.match(/^-(\d+)(ms|s|m|h|d)$/);
    if (m) {
      const n = parseInt(m[1], 10);
      const unit = m[2];
      const multipliers: Record<string, number> = {
        ms: 1, s: 1000, m: 60_000, h: 3_600_000, d: 86_400_000,
      };
      return Date.now() - n * (multipliers[unit] ?? 1);
    }
  }
  const parsed = Date.parse(spec);
  if (!isNaN(parsed)) return parsed;
  return Date.now() - 10 * 60_000; // default: 10 min ago
}

// ---------------------------------------------------------------------------
// CloudFormation
// ---------------------------------------------------------------------------

function cfnUtils(ctx: AwsUtilsContext) {
  return {
    /** Read a stack's outputs as { OutputKey: OutputValue }. */
    getOutputs: async (params: { stackName: string; environment?: string }): Promise<Record<string, string>> => {
      return traced(ctx, `aws.cfn.getOutputs(${params.stackName})`, params, params.environment, async () => {
        const client = new CloudFormationClient({ region: ctx.region });
        const result = await client.send(new DescribeStacksCommand({
          StackName: params.stackName,
        }));
        const stack = result.Stacks?.[0];
        const outputs: Record<string, string> = {};
        for (const o of (stack?.Outputs ?? [])) {
          if (o.OutputKey && o.OutputValue) outputs[o.OutputKey] = o.OutputValue;
        }
        return outputs;
      });
    },

    /** Get recent stack events. */
    getEvents: async (params: { stackName: string; limit?: number; environment?: string }): Promise<Array<{ timestamp: string; resourceStatus?: string; logicalResourceId?: string; resourceType?: string; reason?: string }>> => {
      return traced(ctx, `aws.cfn.getEvents(${params.stackName})`, params, params.environment, async () => {
        const client = new CloudFormationClient({ region: ctx.region });
        const result = await client.send(new DescribeStackEventsCommand({
          StackName: params.stackName,
        }));
        return (result.StackEvents ?? []).slice(0, params.limit ?? 50).map(e => ({
          timestamp: e.Timestamp?.toISOString() ?? '',
          resourceStatus: e.ResourceStatus,
          logicalResourceId: e.LogicalResourceId,
          resourceType: e.ResourceType,
          reason: e.ResourceStatusReason,
        }));
      });
    },

    /** Get a stack's current status. */
    getStatus: async (params: { stackName: string; environment?: string }): Promise<{ stackStatus?: string; lastUpdatedTime?: string }> => {
      return traced(ctx, `aws.cfn.getStatus(${params.stackName})`, params, params.environment, async () => {
        const client = new CloudFormationClient({ region: ctx.region });
        const result = await client.send(new DescribeStacksCommand({
          StackName: params.stackName,
        }));
        const stack = result.Stacks?.[0];
        return {
          stackStatus: stack?.StackStatus,
          lastUpdatedTime: stack?.LastUpdatedTime?.toISOString(),
        };
      });
    },
  };
}

// ---------------------------------------------------------------------------
// S3
// ---------------------------------------------------------------------------

function s3Utils(ctx: AwsUtilsContext) {
  return {
    /** Upload a file to S3. */
    putObject: async (params: {
      bucket: string;
      key: string;
      body: string | Buffer;
      contentType?: string;
      cacheControl?: string;
      environment?: string;
    }): Promise<void> => {
      await traced(ctx, `aws.s3.putObject(${params.bucket}/${params.key})`, { bucket: params.bucket, key: params.key, bytes: params.body.length }, params.environment, async () => {
        const client = new S3Client({ region: ctx.region });
        await client.send(new PutObjectCommand({
          Bucket: params.bucket,
          Key: params.key,
          Body: params.body,
          ContentType: params.contentType ?? 'application/octet-stream',
          CacheControl: params.cacheControl ?? 'no-cache',
        }));
      });
    },

    /** Read an object as a string. */
    getObject: async (params: { bucket: string; key: string; environment?: string }): Promise<string> => {
      return traced(ctx, `aws.s3.getObject(${params.bucket}/${params.key})`, params, params.environment, async () => {
        const client = new S3Client({ region: ctx.region });
        const result = await client.send(new GetObjectCommand({
          Bucket: params.bucket,
          Key: params.key,
        }));
        if (!result.Body) return '';
        const chunks: Uint8Array[] = [];
        for await (const chunk of result.Body as any) {
          chunks.push(chunk instanceof Buffer ? chunk : Buffer.from(chunk));
        }
        return Buffer.concat(chunks).toString('utf-8');
      });
    },

    /** List objects with a given prefix. */
    listObjects: async (params: {
      bucket: string;
      prefix?: string;
      maxKeys?: number;
      environment?: string;
    }): Promise<Array<{ key: string; size?: number; lastModified?: string }>> => {
      return traced(ctx, `aws.s3.listObjects(${params.bucket}/${params.prefix ?? ''})`, params, params.environment, async () => {
        const client = new S3Client({ region: ctx.region });
        const result = await client.send(new ListObjectsV2Command({
          Bucket: params.bucket,
          Prefix: params.prefix,
          MaxKeys: params.maxKeys ?? 1000,
        }));
        return (result.Contents ?? []).map(c => ({
          key: c.Key ?? '',
          size: c.Size,
          lastModified: c.LastModified?.toISOString(),
        }));
      });
    },

    /** Delete an object. */
    deleteObject: async (params: { bucket: string; key: string; environment?: string }): Promise<void> => {
      await traced(ctx, `aws.s3.deleteObject(${params.bucket}/${params.key})`, params, params.environment, async () => {
        const client = new S3Client({ region: ctx.region });
        await client.send(new DeleteObjectCommand({
          Bucket: params.bucket,
          Key: params.key,
        }));
      });
    },
  };
}

// ---------------------------------------------------------------------------
// SSM (Parameter Store)
// ---------------------------------------------------------------------------

function ssmUtils(ctx: AwsUtilsContext) {
  return {
    /** Get a SecureString parameter (decrypted). */
    getSecret: async (params: { name: string; environment?: string }): Promise<string | undefined> => {
      // Resolve the actual SSM path based on project + environment
      const env = params.environment ?? ctx.getTraceContext().environment ?? 'default';
      const path = `/antimatter/env/${ctx.projectId}/${env || 'default'}/${params.name}`;
      return traced(ctx, `aws.ssm.getSecret(${path})`, { name: params.name, environment: env }, params.environment, async () => {
        const client = new SSMClient({ region: ctx.region });
        try {
          const result = await client.send(new GetParameterCommand({
            Name: path,
            WithDecryption: true,
          }));
          return result.Parameter?.Value;
        } catch (err: any) {
          if (err?.name === 'ParameterNotFound') return undefined;
          throw err;
        }
      });
    },

    /** Write a SecureString parameter. */
    setSecret: async (params: { name: string; value: string; description?: string; environment?: string }): Promise<void> => {
      const env = params.environment ?? ctx.getTraceContext().environment ?? 'default';
      const path = `/antimatter/env/${ctx.projectId}/${env || 'default'}/${params.name}`;
      await traced(ctx, `aws.ssm.setSecret(${path})`, { name: params.name, environment: env }, params.environment, async () => {
        const client = new SSMClient({ region: ctx.region });
        await client.send(new PutParameterCommand({
          Name: path,
          Value: params.value,
          Type: 'SecureString',
          Overwrite: true,
          Description: params.description,
        }));
      });
    },

    /** Delete a parameter. */
    deleteSecret: async (params: { name: string; environment?: string }): Promise<void> => {
      const env = params.environment ?? ctx.getTraceContext().environment ?? 'default';
      const path = `/antimatter/env/${ctx.projectId}/${env || 'default'}/${params.name}`;
      await traced(ctx, `aws.ssm.deleteSecret(${path})`, { name: params.name, environment: env }, params.environment, async () => {
        const client = new SSMClient({ region: ctx.region });
        try {
          await client.send(new DeleteParameterCommand({ Name: path }));
        } catch (err: any) {
          if (err?.name !== 'ParameterNotFound') throw err;
        }
      });
    },
  };
}

// ---------------------------------------------------------------------------
// EC2
// ---------------------------------------------------------------------------

function ec2Utils(ctx: AwsUtilsContext) {
  return {
    /** Describe instances by IDs. */
    describe: async (params: { instanceIds: string[]; environment?: string }): Promise<Array<{ instanceId: string; state?: string; privateIp?: string; publicIp?: string; tags?: Record<string, string> }>> => {
      return traced(ctx, `aws.ec2.describe(${params.instanceIds.length} instances)`, params, params.environment, async () => {
        const client = new EC2Client({ region: ctx.region });
        const result = await client.send(new DescribeInstancesCommand({
          InstanceIds: params.instanceIds,
        }));
        const out: Array<{ instanceId: string; state?: string; privateIp?: string; publicIp?: string; tags?: Record<string, string> }> = [];
        for (const reservation of (result.Reservations ?? [])) {
          for (const i of (reservation.Instances ?? [])) {
            const tags: Record<string, string> = {};
            for (const t of (i.Tags ?? [])) {
              if (t.Key && t.Value !== undefined) tags[t.Key] = t.Value;
            }
            out.push({
              instanceId: i.InstanceId ?? '',
              state: i.State?.Name,
              privateIp: i.PrivateIpAddress,
              publicIp: i.PublicIpAddress,
              tags,
            });
          }
        }
        return out;
      });
    },

    /** Reboot instances (in-place reboot). */
    reboot: async (params: { instanceIds: string[]; environment?: string }): Promise<void> => {
      await traced(ctx, `aws.ec2.reboot(${params.instanceIds.join(',')})`, params, params.environment, async () => {
        const client = new EC2Client({ region: ctx.region });
        await client.send(new RebootInstancesCommand({ InstanceIds: params.instanceIds }));
      });
    },

    /** Start stopped instances. */
    start: async (params: { instanceIds: string[]; environment?: string }): Promise<void> => {
      await traced(ctx, `aws.ec2.start(${params.instanceIds.join(',')})`, params, params.environment, async () => {
        const client = new EC2Client({ region: ctx.region });
        await client.send(new StartInstancesCommand({ InstanceIds: params.instanceIds }));
      });
    },

    /** Stop running instances. */
    stop: async (params: { instanceIds: string[]; environment?: string }): Promise<void> => {
      await traced(ctx, `aws.ec2.stop(${params.instanceIds.join(',')})`, params, params.environment, async () => {
        const client = new EC2Client({ region: ctx.region });
        await client.send(new StopInstancesCommand({ InstanceIds: params.instanceIds }));
      });
    },
  };
}

// ---------------------------------------------------------------------------
// Factory — assembles the aws namespace
// ---------------------------------------------------------------------------

export function createAwsUtils(ctx: AwsUtilsContext) {
  return {
    lambda: lambdaUtils(ctx),
    cloudfront: cloudfrontUtils(ctx),
    cloudwatch: cloudwatchUtils(ctx),
    cfn: cfnUtils(ctx),
    s3: s3Utils(ctx),
    ssm: ssmUtils(ctx),
    ec2: ec2Utils(ctx),
    /** Escape hatch — raw SDK clients (not auto-traced). */
    sdk: clientFactory(ctx),
  };
}
