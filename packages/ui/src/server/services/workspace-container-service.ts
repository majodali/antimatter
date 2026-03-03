/**
 * Workspace Container Service — manages the lifecycle of Fargate workspace
 * containers for interactive terminal sessions.
 *
 * Each project gets one container. The API Lambda:
 *  - Starts containers on demand (ECS RunTask)
 *  - Creates per-project ALB target groups + path-based listener rules
 *  - Returns connection info to the frontend
 *  - Cleans up ALB resources + stops tasks on shutdown
 *
 * Dynamic ALB routing: each container gets its own target group and a listener
 * rule matching /{projectId}/* and /ws/terminal/{projectId}*. This ensures
 * deterministic routing — no round-robin across containers.
 */

import {
  ECSClient,
  RunTaskCommand,
  StopTaskCommand,
  DescribeTasksCommand,
  ListTasksCommand,
} from '@aws-sdk/client-ecs';
import {
  ElasticLoadBalancingV2Client,
  RegisterTargetsCommand,
  DeregisterTargetsCommand,
  CreateTargetGroupCommand,
  DeleteTargetGroupCommand,
  CreateRuleCommand,
  DeleteRuleCommand,
  DescribeRulesCommand,
} from '@aws-sdk/client-elastic-load-balancing-v2';
import { randomUUID } from 'node:crypto';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface WorkspaceContainerInfo {
  projectId: string;
  taskArn: string;
  status: 'PROVISIONING' | 'PENDING' | 'RUNNING' | 'DEPROVISIONING' | 'STOPPED' | 'UNKNOWN';
  privateIp?: string;
  port: number;
  sessionToken: string;
  startedAt?: string;
}

export interface WorkspaceContainerServiceConfig {
  clusterArn: string;
  taskDefArn: string;
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

export class WorkspaceContainerService {
  private readonly ecs: ECSClient;
  private readonly elbv2: ElasticLoadBalancingV2Client;
  private readonly config: WorkspaceContainerServiceConfig;

  // In-memory cache of session tokens by project ID.
  private static tokenCache = new Map<string, string>();

  // In-memory cache of dynamic ALB resources by project ID.
  // Lost on Lambda cold start — recovered via recoverRoutingState().
  private static routingCache = new Map<string, RoutingState>();

  constructor(config: WorkspaceContainerServiceConfig) {
    this.config = config;
    this.ecs = new ECSClient({ region: config.region });
    this.elbv2 = new ElasticLoadBalancingV2Client({ region: config.region });
  }

  /**
   * Start a workspace container for a project, or return the existing one.
   */
  async startWorkspace(projectId: string): Promise<WorkspaceContainerInfo> {
    // Check if a task is already running for this project
    const existing = await this.getWorkspaceStatus(projectId);
    if (existing && (existing.status === 'RUNNING' || existing.status === 'PROVISIONING' || existing.status === 'PENDING')) {
      return existing;
    }

    // Generate a session token for WebSocket authentication
    const sessionToken = randomUUID();
    WorkspaceContainerService.tokenCache.set(projectId, sessionToken);

    // Start a new Fargate task
    const result = await this.ecs.send(new RunTaskCommand({
      cluster: this.config.clusterArn,
      taskDefinition: this.config.taskDefArn,
      launchType: 'FARGATE',
      count: 1,
      startedBy: `antimatter-${projectId}`,
      networkConfiguration: {
        awsvpcConfiguration: {
          subnets: this.config.subnetIds,
          securityGroups: [this.config.securityGroupId],
          assignPublicIp: 'DISABLED',
        },
      },
      overrides: {
        containerOverrides: [{
          name: 'workspace',
          environment: [
            { name: 'PROJECT_ID', value: projectId },
            { name: 'SESSION_TOKEN', value: sessionToken },
            { name: 'PROJECTS_BUCKET', value: this.config.projectsBucket },
          ],
        }],
      },
    }));

    const task = result.tasks?.[0];
    if (!task?.taskArn) {
      throw new Error('Failed to start workspace task');
    }

    return {
      projectId,
      taskArn: task.taskArn,
      status: this.mapTaskStatus(task.lastStatus),
      port: 8080,
      sessionToken,
      startedAt: task.startedAt?.toISOString(),
    };
  }

  /**
   * Get the status of a running workspace for a project.
   * When the task reaches RUNNING and has an IP, creates ALB routing rules.
   */
  async getWorkspaceStatus(projectId: string): Promise<WorkspaceContainerInfo | null> {
    // Find tasks started by this project
    const listResult = await this.ecs.send(new ListTasksCommand({
      cluster: this.config.clusterArn,
      startedBy: `antimatter-${projectId}`,
      desiredStatus: 'RUNNING',
    }));

    const taskArns = listResult.taskArns ?? [];
    if (taskArns.length === 0) {
      return null;
    }

    // Describe the first task to get details
    const describeResult = await this.ecs.send(new DescribeTasksCommand({
      cluster: this.config.clusterArn,
      tasks: [taskArns[0]],
    }));

    const task = describeResult.tasks?.[0];
    if (!task) {
      return null;
    }

    // Extract private IP from the ENI attachment
    let privateIp: string | undefined;
    for (const attachment of task.attachments ?? []) {
      if (attachment.type === 'ElasticNetworkInterface') {
        for (const detail of attachment.details ?? []) {
          if (detail.name === 'privateIPv4Address') {
            privateIp = detail.value;
          }
        }
      }
    }

    const status = this.mapTaskStatus(task.lastStatus);
    const sessionToken = WorkspaceContainerService.tokenCache.get(projectId) || '';

    // If the task is RUNNING and we have an IP, ensure ALB routing rules exist
    if (status === 'RUNNING' && privateIp && !WorkspaceContainerService.routingCache.has(projectId)) {
      // Check if rules already exist (Lambda cold start recovery)
      await this.recoverRoutingState(projectId);

      // If still no routing state, create new rules
      if (!WorkspaceContainerService.routingCache.has(projectId)) {
        await this.createRoutingRules(projectId, privateIp);
      }
    }

    return {
      projectId,
      taskArn: taskArns[0],
      status,
      privateIp,
      port: 8080,
      sessionToken,
      startedAt: task.startedAt?.toISOString(),
    };
  }

  /**
   * Stop a workspace container for a project.
   */
  async stopWorkspace(projectId: string): Promise<void> {
    const info = await this.getWorkspaceStatus(projectId);
    if (!info) return;

    // Clean up ALB routing rules and target group
    await this.deleteRoutingRules(projectId);

    // Stop the ECS task
    await this.ecs.send(new StopTaskCommand({
      cluster: this.config.clusterArn,
      task: info.taskArn,
      reason: 'User requested workspace stop',
    }));

    WorkspaceContainerService.tokenCache.delete(projectId);
  }

  // ---- Dynamic ALB routing ----

  /**
   * Create a per-project target group + path-based listener rule.
   * The ALB will route /{projectId}/* and /ws/terminal/{projectId}*
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
        HealthCheckPath: `/${projectId}/health`,
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

      // 2. Register container IP
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
                `/${projectId}/*`,
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
      WorkspaceContainerService.routingCache.set(projectId, {
        targetGroupArn,
        ruleArn,
      });

      console.log(`[workspace] Created ALB routing for ${projectId}: tg=${tgName}, rule priority=${priority}`);
    } catch (err) {
      console.error(`[workspace] Failed to create ALB routing for ${projectId}:`, err);
      throw err;
    }
  }

  /**
   * Delete per-project listener rule + target group.
   */
  private async deleteRoutingRules(projectId: string): Promise<void> {
    // Ensure we have the routing state (may need recovery after cold start)
    if (!WorkspaceContainerService.routingCache.has(projectId)) {
      await this.recoverRoutingState(projectId);
    }

    const state = WorkspaceContainerService.routingCache.get(projectId);
    if (!state) {
      console.log(`[workspace] No routing state to clean up for ${projectId}`);
      return;
    }

    // Delete rule first (must be removed before target group)
    try {
      await this.elbv2.send(new DeleteRuleCommand({
        RuleArn: state.ruleArn,
      }));
      console.log(`[workspace] Deleted listener rule for ${projectId}`);
    } catch (err) {
      console.error(`[workspace] Failed to delete rule for ${projectId}:`, err);
    }

    // Delete target group
    try {
      await this.elbv2.send(new DeleteTargetGroupCommand({
        TargetGroupArn: state.targetGroupArn,
      }));
      console.log(`[workspace] Deleted target group for ${projectId}`);
    } catch (err) {
      console.error(`[workspace] Failed to delete target group for ${projectId}:`, err);
    }

    WorkspaceContainerService.routingCache.delete(projectId);
  }

  /**
   * Recover routing state after Lambda cold start by scanning listener rules
   * for the project's path pattern.
   */
  private async recoverRoutingState(projectId: string): Promise<void> {
    if (WorkspaceContainerService.routingCache.has(projectId)) return;

    try {
      const result = await this.elbv2.send(new DescribeRulesCommand({
        ListenerArn: this.config.listenerArn,
      }));

      for (const rule of result.Rules ?? []) {
        // Check if any path condition contains this projectId
        const pathCondition = rule.Conditions?.find(c => c.Field === 'path-pattern');
        const matchesProject = pathCondition?.PathPatternConfig?.Values?.some(
          v => v.includes(projectId),
        );

        if (matchesProject && rule.RuleArn) {
          const tgArn = rule.Actions?.[0]?.TargetGroupArn;
          if (tgArn) {
            WorkspaceContainerService.routingCache.set(projectId, {
              targetGroupArn: tgArn,
              ruleArn: rule.RuleArn,
            });
            console.log(`[workspace] Recovered routing state for ${projectId}`);
            return;
          }
        }
      }
    } catch (err) {
      console.error(`[workspace] Failed to recover routing state for ${projectId}:`, err);
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

  private mapTaskStatus(status?: string): WorkspaceContainerInfo['status'] {
    switch (status) {
      case 'PROVISIONING': return 'PROVISIONING';
      case 'PENDING': return 'PENDING';
      case 'ACTIVATING': return 'PENDING';
      case 'RUNNING': return 'RUNNING';
      case 'DEACTIVATING': return 'DEPROVISIONING';
      case 'STOPPING': return 'DEPROVISIONING';
      case 'DEPROVISIONING': return 'DEPROVISIONING';
      case 'STOPPED': return 'STOPPED';
      default: return 'UNKNOWN';
    }
  }
}
