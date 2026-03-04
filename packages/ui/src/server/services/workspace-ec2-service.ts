/**
 * Workspace EC2 Service — manages the lifecycle of EC2 workspace instances.
 *
 * Each project gets one EC2 instance. The API Lambda:
 *  - Starts instances on demand (RunInstances or StartInstances for stopped)
 *  - Creates/attaches EBS data volumes for persistent storage
 *  - Creates per-project ALB target groups + path-based listener rules
 *  - Returns connection info to the frontend
 *  - Cleans up ALB resources + stops instances on shutdown
 *
 * Key differences from Fargate containers:
 *  - Stop (not terminate) — EBS volumes + root disk persist across stop/start
 *  - EBS data volume per project — persistent storage survives instance restart
 *  - Full workspace: Docker, git, cdk, all project APIs + terminal
 *  - ALB routes /workspace/{projectId}/* and /ws/terminal/{projectId}*
 */

import {
  EC2Client,
  RunInstancesCommand,
  StartInstancesCommand,
  StopInstancesCommand,
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
  CreateTargetGroupCommand,
  DeleteTargetGroupCommand,
  CreateRuleCommand,
  DeleteRuleCommand,
  DescribeRulesCommand,
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
  listenerArn: string;
  vpcId: string;
  albDns: string;
  projectsBucket: string;
  region?: string;
}

// Per-project ALB routing state
interface RoutingState {
  targetGroupArn: string;
  ruleArn: string;
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

  // In-memory cache of dynamic ALB resources by project ID.
  // Lost on Lambda cold start — recovered via recoverRoutingState().
  private static routingCache = new Map<string, RoutingState>();

  constructor(config: WorkspaceEc2ServiceConfig, eventLogger?: EventLogger) {
    this.config = config;
    this.ec2 = new EC2Client({ region: config.region });
    this.elbv2 = new ElasticLoadBalancingV2Client({ region: config.region });
    this.eventLogger = eventLogger;
  }

  /**
   * Start a workspace instance for a project, or return the existing one.
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

    // No existing instance — launch a new one
    return this.launchNewInstance(projectId);
  }

  /**
   * Get the status of a workspace instance for a project.
   * When the instance reaches RUNNING and has an IP, creates ALB routing rules.
   */
  async getWorkspaceStatus(projectId: string): Promise<WorkspaceInstanceInfo | null> {
    const instance = await this.findInstance(projectId);
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

    // If the instance is RUNNING and we have an IP, ensure ALB routing rules exist
    if (status === 'RUNNING' && privateIp && !WorkspaceEc2Service.routingCache.has(projectId)) {
      await this.recoverRoutingState(projectId);
      if (!WorkspaceEc2Service.routingCache.has(projectId)) {
        await this.createRoutingRules(projectId, privateIp);
      }
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
   * Stop a workspace instance for a project (does NOT terminate — EBS persists).
   */
  async stopWorkspace(projectId: string): Promise<void> {
    const info = await this.getWorkspaceStatus(projectId);
    if (!info) return;

    // Clean up ALB routing rules and target group
    await this.deleteRoutingRules(projectId);

    // Stop the instance (EBS persists, root disk persists)
    await this.ec2.send(new StopInstancesCommand({
      InstanceIds: [info.instanceId],
    }));

    WorkspaceEc2Service.tokenCache.delete(projectId);
    console.log(`[workspace-ec2] Stopped instance ${info.instanceId} for project ${projectId}`);
    await this.eventLogger?.emit('workspace.instance.stopped', 'workspace', 'info',
      `Stopped instance ${info.instanceId}`, { instanceId: info.instanceId });
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
  npm install -g pnpm nx aws-cdk || true

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
NODE_ENV=production
AWS_REGION=us-west-2
AWS_DEFAULT_REGION=us-west-2
EVENT_BUS_NAME=${eventBusName}
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

# ---- Install node-pty (native module needed for terminal) ----
cd /opt/antimatter
if [ ! -d node_modules/node-pty ]; then
  npm install node-pty 2>/dev/null || echo "[workspace] WARNING: node-pty install failed"
fi

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

  // ---- Instance lookup ----

  /**
   * Find an EC2 instance for a project by tag.
   * Returns the first non-terminated instance.
   */
  private async findInstance(projectId: string): Promise<Instance | null> {
    const result = await this.ec2.send(new DescribeInstancesCommand({
      Filters: [
        { Name: 'tag:antimatter:projectId', Values: [projectId] },
        { Name: 'tag:antimatter:managed', Values: ['true'] },
        // Exclude terminated instances
        { Name: 'instance-state-name', Values: ['pending', 'running', 'stopping', 'stopped'] },
      ],
    }));

    for (const reservation of result.Reservations ?? []) {
      for (const instance of reservation.Instances ?? []) {
        return instance;
      }
    }
    return null;
  }

  /**
   * Read a tag value from an EC2 instance.
   */
  private getTagValue(instance: Instance | null, key: string): string | undefined {
    if (!instance) return undefined;
    return instance.Tags?.find(t => t.Key === key)?.Value;
  }

  // ---- Dynamic ALB routing ----

  /**
   * Create a per-project target group + path-based listener rule.
   * Routes /workspace/{projectId}/* and /ws/terminal/{projectId}*
   * to this target group.
   */
  private async createRoutingRules(projectId: string, ip: string): Promise<void> {
    // Target group name: max 32 chars, alphanumeric + hyphens
    const tgName = `ws-${projectId.substring(0, 27)}`;

    try {
      // 1. Create target group
      const createTgResult = await this.elbv2.send(new CreateTargetGroupCommand({
        Name: tgName,
        Protocol: 'HTTP',
        Port: 8080,
        VpcId: this.config.vpcId,
        TargetType: 'ip',
        HealthCheckPath: `/workspace/${projectId}/health`,
        HealthCheckIntervalSeconds: 10,
        HealthCheckTimeoutSeconds: 5,
        HealthyThresholdCount: 2,
        UnhealthyThresholdCount: 3,
        Tags: [
          { Key: 'antimatter:projectId', Value: projectId },
          { Key: 'antimatter:managed', Value: 'true' },
        ],
      }));

      const targetGroupArn = createTgResult.TargetGroups?.[0]?.TargetGroupArn;
      if (!targetGroupArn) throw new Error('CreateTargetGroup returned no ARN');

      // 2. Register instance IP
      await this.elbv2.send(new RegisterTargetsCommand({
        TargetGroupArn: targetGroupArn,
        Targets: [{ Id: ip, Port: 8080 }],
      }));

      // 3. Create listener rule with path-based routing
      const priority = await this.getNextRulePriority();
      const createRuleResult = await this.elbv2.send(new CreateRuleCommand({
        ListenerArn: this.config.listenerArn,
        Priority: priority,
        Conditions: [
          {
            Field: 'path-pattern',
            PathPatternConfig: {
              Values: [
                `/workspace/${projectId}/*`,
                `/ws/terminal/${projectId}*`,
              ],
            },
          },
        ],
        Actions: [
          {
            Type: 'forward',
            TargetGroupArn: targetGroupArn,
          },
        ],
        Tags: [
          { Key: 'antimatter:projectId', Value: projectId },
          { Key: 'antimatter:managed', Value: 'true' },
        ],
      }));

      const ruleArn = createRuleResult.Rules?.[0]?.RuleArn;
      if (!ruleArn) throw new Error('CreateRule returned no ARN');

      // Cache for cleanup
      WorkspaceEc2Service.routingCache.set(projectId, {
        targetGroupArn,
        ruleArn,
      });

      console.log(`[workspace-ec2] Created ALB routing for ${projectId}: tg=${tgName}, rule priority=${priority}`);
      this.eventLogger?.info('workspace', `Created ALB routing for ${projectId}`, { targetGroup: tgName, priority });
    } catch (err) {
      console.error(`[workspace-ec2] Failed to create ALB routing for ${projectId}:`, err);
      this.eventLogger?.error('workspace', `Failed to create ALB routing`, {
        error: err instanceof Error ? err.message : String(err),
      });
      throw err;
    }
  }

  /**
   * Delete per-project listener rule + target group.
   */
  private async deleteRoutingRules(projectId: string): Promise<void> {
    // Ensure we have the routing state (may need recovery after cold start)
    if (!WorkspaceEc2Service.routingCache.has(projectId)) {
      await this.recoverRoutingState(projectId);
    }

    const state = WorkspaceEc2Service.routingCache.get(projectId);
    if (!state) {
      console.log(`[workspace-ec2] No routing state to clean up for ${projectId}`);
      return;
    }

    // Delete rule first (must be removed before target group)
    try {
      await this.elbv2.send(new DeleteRuleCommand({ RuleArn: state.ruleArn }));
      console.log(`[workspace-ec2] Deleted listener rule for ${projectId}`);
    } catch (err) {
      console.error(`[workspace-ec2] Failed to delete rule for ${projectId}:`, err);
    }

    // Delete target group
    try {
      await this.elbv2.send(new DeleteTargetGroupCommand({ TargetGroupArn: state.targetGroupArn }));
      console.log(`[workspace-ec2] Deleted target group for ${projectId}`);
    } catch (err) {
      console.error(`[workspace-ec2] Failed to delete target group for ${projectId}:`, err);
    }

    WorkspaceEc2Service.routingCache.delete(projectId);
  }

  /**
   * Recover routing state after Lambda cold start by scanning listener rules
   * for the project's path pattern.
   */
  private async recoverRoutingState(projectId: string): Promise<void> {
    if (WorkspaceEc2Service.routingCache.has(projectId)) return;

    try {
      const result = await this.elbv2.send(new DescribeRulesCommand({
        ListenerArn: this.config.listenerArn,
      }));

      for (const rule of result.Rules ?? []) {
        const pathCondition = rule.Conditions?.find(c => c.Field === 'path-pattern');
        const matchesProject = pathCondition?.PathPatternConfig?.Values?.some(
          v => v.includes(projectId),
        );

        if (matchesProject && rule.RuleArn) {
          const tgArn = rule.Actions?.[0]?.TargetGroupArn;
          if (tgArn) {
            WorkspaceEc2Service.routingCache.set(projectId, {
              targetGroupArn: tgArn,
              ruleArn: rule.RuleArn,
            });
            console.log(`[workspace-ec2] Recovered routing state for ${projectId}`);
            return;
          }
        }
      }
    } catch (err) {
      console.error(`[workspace-ec2] Failed to recover routing state for ${projectId}:`, err);
    }
  }

  /**
   * Find the next available listener rule priority.
   */
  private async getNextRulePriority(): Promise<number> {
    const result = await this.elbv2.send(new DescribeRulesCommand({
      ListenerArn: this.config.listenerArn,
    }));

    const priorities = (result.Rules ?? [])
      .map(r => parseInt(r.Priority ?? '0', 10))
      .filter(p => !isNaN(p) && p > 0);

    return priorities.length === 0 ? 1 : Math.max(...priorities) + 1;
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
