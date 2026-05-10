/**
 * Unified ActivityEvent model — covers every significant moment in the platform.
 *
 * Sources:
 *  - router:    Router process lifecycle + WebSocket connections
 *  - child:     ChildProcessManager lifecycle (spawn, ready, exit, respawn)
 *  - worker:    Per-project worker process lifecycle
 *  - workflow:  Rule execution (invocations, rules, logs, execs)
 *  - pty:       Terminal session lifecycle
 *  - service:   Automation API / REST requests
 *  - instance:  EC2 instance lifecycle (from Lambda via EventLogger)
 *  - client:    Browser-originated events (errors, navigation)
 *
 * Events can be correlated via:
 *  - projectId:     project scope
 *  - correlationId: primary (invocationId / sessionId / requestId / etc.)
 *  - parentId:      secondary (rule belongs to invocation, exec to rule, etc.)
 */

export type ActivitySource =
  | 'router'
  | 'child'
  | 'worker'
  | 'workflow'
  | 'pty'
  | 'service'
  | 'instance'
  | 'client';

export type ActivityLevel = 'debug' | 'info' | 'warn' | 'error';

export interface ActivityEvent {
  readonly seq: number;
  readonly loggedAt: string;
  readonly source: ActivitySource;
  readonly kind: string;
  readonly level: ActivityLevel;
  readonly message: string;
  readonly projectId?: string;
  /**
   * Operation ID — stable across an entire operation, crosses process
   * boundaries. Enables end-to-end tracing from UI click → rule → HTTP call
   * → Lambda → SSM → worker action, all grouped under one ID.
   */
  readonly operationId?: string;
  /**
   * Correlation ID — this level's primary identifier (invocationId, execId,
   * sessionId, requestId, etc.). Narrower scope than operationId.
   */
  readonly correlationId?: string;
  /** Secondary correlation: parent scope (e.g. ruleId for an exec event). */
  readonly parentId?: string;
  /** Environment the event applies to (for resource/ops actions). */
  readonly environment?: string;
  readonly data?: Record<string, unknown>;
}

/** Input shape for emitting events (seq + loggedAt are added by the log). */
export type ActivityEventInput = Omit<ActivityEvent, 'seq' | 'loggedAt'>;

/** Filter options for querying activity. */
export interface ActivityListOptions {
  /** Max number of events to return (newest first). Default 500. */
  limit?: number;
  /** ISO timestamp — only events after this. */
  since?: string;
  /** Filter by source (e.g. 'workflow'). */
  source?: ActivitySource;
  /** Filter by kind prefix (e.g. 'workflow:' or 'child:spawn'). */
  kind?: string;
  /** Filter by correlation — includes events whose correlationId OR parentId matches. */
  correlationId?: string;
  /** Filter by end-to-end operation ID (spans multiple invocations/processes). */
  operationId?: string;
  /** Filter by projectId. */
  projectId?: string;
  /** Filter by environment. */
  environment?: string;
  /** Filter by minimum level (error > warn > info > debug). */
  minLevel?: ActivityLevel;
}

const LEVEL_RANK: Record<ActivityLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

/** Returns true if `level` meets or exceeds `minLevel`. */
export function levelMeets(level: ActivityLevel, minLevel: ActivityLevel): boolean {
  return LEVEL_RANK[level] >= LEVEL_RANK[minLevel];
}

/** Event kind constants — avoids typos in emit sites. Add as needed. */
export const Kinds = {
  // Router
  RouterStart: 'router:start',
  RouterShutdown: 'router:shutdown',
  RouterWsConnect: 'router:ws-connect',
  RouterWsDisconnect: 'router:ws-disconnect',

  // Child (in Router's view)
  ChildSpawn: 'child:spawn',
  ChildReady: 'child:ready',
  ChildError: 'child:error',
  ChildExit: 'child:exit',
  ChildRespawn: 'child:respawn',
  ChildDead: 'child:dead',
  ChildShutdown: 'child:shutdown',
  ChildUnresponsive: 'child:unresponsive',      // watchdog: heartbeat missed
  ChildForceRestart: 'child:force-restart',     // watchdog: restart due to unresponsiveness
  ChildDeadCooldown: 'child:dead-cooldown',     // dead state expired, allowing respawn

  // Router self-healing
  RouterReapOrphans: 'router:reap-orphans',     // cleanup at startup

  // Worker (in Worker's view)
  WorkerStart: 'worker:start',
  WorkerInitStart: 'worker:init-start',
  WorkerInitEnd: 'worker:init-end',
  WorkerShutdown: 'worker:shutdown',
  WorkerError: 'worker:error',

  // Workflow
  WorkflowInvocationStart: 'workflow:invocation:start',
  WorkflowInvocationEnd: 'workflow:invocation:end',
  WorkflowRuleStart: 'workflow:rule:start',
  WorkflowRuleEnd: 'workflow:rule:end',
  WorkflowLog: 'workflow:log',
  WorkflowExecStart: 'workflow:exec:start',
  WorkflowExecChunk: 'workflow:exec:chunk',
  WorkflowExecEnd: 'workflow:exec:end',
  WorkflowUtilStart: 'workflow:util:start',
  WorkflowUtilEnd: 'workflow:util:end',
  WorkflowEmit: 'workflow:emit',
  WorkflowScheduleFire: 'workflow:schedule:fire',
  WorkflowScheduleSkip: 'workflow:schedule:skip',

  // PTY
  PtySpawn: 'pty:spawn',
  PtyExit: 'pty:exit',
  PtyRespawn: 'pty:respawn',
  PtyClose: 'pty:close',

  // Service
  ServiceRequest: 'service:request',
  ServiceResponse: 'service:response',
  ServiceError: 'service:error',

  // Project context model (Phase 0+ defineX-based model)
  ContextTransitioned: 'context:transitioned',

  // Instance (emitted by Lambda)
  InstanceLaunch: 'instance:launch',
  InstanceResume: 'instance:resume',
  InstanceAttachVolume: 'instance:attach-volume',
  InstanceRegisterTarget: 'instance:register-target',
  InstanceDeregisterTarget: 'instance:deregister-target',
  InstanceTerminate: 'instance:terminate',
} as const;
