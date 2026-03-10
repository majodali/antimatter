/**
 * Expanded ActionContext interface for functional tests.
 *
 * Extends the original ActionContext (file, build, deploy, environment, agent ops)
 * with editor, git, workflow, and terminal operations.
 *
 * Implementations:
 * - FetchActionContext  — HTTP calls to REST API (Lambda/deployed tests)
 * - ServiceActionContext — Direct service calls in-process (Vitest CLI)
 * - BrowserActionContext — Zustand store actions in the browser (IDE test runner)
 */

// ---- Re-export the base interface for convenience ----

export type {
  ActionContext as BaseActionContext,
} from '../../server/tests/action-context.js';

// ---- Git status shape ----

export interface GitStatusResult {
  readonly initialized: boolean;
  readonly branch?: string;
  readonly staged: readonly { path: string; status: string }[];
  readonly unstaged: readonly { path: string; status: string }[];
  readonly untracked: readonly string[];
}

// ---- Expanded interface ----

/**
 * Full ActionContext used by functional test modules.
 *
 * Includes all original ActionContext methods (file, build, deploy, environment, agent)
 * plus editor, git, workflow, and terminal operations.
 */
export interface ActionContext {
  // ---- File operations (from original ActionContext) ----
  writeFile(path: string, content: string): Promise<void>;
  readFile(path: string): Promise<string>;
  deleteFile(path: string): Promise<void>;
  mkdir(path: string): Promise<void>;
  getFileTree(path?: string): Promise<any[]>;

  // ---- Build operations (from original ActionContext) ----
  saveBuildConfig(config: { rules: any[]; targets: any[] }): Promise<void>;
  loadBuildConfig(): Promise<{ rules: any[]; targets: any[] }>;
  executeBuild(): Promise<any[]>;
  getBuildResults(): Promise<any[]>;
  clearBuildResults(): Promise<void>;
  clearBuildCache(targetId?: string): Promise<void>;
  getStaleTargets(): Promise<string[]>;

  // ---- Deploy operations (from original ActionContext) ----
  saveDeployConfig(config: { modules: any[]; packaging: any[]; targets: any[] }): Promise<void>;
  loadDeployConfig(): Promise<{ modules: any[]; packaging: any[]; targets: any[] }>;
  executeDeploy(options?: { targetIds?: string[]; dryRun?: boolean }): Promise<any[]>;
  getDeployResults(): Promise<any[]>;
  clearDeployResults(): Promise<void>;

  // ---- Environment operations (from original ActionContext) ----
  saveEnvironmentConfig(config: { pipeline: any; environments: any[]; transitions: any[] }): Promise<void>;
  loadEnvironmentConfig(): Promise<{ pipeline: any; environments: any[]; transitions: any[] }>;
  createEnvironment(name: string, stageId?: string): Promise<any>;
  listEnvironments(): Promise<any[]>;
  getEnvironment(envId: string): Promise<any>;
  destroyEnvironment(envId: string): Promise<void>;

  // ---- Agent operations (from original ActionContext) ----
  sendChat(message: string): Promise<{ response: string }>;
  getHistory(): Promise<any[]>;
  clearHistory(): Promise<void>;
  getCustomTools(): Promise<any[]>;
  saveCustomTools(tools: any[]): Promise<void>;

  // ---- Editor operations (NEW) ----

  /** Open a file in the editor (creates tab, makes active). */
  openFileInEditor(path: string): Promise<void>;
  /** Get the path of the currently active editor tab (null if none). */
  getActiveFile(): Promise<string | null>;
  /** Get list of open editor tab paths. */
  getOpenTabs(): Promise<string[]>;
  /** Close a specific editor tab. */
  closeTab(path: string): Promise<void>;
  /** Update file content in the editor (triggers dirty state). */
  editFileContent(path: string, content: string): Promise<void>;
  /** Save the currently active file. */
  saveActiveFile(): Promise<void>;

  // ---- Git operations (NEW) ----

  /** Get current git status. */
  getGitStatus(): Promise<GitStatusResult>;
  /** Stage files for commit. */
  stageFiles(files: string[]): Promise<void>;
  /** Unstage files. */
  unstageFiles(files: string[]): Promise<void>;
  /** Create a commit with the given message. */
  gitCommit(message: string): Promise<void>;
  /** Push to remote. */
  gitPush(): Promise<void>;
  /** Pull from remote. */
  gitPull(): Promise<void>;

  // ---- Workflow operations (NEW) ----

  /** Emit a workflow event. */
  emitWorkflowEvent(event: { type: string; [key: string]: unknown }): Promise<any>;
  /** Run a specific workflow rule by ID. */
  runWorkflowRule(ruleId: string): Promise<any>;
  /** Get current workflow state. */
  getWorkflowState(): Promise<unknown>;
  /** Get workflow declarations (rules, widgets, etc.). */
  getWorkflowDeclarations(): Promise<any>;
  /** Get all project errors. */
  getProjectErrors(): Promise<any[]>;
}
