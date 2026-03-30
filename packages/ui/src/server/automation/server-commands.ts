/**
 * Server-side automation command executor.
 *
 * Maps automation command strings (e.g. 'file.read', 'git.status') to
 * WorkspaceService / WorkflowManager / ErrorStore calls. Each handler
 * validates params, invokes the service, and returns structured data.
 *
 * Browser-side commands (editor.*, tests.*) are NOT handled here — they
 * relay through WebSocket to the connected browser tab.
 */

import type { WorkspaceService } from '../services/workspace-service.js';
import type { WorkflowManager } from '../services/workflow-manager.js';
import type { ErrorStore } from '../services/error-store.js';
import { COMMAND_CATALOG } from '../../shared/automation-types.js';
import type { AutomationErrorCode } from '../../shared/automation-types.js';
import type { ProjectError } from '@antimatter/workflow';
import { ErrorTypes } from '@antimatter/workflow';
import { detectTestRunner, parseVitestJson, parseJestJson } from './test-output-parser.js';

// ---------------------------------------------------------------------------
// Error helper
// ---------------------------------------------------------------------------

export class AutomationCommandError extends Error {
  constructor(
    message: string,
    public readonly code: AutomationErrorCode,
  ) {
    super(message);
    this.name = 'AutomationCommandError';
  }
}

function requireParam<T>(params: Record<string, unknown>, key: string): T {
  if (!(key in params) || params[key] === undefined || params[key] === null) {
    throw new AutomationCommandError(`Missing required parameter: ${key}`, 'invalid-params');
  }
  return params[key] as T;
}

// ---------------------------------------------------------------------------
// File tree filtering (matches filesystem.ts filterTree logic)
// ---------------------------------------------------------------------------

interface FileNode {
  name: string;
  path: string;
  isDirectory: boolean;
  children?: FileNode[];
}

function filterTree(nodes: FileNode[], ignorePatterns: string[]): FileNode[] {
  return nodes
    .filter((node) => {
      const normalized = node.path.startsWith('/') ? node.path.slice(1) : node.path;
      if (node.isDirectory) {
        return !ignorePatterns.some(
          (p) => node.name + '/' === p || normalized + '/' === p || normalized.startsWith(p),
        );
      }
      return !ignorePatterns.some((p) => normalized.startsWith(p));
    })
    .map((node) => {
      if (node.children) {
        return { ...node, children: filterTree(node.children, ignorePatterns) };
      }
      return node;
    });
}

// ---------------------------------------------------------------------------
// Git helpers (mirrors packages/ui/src/server/routes/git.ts)
// ---------------------------------------------------------------------------

function parseGitStatus(output: string): {
  staged: { path: string; status: string }[];
  unstaged: { path: string; status: string }[];
  untracked: string[];
} {
  const staged: { path: string; status: string }[] = [];
  const unstaged: { path: string; status: string }[] = [];
  const untracked: string[] = [];

  for (const line of output.split('\n')) {
    if (!line) continue;
    const x = line[0]; // index status
    const y = line[1]; // worktree status
    const file = line.slice(3);

    if (x === '?' && y === '?') {
      untracked.push(file);
    } else {
      if (x !== ' ' && x !== '?') {
        staged.push({ path: file, status: statusChar(x) });
      }
      if (y !== ' ' && y !== '?') {
        unstaged.push({ path: file, status: statusChar(y) });
      }
    }
  }

  return { staged, unstaged, untracked };
}

function statusChar(c: string): string {
  switch (c) {
    case 'M': return 'modified';
    case 'A': return 'added';
    case 'D': return 'deleted';
    case 'R': return 'renamed';
    case 'C': return 'copied';
    default: return 'modified';
  }
}

// ---------------------------------------------------------------------------
// Dependencies
// ---------------------------------------------------------------------------

export interface ServerCommandDependencies {
  /** The workspace service (file ops, build, env). */
  workspace: WorkspaceService;
  /** Lazy getter — workflow manager may not be ready at router mount time. */
  workflowManager: () => WorkflowManager | undefined;
  /** Lazy getter — error store may not be ready at router mount time. */
  errorStore: () => ErrorStore | undefined;
  /** Lazy getter — test results storage. */
  testResultsStorage?: () => import('../routes/test-results.js').FileTestResultsStorage | undefined;
  /** Returns current explorer ignore patterns for file tree filtering. */
  explorerIgnore: () => string[];
}

// ---------------------------------------------------------------------------
// Command handler type
// ---------------------------------------------------------------------------

type CommandHandler = (params: Record<string, unknown>) => Promise<unknown>;

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

/**
 * Creates a server-side command executor function.
 * Returns an async function that dispatches a command string to the
 * appropriate service call and returns structured data.
 *
 * Throws `AutomationCommandError` with a typed code on failure.
 */
export function createServerCommandExecutor(
  deps: ServerCommandDependencies,
): (command: string, params: Record<string, unknown>) => Promise<unknown> {
  const { workspace, workflowManager, errorStore, testResultsStorage, explorerIgnore } = deps;

  /** Helper: run a git command via workspace environment. */
  async function runGit(args: string, timeout = 30_000): Promise<{
    stdout: string;
    stderr: string;
    exitCode: number;
  }> {
    if (!workspace.env) {
      throw new AutomationCommandError(
        'Git requires a running workspace (not available in Lambda)',
        'unsupported',
      );
    }
    const result = await workspace.env.execute({
      command: `git ${args}`,
      cwd: '.',
      timeout,
    });
    return {
      stdout: result.stdout?.trim() ?? '',
      stderr: result.stderr?.trim() ?? '',
      exitCode: result.exitCode,
    };
  }

  // ---- Command dispatch table ----

  const handlers = new Map<string, CommandHandler>();

  // ---- File operations ----

  handlers.set('file.read', async (params) => {
    const path = requireParam<string>(params, 'path');
    const content = await workspace.readFile(path);
    return { path, content };
  });

  handlers.set('file.write', async (params) => {
    const path = requireParam<string>(params, 'path');
    const content = requireParam<string>(params, 'content');
    await workspace.writeFile(path, content);
    return { path };
  });

  handlers.set('file.delete', async (params) => {
    const path = requireParam<string>(params, 'path');
    await workspace.deleteFile(path);
    return { path };
  });

  handlers.set('file.mkdir', async (params) => {
    const path = requireParam<string>(params, 'path');
    await workspace.mkdir(path);
    return { path };
  });

  handlers.set('file.tree', async (params) => {
    const path = (params.path as string) || '/';
    const tree = await workspace.getDirectoryTreeRecursive(path);
    const ignorePatterns = explorerIgnore();
    const filtered = ignorePatterns.length > 0 ? filterTree(tree, ignorePatterns) : tree;
    return { tree: filtered };
  });

  // ---- Git operations ----

  handlers.set('git.status', async () => {
    // Check initialization
    const revParse = await runGit('rev-parse --is-inside-work-tree').catch(() => null);
    if (!revParse || revParse.exitCode !== 0) {
      return { initialized: false, staged: [], unstaged: [], untracked: [] };
    }

    // Branch
    const branchResult = await runGit('rev-parse --abbrev-ref HEAD');
    const branch = branchResult.exitCode === 0 ? branchResult.stdout : undefined;

    // Porcelain status
    const statusResult = await runGit('status --porcelain=v1');
    const { staged, unstaged, untracked } = parseGitStatus(statusResult.stdout);

    return { initialized: true, branch, staged, unstaged, untracked };
  });

  handlers.set('git.stage', async (params) => {
    const files = requireParam<string[]>(params, 'files');
    if (!Array.isArray(files) || files.length === 0) {
      throw new AutomationCommandError('files must be a non-empty array', 'invalid-params');
    }
    const fileArgs = files.map((f) => `"${f}"`).join(' ');
    const result = await runGit(`add ${fileArgs}`);
    if (result.exitCode !== 0) {
      throw new AutomationCommandError(result.stderr || 'git add failed', 'execution-error');
    }
    return { files };
  });

  handlers.set('git.unstage', async (params) => {
    const files = requireParam<string[]>(params, 'files');
    if (!Array.isArray(files) || files.length === 0) {
      throw new AutomationCommandError('files must be a non-empty array', 'invalid-params');
    }
    const fileArgs = files.map((f) => `"${f}"`).join(' ');
    const result = await runGit(`reset HEAD ${fileArgs}`);
    if (result.exitCode !== 0) {
      throw new AutomationCommandError(result.stderr || 'git reset failed', 'execution-error');
    }
    return { files };
  });

  handlers.set('git.commit', async (params) => {
    const message = requireParam<string>(params, 'message');
    const escaped = message.replace(/"/g, '\\"');
    const result = await runGit(`commit -m "${escaped}"`);
    if (result.exitCode !== 0) {
      throw new AutomationCommandError(result.stderr || 'git commit failed', 'execution-error');
    }
    return { message: result.stdout };
  });

  handlers.set('git.push', async (params) => {
    const remote = params.remote as string | undefined;
    const branch = params.branch as string | undefined;
    const args = ['push'];
    if (remote) args.push(remote);
    if (branch) args.push(branch);
    const result = await runGit(args.join(' '), 60_000);
    if (result.exitCode !== 0) {
      throw new AutomationCommandError(result.stderr || 'git push failed', 'execution-error');
    }
    return { message: result.stdout || result.stderr };
  });

  handlers.set('git.pull', async (params) => {
    const remote = params.remote as string | undefined;
    const branch = params.branch as string | undefined;
    const args = ['pull'];
    if (remote) args.push(remote);
    if (branch) args.push(branch);
    const result = await runGit(args.join(' '), 60_000);
    if (result.exitCode !== 0) {
      throw new AutomationCommandError(result.stderr || 'git pull failed', 'execution-error');
    }
    return { message: result.stdout };
  });

  // ---- Build ----

  handlers.set('build.run', async (params) => {
    let rules = params.rules as any[] | undefined;

    // If no rules provided, load from stored config
    if (!rules || rules.length === 0) {
      const config = await workspace.loadBuildConfig();
      rules = config.rules;
    }

    if (!rules || rules.length === 0) {
      throw new AutomationCommandError(
        'No build rules configured. Add build rules via config or provide them in params.',
        'invalid-params',
      );
    }

    const resultMap = await workspace.executeBuild(rules);
    const results = Array.from(resultMap.values());
    return { results };
  });

  // ---- Workflow ----

  handlers.set('workflow.state', async () => {
    const wm = workflowManager();
    if (!wm) {
      throw new AutomationCommandError('Workflow manager not initialized', 'unsupported');
    }
    const state = wm.getState();
    return state ?? { version: 0, state: null, updatedAt: null };
  });

  handlers.set('workflow.errors', async () => {
    const es = errorStore();
    const errors = es ? es.getAllErrors() : [];
    return { errors };
  });

  // ---- File annotations ----

  const severityToErrorType = (severity: string) => {
    switch (severity) {
      case 'error': return ErrorTypes.SyntaxError;
      case 'warning': return ErrorTypes.Warning;
      case 'info': return ErrorTypes.Info;
      case 'hint': return ErrorTypes.Info;
      default: return ErrorTypes.SyntaxError;
    }
  };

  const errorTypeToSeverity = (et: { name: string }) => {
    switch (et.name) {
      case 'Warning': return 'warning';
      case 'Info': return 'info';
      case 'TestFailure': return 'error';
      default: return 'error';
    }
  };

  handlers.set('files.annotate', async (params) => {
    const es = errorStore();
    if (!es) throw new AutomationCommandError('Error store not ready', 'execution-error');
    const annotations = requireParam<any[]>(params, 'annotations');
    // Group annotations by source → setErrors per source
    const bySource = new Map<string, ProjectError[]>();
    for (const a of annotations) {
      const source = a.source || 'external';
      if (!bySource.has(source)) bySource.set(source, []);
      bySource.get(source)!.push({
        errorType: severityToErrorType(a.severity || 'error'),
        toolId: source,
        file: a.path || '',
        message: a.message || '',
        detail: a.detail,
        line: a.line,
        column: a.column,
        endLine: a.endLine,
        endColumn: a.endColumn,
      });
    }
    let count = 0;
    for (const [toolId, errors] of bySource) {
      await es.setErrors(toolId, errors);
      count += errors.length;
    }
    return { count };
  });

  handlers.set('files.clearAnnotations', async (params) => {
    const es = errorStore();
    if (!es) throw new AutomationCommandError('Error store not ready', 'execution-error');
    const source = params.source as string | undefined;
    const path = params.path as string | undefined;

    if (!source && !path) {
      const before = es.getAllErrors().length;
      await es.clearAll();
      return { cleared: before };
    }
    if (source && !path) {
      const before = es.getAllErrors().length;
      await es.clearTool(source);
      return { cleared: before - es.getAllErrors().length };
    }
    // path filter (with or without source): remove matching errors, keep the rest
    const allErrors = es.getAllErrors();
    const toolIds = new Set(allErrors.map(e => e.toolId));
    let cleared = 0;
    for (const toolId of toolIds) {
      if (source && toolId !== source) continue;
      const toolErrors = allErrors.filter(e => e.toolId === toolId);
      const kept = toolErrors.filter(e => e.file !== path);
      cleared += toolErrors.length - kept.length;
      await es.setErrors(toolId, kept);
    }
    return { cleared };
  });

  handlers.set('files.annotations', async (params) => {
    const es = errorStore();
    let errors = es ? es.getAllErrors() : [];
    const source = params.source as string | undefined;
    const path = params.path as string | undefined;
    const severity = params.severity as string | undefined;
    if (source) errors = errors.filter(e => e.toolId === source);
    if (path) errors = errors.filter(e => e.file === path);
    if (severity) errors = errors.filter(e => errorTypeToSeverity(e.errorType) === severity);
    const annotations = errors.map(e => ({
      id: `${e.toolId}:${e.file}:${e.line ?? 0}:${e.column ?? 0}`,
      source: e.toolId,
      path: e.file,
      line: e.line,
      column: e.column,
      endLine: e.endLine,
      endColumn: e.endColumn,
      severity: errorTypeToSeverity(e.errorType),
      message: e.message,
      detail: e.detail,
    }));
    return { annotations };
  });

  // ---- Project tests (vitest/jest) ----

  handlers.set('tests.discover-project', async () => {
    // Read package.json to detect test runner
    let packageJson: string;
    try {
      packageJson = await workspace.readFile('package.json');
    } catch {
      return { runner: null, tests: [], error: 'No package.json found' };
    }
    const runner = detectTestRunner(packageJson);
    if (!runner) {
      return { runner: null, tests: [], error: 'No vitest or jest found in dependencies' };
    }
    // Use vitest --list or jest --listTests to find test files
    const cmd = runner === 'vitest'
      ? 'npx vitest --list --reporter=json 2>/dev/null || true'
      : 'npx jest --listTests --json 2>/dev/null || true';
    const result = await workspace.env.execute({ command: cmd, timeout: 30_000 });
    let testFiles: string[] = [];
    try {
      if (runner === 'vitest') {
        // vitest --list --reporter=json outputs the full JSON with testResults
        const data = JSON.parse(result.stdout);
        testFiles = (data.testResults ?? []).map((r: any) => r.name ?? r);
      } else {
        testFiles = JSON.parse(result.stdout);
      }
    } catch {
      // Fallback: glob for test files
      try {
        const globResult = await workspace.env.execute({
          command: 'find . -name "*.test.ts" -o -name "*.spec.ts" -o -name "*.test.js" -o -name "*.spec.js" | grep -v node_modules | head -100',
          timeout: 10_000,
        });
        testFiles = globResult.stdout.split('\n').filter(Boolean).map(f => f.replace(/^\.\//, ''));
      } catch { /* ignore */ }
    }
    // Normalize to relative paths
    const projectRoot = (workspace.env as any).rootPath ?? process.cwd();
    testFiles = testFiles.map(f => {
      if (f.startsWith(projectRoot)) return f.slice(projectRoot.length).replace(/^\//, '');
      return f.replace(/^\.\//, '');
    });
    return { runner, tests: testFiles };
  });

  handlers.set('tests.run-project', async (params) => {
    const file = params.file as string | undefined;
    // Detect runner
    let packageJson: string;
    try {
      packageJson = await workspace.readFile('package.json');
    } catch {
      throw new AutomationCommandError('No package.json found', 'execution-error');
    }
    const runner = detectTestRunner(packageJson);
    if (!runner) {
      throw new AutomationCommandError('No vitest or jest found in dependencies', 'execution-error');
    }
    const projectRoot = (workspace.env as any).rootPath ?? process.cwd();
    const fileFilter = file ? ` ${file}` : '';
    const cmd = runner === 'vitest'
      ? `npx vitest run --reporter=json${fileFilter} 2>/dev/null || true`
      : `npx jest --json${fileFilter} 2>/dev/null || true`;
    const result = await workspace.env.execute({ command: cmd, timeout: 300_000 });
    const parser = runner === 'vitest' ? parseVitestJson : parseJestJson;
    const summary = parser(result.stdout, projectRoot);
    // Persist results
    const storage = testResultsStorage?.();
    if (storage) {
      await storage.saveProjectRun(summary);
    }
    return summary;
  });

  handlers.set('tests.project-results', async () => {
    const storage = testResultsStorage?.();
    if (!storage) return { runs: [] };
    const runs = await storage.loadProjectRuns();
    return { runs };
  });

  handlers.set('workflow.emit', async (params) => {
    const wm = workflowManager();
    if (!wm) {
      throw new AutomationCommandError('Workflow manager not initialized', 'unsupported');
    }
    const event = requireParam<{ type: string; [key: string]: unknown }>(params, 'event');
    if (!event.type) {
      throw new AutomationCommandError('event.type is required', 'invalid-params');
    }
    const result = await wm.emitEvent(event);
    return { result };
  });

  // ---- Meta ----

  handlers.set('commands.list', async () => {
    return { commands: COMMAND_CATALOG };
  });

  // ---- Executor function ----

  return async (command: string, params: Record<string, unknown>): Promise<unknown> => {
    const handler = handlers.get(command);
    if (!handler) {
      throw new AutomationCommandError(`Unknown server command: ${command}`, 'not-found');
    }
    return handler(params);
  };
}
