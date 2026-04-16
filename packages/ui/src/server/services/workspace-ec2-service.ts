/**
 * Workspace EC2 Service — manages the lifecycle of EC2 workspace instances.
 *
 * Supports two modes:
 *  - **Dedicated** (default): Each project gets its own EC2 instance.
 *  - **Shared**: Multiple projects share a single EC2 instance. The workspace
 *    server initializes project contexts lazily when traffic arrives.
 *
 * ALB routing is static — a single catch-all target group forwards all
 * /workspace/* and /ws/* traffic to the workspace server. This service
 * only registers/deregisters instance IPs in the target group.
 * The workspace server handles per-project routing internally.
 */

import {
  EC2Client,
  RunInstancesCommand,
  StartInstancesCommand,
  TerminateInstancesCommand,
  DescribeInstancesCommand,
  CreateVolumeCommand,
  AttachVolumeCommand,
  DescribeVolumesCommand,
  DescribeSubnetsCommand,
  CreateTagsCommand,
} from '@aws-sdk/client-ec2';
import type { Instance } from '@aws-sdk/client-ec2';
import {
  ElasticLoadBalancingV2Client,
  RegisterTargetsCommand,
  DeregisterTargetsCommand,
  DescribeTargetHealthCommand,
} from '@aws-sdk/client-elastic-load-balancing-v2';
import { randomUUID } from 'node:crypto';
import type { EventLogger } from './event-logger.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface WorkspaceInstanceInfo {
  projectId: string;
  instanceId: string;
  status: 'PENDING' | 'RUNNING' | 'STOPPING' | 'STOPPED' | 'TERMINATED' | 'UNKNOWN';
  privateIp?: string;
  port: number;
  sessionToken: string;
  startedAt?: string;
  volumeId?: string;
}

export interface WorkspaceEc2ServiceConfig {
  launchTemplateId: string;
  instanceProfileArn: string;
  subnetIds: string[];
  securityGroupId: string;
  /** ARN of the static ALB target group for workspace traffic. */
  targetGroupArn: string;
  albDns: string;
  projectsBucket: string;
  region?: string;
  /**
   * When true, reuse existing running workspace instances for new projects
   * instead of launching a dedicated instance per project. The workspace server
   * initializes project contexts lazily when traffic arrives.
   */
  sharedMode?: boolean;
}

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------

export class WorkspaceEc2Service {
  private readonly ec2: EC2Client;
  private readonly elbv2: ElasticLoadBalancingV2Client;
  private readonly config: WorkspaceEc2ServiceConfig;
  private readonly eventLogger?: EventLogger;

  // In-memory cache of session tokens by project ID.
  // On cold start, recovered from instance tags.
  private static tokenCache = new Map<string, string>();

  constructor(config: WorkspaceEc2ServiceConfig, eventLogger?: EventLogger) {
    this.config = config;
    this.ec2 = new EC2Client({ region: config.region });
    this.elbv2 = new ElasticLoadBalancingV2Client({ region: config.region });
    this.eventLogger = eventLogger;
  }

  /**
   * Start a workspace instance for a project, or return the existing one.
   *
   * In shared mode, tries to reuse any running managed instance first.
   * The workspace server will lazy-initialize the project context when
   * traffic arrives via the ALB.
   */
  async startWorkspace(projectId: string): Promise<WorkspaceInstanceInfo> {
    // Check if an instance already exists for this project
    const existing = await this.getWorkspaceStatus(projectId);
    if (existing) {
      if (existing.status === 'RUNNING' || existing.status === 'PENDING') {
        return existing;
      }
      // Instance exists but is stopped — resume it
      if (existing.status === 'STOPPED') {
        return this.resumeInstance(projectId, existing.instanceId);
      }
    }

    // In shared mode, try to reuse an existing running server, or resume a stopped one
    if (this.config.sharedMode) {
      const shared = await this.reuseRunningServer(projectId);
      if (shared) return shared;

      const resumed = await this.resumeSharedServer(projectId);
      if (resumed) return resumed;
    }

    // No existing instance — launch a new one
    return this.launchNewInstance(projectId);
  }

  /**
   * Get the status of a workspace instance for a project.
   * When the instance is RUNNING, ensures its IP is registered in the ALB target group.
   */
  async getWorkspaceStatus(projectId: string): Promise<WorkspaceInstanceInfo | null> {
    let instance = await this.findInstance(projectId);

    // In shared mode, no instance is tagged per-project. Fall back to finding
    // any running managed server.
    if (!instance && this.config.sharedMode) {
      const shared = await this.findAnyRunningServer();
      if (shared) {
        instance = shared;
      }
    }

    if (!instance) return null;

    const instanceId = instance.InstanceId!;
    const status = this.mapInstanceState(instance.State?.Name);
    const privateIp = instance.PrivateIpAddress;

    // Read token from cache, or recover from instance tag
    let sessionToken = WorkspaceEc2Service.tokenCache.get(projectId);
    if (!sessionToken) {
      sessionToken = this.getTagValue(instance, 'antimatter:sessionToken') ?? '';
      if (sessionToken) {
        WorkspaceEc2Service.tokenCache.set(projectId, sessionToken);
      }
    }

    // Find EBS data volume
    let volumeId: string | undefined;
    for (const bdm of instance.BlockDeviceMappings ?? []) {
      if (bdm.DeviceName === '/dev/sdf' || bdm.DeviceName === '/dev/xvdf') {
        volumeId = bdm.Ebs?.VolumeId;
      }
    }

    // If the instance is RUNNING and we have an IP, ensure it's registered in the target group
    if (status === 'RUNNING' && privateIp) {
      await this.ensureTargetRegistered(privateIp);
    }

    return {
      projectId,
      instanceId,
      status,
      privateIp,
      port: 8080,
      sessionToken: sessionToken ?? '',
      startedAt: instance.LaunchTime?.toISOString(),
      volumeId,
    };
  }

  /**
   * Clean up project-specific resources.
   * With static ALB routing, there are no per-project ALB resources to clean up.
   * Just clears the cached session token.
   */
  async deleteProjectRouting(projectId: string): Promise<void> {
    WorkspaceEc2Service.tokenCache.delete(projectId);
  }

  // ---- Instance lifecycle ----

  /**
   * Launch a brand new EC2 instance for a project.
   */
  private async launchNewInstance(projectId: string): Promise<WorkspaceInstanceInfo> {
    const sessionToken = randomUUID();
    WorkspaceEc2Service.tokenCache.set(projectId, sessionToken);

    // Pin to the first private subnet (single AZ for EBS compatibility)
    const subnetId = this.config.subnetIds[0];
    const az = await this.getSubnetAz(subnetId);

    // Find or create EBS data volume in the same AZ
    const volumeId = await this.findOrCreateVolume(projectId, az);

    // Generate user-data script with project-specific config
    const userData = this.generateUserData(projectId, sessionToken);

    // Launch the instance
    const result = await this.ec2.send(new RunInstancesCommand({
      LaunchTemplate: {
        LaunchTemplateId: this.config.launchTemplateId,
      },
      MinCount: 1,
      MaxCount: 1,
      SubnetId: subnetId,
      UserData: Buffer.from(userData).toString('base64'),
      TagSpecifications: [{
        ResourceType: 'instance',
        Tags: [
          { Key: 'Name', Value: `antimatter-workspace-${projectId}` },
          { Key: 'antimatter:projectId', Value: projectId },
          { Key: 'antimatter:sessionToken', Value: sessionToken },
          { Key: 'antimatter:managed', Value: 'true' },
        ],
      }],
    }));

    const instance = result.Instances?.[0];
    if (!instance?.InstanceId) {
      throw new Error('Failed to launch workspace instance');
    }

    const instanceId = instance.InstanceId;
    console.log(`[workspace-ec2] Launched instance ${instanceId} for project ${projectId}`);

    // Attach EBS data volume
    try {
      await this.ec2.send(new AttachVolumeCommand({
        InstanceId: instanceId,
        VolumeId: volumeId,
        Device: '/dev/sdf',
      }));
      console.log(`[workspace-ec2] Attached volume ${volumeId} to ${instanceId}`);
      this.eventLogger?.info('workspace', `Attached volume ${volumeId} to ${instanceId}`, { instanceId, volumeId });
    } catch (err) {
      console.error(`[workspace-ec2] Failed to attach volume ${volumeId}:`, err);
      this.eventLogger?.error('workspace', `Failed to attach volume ${volumeId}`, {
        instanceId, volumeId, error: err instanceof Error ? err.message : String(err),
      });
      // Continue — instance can still work without data volume
    }

    await this.eventLogger?.emit('workspace.instance.launched', 'workspace', 'info',
      `Launched new instance ${instanceId}`, { instanceId, volumeId });

    return {
      projectId,
      instanceId,
      status: 'PENDING',
      port: 8080,
      sessionToken,
      volumeId,
    };
  }

  /**
   * Resume a stopped instance. The root EBS has tools installed and the
   * systemd service auto-starts the workspace server on boot.
   * The config.env and session token persist from the original launch.
   */
  private async resumeInstance(projectId: string, instanceId: string): Promise<WorkspaceInstanceInfo> {
    // Read session token from instance tags (persisted from original launch)
    const instance = await this.findInstance(projectId);
    let sessionToken = this.getTagValue(instance, 'antimatter:sessionToken') ?? '';

    if (!sessionToken) {
      // Token missing — generate new one and update tag
      sessionToken = randomUUID();
      await this.ec2.send(new CreateTagsCommand({
        Resources: [instanceId],
        Tags: [{ Key: 'antimatter:sessionToken', Value: sessionToken }],
      }));
    }

    WorkspaceEc2Service.tokenCache.set(projectId, sessionToken);

    // Start the stopped instance
    await this.ec2.send(new StartInstancesCommand({
      InstanceIds: [instanceId],
    }));

    console.log(`[workspace-ec2] Resumed instance ${instanceId} for project ${projectId}`);
    await this.eventLogger?.emit('workspace.instance.resumed', 'workspace', 'info',
      `Resumed stopped instance ${instanceId}`, { instanceId });

    return {
      projectId,
      instanceId,
      status: 'PENDING',
      port: 8080,
      sessionToken,
    };
  }

  // ---- Shared server support ----

  /**
   * Find any running managed workspace instance (regardless of project).
   * Used in shared mode to reuse existing servers for new projects.
   */
  private async findAnyRunningServer(): Promise<Instance | null> {
    const result = await this.ec2.send(new DescribeInstancesCommand({
      Filters: [
        { Name: 'tag:antimatter:managed', Values: ['true'] },
        { Name: 'instance-state-name', Values: ['running'] },
      ],
    }));

    for (const reservation of result.Reservations ?? []) {
      for (const instance of reservation.Instances ?? []) {
        if (instance.PrivateIpAddress) {
          return instance;
        }
      }
    }
    return null;
  }

  /**
   * Reuse an existing running workspace server for a new project.
   * The workspace server will lazy-initialize the project context when traffic arrives.
   */
  private async reuseRunningServer(projectId: string): Promise<WorkspaceInstanceInfo | null> {
    const server = await this.findAnyRunningServer();
    if (!server || !server.PrivateIpAddress || !server.InstanceId) return null;

    const ip = server.PrivateIpAddress;
    const instanceId = server.InstanceId;

    // Recover or read the session token from the server's tags
    let sessionToken = this.getTagValue(server, 'antimatter:sessionToken') ?? '';
    if (!sessionToken) {
      sessionToken = randomUUID();
    }
    WorkspaceEc2Service.tokenCache.set(projectId, sessionToken);

    // Ensure the server's IP is in the target group
    await this.ensureTargetRegistered(ip);

    console.log(`[workspace-ec2] Reusing instance ${instanceId} (${ip}) for project ${projectId} (shared mode)`);
    this.eventLogger?.info('workspace',
      `Reusing shared instance ${instanceId} for project ${projectId}`,
      { instanceId, projectId, ip });

    return {
      projectId,
      instanceId,
      status: 'RUNNING',
      privateIp: ip,
      port: 8080,
      sessionToken,
      startedAt: server.LaunchTime?.toISOString(),
    };
  }

  /**
   * Find any managed workspace instance in the given states (regardless of project).
   * Prefers running > pending > stopped, then newest first.
   */
  private async findAnyManagedServer(
    states: string[] = ['running', 'pending', 'stopped'],
  ): Promise<Instance | null> {
    const result = await this.ec2.send(new DescribeInstancesCommand({
      Filters: [
        { Name: 'tag:antimatter:managed', Values: ['true'] },
        { Name: 'instance-state-name', Values: states },
      ],
    }));

    const instances: Instance[] = [];
    for (const reservation of result.Reservations ?? []) {
      for (const instance of reservation.Instances ?? []) {
        if (instance.InstanceId) {
          instances.push(instance);
        }
      }
    }

    if (instances.length === 0) return null;

    // Sort: running (3) > pending (2) > stopped (1), then newest first
    const statePriority: Record<string, number> = { running: 3, pending: 2, stopped: 1 };
    instances.sort((a, b) => {
      const pa = statePriority[a.State?.Name ?? ''] ?? 0;
      const pb = statePriority[b.State?.Name ?? ''] ?? 0;
      if (pa !== pb) return pb - pa;
      return (b.LaunchTime?.getTime() ?? 0) - (a.LaunchTime?.getTime() ?? 0);
    });

    return instances[0];
  }

  /**
   * Resume a stopped shared server for a new project.
   * Used in shared mode when no running instance is available but a stopped one exists.
   */
  private async resumeSharedServer(projectId: string): Promise<WorkspaceInstanceInfo | null> {
    const server = await this.findAnyManagedServer(['stopped']);
    if (!server || !server.InstanceId) return null;

    const instanceId = server.InstanceId;

    // Read session token from instance tags
    let sessionToken = this.getTagValue(server, 'antimatter:sessionToken') ?? '';
    if (!sessionToken) {
      sessionToken = randomUUID();
      await this.ec2.send(new CreateTagsCommand({
        Resources: [instanceId],
        Tags: [{ Key: 'antimatter:sessionToken', Value: sessionToken }],
      }));
    }
    WorkspaceEc2Service.tokenCache.set(projectId, sessionToken);

    // Start the stopped instance
    await this.ec2.send(new StartInstancesCommand({
      InstanceIds: [instanceId],
    }));

    console.log(`[workspace-ec2] Resumed shared instance ${instanceId} for project ${projectId}`);
    this.eventLogger?.info('workspace',
      `Resumed shared instance ${instanceId} for project ${projectId}`,
      { instanceId, projectId });

    return {
      projectId,
      instanceId,
      status: 'PENDING',
      port: 8080,
      sessionToken,
    };
  }

  // ---- EBS volume management ----

  /**
   * Find an existing data volume for a project, or create a new one.
   * Volumes are tagged with antimatter:projectId for lookup.
   */
  private async findOrCreateVolume(projectId: string, az: string): Promise<string> {
    // Look for existing volume in the same AZ
    const describeResult = await this.ec2.send(new DescribeVolumesCommand({
      Filters: [
        { Name: 'tag:antimatter:projectId', Values: [projectId] },
        { Name: 'tag:antimatter:volumeType', Values: ['data'] },
        { Name: 'status', Values: ['available', 'in-use'] },
      ],
    }));

    const existing = describeResult.Volumes?.find(v => v.AvailabilityZone === az);
    if (existing?.VolumeId) {
      console.log(`[workspace-ec2] Found existing volume ${existing.VolumeId} for ${projectId}`);
      return existing.VolumeId;
    }

    // Create new volume
    const createResult = await this.ec2.send(new CreateVolumeCommand({
      AvailabilityZone: az,
      Size: 50, // 50 GB gp3 — ~$4/month
      VolumeType: 'gp3',
      Encrypted: true,
      TagSpecifications: [{
        ResourceType: 'volume',
        Tags: [
          { Key: 'Name', Value: `antimatter-data-${projectId}` },
          { Key: 'antimatter:projectId', Value: projectId },
          { Key: 'antimatter:volumeType', Value: 'data' },
          { Key: 'antimatter:managed', Value: 'true' },
        ],
      }],
    }));

    const volumeId = createResult.VolumeId!;
    console.log(`[workspace-ec2] Created new volume ${volumeId} for ${projectId} in ${az}`);
    this.eventLogger?.info('workspace', `Created new EBS volume ${volumeId}`, { volumeId, az });
    return volumeId;
  }

  /**
   * Get the availability zone of a subnet.
   */
  private async getSubnetAz(subnetId: string): Promise<string> {
    const result = await this.ec2.send(new DescribeSubnetsCommand({
      SubnetIds: [subnetId],
    }));
    return result.Subnets?.[0]?.AvailabilityZone ?? 'us-west-2a';
  }

  // ---- User data script ----

  /**
   * Generate the user-data boot script for a workspace instance.
   * Runs on first boot only (cloud-init default). On restart, the
   * systemd service auto-starts the workspace server.
   */
  private generateUserData(projectId: string, sessionToken: string): string {
    const bucket = this.config.projectsBucket;

    // Use heredoc-safe escaping — these values are inserted into a bash script
    const safeProjectId = projectId.replace(/'/g, "'\\''");
    const safeBucket = bucket.replace(/'/g, "'\\''");
    const safeToken = sessionToken.replace(/'/g, "'\\''");
    const eventBusName = process.env.EVENT_BUS_NAME ?? 'antimatter';
    const cognitoUserPoolId = process.env.COGNITO_USER_POOL_ID ?? '';
    const cognitoClientId = process.env.COGNITO_CLIENT_ID ?? '';
    const targetGroupArn = this.config.targetGroupArn;

    return `#!/bin/bash
set -x
exec > /var/log/workspace-boot.log 2>&1

echo "[workspace] Boot script starting for project: ${safeProjectId}"

# ---- Tool installation (idempotent — persists on root EBS across stop/start) ----
if [ ! -f /opt/antimatter/.tools-installed ]; then
  echo "[workspace] Installing tools..."
  mkdir -p /opt/antimatter

  # Node.js 20.x
  curl -fsSL https://rpm.nodesource.com/setup_20.x | bash - || true
  yum install -y nodejs git docker gcc-c++ make python3 || true

  # Global npm packages
  npm install -g aws-cdk puppeteer-core || true

  # Google Chrome for headless browser testing (puppeteer-core)
  cat > /etc/yum.repos.d/google-chrome.repo << 'CHROME_REPO'
[google-chrome]
name=google-chrome
baseurl=https://dl.google.com/linux/chrome/rpm/stable/x86_64
enabled=1
gpgcheck=1
gpgkey=https://dl.google.com/linux/linux_signing_key.pub
CHROME_REPO
  yum install -y google-chrome-stable || true

  # Enable Docker (may fail during cloud-init — not critical)
  systemctl enable docker || true

  touch /opt/antimatter/.tools-installed
  echo "[workspace] Tools installed"
fi

# Start Docker (may already be running)
systemctl start docker || true

# ---- Write config ----
mkdir -p /opt/antimatter
cat > /opt/antimatter/config.env << 'ENVEOF'
PROJECT_ID=${safeProjectId}
PROJECTS_BUCKET=${safeBucket}
SESSION_TOKEN=${safeToken}
WORKSPACE_ROOT=/workspace/data
HOME=/workspace/data
PORT=8080
NODE_ENV=development
AWS_REGION=us-west-2
AWS_DEFAULT_REGION=us-west-2
EVENT_BUS_NAME=${eventBusName}
COGNITO_USER_POOL_ID=${cognitoUserPoolId}
COGNITO_CLIENT_ID=${cognitoClientId}
WORKSPACE_TARGET_GROUP_ARN=${targetGroupArn}
ENVEOF

# ---- Mount EBS data volume ----
DATA_DEVICE=""
MOUNT_POINT="/workspace/data"
mkdir -p "$MOUNT_POINT"

# Wait for device to appear (handles various naming: sdf, xvdf, nvme1n1)
for i in $(seq 1 30); do
  if [ -e "/dev/sdf" ]; then DATA_DEVICE="/dev/sdf"; break; fi
  if [ -e "/dev/xvdf" ]; then DATA_DEVICE="/dev/xvdf"; break; fi
  if [ -e "/dev/nvme1n1" ]; then DATA_DEVICE="/dev/nvme1n1"; break; fi
  sleep 1
done

if [ -n "$DATA_DEVICE" ]; then
  # Format if new volume (no filesystem)
  if ! blkid "$DATA_DEVICE" 2>/dev/null; then
    echo "[workspace] Formatting new data volume at $DATA_DEVICE"
    mkfs.ext4 "$DATA_DEVICE"
  fi
  mount "$DATA_DEVICE" "$MOUNT_POINT" || true

  # Create project directory
  mkdir -p "$MOUNT_POINT/${safeProjectId}"
  echo "[workspace] Data volume mounted at $MOUNT_POINT"
else
  echo "[workspace] WARNING: No data device found — using ephemeral storage"
  mkdir -p "$MOUNT_POINT/${safeProjectId}"
fi

# ---- Download workspace server from S3 ----
echo "[workspace] Downloading workspace server..."
aws s3 cp "s3://${safeBucket}/workspace-server/workspace-server.js" /opt/antimatter/workspace-server.js || echo "[workspace] WARNING: workspace-server.js not found in S3"

# ---- Download workspace server package.json for external dependencies ----
aws s3 cp "s3://${safeBucket}/workspace-server/package.json" /opt/antimatter/package.json || echo "[workspace] WARNING: package.json not found in S3"

# ---- Install native modules (node-pty, esbuild) needed at runtime ----
cd /opt/antimatter
npm install 2>/dev/null || echo "[workspace] WARNING: npm install failed"

# ---- Create systemd service (auto-starts on boot) ----
cat > /etc/systemd/system/workspace-server.service << 'SVCEOF'
[Unit]
Description=Antimatter Workspace Server
After=network.target docker.service

[Service]
Type=simple
EnvironmentFile=/opt/antimatter/config.env
WorkingDirectory=/opt/antimatter
ExecStartPre=/bin/bash -c 'mkdir -p /workspace/data && (mount /dev/sdf /workspace/data 2>/dev/null || mount /dev/xvdf /workspace/data 2>/dev/null || mount /dev/nvme1n1 /workspace/data 2>/dev/null || true)'
ExecStartPre=/bin/bash -c '. /opt/antimatter/config.env && aws s3 cp "s3://$PROJECTS_BUCKET/workspace-server/workspace-server.js" /opt/antimatter/workspace-server.js 2>/dev/null || echo "[workspace] S3 download failed — using existing binary"'
ExecStartPre=/bin/bash -c '. /opt/antimatter/config.env && aws s3 cp "s3://$PROJECTS_BUCKET/workspace-server/package.json" /opt/antimatter/package.json 2>/dev/null && cd /opt/antimatter && npm install --production 2>/dev/null || true'
ExecStart=/usr/bin/node /opt/antimatter/workspace-server.js
Restart=always
RestartSec=5
StandardOutput=journal
StandardError=journal

[Install]
WantedBy=multi-user.target
SVCEOF

systemctl daemon-reload
systemctl enable workspace-server
systemctl start workspace-server

echo "[workspace] Boot script complete"
`;
  }

  // ---- ALB target registration ----

  /**
   * Ensure the instance IP is registered in the static ALB target group.
   * Also deregisters any stale IPs that no longer belong to a running instance.
   */
  private async ensureTargetRegistered(ip: string): Promise<void> {
    try {
      const health = await this.elbv2.send(new DescribeTargetHealthCommand({
        TargetGroupArn: this.config.targetGroupArn,
      }));

      const registered = health.TargetHealthDescriptions ?? [];
      const hasIp = registered.some(t => t.Target?.Id === ip);

      if (hasIp) return; // Already registered

      // Deregister any stale targets (old IPs from previous instance runs)
      const staleTargets = registered
        .filter(t => t.Target?.Id && t.Target.Id !== ip)
        .map(t => ({ Id: t.Target!.Id!, Port: t.Target!.Port }));

      if (staleTargets.length > 0) {
        await this.elbv2.send(new DeregisterTargetsCommand({
          TargetGroupArn: this.config.targetGroupArn,
          Targets: staleTargets,
        }));
        console.log(`[workspace-ec2] Deregistered ${staleTargets.length} stale target(s) from ALB`);
      }

      // Register the current IP
      await this.elbv2.send(new RegisterTargetsCommand({
        TargetGroupArn: this.config.targetGroupArn,
        Targets: [{ Id: ip, Port: 8080 }],
      }));

      console.log(`[workspace-ec2] Registered IP ${ip} in ALB target group`);
      this.eventLogger?.info('workspace', `Registered IP ${ip} in ALB target group`);
    } catch (err) {
      console.error(`[workspace-ec2] Failed to register target IP ${ip}:`, err);
      this.eventLogger?.error('workspace', `Failed to register target IP`, {
        ip, error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  // ---- Instance lookup ----

  /**
   * Find ALL non-terminated EC2 instances for a project by its tags.
   */
  private async findAllInstances(projectId: string): Promise<Instance[]> {
    const result = await this.ec2.send(new DescribeInstancesCommand({
      Filters: [
        { Name: 'tag:antimatter:projectId', Values: [projectId] },
        { Name: 'tag:antimatter:managed', Values: ['true'] },
        // Exclude terminated instances
        { Name: 'instance-state-name', Values: ['pending', 'running', 'stopping', 'stopped'] },
      ],
    }));

    const instances: Instance[] = [];
    for (const reservation of result.Reservations ?? []) {
      for (const instance of reservation.Instances ?? []) {
        instances.push(instance);
      }
    }
    return instances;
  }

  /**
   * Find the EC2 instance for a project by tag.
   * If multiple instances exist, keeps the best one (prefer running > pending
   * > stopped, then newest) and terminates the extras.
   */
  private async findInstance(projectId: string): Promise<Instance | null> {
    const instances = await this.findAllInstances(projectId);
    if (instances.length === 0) return null;
    if (instances.length === 1) return instances[0];

    // Multiple instances — keep one, terminate the rest.
    const statePriority = (s: string | undefined) => {
      switch (s) {
        case 'running': return 3;
        case 'pending': return 2;
        case 'stopped': return 1;
        default: return 0;
      }
    };

    instances.sort((a, b) => {
      const sa = statePriority(a.State?.Name);
      const sb = statePriority(b.State?.Name);
      if (sa !== sb) return sb - sa;
      const ta = a.LaunchTime?.getTime() ?? 0;
      const tb = b.LaunchTime?.getTime() ?? 0;
      return tb - ta;
    });

    const keeper = instances[0];
    const extras = instances.slice(1);

    console.warn(
      `[workspace-ec2] Found ${instances.length} instances for project ${projectId} — ` +
      `keeping ${keeper.InstanceId} (${keeper.State?.Name}), ` +
      `terminating ${extras.length} extras: ${extras.map(i => i.InstanceId).join(', ')}`,
    );

    // Terminate extras asynchronously (don't block the caller)
    this.terminateInstances(extras.map(i => i.InstanceId!)).catch(err => {
      console.error(`[workspace-ec2] Failed to terminate extra instances:`, err);
    });

    return keeper;
  }

  /**
   * Terminate EC2 instances by ID. Used to clean up duplicate instances.
   */
  private async terminateInstances(instanceIds: string[]): Promise<void> {
    if (instanceIds.length === 0) return;
    await this.ec2.send(new TerminateInstancesCommand({ InstanceIds: instanceIds }));
    console.log(`[workspace-ec2] Terminated duplicate instances: ${instanceIds.join(', ')}`);
  }

  /**
   * Read a tag value from an EC2 instance.
   */
  private getTagValue(instance: Instance | null, key: string): string | undefined {
    if (!instance) return undefined;
    return instance.Tags?.find(t => t.Key === key)?.Value;
  }

  // ---- Helpers ----

  private mapInstanceState(state?: string): WorkspaceInstanceInfo['status'] {
    switch (state) {
      case 'pending': return 'PENDING';
      case 'running': return 'RUNNING';
      case 'stopping': return 'STOPPING';
      case 'stopped': return 'STOPPED';
      case 'shutting-down': return 'STOPPING';
      case 'terminated': return 'TERMINATED';
      default: return 'UNKNOWN';
    }
  }
}
