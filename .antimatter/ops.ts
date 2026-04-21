/**
 * Operations Automation — registers Antimatter's platform resources and
 * defines operational actions (restart, reload, invalidate, recycle, etc.)
 *
 * This file demonstrates the layered ops model:
 *  - Platform resources (host, workers, CDN, API Lambda, buckets) registered
 *    dynamically via wf.utils.resource.register()
 *  - Action triggers defined as workflow rules
 *  - Actions call either wf.utils.aws.* directly, or the Lambda admin
 *    endpoints (/api/admin/*) for ops that must act from outside EC2
 *  - Worker lifecycle events from Router (worker:spawned/exited) auto-register
 *    and deregister worker resources
 */
// No imports — automation files use the `wf` runtime parameter.

// Production domain — stepmother (Lambda admin) endpoints live here.
const PROD_API = 'https://ide.antimatter.solutions/api';

// Production environment label — defines scope for resource registration.
const ENV = 'production';

export default (wf: any) => {

  // -------------------------------------------------------------------------
  // Widgets — action buttons in the Operations panel
  // -------------------------------------------------------------------------

  wf.widget('ops-host-restart', {
    type: 'button',
    label: 'Restart Router',
    section: 'ops',
    icon: 'refresh',
    variant: 'destructive',
    event: { type: 'host:restart' },
  });

  wf.widget('ops-host-reload', {
    type: 'button',
    label: 'Reload Bundles + Restart',
    section: 'ops',
    icon: 'download',
    variant: 'destructive',
    event: { type: 'host:reload-bundles' },
  });

  wf.widget('ops-cdn-invalidate', {
    type: 'button',
    label: 'Invalidate CDN',
    section: 'ops',
    icon: 'zap',
    variant: 'default',
    event: { type: 'cdn:invalidate' },
  });

  wf.widget('ops-instance-reboot', {
    type: 'button',
    label: 'Reboot Instance',
    section: 'ops',
    icon: 'power',
    variant: 'destructive',
    event: { type: 'instance:reboot' },
  });

  wf.widget('ops-register-resources', {
    type: 'button',
    label: 'Refresh Resource Registry',
    section: 'ops',
    icon: 'list',
    variant: 'secondary',
    event: { type: 'ops:register-platform-resources' },
  });

  // -------------------------------------------------------------------------
  // Register static platform resources on project:initialize
  // (These don't change with workers — they're the deployed infrastructure)
  // -------------------------------------------------------------------------

  wf.rule('Register platform resources',
    (e: any) => e.type === 'project:initialize' || e.type === 'ops:register-platform-resources',
    async () => {
      wf.log('Registering Antimatter platform resources...');

      // Look up current deployment details from CloudFormation.
      let outputs: Record<string, string> = {};
      try {
        outputs = await wf.utils.aws.cfn.getOutputs({ stackName: 'AntimatterStack' });
      } catch (err: any) {
        wf.log(`Failed to read CFN outputs: ${err?.message ?? err}`, 'warn');
      }

      const distributionId = outputs.DistributionId ?? '';
      const websiteBucket = outputs.S3BucketName ?? '';
      const dataBucket = outputs.DataBucketName ?? '';
      const apiUrl = outputs.ApiURL ?? '';
      const albDns = outputs.WorkspaceAlbDns ?? '';

      // CloudFront distribution — frontend CDN
      if (distributionId) {
        await wf.utils.resource.register({
          id: 'cdn-production',
          name: 'CloudFront CDN',
          resourceType: 'aws:cloudfront',
          environment: ENV,
          instance: { distributionId, region: 'us-east-1', domain: 'ide.antimatter.solutions' },
          actions: [
            { triggerId: 'cdn:invalidate', label: 'Invalidate', icon: 'zap' },
          ],
        });
      }

      // API Lambda — REST API backend (name is dynamic, looked up)
      try {
        const fns = await wf.utils.aws.lambda.list({
          namePrefix: 'AntimatterStack-ApiFunction',
          environment: ENV,
        });
        const apiFn = fns[0];
        if (apiFn) {
          await wf.utils.resource.register({
            id: 'api-lambda-production',
            name: 'API Lambda',
            resourceType: 'aws:lambda',
            environment: ENV,
            instance: { functionName: apiFn.functionName, functionArn: apiFn.functionArn },
            actions: [
              { triggerId: 'api:tail-logs', label: 'Tail logs', icon: 'terminal' },
              { triggerId: 'api:show-config', label: 'Show config', icon: 'info' },
            ],
          });
        }
      } catch (err: any) {
        wf.log(`Failed to enumerate Lambda functions: ${err?.message ?? err}`, 'warn');
      }

      // S3 buckets — frontend + data
      if (websiteBucket) {
        await wf.utils.resource.register({
          id: 'website-bucket-production',
          name: 'Frontend S3 Bucket',
          resourceType: 'aws:s3-bucket',
          environment: ENV,
          instance: { bucketName: websiteBucket, region: 'us-west-2' },
        });
      }
      if (dataBucket) {
        await wf.utils.resource.register({
          id: 'data-bucket-production',
          name: 'Data S3 Bucket',
          resourceType: 'aws:s3-bucket',
          environment: ENV,
          instance: { bucketName: dataBucket, region: 'us-west-2' },
        });
      }

      // ALB — workspace router traffic
      if (albDns) {
        await wf.utils.resource.register({
          id: 'alb-production',
          name: 'Workspace ALB',
          resourceType: 'aws:alb',
          environment: ENV,
          instance: { dnsName: albDns, region: 'us-west-2' },
        });
      }

      // Antimatter Host (Router + EC2 instance) — singleton for now
      await wf.utils.resource.register({
        id: 'antimatter-host-production',
        name: 'Antimatter Host',
        resourceType: 'antimatter:host',
        environment: ENV,
        instance: { apiUrl, albDns, note: 'Router + workspace EC2' },
        actions: [
          { triggerId: 'host:restart', label: 'Restart Router', icon: 'refresh', destructive: true },
          { triggerId: 'host:reload-bundles', label: 'Reload Bundles', icon: 'download', destructive: true },
          { triggerId: 'host:tail-logs', label: 'Tail Router logs', icon: 'terminal' },
          { triggerId: 'instance:reboot', label: 'Reboot EC2', icon: 'power', destructive: true },
        ],
      });

      wf.log(`Registered platform resources (env=${ENV}, dist=${distributionId}, dataBucket=${dataBucket})`);
    });

  // -------------------------------------------------------------------------
  // Dynamic worker registration — react to Router's lifecycle events
  // -------------------------------------------------------------------------

  wf.rule('Register worker on spawn',
    (e: any) => e.type === 'worker:spawned',
    async (events: any[]) => {
      for (const e of events) {
        await wf.utils.resource.register({
          id: `worker-${e.projectId}`,
          name: `Worker: ${e.projectId}`,
          resourceType: 'antimatter:worker',
          environment: ENV,
          instance: {
            projectId: e.projectId,
            hostedOn: e.instanceId,
            pid: e.pid,
            spawnedAt: e.spawnedAt,
          },
          status: 'healthy',
          actions: [
            { triggerId: 'worker:restart', label: 'Restart', icon: 'refresh' },
            { triggerId: 'worker:shutdown', label: 'Shutdown', icon: 'power', destructive: true },
          ],
        });
        wf.log(`Registered worker resource: ${e.projectId}`);
      }
    });

  wf.rule('Deregister worker on exit',
    (e: any) => e.type === 'worker:exited' || e.type === 'worker:dead',
    async (events: any[]) => {
      for (const e of events) {
        await wf.utils.resource.deregister(`worker-${e.projectId}`);
        wf.log(`Deregistered worker resource: ${e.projectId}`);
      }
    });

  wf.rule('Mark worker status on error',
    (e: any) => e.type === 'worker:unresponsive' || e.type === 'worker:error',
    async (events: any[]) => {
      for (const e of events) {
        await wf.utils.resource.setStatus(`worker-${e.projectId}`, {
          status: e.fatal ? 'down' : 'degraded',
          statusMessage: e.message ?? 'Worker error',
          lastChecked: new Date().toISOString(),
        });
      }
    });

  // -------------------------------------------------------------------------
  // Action handlers — platform-level ops
  // -------------------------------------------------------------------------

  /** Invalidate the CloudFront CDN for the frontend. */
  wf.rule('Invalidate CDN',
    (e: any) => e.type === 'cdn:invalidate',
    async () => {
      const resource = await wf.utils.resource.get('cdn-production');
      if (!resource?.instance?.distributionId) {
        wf.log('No CDN resource registered — run "ops:register-platform-resources" first', 'error');
        return;
      }
      const distributionId = resource.instance.distributionId;
      wf.log(`Invalidating CloudFront distribution ${distributionId}...`);
      const result = await wf.utils.aws.cloudfront.invalidate({
        distributionId,
        paths: ['/*'],
        environment: ENV,
      });
      wf.log(`Invalidation created: ${result.id} (${result.status})`);
    });

  /** Tail API Lambda's recent CloudWatch logs. */
  wf.rule('Tail API Lambda logs',
    (e: any) => e.type === 'api:tail-logs',
    async () => {
      const resource = await wf.utils.resource.get('api-lambda-production');
      if (!resource?.instance?.functionName) {
        wf.log('No API Lambda resource registered', 'error');
        return;
      }
      const logGroup = `/aws/lambda/${resource.instance.functionName}`;
      wf.log(`Tailing ${logGroup}...`);
      const events = await wf.utils.aws.cloudwatch.tailLogs({
        logGroup,
        since: '-10m',
        limit: 100,
        environment: ENV,
      });
      wf.log(`Fetched ${events.length} log events`);
      for (const e of events.slice(-20)) {
        wf.log(`[${e.timestamp}] ${e.message.trim().slice(0, 400)}`);
      }
    });

  /** Show API Lambda current configuration. */
  wf.rule('Show API Lambda config',
    (e: any) => e.type === 'api:show-config',
    async () => {
      const resource = await wf.utils.resource.get('api-lambda-production');
      if (!resource?.instance?.functionName) return;
      const cfg = await wf.utils.aws.lambda.getConfig({
        functionName: resource.instance.functionName,
        environment: ENV,
      });
      wf.log(`API Lambda: ${cfg.FunctionName} / runtime=${cfg.Runtime} / mem=${cfg.MemorySize}MB / state=${cfg.State}`);
    });

  // -------------------------------------------------------------------------
  // Self-referencing ops — route through Lambda admin endpoints
  // (the "stepmother" acts from outside the EC2 instance we're restarting)
  // -------------------------------------------------------------------------

  /** Restart the Router process on the current EC2 host. */
  wf.rule('Restart Router (host)',
    (e: any) => e.type === 'host:restart',
    async () => {
      wf.log('Calling /api/admin/host/restart...');
      const response = await wf.utils.http.post(
        `${PROD_API}/admin/host/restart`,
        { projectId: 'antimatter' },
        { environment: ENV, timeout: 60_000 },
      );
      if (response.ok) {
        wf.log(`Router restart queued: ${JSON.stringify(response.json ?? response.body)}`);
      } else {
        wf.log(`Router restart failed: status=${response.status} body=${response.body}`, 'error');
      }
    });

  /** Pull latest bundles from S3 + restart Router. */
  wf.rule('Reload bundles + restart Router',
    (e: any) => e.type === 'host:reload-bundles',
    async () => {
      wf.log('Calling /api/admin/host/reload-bundles...');
      const response = await wf.utils.http.post(
        `${PROD_API}/admin/host/reload-bundles`,
        { projectId: 'antimatter' },
        { environment: ENV, timeout: 120_000 },
      );
      if (response.ok) {
        wf.log(`Reload queued: ${JSON.stringify(response.json ?? response.body)}`);
      } else {
        wf.log(`Reload failed: status=${response.status} body=${response.body}`, 'error');
      }
    });

  /** Tail the Router's own log (workspace-server.log) via SSM. */
  wf.rule('Tail Router logs',
    (e: any) => e.type === 'host:tail-logs',
    async () => {
      const response = await wf.utils.http.post(
        `${PROD_API}/admin/host/logs`,
        { projectId: 'antimatter', lines: 100 },
        { environment: ENV, timeout: 30_000 },
      );
      if (response.ok && response.json) {
        const lines = (response.json as any).lines ?? [];
        wf.log(`Fetched ${lines.length} log lines`);
        for (const line of lines.slice(-30)) {
          if (line.trim()) wf.log(line.slice(0, 400));
        }
      }
    });

  /** Restart a specific project worker. */
  wf.rule('Restart project worker',
    (e: any) => e.type === 'worker:restart',
    async (events: any[]) => {
      for (const e of events) {
        const projectId = e.projectId ?? e.resourceId?.replace(/^worker-/, '');
        if (!projectId) continue;
        wf.log(`Restarting worker: ${projectId}`);
        const response = await wf.utils.http.post(
          `${PROD_API}/admin/project/restart`,
          { projectId },
          { environment: ENV, timeout: 30_000 },
        );
        if (response.ok) wf.log(`Worker ${projectId} restart queued`);
        else wf.log(`Worker restart failed: ${response.body}`, 'error');
      }
    });

  /** EC2 instance reboot. */
  wf.rule('Reboot EC2 instance',
    (e: any) => e.type === 'instance:reboot',
    async () => {
      wf.log('Rebooting EC2 instance via /api/admin/instance/reboot...');
      const response = await wf.utils.http.post(
        `${PROD_API}/admin/instance/reboot`,
        { projectId: 'antimatter' },
        { environment: ENV, timeout: 30_000 },
      );
      if (response.ok) wf.log(`Instance reboot queued: ${JSON.stringify(response.json ?? response.body)}`);
      else wf.log(`Reboot failed: ${response.body}`, 'error');
    });
};
