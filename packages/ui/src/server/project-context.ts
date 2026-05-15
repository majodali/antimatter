/**
 * ProjectContext — encapsulates all per-project state for the workspace server.
 *
 * Each project gets its own:
 * - LocalWorkspaceEnvironment (file system, command execution)
 * - WorkspaceService (file APIs, build, agent, etc.)
 * - PtyManager (pseudo-terminal)
 * - S3SyncScheduler (periodic workspace → S3 backup)
 * - FileChangeNotifier (filesystem watcher → WebSocket broadcasts)
 * - WorkflowManager (event-driven rule engine)
 * - ErrorStore (project error storage)
 * - EventLogger (structured logging)
 * - Express Router (project-scoped API routes)
 * - WebSocket connections (for broadcast isolation)
 *
 * Lifecycle:
 *  1. Constructor creates lightweight shell (no I/O)
 *  2. initialize() does heavy lifting: S3 sync, git init, PTY, workflow engine
 *  3. shutdown() stops all subsystems and flushes pending data
 */

import express from 'express';
import { existsSync, readdirSync, mkdirSync, createWriteStream } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { pipeline } from 'node:stream/promises';
import { Readable } from 'node:stream';
import { WebSocket } from 'ws';
import {
  S3Client,
  ListObjectsV2Command,
  GetObjectCommand,
} from '@aws-sdk/client-s3';
import { EventBridgeClient } from '@aws-sdk/client-eventbridge';
import { SSMClient, GetParameterCommand } from '@aws-sdk/client-ssm';
import { LocalWorkspaceEnvironment, syncToS3 } from '@antimatter/workspace';
import type { SyncOptions, SyncResult } from '@antimatter/workspace';
import { watchDebounced } from '@antimatter/filesystem';
import type { FileSystem, WatchEvent, Watcher, WorkspacePath } from '@antimatter/filesystem';
import { EventLogger } from './services/event-logger.js';
import type { BuildRule, BuildResult } from '@antimatter/project-model';
import { WorkspaceService } from './services/workspace-service.js';
import { createFileRouter } from './routes/filesystem.js';
import { createBuildRouter } from './routes/build.js';
import { createAgentRouter, processChatMessage } from './routes/agent.js';
import { createDeployRouter } from './routes/deploy.js';
import { createEnvironmentRouter } from './routes/environments.js';
import { createActivityRouter } from './routes/activity.js';
import { createGitRouter } from './routes/git.js';
import { createEventsRouter } from './routes/events.js';
import { createWorkflowRouter } from './routes/workflow.js';
import { createTestResultsRouter, FileTestResultsStorage } from './routes/test-results.js';
import { createAutomationRouter } from './routes/automation.js';
import { createContextsRouter } from './routes/contexts.js';
import { createServerCommandExecutor } from './automation/server-commands.js';
import { WorkflowManager } from './services/workflow-manager.js';
import { ErrorStore } from './services/error-store.js';
import { DeployedResourceStore } from './services/deployed-resource-store.js';
import { ActivityLog } from './services/activity-log.js';
import { ContextStore } from './services/context-store.js';
import { ContextLifecycleStore } from './services/context-lifecycle-store.js';
import { ProjectContextModelStore } from './services/project-context-model-store.js';
import { Kinds } from '../shared/activity-types.js';
import {
  COMMAND_TIMEOUTS,
  DEFAULT_COMMAND_TIMEOUT,
} from '../shared/automation-types.js';
import type { AutomationErrorCode } from '../shared/automation-types.js';
import type { DeployLambdaClient, DeployCloudfrontClient } from './services/deployment-executor.js';

// ---------------------------------------------------------------------------
// node-pty — native module, installed separately on EC2
// ---------------------------------------------------------------------------

let pty: any;
try {
  pty = require('node-pty');
} catch {
  console.warn('[project-context] node-pty not available — terminal disabled');
}

// ---------------------------------------------------------------------------
// Shared configuration passed from the main server
// ---------------------------------------------------------------------------

export interface SharedConfig {
  workspaceRoot: string;
  projectsBucket: string;
  anthropicApiKey: string;
  s3Client: S3Client;
  ssmClient: SSMClient;
  eventBridgeClient: EventBridgeClient;
  eventBusName: string;
  getDeployLambdaClient: () => DeployLambdaClient;
  getDeployCloudfrontClient: () => DeployCloudfrontClient;
  /** S3 bucket for the public website (CloudFront origin). Used for package publishing. */
  websiteBucket: string;
  /** Called when a workflow command starts — holds global idle shutdown. */
  onExecStart: () => void;
  /** Called when a workflow command ends — releases global idle shutdown hold. */
  onExecEnd: () => void;
  /**
   * Optional IPC broadcast function (worker mode).
   * When set, broadcastToClients() delegates to this instead of iterating over WebSocket objects.
   * This enables running ProjectContext in a child process where WebSocket objects don't exist.
   */
  broadcastFn?: (msg: object) => void;
  /**
   * Optional callback to send a message to a specific WebSocket client by connectionId (worker mode).
   * Used for targeted sends (e.g., automation responses, PTY output to single client).
   */
  sendToClientFn?: (connectionId: string, msg: object) => void;
}

// ---------------------------------------------------------------------------
// Default ignore patterns
// ---------------------------------------------------------------------------

/**
 * Watcher ignore patterns that MUST always be present — writing to any of
 * these paths is the worker's own business and watching them creates
 * pathological feedback loops (e.g. `.antimatter-cache/events.jsonl`, the
 * worker's own EventLog append target).
 *
 * Project config (`.antimatter/config.json`) can add more patterns but
 * cannot remove these. See `loadIgnoreConfig`.
 */
const STRUCTURAL_WATCHER_IGNORE = ['.git/', '.vite-temp/', '.antimatter-cache/'];
const DEFAULT_WATCHER_IGNORE = [...STRUCTURAL_WATCHER_IGNORE];
const DEFAULT_EXPLORER_IGNORE = [
  'node_modules/', '.antimatter-cache/', 'dist/', '.next/', '__pycache__/', '.git/',
];
const NOISE_FILES = ['.antimatter-sync.json'];

// ---------------------------------------------------------------------------
// FileChangeNotifier — broadcasts filesystem changes via WebSocket
// ---------------------------------------------------------------------------

class FileChangeNotifier {
  private watcher: Watcher | null = null;
  private onBulkChange: (() => void) | null = null;
  private onFilteredChanges: ((events: readonly WatchEvent[], source?: string) => void) | null = null;

  private pendingBroadcast: { type: string; path: string }[] = [];
  private broadcastTimer: ReturnType<typeof setTimeout> | null = null;
  private broadcastFn: ((msg: object) => void) | null = null;
  private readonly BROADCAST_BATCH_MS = 500;
  private readonly BROADCAST_BATCH_MAX = 50;

  private watcherIgnorePatterns: string[];
  private explorerIgnorePatterns: string[];

  constructor(
    private readonly projectId: string,
    watcherIgnore?: string[],
    explorerIgnore?: string[],
  ) {
    this.watcherIgnorePatterns = watcherIgnore ?? [...DEFAULT_WATCHER_IGNORE];
    this.explorerIgnorePatterns = explorerIgnore ?? [...DEFAULT_EXPLORER_IGNORE];
  }

  setWatcherIgnore(patterns: string[]): void { this.watcherIgnorePatterns = patterns; }
  setExplorerIgnore(patterns: string[]): void { this.explorerIgnorePatterns = patterns; }
  getExplorerIgnore(): string[] { return this.explorerIgnorePatterns; }

  /**
   * Emit synthetic file change events (from REST API mutations).
   * Follows the same filtering and routing as the filesystem watcher callback,
   * ensuring workflow rules trigger reliably even when inotify doesn't fire.
   * Deduplication with watcher events is handled by the workflow manager's
   * serialized event processing.
   */
  emitSynthetic(events: readonly { type: 'change' | 'delete'; path: string }[]): void {
    const asWatch: WatchEvent[] = events.map(e => ({ type: e.type, path: e.path }));
    const filtered = asWatch.filter(e => !this.isWatcherIgnored(e.path));
    if (filtered.length === 0) return;

    if (this.onFilteredChanges) {
      this.onFilteredChanges(filtered, 'rest-api');
    }

    const uiFiltered = filtered.filter(e => !this.isExplorerIgnored(e.path));
    if (uiFiltered.length > 0) {
      this.queueBroadcast(uiFiltered);
    }
  }

  private isWatcherIgnored(path: string): boolean {
    const normalized = path.startsWith('/') ? path.slice(1) : path;
    return this.watcherIgnorePatterns.some(p => normalized.startsWith(p))
      || NOISE_FILES.includes(normalized);
  }

  private isExplorerIgnored(path: string): boolean {
    const normalized = path.startsWith('/') ? path.slice(1) : path;
    return this.explorerIgnorePatterns.some(p => normalized.startsWith(p))
      || NOISE_FILES.includes(normalized);
  }

  start(
    fs: FileSystem,
    broadcast: (msg: object) => void,
    onBulkChange?: () => void,
    onFilteredChanges?: (events: readonly WatchEvent[], source?: string) => void,
  ): void {
    this.onBulkChange = onBulkChange ?? null;
    this.onFilteredChanges = onFilteredChanges ?? null;
    this.broadcastFn = broadcast;

    this.watcher = watchDebounced(
      fs,
      '/' as WorkspacePath,
      (events: readonly WatchEvent[]) => {
        const watcherFiltered = events.filter(e => !this.isWatcherIgnored(e.path));
        if (watcherFiltered.length === 0) return;

        if (this.onFilteredChanges) {
          this.onFilteredChanges(watcherFiltered, 'watcher');
        }

        const uiFiltered = watcherFiltered.filter(e => !this.isExplorerIgnored(e.path));
        if (uiFiltered.length > 0) {
          this.queueBroadcast(uiFiltered);
        }

        if (watcherFiltered.length > 20 && this.onBulkChange) {
          this.onBulkChange();
        }
      },
      300,
    );
  }

  private queueBroadcast(events: readonly WatchEvent[]): void {
    for (const e of events) {
      this.pendingBroadcast.push({ type: e.type, path: e.path });
    }
    if (this.pendingBroadcast.length >= this.BROADCAST_BATCH_MAX) {
      this.flushBroadcast();
      return;
    }
    if (this.broadcastTimer) clearTimeout(this.broadcastTimer);
    this.broadcastTimer = setTimeout(() => this.flushBroadcast(), this.BROADCAST_BATCH_MS);
  }

  private flushBroadcast(): void {
    if (this.broadcastTimer) { clearTimeout(this.broadcastTimer); this.broadcastTimer = null; }
    if (this.pendingBroadcast.length === 0 || !this.broadcastFn) return;
    const changes = this.pendingBroadcast;
    this.pendingBroadcast = [];
    this.broadcastFn({ type: 'file-changes', changes });
  }

  stop(): void {
    this.flushBroadcast();
    this.watcher?.close();
    this.watcher = null;
  }
}

// ---------------------------------------------------------------------------
// S3SyncScheduler — periodic workspace → S3 backup
// ---------------------------------------------------------------------------

class S3SyncScheduler {
  private timer: ReturnType<typeof setInterval> | null = null;
  private syncing = false;

  constructor(
    private readonly syncOptions: SyncOptions,
    private readonly eventLogger: EventLogger,
  ) {}

  start(intervalMs = 30_000): void {
    this.timer = setInterval(() => this.sync(), intervalMs);
  }

  async sync(): Promise<SyncResult | null> {
    if (this.syncing) return null;
    this.syncing = true;
    try {
      const result = await syncToS3(this.syncOptions);
      if (result.uploaded > 0 || result.deleted > 0) {
        this.eventLogger.info('system',
          `S3 sync: ${result.uploaded} uploaded, ${result.deleted} deleted (${result.durationMs}ms)`,
          { uploaded: result.uploaded, deleted: result.deleted, durationMs: result.durationMs });
      }
      return result;
    } catch (err) {
      this.eventLogger.error('system', 'S3 sync failed', {
        error: err instanceof Error ? err.message : String(err),
      });
      return null;
    } finally {
      this.syncing = false;
    }
  }

  async shutdown(): Promise<void> {
    if (this.timer) { clearInterval(this.timer); this.timer = null; }
    await this.sync();
  }
}

// ---------------------------------------------------------------------------
// PtyManager — single pseudo-terminal session
// ---------------------------------------------------------------------------

const MAX_REPLAY_BYTES = 50 * 1024;

class PtyManager {
  private shell: any = null;
  private replayBuffer = '';
  private listeners = new Set<(data: string) => void>();
  readonly name: string;
  /** Whether a broadcast subscriber has been attached (worker mode, one per session). */
  hasBroadcastSubscriber = false;

  constructor(name = 'Terminal') { this.name = name; }

  get isRunning(): boolean { return this.shell !== null; }

  start(cwd: string): void {
    if (!pty) { console.warn('[pty] node-pty not available'); return; }
    if (this.shell) return;

    if (!existsSync(cwd)) mkdirSync(cwd, { recursive: true });
    console.log(`[pty] Starting bash shell "${this.name}" in ${cwd}`);

    this.shell = pty.spawn('bash', [], {
      name: 'xterm-256color',
      cols: 120,
      rows: 30,
      cwd,
      env: {
        ...process.env,
        TERM: 'xterm-256color',
        HOME: cwd,
        LANG: 'en_US.UTF-8',
      },
    });

    this.shell.onData((data: string) => {
      this.replayBuffer += data;
      if (this.replayBuffer.length > MAX_REPLAY_BYTES) {
        this.replayBuffer = this.replayBuffer.slice(-MAX_REPLAY_BYTES);
      }
      for (const cb of this.listeners) {
        try { cb(data); } catch { /* ignore */ }
      }
    });

    this.shell.onExit(({ exitCode, signal }: { exitCode: number; signal: number }) => {
      console.log(`[pty] Shell "${this.name}" exited: code=${exitCode}, signal=${signal}`);
      this.shell = null;
      setTimeout(() => {
        if (!this.shell) { console.log(`[pty] Restarting shell "${this.name}"...`); this.start(cwd); }
      }, 1000);
    });
  }

  write(data: string): void { if (this.shell) this.shell.write(data); }

  resize(cols: number, rows: number): void {
    if (this.shell) { try { this.shell.resize(cols, rows); } catch { /* ignore */ } }
  }

  onData(cb: (data: string) => void): () => void {
    this.listeners.add(cb);
    return () => this.listeners.delete(cb);
  }

  getReplayBuffer(): string { return this.replayBuffer; }

  /** Append to replay buffer without a PTY (used by virtual sessions like Build). */
  appendOutput(data: string): void {
    this.replayBuffer += data;
    if (this.replayBuffer.length > MAX_REPLAY_BYTES) {
      this.replayBuffer = this.replayBuffer.slice(-MAX_REPLAY_BYTES);
    }
    for (const cb of this.listeners) {
      try { cb(data); } catch { /* ignore */ }
    }
  }

  stop(): void {
    if (this.shell) {
      try { this.shell.kill(); } catch { /* ignore */ }
      this.shell = null;
    }
    this.listeners.clear();
    this.replayBuffer = '';
  }
}

// ---------------------------------------------------------------------------
// PtySessionPool — manages multiple named terminal sessions per project
// ---------------------------------------------------------------------------

interface TerminalSessionInfo {
  id: string;
  name: string;
  running: boolean;
  /** Virtual sessions (like Build) have no PTY — they're read-only output streams. */
  virtual: boolean;
}

export class PtySessionPool {
  private sessions = new Map<string, PtyManager>();

  /** Lifecycle hooks (set externally by ProjectContext to emit activity events). */
  onSessionSpawn?: (sessionId: string, name: string, virtual: boolean) => void;
  onSessionClose?: (sessionId: string) => void;

  /** Get or create a session. Starts PTY if not virtual. */
  getOrCreate(sessionId: string, cwd: string, name?: string): PtyManager {
    let session = this.sessions.get(sessionId);
    if (!session) {
      session = new PtyManager(name ?? sessionId);
      this.sessions.set(sessionId, session);
      // Don't auto-start PTY for 'build' — it's a virtual (read-only) session
      if (sessionId !== 'build') {
        session.start(cwd);
      }
      this.onSessionSpawn?.(sessionId, name ?? sessionId, sessionId === 'build');
    }
    return session;
  }

  /** Get an existing session (returns undefined if not found). */
  get(sessionId: string): PtyManager | undefined {
    return this.sessions.get(sessionId);
  }

  /** Ensure the build session exists (virtual, no PTY). */
  ensureBuild(): PtyManager {
    let build = this.sessions.get('build');
    if (!build) {
      build = new PtyManager('Build');
      this.sessions.set('build', build);
    }
    return build;
  }

  /** List all sessions. */
  list(): TerminalSessionInfo[] {
    return Array.from(this.sessions.entries()).map(([id, mgr]) => ({
      id,
      name: mgr.name,
      running: mgr.isRunning,
      virtual: id === 'build',
    }));
  }

  /** Close and remove a session. */
  close(sessionId: string): boolean {
    const session = this.sessions.get(sessionId);
    if (!session) return false;
    session.stop();
    this.sessions.delete(sessionId);
    this.onSessionClose?.(sessionId);
    return true;
  }

  /** Close all sessions. */
  closeAll(): void {
    for (const session of this.sessions.values()) session.stop();
    this.sessions.clear();
  }

  /** Check if any interactive (non-virtual) session has a running PTY. */
  get hasRunningPty(): boolean {
    for (const [id, session] of this.sessions) {
      if (id !== 'build' && session.isRunning) return true;
    }
    return false;
  }
}

// ---------------------------------------------------------------------------
// SSM helper
// ---------------------------------------------------------------------------

async function getSSMSecret(ssmClient: SSMClient, name: string): Promise<string> {
  try {
    const result = await ssmClient.send(
      new GetParameterCommand({ Name: `/antimatter/secrets/${name}`, WithDecryption: true }),
    );
    return result.Parameter?.Value ?? '';
  } catch {
    return '';
  }
}

// ---------------------------------------------------------------------------
// ProjectContext
// ---------------------------------------------------------------------------

export class ProjectContext {
  readonly projectId: string;
  readonly projectPath: string;
  readonly env: LocalWorkspaceEnvironment;
  workspace: WorkspaceService;
  readonly ptyManager: PtySessionPool;
  readonly fileChangeNotifier: FileChangeNotifier;
  readonly eventLogger: EventLogger;
  workflowManager!: WorkflowManager;
  errorStore!: ErrorStore;
  testResultsStorage!: FileTestResultsStorage;
  deployedResourceStore!: DeployedResourceStore;
  contextStore!: ContextStore;
  contextLifecycleStore!: ContextLifecycleStore;
  /**
   * Server-side cache for the NEW (Phase 0+) project context model
   * loaded from `.antimatter/{resources,contexts,build}.ts`. Coexists
   * with `contextStore` (legacy DSL) until the new model fully
   * replaces it.
   */
  projectContextModelStore!: ProjectContextModelStore;
  private eventLog?: import('./event-log.js').EventLog;
  /** Unified activity log for worker/workflow/pty/service events. Created during initialize(). */
  activityLog?: import('./services/activity-log.js').ActivityLog;
  s3SyncScheduler: S3SyncScheduler | null = null;

  /** WebSocket connections scoped to this project (for broadcast isolation). */
  readonly connections = new Set<WebSocket>();

  /** Diagnostic counters for debugging WebSocket lifecycle. */
  private _connectionsReceived = 0;
  private _connectionsCleaned = 0;
  private _lastConnectTime: string | null = null;
  private _lastCleanupTime: string | null = null;
  private _lastCleanupReason: string | null = null;

  /** Express Router with all project-scoped API routes. */
  readonly router: express.Router;

  private readonly config: SharedConfig;
  private initialized = false;

  /** Pending browser automation commands awaiting WebSocket response. */
  private readonly pendingBrowserCommands = new Map<string, {
    resolve: (data: unknown) => void;
    reject: (err: Error) => void;
    timer: ReturnType<typeof setTimeout>;
  }>();

  constructor(projectId: string, config: SharedConfig) {
    this.projectId = projectId;
    this.config = config;
    this.projectPath = join(config.workspaceRoot, projectId);

    // Lightweight objects — no I/O in constructor
    this.env = new LocalWorkspaceEnvironment({
      rootPath: this.projectPath,
      id: projectId,
      label: projectId,
    });

    this.workspace = new WorkspaceService({
      env: this.env,
      anthropicApiKey: config.anthropicApiKey,
    });

    this.ptyManager = new PtySessionPool();
    this.fileChangeNotifier = new FileChangeNotifier(projectId);

    this.eventLogger = new EventLogger({
      s3Client: config.s3Client,
      bucket: config.projectsBucket,
      source: 'workspace',
      projectId,
      eventBridgeClient: config.eventBridgeClient,
      eventBusName: config.eventBusName,
    });

    // Create router immediately (routes use `this` via closure)
    this.router = this.createRouter();
  }

  // ---- Initialization (heavy I/O) ----

  async initialize(): Promise<void> {
    if (this.initialized) return;
    console.log(`[project-context] Initializing project: ${this.projectId}`);
    const initStart = Date.now();

    // Ensure project directory exists
    if (!existsSync(this.projectPath)) {
      mkdirSync(this.projectPath, { recursive: true });
    }

    // Activity log — unified observability for worker/workflow/pty/service events.
    // Initialize FIRST so the rest of init can emit events.
    this.activityLog = new ActivityLog({
      logPath: join(this.projectPath, '.antimatter-cache', 'activity.jsonl'),
      label: `activity:${this.projectId}`,
    });
    await this.activityLog.initialize();
    // Subscribe: broadcast each event to all project WebSocket clients (via IPC when in worker mode)
    this.activityLog.subscribe((event) => {
      this.broadcastToClients({ type: 'activity-event', event });
    });
    this.activityLog.emit({
      source: 'worker', kind: Kinds.WorkerInitStart, level: 'info',
      message: `Worker initializing project: ${this.projectId}`,
      projectId: this.projectId, correlationId: this.projectId,
    });

    // Wire PTY session lifecycle → activity log
    this.ptyManager.onSessionSpawn = (sessionId, name, virtual) => {
      this.activityLog?.emit({
        source: 'pty', kind: Kinds.PtySpawn, level: 'info',
        message: virtual ? `Virtual PTY session: ${name}` : `PTY session started: ${name}`,
        projectId: this.projectId, correlationId: sessionId,
        data: { sessionId, name, virtual },
      });
    };
    this.ptyManager.onSessionClose = (sessionId) => {
      this.activityLog?.emit({
        source: 'pty', kind: Kinds.PtyClose, level: 'info',
        message: `PTY session closed: ${sessionId}`,
        projectId: this.projectId, correlationId: sessionId,
        data: { sessionId },
      });
    };

    // Start event logger
    this.eventLogger.startPeriodicFlush(10_000);

    // Initial sync from S3 (only if directory is empty)
    const downloadedFiles = await this.initialSyncFromS3();

    // Fetch Anthropic API key from SSM (fall back to config value)
    const ssmKey = await getSSMSecret(this.config.ssmClient, 'anthropic-api-key');
    if (ssmKey) {
      console.log(`[project-context:${this.projectId}] Using Anthropic API key from SSM`);
      this.workspace = new WorkspaceService({ env: this.env, anthropicApiKey: ssmKey });
    }

    // Initialize git
    await this.initializeGit();

    // PTY is started lazily on first WebSocket connection (not during init).
    // node-pty can crash the process with std::bad_alloc on resource-constrained
    // instances, so deferring avoids killing the server before it serves HTTP.
    // See handleWebSocket() for the lazy start.

    // Error store
    this.errorStore = new ErrorStore(this.env, () => {
      this.workflowManager.broadcastStatePatch({
        errors: this.errorStore.getAllErrors(),
      });
    });

    // Event log — persistent ordered event sourcing for the workflow engine
    const { EventLog } = await import('./services/event-log.js');
    const eventLogPath = join(this.projectPath, '.antimatter-cache', 'events.jsonl');
    this.eventLog = new EventLog({ logPath: eventLogPath });
    await this.eventLog.initialize();

    // Deployed resource store — must be created BEFORE WorkflowManager so that
    // wf.utils.resource.* in workflow rules has a real store to talk to.
    this.testResultsStorage = new FileTestResultsStorage(this.env);
    this.deployedResourceStore = new DeployedResourceStore(this.env, () => {
      this.broadcastToClients({
        type: 'application-state',
        state: { deployedResources: this.deployedResourceStore.list() },
      });
      // Phase 3: deployed-resource-{present,healthy} validations may flip,
      // so re-evaluate the new context model.
      this.projectContextModelStore?.reevaluate().catch((err: unknown) => {
        console.error(`[project-context:${this.projectId}] context model re-evaluate (deployed-resource) failed:`, err);
      });
    });

    // Workflow manager — broadcast callback also captures build terminal output.
    // The onRuleResultsChanged hook drives ContextLifecycleStore re-derivation
    // (created below; the closure resolves it lazily so the wiring order works
    // — workflowManager is constructed before contextLifecycleStore exists).
    this.workflowManager = new WorkflowManager({
      env: this.env,
      broadcast: (msg: object) => {
        this.broadcastToClients(msg);
        // Capture build terminal output in the session replay buffer
        const m = msg as { type?: string; sessionId?: string; data?: string };
        if (m.type === 'output' && m.sessionId === 'build' && m.data) {
          this.ptyManager.ensureBuild().appendOutput(m.data);
        }
      },
      errorStore: this.errorStore,
      eventLog: this.eventLog,
      deployedResourceStore: this.deployedResourceStore,
      activityLog: this.activityLog,
      projectId: this.projectId,
      onExecStart: () => this.config.onExecStart(),
      onExecEnd: () => this.config.onExecEnd(),
      onRuleResultsChanged: () => {
        this.contextLifecycleStore?.scheduleRecompute();
        // Phase 3: rule-outcome validations re-evaluate against the new
        // pass/fail state. Fire-and-forget; the snapshot broadcast goes
        // out via the store's subscriber.
        this.projectContextModelStore?.reevaluate().catch((err: unknown) => {
          console.error(`[project-context:${this.projectId}] context model re-evaluate (rule) failed:`, err);
        });
      },
    });

    await this.errorStore.initialize();
    await this.testResultsStorage.initialize();
    await this.deployedResourceStore.initialize();

    // Project context tree — parsed from `.antimatter/contexts.dsl` if present.
    // Always safe to construct (empty snapshot if no DSL file). Subscribe so
    // changes broadcast as application-state patches to all connected clients.
    this.contextStore = new ContextStore(this.env);
    await this.contextStore.initialize();
    this.contextStore.subscribe((snap) => {
      this.broadcastToClients({
        type: 'application-state',
        state: { contexts: snap },
      });
    });

    // NEW project context model (Phase 0+): defineX-based declarations
    // in `.antimatter/{resources,contexts,build}.ts`. Watcher hookup
    // (Phase 2) reloads on edits and broadcasts a fresh snapshot.
    // Phase 3 wires evaluator collaborators so validations carry
    // pass/fail status derived from real runtime state (rule results,
    // test passes, deployed-resource health).
    this.projectContextModelStore = new ProjectContextModelStore(this.projectPath, {
      getRuleStatus: (ruleId) => {
        const r = this.workflowManager?.getRuleResult(ruleId);
        return r?.status;
      },
      getTestPasses: () => this.testResultsStorage?.getLatestPasses() ?? [],
      hasDeployedResource: (resourceId) => !!this.deployedResourceStore?.get(resourceId),
      isDeployedResourceHealthy: (resourceId) => {
        const r = this.deployedResourceStore?.get(resourceId);
        if (!r) return false;
        return r.status === 'healthy';
      },
      onTransition: (event) => {
        // Phase 4: surface lifecycle transitions in the unified activity log so
        // the IDE's activity stream shows them alongside rule fires + worker events.
        this.activityLog?.emit({
          source: 'worker',
          kind: Kinds.ContextTransitioned,
          level: event.to === 'regressed' || event.to === 'dependency-regressed' ? 'warn' : 'info',
          message: `Context "${event.contextName}" ${event.from ? `${event.from} → ${event.to}` : `→ ${event.to}`}`,
          projectId: this.projectId,
          correlationId: event.contextId,
          data: { contextId: event.contextId, from: event.from, to: event.to },
        });
      },
    });
    await this.projectContextModelStore.reload();
    this.projectContextModelStore.subscribe((snap) => {
      this.broadcastToClients({
        type: 'application-state',
        state: { projectContextModel: snap },
      });
    });
    {
      const initialSnap = this.projectContextModelStore.getSnapshot();
      if (initialSnap.present) {
        const errCount = initialSnap.modelErrors.length + initialSnap.loadErrors.length;
        console.log(`[project-context:${this.projectId}] Loaded project context model: ${initialSnap.counts.contexts} contexts, ${initialSnap.counts.resources} resources, ${initialSnap.counts.rules} rules, ${errCount} error(s)`);
      }
    }
    {
      const initialSnap = this.contextStore.getSnapshot();
      if (initialSnap.present) {
        const errCount = initialSnap.errors.length;
        console.log(`[project-context:${this.projectId}] Loaded contexts.dsl: ${initialSnap.nodes.length} contexts, ${errCount} validation error(s)`);
        if (errCount > 0) {
          this.activityLog?.emit({
            source: 'worker', kind: Kinds.WorkerError, level: 'warn',
            message: `contexts.dsl has ${errCount} validation error(s)`,
            projectId: this.projectId, correlationId: this.projectId,
            data: { errors: initialSnap.errors.map(e => ({ code: e.code, message: e.message })) },
          });
        }
      }
    }

    await this.workflowManager.start();

    // Lifecycle store — derives status per context from rule + test
    // pass state. Construct AFTER WorkflowManager so the rule catalog
    // and result API are ready. The hook in WorkflowManager
    // (onRuleResultsChanged) calls scheduleRecompute() whenever rule
    // results update; same for FileTestResultsStorage.onChange below.
    this.contextLifecycleStore = new ContextLifecycleStore({
      env: this.env,
      contextStore: this.contextStore,
      getRuleDeclarations: () => this.workflowManager.getDeclarations().rules,
      getRuleResult: (id) => this.workflowManager.getRuleResult(id)?.status,
      getTestPasses: () => this.testResultsStorage.getLatestPasses(),
      onTransitions: (transitions) => {
        // Emit a workflow event per transition so rules can react
        // (e.g. agent watches for context:transitioned to=regressed and
        // opens a debugging session). Fire-and-forget.
        for (const t of transitions) {
          this.workflowManager.emitEvent({
            type: 'context:transitioned',
            contextId: t.contextId,
            from: t.from,
            to: t.to,
            at: t.at,
          }).catch((err: unknown) => {
            console.error(`[project-context:${this.projectId}] context:transitioned emit failed:`, err);
          });
        }
      },
    });
    await this.contextLifecycleStore.initialize();
    // Subscribe lifecycle changes → broadcast to clients.
    this.contextLifecycleStore.subscribe((snap) => {
      this.broadcastToClients({
        type: 'application-state',
        state: { contextLifecycle: snap },
      });
    });
    // Wire test-results changes to lifecycle recompute.
    this.testResultsStorage.onChange = () => {
      this.contextLifecycleStore.scheduleRecompute();
      // Phase 3: test-pass / test-set-pass validations re-evaluate.
      this.projectContextModelStore?.reevaluate().catch((err: unknown) => {
        console.error(`[project-context:${this.projectId}] context model re-evaluate (test) failed:`, err);
      });
    };

    // Auto-register Preview resource if project has an index.html
    const previewCandidates = ['dist/index.html', 'src/index.html'];
    for (const candidate of previewCandidates) {
      if (existsSync(join(this.projectPath, candidate))) {
        // Only register if not already present
        if (!this.deployedResourceStore.get('preview')) {
          await this.deployedResourceStore.register({
            name: 'Preview',
            resourceType: 'preview',
            metadata: {
              url: `/workspace/${this.projectId}/preview/`,
              directory: candidate.replace('/index.html', ''),
            },
            builtIn: true,
          });
        }
        break;
      }
    }

    // Feed initial S3 files to workflow engine
    if (downloadedFiles.length > 0) {
      const syntheticEvents: WatchEvent[] = downloadedFiles
        .map(p => ({ type: 'change' as const, path: p as WorkspacePath }));
      console.log(`[project-context:${this.projectId}] Feeding ${syntheticEvents.length} initial files to workflow engine`);
      this.workflowManager.onFileChanges(syntheticEvents);
    }

    // Load ignore config
    await this.loadIgnoreConfig();

    // S3 sync scheduler
    if (this.config.projectsBucket) {
      this.s3SyncScheduler = new S3SyncScheduler({
        s3Client: new S3Client({}),
        bucket: this.config.projectsBucket,
        s3Prefix: `projects/${this.projectId}/files/`,
        localPath: this.projectPath,
        excludePatterns: ['node_modules/', '.git/', '.antimatter-cache/', 'dist/', 'dist-lambda/'],
      }, this.eventLogger);
      this.s3SyncScheduler.start(30_000);
    }

    // File change notifier — also watches `.antimatter/contexts.dsl` and
    // re-parses it via ContextStore so the UI sees a fresh tree without
    // requiring a worker restart.
    this.fileChangeNotifier.start(
      this.env.fileSystem,
      (msg: object) => this.broadcastToClients(msg),
      () => this.s3SyncScheduler?.sync(),
      (events, source) => {
        if (events.some(e => ContextStore.isContextsFile(e.path))) {
          this.contextStore.reload().catch((err: unknown) => {
            console.error(`[project-context:${this.projectId}] contexts.dsl reload failed:`, err);
          });
        }
        if (events.some(e => ProjectContextModelStore.isContextModelFile(e.path))) {
          this.projectContextModelStore.reload().catch((err: unknown) => {
            console.error(`[project-context:${this.projectId}] project context model reload failed:`, err);
          });
        }
        this.workflowManager.onFileChanges(events, source as any);
      },
    );

    this.initialized = true;
    console.log(`[project-context] Project ${this.projectId} initialized`);
    this.activityLog?.emit({
      source: 'worker', kind: Kinds.WorkerInitEnd, level: 'info',
      message: `Worker ready: ${this.projectId}`,
      projectId: this.projectId, correlationId: this.projectId,
      data: { durationMs: Date.now() - initStart },
    });
    await this.eventLogger.emit('workspace.ready', 'workspace', 'info',
      `Project context ready: ${this.projectId}`, { projectId: this.projectId });
  }

  // ---- S3 Initial Sync ----

  private async initialSyncFromS3(): Promise<string[]> {
    const bucket = this.config.projectsBucket;
    if (!bucket) {
      console.log(`[sync:${this.projectId}] No S3 bucket configured — skipping sync`);
      return [];
    }

    if (existsSync(this.projectPath)) {
      // Treat platform-internal directories as not counting toward "non-empty".
      // ActivityLog.initialize() runs before this and creates .antimatter-cache/,
      // so a freshly-initialized project would otherwise look "non-empty" and
      // we'd skip the S3 sync — leaving git-imported source unreachable until
      // a manual restart of the worker. (The same applies to a stray `.git`
      // dir from a previous incomplete init.)
      const PLATFORM_DIRS = new Set(['.antimatter-cache', '.git']);
      const userEntries = readdirSync(this.projectPath).filter((e) => !PLATFORM_DIRS.has(e));
      if (userEntries.length > 0) {
        console.log(`[sync:${this.projectId}] Project directory has ${userEntries.length} user entries — skipping S3 sync`);
        return [];
      }
    }

    console.log(`[sync:${this.projectId}] Empty project directory — syncing from S3...`);
    const s3 = this.config.s3Client;
    const prefix = `projects/${this.projectId}/files/`;
    const downloadedFiles: string[] = [];

    try {
      let continuationToken: string | undefined;
      do {
        const result = await s3.send(new ListObjectsV2Command({
          Bucket: bucket,
          Prefix: prefix,
          ContinuationToken: continuationToken,
        }));

        for (const obj of result.Contents ?? []) {
          if (!obj.Key || obj.Key.endsWith('/')) continue;
          const relativePath = obj.Key.slice(prefix.length);
          const localPath = join(this.projectPath, relativePath);
          await mkdir(dirname(localPath), { recursive: true });

          const getResult = await s3.send(new GetObjectCommand({
            Bucket: bucket, Key: obj.Key,
          }));
          if (getResult.Body) {
            const stream = getResult.Body as Readable;
            const ws = createWriteStream(localPath);
            await pipeline(stream, ws);
            downloadedFiles.push(relativePath);
          }
        }
        continuationToken = result.NextContinuationToken;
      } while (continuationToken);

      console.log(`[sync:${this.projectId}] Downloaded ${downloadedFiles.length} files from S3`);
      this.eventLogger.info('workspace', `S3 sync complete: ${downloadedFiles.length} files downloaded`,
        { downloaded: downloadedFiles.length });
    } catch (err) {
      console.error(`[sync:${this.projectId}] S3 sync failed:`, err);
      this.eventLogger.error('workspace', 'S3 initial sync failed', {
        error: err instanceof Error ? err.message : String(err),
      });
    }

    return downloadedFiles;
  }

  // ---- Git Auto-Init ----

  private async initializeGit(): Promise<void> {
    console.log(`[project-context:${this.projectId}] Initializing git repository...`);
    try {
      const githubPat = (await getSSMSecret(this.config.ssmClient, 'github-pat'))
        || process.env.GITHUB_PAT || '';

      // Read project metadata from S3 for git config
      let gitConfig: { repository?: string; defaultBranch?: string; userName?: string; userEmail?: string } = {};
      if (this.config.projectsBucket) {
        try {
          const metaRes = await this.config.s3Client.send(
            new GetObjectCommand({
              Bucket: this.config.projectsBucket,
              Key: `projects/${this.projectId}/meta.json`,
            }),
          );
          const body = await metaRes.Body?.transformToString('utf-8');
          if (body) {
            const meta = JSON.parse(body);
            gitConfig = meta.git ?? {};
          }
        } catch {
          // No project meta — use defaults
        }
      }

      await this.env.execute({ command: 'git init', cwd: '.', timeout: 5000 });

      // Ensure .gitignore includes sync metadata
      const gitignorePath = join(this.projectPath, '.gitignore');
      let gitignoreContent = '';
      try { gitignoreContent = await readFile(gitignorePath, 'utf-8'); } catch { /* no .gitignore */ }
      const ignoreEntries = ['.antimatter-sync.json', '.antimatter-cache/'];
      const missing = ignoreEntries.filter(e => !gitignoreContent.split('\n').some(l => l.trim() === e));
      if (missing.length > 0) {
        const suffix = (gitignoreContent && !gitignoreContent.endsWith('\n')) ? '\n' : '';
        await writeFile(gitignorePath, gitignoreContent + suffix + missing.join('\n') + '\n');
      }

      const branch = gitConfig.defaultBranch || 'main';
      await this.env.execute({ command: `git checkout -B ${branch}`, cwd: '.', timeout: 5000 });

      if (gitConfig.userName) {
        await this.env.execute({ command: `git config user.name "${gitConfig.userName}"`, cwd: '.', timeout: 5000 });
      }
      if (gitConfig.userEmail) {
        await this.env.execute({ command: `git config user.email "${gitConfig.userEmail}"`, cwd: '.', timeout: 5000 });
      }

      if (gitConfig.repository) {
        let remoteUrl = gitConfig.repository;
        if (githubPat && remoteUrl.startsWith('https://')) {
          remoteUrl = remoteUrl.replace('https://', `https://x-access-token:${githubPat}@`);
        }
        await this.env.execute({ command: 'git remote remove origin', cwd: '.', timeout: 5000 }).catch(() => {});
        await this.env.execute({ command: `git remote add origin ${remoteUrl}`, cwd: '.', timeout: 5000 });

        const fetchResult = await this.env.execute({ command: 'git fetch origin', cwd: '.', timeout: 30000 });
        if (fetchResult.exitCode === 0) {
          await this.env.execute({
            command: `git branch --set-upstream-to=origin/${branch} ${branch}`,
            cwd: '.', timeout: 5000,
          }).catch(() => {});
        }
      }

      const logResult = await this.env.execute({ command: 'git log --oneline -1', cwd: '.', timeout: 5000 });
      if (logResult.exitCode !== 0) {
        await this.env.execute({ command: 'git add -A', cwd: '.', timeout: 30000 });
        await this.env.execute({ command: 'git commit -m "Initial import" --allow-empty', cwd: '.', timeout: 10000 });
      }

      console.log(`[project-context:${this.projectId}] Git repository initialized`);
    } catch (err) {
      console.warn(`[project-context:${this.projectId}] Git initialization failed (non-fatal):`, err);
    }
  }

  // ---- Ignore config ----

  private async loadIgnoreConfig(): Promise<void> {
    try {
      const configPath = join(this.projectPath, '.antimatter', 'config.json');
      const raw = await readFile(configPath, 'utf-8');
      const config = JSON.parse(raw);
      if (Array.isArray(config.watcherIgnore)) {
        // Structural entries (.antimatter-cache/, .git/, .vite-temp/) are
        // always enforced — they protect against feedback loops and can't
        // be disabled via config, only extended.
        const merged = Array.from(new Set([...STRUCTURAL_WATCHER_IGNORE, ...config.watcherIgnore]));
        this.fileChangeNotifier.setWatcherIgnore(merged);
        console.log(`[config:${this.projectId}] watcherIgnore loaded: ${merged.join(', ')}`);
      }
      if (Array.isArray(config.explorerIgnore)) {
        this.fileChangeNotifier.setExplorerIgnore(config.explorerIgnore);
        console.log(`[config:${this.projectId}] explorerIgnore loaded: ${config.explorerIgnore.join(', ')}`);
      }
    } catch {
      // No config file or invalid JSON — use defaults
    }
  }

  // ---- Express Router ----

  private createRouter(): express.Router {
    const router = express.Router();

    // Per-project health check
    router.get('/health', (_req, res) => {
      res.json({
        status: 'healthy',
        projectId: this.projectId,
        uptime: process.uptime(),
      });
    });

    // Per-project status
    router.get('/status', (_req, res) => {
      res.json({
        projectId: this.projectId,
        connections: this.connections.size,
        connectionsReceived: this._connectionsReceived,
        connectionsCleaned: this._connectionsCleaned,
        lastConnectTime: this._lastConnectTime,
        lastCleanupTime: this._lastCleanupTime,
        lastCleanupReason: this._lastCleanupReason,
        uptime: process.uptime(),
        ptyRunning: this.ptyManager.hasRunningPty,
      });
    });

    // Refresh — download latest workspace server from S3 and restart via systemd
    router.post('/api/refresh', async (_req, res) => {
      try {
        const bucket = this.config.projectsBucket;
        if (!bucket) {
          return res.status(500).json({ error: 'PROJECTS_BUCKET not configured' });
        }

        console.log('[workspace-server] Refresh requested — downloading latest bundle from S3...');
        const result = await this.env.execute({
          command: `aws s3 cp "s3://${bucket}/workspace-server/workspace-server.js" /opt/antimatter/workspace-server.js`,
          cwd: '.', timeout: 30000,
        });

        if (result.exitCode !== 0) {
          return res.status(500).json({ error: 'Failed to download update', details: result.stderr });
        }

        await this.env.execute({
          command: `aws s3 cp "s3://${bucket}/workspace-server/package.json" /opt/antimatter/package.json && cd /opt/antimatter && npm install --production`,
          cwd: '.', timeout: 60000,
        }).catch(err => console.warn('[workspace-server] package.json update skipped:', err));

        res.json({ success: true, message: 'Update downloaded. Restarting...' });
        setTimeout(() => process.exit(0), 500);
      } catch (err) {
        console.error('[workspace-server] Refresh error:', err);
        res.status(500).json({ error: 'Refresh failed', message: String(err) });
      }
    });

    // Mount project-scoped API routes
    router.use('/api/files', createFileRouter(this.workspace, {
      getExplorerIgnore: () => this.fileChangeNotifier.getExplorerIgnore(),
      onFileChange: (changes) => {
        // Emit file:change/file:delete events directly to the workflow manager
        // so REST API writes reliably trigger workflow rules (supplements fs watcher).
        // The workflow manager deduplicates via its debounced event processing.
        const events = changes.map(c => ({
          type: c.type === 'delete' ? 'delete' as const : 'change' as const,
          path: c.path.startsWith('/') ? c.path : `/${c.path}`,
        }));
        this.fileChangeNotifier.emitSynthetic(events);
      },
    }));
    router.use('/api/build', createBuildRouter(this.workspace, {}));
    router.use('/api/agent', createAgentRouter(this.workspace, {
      broadcast: (msg: object) => this.broadcastToClients(msg),
    }));
    router.use('/api/deploy', (req, res, next) => {
      createDeployRouter(
        this.workspace,
        this.config.s3Client,
        {
          bucket: this.config.projectsBucket,
          prefix: `projects/${this.projectId}/files/`,
          lambdaClient: this.config.getDeployLambdaClient(),
          cloudfrontClient: this.config.getDeployCloudfrontClient(),
        },
      )(req, res, next);
    });
    router.use('/api/environments', createEnvironmentRouter(this.workspace));
    router.use('/api/activity', createActivityRouter(this.workspace));
    router.use('/api/git', createGitRouter(this.workspace));
    router.use('/api/events', createEventsRouter(this.config.s3Client, this.config.projectsBucket, this.projectId));
    router.use('/api/workflow', (...args) => {
      // Lazy: workflowManager may not exist until initialize() completes
      if (this.workflowManager) {
        createWorkflowRouter(this.workflowManager, this.errorStore)(...args);
      } else {
        args[1].status(503).json({ error: 'Project not yet initialized' });
      }
    });

    // Application event ingress: POST /environments/{env}/events
    // Apps emit domain events to this endpoint. The environment in the path
    // is attached to the event so rules can route/filter by it.
    router.post('/environments/:environment/events', (req, res) => {
      const { environment } = req.params;
      const body = req.body as { type?: string; [key: string]: unknown };
      if (!body?.type) {
        return res.status(400).json({ error: 'event type is required' });
      }
      if (!this.workflowManager) {
        return res.status(503).json({ error: 'Project not yet initialized' });
      }
      const event = { ...body, environment };
      this.workflowManager.emitEvent(event).catch((err: unknown) => {
        console.error(`[ingress-event] Error processing event ${body.type}:`, err);
      });
      res.json({ queued: true, type: body.type, environment });
    });
    router.use('/api/test-results', createTestResultsRouter(this.testResultsStorage));
    router.use('/api/contexts', (req, res, next) => {
      // Lazy: contextStore exists only after initialize() completes.
      if (this.contextStore) {
        createContextsRouter(
          this.contextStore,
          () => this.contextLifecycleStore?.getSnapshot() ?? null,
        )(req, res, next);
      } else {
        res.status(503).json({ error: 'Project not yet initialized' });
      }
    });

    // Automation API — unified command endpoint for external agents
    const executeServerCommand = createServerCommandExecutor({
      workspace: this.workspace,
      workflowManager: () => this.workflowManager,
      errorStore: () => this.errorStore,
      testResultsStorage: () => this.testResultsStorage,
      ptySessionPool: () => this.ptyManager,
      deployedResourceStore: () => this.deployedResourceStore,
      activityLog: () => this.activityLog,
      projectContextModelStore: () => this.projectContextModelStore,
      explorerIgnore: () => this.fileChangeNotifier.getExplorerIgnore(),
    });
    router.use('/api/automation', createAutomationRouter({
      executeServerCommand,
      relayBrowserCommand: (requestId, command, params) =>
        this.relayBrowserCommand(requestId, command, params),
      executeHeadlessTests: async (params, authToken) => {
        const { runHeadlessTests } = await import('./automation/headless-test-runner.js');
        // Canonical IDE URL — the SPA is served here and `/api/projects` is
        // the Lambda endpoint the runner uses for its disposable project.
        const baseUrl = 'https://ide.antimatter.solutions';
        const apiBaseUrl = `${baseUrl}/api`;
        return runHeadlessTests(
          { baseUrl, apiBaseUrl, authToken },
          {
            testIds: params.testIds as string[] | undefined,
            area: params.area as string | undefined,
            failedOnly: params.failedOnly as boolean | undefined,
          },
        );
      },
    }));

    // Web app preview — serves project files for browser preview.
    // Resolves directory dynamically: dist/ > src/ > project root.
    const projectPath = this.projectPath;
    const resolvePreviewDir = () => {
      for (const candidate of ['dist', 'src']) {
        const p = join(projectPath, candidate);
        if (existsSync(p) && existsSync(join(p, 'index.html'))) return p;
      }
      return projectPath;
    };
    router.use('/preview', (req, res, next) => {
      express.static(resolvePreviewDir(), { dotfiles: 'deny' })(req, res, next);
    });
    // SPA fallback — serve index.html for paths that don't match a file
    router.get('/preview/*', (_req, res) => {
      const dir = resolvePreviewDir();
      const indexPath = join(dir, 'index.html');
      if (existsSync(indexPath)) {
        res.sendFile(indexPath);
      } else {
        res.status(404).send('No index.html found in preview directory');
      }
    });

    return router;
  }

  // ---- WebSocket Connection Handling (IPC-compatible) ----

  /** Track active virtual connections by ID (worker mode). */
  private readonly virtualConnections = new Set<string>();

  /**
   * Handle a new client connection (worker mode — no WebSocket object).
   * Returns an array of initial messages to send to the client.
   */
  handleClientConnect(connectionId: string): object[] {
    this._connectionsReceived++;
    this._lastConnectTime = new Date().toISOString();
    this.virtualConnections.add(connectionId);
    console.log(`[project-context:${this.projectId}] Virtual client connected: ${connectionId}`);

    const messages: object[] = [];

    // Lazy-start 'main' PTY
    const mainSession = this.ptyManager.getOrCreate('main', this.projectPath, 'Terminal');

    // Session list
    messages.push({ type: 'terminal.list', sessions: this.ptyManager.list() });

    // Replay buffers
    const replay = mainSession.getReplayBuffer();
    if (replay) messages.push({ type: 'replay', sessionId: 'main', data: replay });
    const buildSession = this.ptyManager.get('build');
    if (buildSession) {
      const buildReplay = buildSession.getReplayBuffer();
      if (buildReplay) messages.push({ type: 'replay', sessionId: 'build', data: buildReplay });
    }

    // Status + application state
    messages.push({ type: 'status', state: 'ready' });
    if (this.workflowManager) {
      messages.push({
        type: 'application-state',
        full: true,
        state: {
          ...this.workflowManager.getApplicationState(),
          contexts: this.contextStore?.getSnapshot(),
          contextLifecycle: this.contextLifecycleStore?.getSnapshot(),
          projectContextModel: this.projectContextModelStore?.getSnapshot(),
        },
      });
    }

    // Subscribe PTY output → broadcast (single subscription, not per-client)
    // In worker mode, PTY output goes to parent via ws-broadcast IPC and parent fans out.
    // This is already handled by the existing PTY → broadcastToClients path in workflow-manager.
    // For terminal output specifically, we need per-session broadcast:
    for (const session of this.ptyManager.list()) {
      const mgr = this.ptyManager.get(session.id);
      if (mgr && !mgr.hasBroadcastSubscriber) {
        const sid = session.id;
        mgr.onData((data) => {
          this.broadcastToClients({ type: 'output', sessionId: sid, data });
        });
        mgr.hasBroadcastSubscriber = true;
      }
    }

    return messages;
  }

  /**
   * Handle an incoming message from a client (worker mode — by connectionId).
   * Dispatches the same message types as the WebSocket on('message') handler.
   */
  handleClientMessage(connectionId: string, rawData: string): void {
    try {
      const msg = JSON.parse(rawData);
      this.dispatchClientMessage(msg, connectionId);
    } catch {
      // Ignore malformed messages
    }
  }

  /**
   * Handle client disconnect (worker mode — by connectionId).
   */
  handleClientDisconnect(connectionId: string): void {
    this._connectionsCleaned++;
    this._lastCleanupTime = new Date().toISOString();
    this._lastCleanupReason = 'virtual-disconnect';
    this.virtualConnections.delete(connectionId);
    console.log(`[project-context:${this.projectId}] Virtual client disconnected: ${connectionId}`);
  }

  /**
   * Dispatch a parsed client message. Used by both handleConnection (monolith)
   * and handleClientMessage (worker mode).
   */
  private dispatchClientMessage(msg: any, connectionId?: string): void {
    switch (msg.type) {
      case 'input': {
        const sid = msg.sessionId || 'main';
        const session = this.ptyManager.get(sid);
        if (session) session.write(msg.data);
        break;
      }
      case 'resize': {
        const sid = msg.sessionId || 'main';
        if (typeof msg.cols === 'number' && typeof msg.rows === 'number') {
          const session = this.ptyManager.get(sid);
          if (session) session.resize(msg.cols, msg.rows);
        }
        break;
      }
      case 'terminal.create': {
        const newId = msg.sessionId || `term-${Date.now().toString(36)}`;
        const name = msg.name || `Terminal ${this.ptyManager.list().length + 1}`;
        this.ptyManager.getOrCreate(newId, this.projectPath, name);
        this.broadcastToClients({ type: 'terminal.created', sessionId: newId, name });
        this.broadcastToClients({ type: 'terminal.list', sessions: this.ptyManager.list() });
        // Subscribe broadcast for the new session
        const newMgr = this.ptyManager.get(newId);
        if (newMgr && !newMgr.hasBroadcastSubscriber) {
          const sid = newId;
          newMgr.onData((data) => {
            this.broadcastToClients({ type: 'output', sessionId: sid, data });
          });
          newMgr.hasBroadcastSubscriber = true;
        }
        break;
      }
      case 'terminal.close': {
        if (msg.sessionId && msg.sessionId !== 'main') {
          this.ptyManager.close(msg.sessionId);
          this.broadcastToClients({ type: 'terminal.closed', sessionId: msg.sessionId });
          this.broadcastToClients({ type: 'terminal.list', sessions: this.ptyManager.list() });
        }
        break;
      }
      case 'ping':
        // In worker mode, respond via targeted send
        if (connectionId && this.config.sendToClientFn) {
          this.sendToClient(connectionId, { type: 'pong' });
        }
        break;
      case 'workflow-emit':
        this.workflowManager?.emitEvent(msg.event).catch((err: unknown) => {
          console.error(`[project-context:${this.projectId}] Workflow emit failed:`, err);
        });
        break;
      case 'workflow-hold':
        this.workflowManager?.hold();
        break;
      case 'workflow-release':
        this.workflowManager?.release();
        break;
      case 'workflow-reload':
        this.workflowManager?.start().catch((err: unknown) => {
          console.error(`[project-context:${this.projectId}] Workflow reload failed:`, err);
        });
        break;
      case 'agents.chats.send':
        if (msg.message) {
          processChatMessage(msg.message, this.workspace, (m: object) => this.broadcastToClients(m));
        }
        break;
      case 'automation-response':
        this.handleAutomationResponse(msg);
        break;
    }
  }

  // ---- WebSocket Connection Handling (monolith mode — direct WebSocket) ----

  handleConnection(ws: WebSocket): void {
    this._connectionsReceived++;
    this._lastConnectTime = new Date().toISOString();
    console.log(`[project-context:${this.projectId}] WebSocket client connected (total received: ${this._connectionsReceived}, current: ${this.connections.size + 1})`);
    this.connections.add(ws);

    // Lazy-start default 'main' PTY on first WebSocket connection.
    const mainSession = this.ptyManager.getOrCreate('main', this.projectPath, 'Terminal');

    // Send session list
    ws.send(JSON.stringify({ type: 'terminal.list', sessions: this.ptyManager.list() }));

    // Send replay buffer for main session
    const replay = mainSession.getReplayBuffer();
    if (replay) {
      ws.send(JSON.stringify({ type: 'replay', sessionId: 'main', data: replay }));
    }

    // Also send replay for build session if it exists
    const buildSession = this.ptyManager.get('build');
    if (buildSession) {
      const buildReplay = buildSession.getReplayBuffer();
      if (buildReplay) {
        ws.send(JSON.stringify({ type: 'replay', sessionId: 'build', data: buildReplay }));
      }
    }

    // Send status
    ws.send(JSON.stringify({ type: 'status', state: 'ready' }));

    // Send full application state snapshot
    if (this.workflowManager) {
      ws.send(JSON.stringify({
        type: 'application-state',
        full: true,
        state: {
          ...this.workflowManager.getApplicationState(),
          contexts: this.contextStore?.getSnapshot(),
          contextLifecycle: this.contextLifecycleStore?.getSnapshot(),
          projectContextModel: this.projectContextModelStore?.getSnapshot(),
        },
      }));
    }

    // Server-side proactive heartbeat (20s) — keeps connection alive through CloudFront/ALB
    const heartbeatTimer = setInterval(() => {
      if (ws.readyState === 1) ws.send(JSON.stringify({ type: 'heartbeat' }));
    }, 20_000);

    // Forward PTY output from ALL sessions to client (tagged with sessionId)
    const unsubscribers: (() => void)[] = [];
    for (const session of this.ptyManager.list()) {
      const mgr = this.ptyManager.get(session.id);
      if (mgr) {
        const sid = session.id;
        unsubscribers.push(mgr.onData((data) => {
          if (ws.readyState === 1) ws.send(JSON.stringify({ type: 'output', sessionId: sid, data }));
        }));
      }
    }

    // Handle messages
    ws.on('message', (raw) => {
      try {
        const msg = JSON.parse(raw.toString());
        switch (msg.type) {
          case 'input': {
            const sid = msg.sessionId || 'main';
            const session = this.ptyManager.get(sid);
            if (session) session.write(msg.data);
            break;
          }
          case 'resize': {
            const sid = msg.sessionId || 'main';
            if (typeof msg.cols === 'number' && typeof msg.rows === 'number') {
              const session = this.ptyManager.get(sid);
              if (session) session.resize(msg.cols, msg.rows);
            }
            break;
          }
          case 'terminal.create': {
            const newId = msg.sessionId || `term-${Date.now().toString(36)}`;
            const name = msg.name || `Terminal ${this.ptyManager.list().length + 1}`;
            const newSession = this.ptyManager.getOrCreate(newId, this.projectPath, name);
            // Subscribe output for the new session to all clients
            const sid = newId;
            for (const client of this.connections) {
              // Only need to send to new subscriber but broadcast is simpler
            }
            this.broadcastToClients({ type: 'terminal.created', sessionId: newId, name });
            this.broadcastToClients({ type: 'terminal.list', sessions: this.ptyManager.list() });
            // Subscribe this client to the new session's output
            unsubscribers.push(newSession.onData((data) => {
              if (ws.readyState === 1) ws.send(JSON.stringify({ type: 'output', sessionId: sid, data }));
            }));
            break;
          }
          case 'terminal.close': {
            if (msg.sessionId && msg.sessionId !== 'main') {
              this.ptyManager.close(msg.sessionId);
              this.broadcastToClients({ type: 'terminal.closed', sessionId: msg.sessionId });
              this.broadcastToClients({ type: 'terminal.list', sessions: this.ptyManager.list() });
            }
            break;
          }
          case 'ping':
            ws.send(JSON.stringify({ type: 'pong' }));
            break;
          case 'workflow-emit':
            this.workflowManager?.emitEvent(msg.event).catch((err: unknown) => {
              console.error(`[project-context:${this.projectId}] Workflow emit failed:`, err);
            });
            break;
          case 'workflow-hold':
            this.workflowManager?.hold();
            break;
          case 'workflow-release':
            this.workflowManager?.release();
            break;
          case 'workflow-reload':
            this.workflowManager?.start().catch((err: unknown) => {
              console.error(`[project-context:${this.projectId}] Workflow reload failed:`, err);
            });
            break;
          case 'agents.chats.send':
            // Chat message via WebSocket — same pipeline as REST POST /agent/chat
            console.log(`[project-context:${this.projectId}] Chat send via WebSocket: "${String(msg.message).slice(0, 50)}"`);
            if (msg.message) {
              processChatMessage(msg.message, this.workspace, (m: object) => this.broadcastToClients(m));
            }
            break;
          case 'automation-response':
            this.handleAutomationResponse(msg);
            break;
        }
      } catch {
        // Ignore malformed messages
      }
    });

    const cleanup = (reason: string) => {
      this._connectionsCleaned++;
      this._lastCleanupTime = new Date().toISOString();
      this._lastCleanupReason = reason;
      console.log(`[project-context:${this.projectId}] WebSocket client disconnected (reason: ${reason}, cleaned: ${this._connectionsCleaned}, remaining: ${this.connections.size - 1})`);
      clearInterval(heartbeatTimer);
      for (const unsub of unsubscribers) unsub();
      this.connections.delete(ws);
    };

    ws.on('close', (code, reason) => {
      cleanup(`close(code=${code}, reason=${reason?.toString() || 'none'})`);
    });
    ws.on('error', (err) => {
      console.error(`[project-context:${this.projectId}] WebSocket error:`, err);
      cleanup(`error(${err.message})`);
    });
  }

  // ---- Browser Command Relay ----

  /**
   * Relay a command to the first connected browser tab via WebSocket.
   * Returns a Promise that resolves when the browser sends back an
   * `automation-response` with the matching requestId.
   */
  relayBrowserCommand(
    requestId: string,
    command: string,
    params: Record<string, unknown>,
  ): Promise<unknown> {
    // Find a connected browser tab
    console.log(`[project-context:${this.projectId}] relayBrowserCommand: command=${command}, connections.size=${this.connections.size}, received=${this._connectionsReceived}, cleaned=${this._connectionsCleaned}`);
    let targetWs: WebSocket | null = null;
    for (const ws of this.connections) {
      console.log(`[project-context:${this.projectId}] relayBrowserCommand: checking ws readyState=${ws.readyState} (OPEN=${WebSocket.OPEN})`);
      if (ws.readyState === WebSocket.OPEN) {
        targetWs = ws;
        break;
      }
    }

    if (!targetWs) {
      const err = new Error('No browser tab connected to relay command');
      (err as any).code = 'no-browser' as AutomationErrorCode;
      return Promise.reject(err);
    }

    return new Promise<unknown>((resolve, reject) => {
      const timeout = COMMAND_TIMEOUTS[command] ?? DEFAULT_COMMAND_TIMEOUT;

      const timer = setTimeout(() => {
        this.pendingBrowserCommands.delete(requestId);
        const err = new Error(`Browser command '${command}' timed out after ${timeout}ms`);
        (err as any).code = 'timeout' as AutomationErrorCode;
        reject(err);
      }, timeout);

      this.pendingBrowserCommands.set(requestId, { resolve, reject, timer });

      // Send automation-request to the browser
      targetWs!.send(JSON.stringify({
        type: 'automation-request',
        requestId,
        command,
        params,
      }));
    });
  }

  /**
   * Handle an `automation-response` message from the browser.
   * Resolves or rejects the corresponding pending Promise.
   */
  private handleAutomationResponse(msg: {
    requestId: string;
    ok: boolean;
    data?: unknown;
    error?: { code: AutomationErrorCode; message: string };
  }): void {
    const pending = this.pendingBrowserCommands.get(msg.requestId);
    if (!pending) return; // Unknown or timed-out request

    clearTimeout(pending.timer);
    this.pendingBrowserCommands.delete(msg.requestId);

    if (msg.ok) {
      pending.resolve(msg.data);
    } else {
      const err = new Error(msg.error?.message ?? 'Browser command failed');
      (err as any).code = msg.error?.code ?? 'execution-error';
      pending.reject(err);
    }
  }

  // ---- Broadcast ----

  broadcastToClients(msg: object): void {
    // Worker mode: delegate to IPC broadcast function
    if (this.config.broadcastFn) {
      this.config.broadcastFn(msg);
      return;
    }
    // Monolith mode: iterate WebSocket objects directly
    const data = JSON.stringify(msg);
    for (const client of this.connections) {
      if (client.readyState === WebSocket.OPEN) {
        client.send(data);
      }
    }
  }

  /** Send a message to a specific client by connectionId (worker mode). */
  sendToClient(connectionId: string, msg: object): void {
    if (this.config.sendToClientFn) {
      this.config.sendToClientFn(connectionId, msg);
    }
  }

  // ---- Shutdown ----

  async shutdown(): Promise<void> {
    console.log(`[project-context:${this.projectId}] Shutting down...`);
    this.activityLog?.emit({
      source: 'worker', kind: Kinds.WorkerShutdown, level: 'info',
      message: `Worker shutting down: ${this.projectId}`,
      projectId: this.projectId, correlationId: this.projectId,
    });
    this.fileChangeNotifier.stop();
    this.ptyManager.closeAll();
    if (this.contextLifecycleStore) await this.contextLifecycleStore.shutdown();
    if (this.eventLog) await this.eventLog.shutdown();
    if (this.s3SyncScheduler) await this.s3SyncScheduler.shutdown();
    if (this.activityLog) await this.activityLog.shutdown();
    await this.eventLogger.shutdown();
    // Reject all pending browser automation commands
    for (const [requestId, pending] of this.pendingBrowserCommands) {
      clearTimeout(pending.timer);
      pending.reject(new Error('Server shutting down'));
    }
    this.pendingBrowserCommands.clear();
    // Close all WebSocket connections
    for (const ws of this.connections) {
      try { ws.close(1001, 'Server shutting down'); } catch { /* ignore */ }
    }
    this.connections.clear();
    console.log(`[project-context:${this.projectId}] Shutdown complete`);
  }
}
