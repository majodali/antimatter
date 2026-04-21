/**
 * Admin routes — operational endpoints that live in Lambda ("stepmother"/POE).
 *
 * These can perform actions on the workspace host and its children that
 * can't be done from inside the host itself:
 *  - Restart the Router process (SSM command to the EC2 instance)
 *  - Reload bundles from S3 + restart
 *  - Restart a specific project worker (via Router's /internal endpoint)
 *  - EC2 lifecycle: reboot, stop, start, recycle
 *  - Detailed instance status
 *
 * All endpoints:
 *  - Require Cognito auth (applied by apiRouter parent)
 *  - Honor X-Operation-Id header for end-to-end trace correlation
 *  - Emit EventBridge events for cross-environment observability
 *  - Return quickly (operations often fire-and-forget)
 */

import express, { type Request, type Response } from 'express';
import { randomUUID } from 'node:crypto';
import {
  EC2Client,
  DescribeInstancesCommand,
  RebootInstancesCommand,
  StopInstancesCommand,
  StartInstancesCommand,
  TerminateInstancesCommand,
  DescribeInstanceStatusCommand,
} from '@aws-sdk/client-ec2';
import {
  SSMClient,
  SendCommandCommand,
  GetCommandInvocationCommand,
} from '@aws-sdk/client-ssm';
import type { EventLogger } from '../services/event-logger.js';

// ---------------------------------------------------------------------------
// Dependencies
// ---------------------------------------------------------------------------

export interface AdminRouterDeps {
  /** EC2 client for instance lifecycle. */
  ec2Client: EC2Client;
  /** SSM client for remote command execution. */
  ssmClient: SSMClient;
  /** EventLogger for emitting instance:* activity events. */
  eventLogger: EventLogger;
  /** ALB DNS name — used to reach Router's internal endpoints. */
  albDns: string;
  /** Projects S3 bucket (for bundle downloads). */
  projectsBucket: string;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Extract operationId from header or generate new one. */
function getOperationId(req: Request): string {
  return (req.headers['x-operation-id'] as string | undefined) ?? randomUUID();
}

/** Emit an instance:* activity event via EventLogger → EventBridge + S3. */
async function emitInstanceEvent(
  eventLogger: EventLogger,
  kind: string,
  message: string,
  detail: Record<string, unknown>,
  operationId: string,
): Promise<void> {
  await eventLogger.emit(kind, 'workspace', 'info', message, {
    ...detail,
    operationId,
  });
}

/** Find instance by projectId tag. */
async function findInstanceByProject(ec2: EC2Client, projectId: string): Promise<{ instanceId: string; privateIp?: string } | null> {
  const result = await ec2.send(new DescribeInstancesCommand({
    Filters: [
      { Name: 'tag:antimatter:projectId', Values: [projectId] },
      { Name: 'instance-state-name', Values: ['running', 'stopped', 'stopping', 'pending'] },
    ],
  }));
  for (const r of (result.Reservations ?? [])) {
    for (const i of (r.Instances ?? [])) {
      if (i.InstanceId) return { instanceId: i.InstanceId, privateIp: i.PrivateIpAddress };
    }
  }
  return null;
}

/** Run SSM command on an instance, returns command ID (fire-and-forget). */
async function runSsmCommand(ssm: SSMClient, instanceId: string, commands: string[]): Promise<string> {
  const result = await ssm.send(new SendCommandCommand({
    InstanceIds: [instanceId],
    DocumentName: 'AWS-RunShellScript',
    Parameters: { commands },
  }));
  return result.Command?.CommandId ?? '';
}

/** Resolve target instance ID from request body (explicit) or project tag. */
async function resolveInstance(
  ec2: EC2Client,
  req: Request,
): Promise<{ instanceId: string; privateIp?: string } | null> {
  const explicit = req.body?.instanceId as string | undefined;
  if (explicit) {
    const result = await ec2.send(new DescribeInstancesCommand({ InstanceIds: [explicit] }));
    const i = result.Reservations?.[0]?.Instances?.[0];
    if (i) return { instanceId: i.InstanceId!, privateIp: i.PrivateIpAddress };
    return null;
  }
  const projectId = req.body?.projectId as string | undefined;
  if (projectId) {
    return findInstanceByProject(ec2, projectId);
  }
  return null;
}

// ---------------------------------------------------------------------------
// Router factory
// ---------------------------------------------------------------------------

export function createAdminRouter(deps: AdminRouterDeps): express.Router {
  const router = express.Router();
  const { ec2Client, ssmClient, eventLogger, albDns, projectsBucket } = deps;

  // ---- Host (Router) operations ----

  /** Restart the Router process via SSM (systemd will keep it running if configured). */
  router.post('/host/restart', async (req, res) => {
    const operationId = getOperationId(req);
    const target = await resolveInstance(ec2Client, req);
    if (!target) return res.status(404).json({ error: 'No target instance found (specify instanceId or projectId)' });

    const cmd = [
      'pkill -f workspace-server.js || true',
      'sleep 2',
      'set -a; source /opt/antimatter/config.env; set +a; cd /opt/antimatter && nohup node workspace-server.js > /var/log/workspace-server.log 2>&1 &',
      'echo "router-restart-sent"',
    ];
    const commandId = await runSsmCommand(ssmClient, target.instanceId, cmd);
    await emitInstanceEvent(eventLogger, 'host.restart', `Restarting Router on ${target.instanceId}`, {
      instanceId: target.instanceId, ssmCommandId: commandId,
    }, operationId);

    res.json({ operationId, instanceId: target.instanceId, ssmCommandId: commandId, status: 'queued' });
  });

  /** Pull latest bundles from S3, then restart Router. */
  router.post('/host/reload-bundles', async (req, res) => {
    const operationId = getOperationId(req);
    const target = await resolveInstance(ec2Client, req);
    if (!target) return res.status(404).json({ error: 'No target instance found' });

    const cmd = [
      `cd /opt/antimatter && aws s3 cp s3://${projectsBucket}/workspace-server/workspace-server.js workspace-server.js && aws s3 cp s3://${projectsBucket}/workspace-server/project-worker.js project-worker.js`,
      'pkill -f workspace-server.js || true',
      'sleep 2',
      'set -a; source /opt/antimatter/config.env; set +a; cd /opt/antimatter && nohup node workspace-server.js > /var/log/workspace-server.log 2>&1 &',
      'echo "host-reload-sent"',
    ];
    const commandId = await runSsmCommand(ssmClient, target.instanceId, cmd);
    await emitInstanceEvent(eventLogger, 'host.reload-bundles', `Reloading bundles on ${target.instanceId}`, {
      instanceId: target.instanceId, ssmCommandId: commandId,
    }, operationId);

    res.json({ operationId, instanceId: target.instanceId, ssmCommandId: commandId, status: 'queued' });
  });

  /** Tail Router log via SSM. Returns recent log lines. */
  router.post('/host/logs', async (req, res) => {
    const operationId = getOperationId(req);
    const target = await resolveInstance(ec2Client, req);
    if (!target) return res.status(404).json({ error: 'No target instance found' });
    const lines = Math.min(parseInt(req.body?.lines ?? '100', 10) || 100, 1000);

    const cmd = [`tail -n ${lines} /var/log/workspace-server.log 2>/dev/null || echo "(no log)"`];
    const commandId = await runSsmCommand(ssmClient, target.instanceId, cmd);

    // Poll for completion (up to 10 seconds)
    let output = '';
    for (let i = 0; i < 20; i++) {
      await new Promise(r => setTimeout(r, 500));
      try {
        const result = await ssmClient.send(new GetCommandInvocationCommand({
          CommandId: commandId,
          InstanceId: target.instanceId,
        }));
        if (result.Status === 'Success' || result.Status === 'Failed') {
          output = result.StandardOutputContent ?? '';
          break;
        }
      } catch { /* not ready yet */ }
    }

    res.json({ operationId, instanceId: target.instanceId, lines: output.split('\n') });
  });

  // ---- Project worker operations (delegate to Router's internal endpoints) ----

  /** Restart a specific project's worker (Router kills + respawns). */
  router.post('/project/restart', async (req, res) => {
    const operationId = getOperationId(req);
    const projectId = req.body?.projectId as string | undefined;
    if (!projectId) return res.status(400).json({ error: 'projectId required' });

    // DELETE /internal/project-context/:projectId triggers graceful shutdown;
    // next request to that project will spawn a fresh worker.
    try {
      const response = await fetch(`https://ide.antimatter.solutions/internal/project-context/${projectId}`, {
        method: 'DELETE',
        headers: { 'X-Operation-Id': operationId },
      });
      const body = await response.text();
      await emitInstanceEvent(eventLogger, 'project.restart', `Restarted worker: ${projectId}`, {
        projectId, status: response.status,
      }, operationId);
      res.json({ operationId, projectId, status: response.ok ? 'restarted' : 'error', routerResponse: body });
    } catch (err) {
      res.status(502).json({ operationId, error: 'Failed to reach Router', message: err instanceof Error ? err.message : String(err) });
    }
  });

  // ---- Instance lifecycle (EC2) ----

  /** Get detailed EC2 instance status (state, health checks, IPs, tags). */
  router.get('/instance/status', async (req, res) => {
    const projectId = (req.query.projectId as string | undefined) ?? undefined;
    const instanceId = (req.query.instanceId as string | undefined) ?? undefined;

    let target: { instanceId: string } | null = null;
    if (instanceId) target = { instanceId };
    else if (projectId) target = await findInstanceByProject(ec2Client, projectId);
    if (!target) return res.status(404).json({ error: 'No target instance' });

    const [desc, status] = await Promise.all([
      ec2Client.send(new DescribeInstancesCommand({ InstanceIds: [target.instanceId] })),
      ec2Client.send(new DescribeInstanceStatusCommand({ InstanceIds: [target.instanceId], IncludeAllInstances: true })),
    ]);
    const i = desc.Reservations?.[0]?.Instances?.[0];
    const s = status.InstanceStatuses?.[0];

    res.json({
      instanceId: target.instanceId,
      state: i?.State?.Name,
      privateIp: i?.PrivateIpAddress,
      publicIp: i?.PublicIpAddress,
      instanceType: i?.InstanceType,
      launchTime: i?.LaunchTime?.toISOString(),
      systemStatus: s?.SystemStatus?.Status,
      instanceStatus: s?.InstanceStatus?.Status,
      tags: (i?.Tags ?? []).reduce((acc: Record<string, string>, t) => {
        if (t.Key && t.Value !== undefined) acc[t.Key] = t.Value;
        return acc;
      }, {}),
    });
  });

  /** EC2 reboot (in-place OS reboot, keeps state). */
  router.post('/instance/reboot', async (req, res) => {
    const operationId = getOperationId(req);
    const target = await resolveInstance(ec2Client, req);
    if (!target) return res.status(404).json({ error: 'No target instance' });

    await ec2Client.send(new RebootInstancesCommand({ InstanceIds: [target.instanceId] }));
    await emitInstanceEvent(eventLogger, 'instance.reboot', `Rebooting instance ${target.instanceId}`, {
      instanceId: target.instanceId,
    }, operationId);
    res.json({ operationId, instanceId: target.instanceId, status: 'rebooting' });
  });

  /** EC2 stop (graceful — preserves EBS). */
  router.post('/instance/stop', async (req, res) => {
    const operationId = getOperationId(req);
    const target = await resolveInstance(ec2Client, req);
    if (!target) return res.status(404).json({ error: 'No target instance' });

    await ec2Client.send(new StopInstancesCommand({ InstanceIds: [target.instanceId] }));
    await emitInstanceEvent(eventLogger, 'instance.stop', `Stopping instance ${target.instanceId}`, {
      instanceId: target.instanceId,
    }, operationId);
    res.json({ operationId, instanceId: target.instanceId, status: 'stopping' });
  });

  /** EC2 start (resume stopped instance). */
  router.post('/instance/start', async (req, res) => {
    const operationId = getOperationId(req);
    const target = await resolveInstance(ec2Client, req);
    if (!target) return res.status(404).json({ error: 'No target instance' });

    await ec2Client.send(new StartInstancesCommand({ InstanceIds: [target.instanceId] }));
    await emitInstanceEvent(eventLogger, 'instance.start', `Starting instance ${target.instanceId}`, {
      instanceId: target.instanceId,
    }, operationId);
    res.json({ operationId, instanceId: target.instanceId, status: 'starting' });
  });

  /** EC2 recycle — terminate (caller must launch new one separately via /api/workspace/start). */
  router.post('/instance/terminate', async (req, res) => {
    const operationId = getOperationId(req);
    const target = await resolveInstance(ec2Client, req);
    if (!target) return res.status(404).json({ error: 'No target instance' });

    await ec2Client.send(new TerminateInstancesCommand({ InstanceIds: [target.instanceId] }));
    await emitInstanceEvent(eventLogger, 'instance.terminate', `Terminating instance ${target.instanceId}`, {
      instanceId: target.instanceId,
    }, operationId);
    res.json({ operationId, instanceId: target.instanceId, status: 'terminating' });
  });

  return router;
}
