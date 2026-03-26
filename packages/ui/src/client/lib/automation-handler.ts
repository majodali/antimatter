/**
 * Browser-side automation command handler.
 *
 * Receives `automation-request` messages from the workspace server via
 * WebSocket, executes browser-only commands (editor.*, tests.*) against
 * Zustand stores and the in-browser test runner, then sends structured
 * `automation-response` messages back.
 *
 * Lifecycle: created when a project loads (App.tsx), disposed on unmount.
 */

import type {
  AutomationWsRequest,
  AutomationWsResponse,
  AutomationErrorCode,
} from '../../shared/automation-types.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type BrowserCommandHandler = (params: Record<string, unknown>) => Promise<unknown>;

// ---------------------------------------------------------------------------
// Handler class
// ---------------------------------------------------------------------------

export class AutomationHandler {
  private readonly handlers = new Map<string, BrowserCommandHandler>();
  private disposed = false;

  constructor(private readonly getWs: () => WebSocket | null) {
    this.registerHandlers();
  }

  // ---- Public API ----

  /**
   * Handle an incoming automation request from the server.
   * Dispatches to the appropriate handler and sends the response back.
   */
  async handleMessage(msg: AutomationWsRequest): Promise<void> {
    if (this.disposed) return;

    try {
      const handler = this.handlers.get(msg.command);
      if (!handler) {
        this.sendResponse({
          type: 'automation-response',
          requestId: msg.requestId,
          ok: false,
          error: {
            code: 'unsupported',
            message: `Unknown browser command: ${msg.command}`,
          },
        });
        return;
      }

      const data = await handler(msg.params ?? {});
      this.sendResponse({
        type: 'automation-response',
        requestId: msg.requestId,
        ok: true,
        data,
      });
    } catch (err) {
      const code: AutomationErrorCode = (err as any)?.code ?? 'execution-error';
      const message = err instanceof Error ? err.message : String(err);
      this.sendResponse({
        type: 'automation-response',
        requestId: msg.requestId,
        ok: false,
        error: { code, message },
      });
    }
  }

  /** Clean up handler. */
  dispose(): void {
    this.disposed = true;
    this.handlers.clear();
  }

  // ---- Private ----

  private sendResponse(msg: AutomationWsResponse): void {
    const ws = this.getWs();
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(msg));
    } else {
      console.warn('[automation-handler] Cannot send response — WebSocket not available');
    }
  }

  private registerHandlers(): void {
    // ---- Editor commands ----

    this.handlers.set('editor.open', async (params) => {
      const { useEditorStore } = await import('../stores/editorStore.js');
      const { useProjectStore } = await import('../stores/projectStore.js');
      const { fetchFileContent } = await import('./api.js');

      const path = params.path as string;
      if (!path) throw Object.assign(new Error('path is required'), { code: 'invalid-params' });

      // Fetch file content via workspace-aware routing (uses project ID for EC2 path)
      const projectId = useProjectStore.getState().currentProjectId ?? undefined;
      const content = await fetchFileContent(path, projectId);
      const language = guessLanguage(path);

      useEditorStore.getState().openFile(path as any, content, language);
      return { path };
    });

    this.handlers.set('editor.active', async () => {
      const { useEditorStore } = await import('../stores/editorStore.js');
      const activeFile = useEditorStore.getState().activeFile;
      return { path: activeFile };
    });

    this.handlers.set('editor.tabs', async () => {
      const { useEditorStore } = await import('../stores/editorStore.js');
      const openFiles = useEditorStore.getState().openFiles;
      const tabs = Array.from(openFiles.keys());
      return { tabs };
    });

    this.handlers.set('editor.close', async (params) => {
      const { useEditorStore } = await import('../stores/editorStore.js');

      const path = params.path as string;
      if (!path) throw Object.assign(new Error('path is required'), { code: 'invalid-params' });

      useEditorStore.getState().closeFile(path as any);
      return { path };
    });

    // ---- Test commands ----

    this.handlers.set('tests.run', async (params) => {
      const fixture = (params.fixture as string) ?? 'browser';

      if (fixture === 'headless') {
        // Headless tests are handled server-side — should not reach the browser handler
        throw Object.assign(
          new Error('Headless fixture must be routed to the server, not the browser'),
          { code: 'unsupported' },
        );
      }

      // Browser fixture: fire-and-forget — start the test run asynchronously
      // and return immediately. Callers poll via tests.results.
      // This avoids HTTP/WebSocket timeouts for long-running tests.
      const { TestOrchestrator } = await import('./test-orchestrator.js');
      const testIds = params.testIds as string[] | undefined;

      const orchestrator = new TestOrchestrator();

      // Start entire test pipeline in background — don't await.
      // The orchestrator handles setup() internally (calls test module setup
      // to get projectId before opening the test tab).
      (async () => {
        await orchestrator.runTests({
          testIds,
          area: params.area as any,
          failedOnly: params.failedOnly as boolean | undefined,
          keepTabOpen: false,
        });
      })().catch(async (err) => {
        console.error('[automation] tests.run failed:', err);
        const { useTestResultStore } = await import('../stores/testResultStore.js');
        const msg = err instanceof Error ? err.message : String(err);
        useTestResultStore.getState().setLastError(msg);
        useTestResultStore.getState().setRunning(false);
      }).finally(() => {
        orchestrator.dispose();
      });

      // Return immediately — caller polls tests.results
      return { started: true, testIds };
    });

    this.handlers.set('tests.list', async () => {
      const { getAllTestModules } = await import('./browser-test-runner.js');
      const modules = getAllTestModules();
      return {
        tests: modules.map((m) => ({
          id: m.id,
          name: m.name,
          area: m.area,
        })),
      };
    });

    this.handlers.set('tests.results', async () => {
      const { useTestResultStore } = await import('../stores/testResultStore.js');
      const state = useTestResultStore.getState();
      return {
        results: state.results,
        runs: state.runs,
        isRunning: state.isRunning,
        currentTestId: state.currentTestId,
        lastError: state.lastError,
        testTabStatus: state.testTabStatus,
        liveLogs: state.liveLogs,
      };
    });

    // ---- Client lifecycle commands ----

    this.handlers.set('client.refresh', async () => {
      // Send the response before reloading so the caller gets confirmation
      setTimeout(() => window.location.reload(), 100);
      return { refreshing: true };
    });

    this.handlers.set('client.navigate', async (params) => {
      const url = params.url as string | undefined;
      const projectId = params.projectId as string | undefined;

      if (url) {
        // Navigate to an arbitrary URL (same-origin only)
        setTimeout(() => { window.location.href = url; }, 100);
        return { navigating: true, url };
      }

      if (projectId) {
        // Navigate to a specific project's IDE view
        setTimeout(() => { window.location.href = `/?project=${encodeURIComponent(projectId)}`; }, 100);
        return { navigating: true, projectId };
      }

      return { error: 'Provide either url or projectId parameter' };
    });

    this.handlers.set('client.state', async () => {
      // Comprehensive UI state snapshot — everything visible in the IDE.
      // Excludes file contents, terminal buffer, and build/deploy output.
      const { useProjectStore } = await import('../stores/projectStore.js');
      const { useEditorStore } = await import('../stores/editorStore.js');
      const { useFileStore } = await import('../stores/fileStore.js');
      const { useApplicationStore } = await import('../stores/applicationStore.js');
      const { useChatStore } = await import('../stores/chatStore.js');
      const { useGitStore } = await import('../stores/gitStore.js');
      const { useTestResultStore } = await import('../stores/testResultStore.js');
      const { useTerminalStore } = await import('../stores/terminalStore.js');

      const project = useProjectStore.getState();
      const editor = useEditorStore.getState();
      const files = useFileStore.getState();
      const app = useApplicationStore.getState();
      const chat = useChatStore.getState();
      const git = useGitStore.getState();
      const tests = useTestResultStore.getState();
      const terminal = useTerminalStore.getState();

      // Editor: open files (paths only, no content), active file, dirty state
      const openFiles = Array.from(editor.openFiles.entries()).map(([path, f]) => ({
        path,
        language: f.language,
        isDirty: f.isDirty,
      }));

      // File tree: flatten to paths (no content)
      const flattenTree = (nodes: any[], prefix = ''): string[] => {
        const result: string[] = [];
        for (const n of nodes) {
          const p = prefix ? `${prefix}/${n.name}` : n.name;
          result.push(n.isDirectory ? `${p}/` : p);
          if (n.children) result.push(...flattenTree(n.children, p));
        }
        return result;
      };

      // Application state: errors, workflow, rules
      const errors = app.getErrors?.() ?? [];
      const errorSummary = {
        total: errors.length,
        byFile: Object.fromEntries(
          Array.from((app.getErrorCountsByFile?.() ?? new Map()).entries())
        ),
        bySeverity: {
          error: errors.filter((e: any) => e.errorType?.name === 'TypeError' || e.errorType?.name === 'Error').length,
          warning: errors.filter((e: any) => e.errorType?.name === 'Warning').length,
        },
      };

      // Workflow state from server
      const serverState = app.serverState;
      const ruleResults = serverState?.ruleResults ?? {};
      const loadedFiles = serverState?.loadedFiles ?? [];
      const declarations = serverState?.declarations;
      const ruleCount = declarations?.rules?.length ?? 0;

      // Test results
      const testSummary = tests.getSummary();

      return {
        // Navigation
        url: window.location.href,

        // Project
        project: {
          id: project.currentProjectId,
          workspaceReady: project.workspaceReady,
          projectCount: project.projects.length,
        },

        // Editor
        editor: {
          activeFile: editor.activeFile,
          openFiles,
          openFileCount: openFiles.length,
          dirtyFileCount: openFiles.filter(f => f.isDirty).length,
        },

        // File Explorer
        fileExplorer: {
          fileCount: flattenTree(files.files).length,
          selectedFile: files.selectedFile,
          selectedFiles: Array.from(files.selectedFiles),
          expandedFolders: Array.from(files.expandedFolders),
          hasClipboard: !!files.clipboard,
          clipboardMode: files.clipboard?.mode ?? null,
        },

        // Problems / Errors
        problems: errorSummary,

        // Workflow / Build
        workflow: {
          loadedFiles,
          ruleCount,
          ruleResults: Object.fromEntries(
            Object.entries(ruleResults).map(([id, r]: [string, any]) => [
              id,
              { status: r.status, lastRunAt: r.lastRunAt, durationMs: r.durationMs, error: r.error },
            ])
          ),
        },

        // Git
        git: {
          initialized: git.status?.initialized ?? false,
          branch: git.status?.branch ?? null,
          staged: git.status?.staged?.length ?? 0,
          unstaged: git.status?.unstaged?.length ?? 0,
          untracked: git.status?.untracked?.length ?? 0,
          remoteCount: git.remotes.length,
          commitMessage: git.commitMessage || null,
        },

        // Chat
        chat: {
          messageCount: chat.messages.length,
          isTyping: chat.isTyping,
          isStreaming: !!chat.streamingMessageId,
          currentAgent: chat.currentAgent ?? null,
        },

        // Tests
        tests: {
          ...testSummary,
          isRunning: tests.isRunning,
          currentTestId: tests.currentTestId,
          testTabStatus: tests.testTabStatus,
          lastError: tests.lastError,
          resultCount: tests.results.length,
          runCount: tests.runs.length,
        },

        // Terminal
        terminal: {
          connectionState: terminal.connectionState,
          isRunning: terminal.isRunning,
          showReconnectOverlay: terminal.showReconnectOverlay,
        },
      };
    });
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Guess a Monaco editor language from the file extension. */
function guessLanguage(path: string): string {
  const ext = path.split('.').pop()?.toLowerCase();
  switch (ext) {
    case 'ts': case 'tsx': return 'typescript';
    case 'js': case 'jsx': case 'mjs': case 'cjs': return 'javascript';
    case 'json': return 'json';
    case 'html': case 'htm': return 'html';
    case 'css': return 'css';
    case 'scss': case 'sass': return 'scss';
    case 'md': case 'markdown': return 'markdown';
    case 'py': return 'python';
    case 'rs': return 'rust';
    case 'go': return 'go';
    case 'java': return 'java';
    case 'yml': case 'yaml': return 'yaml';
    case 'xml': return 'xml';
    case 'sh': case 'bash': return 'shell';
    case 'sql': return 'sql';
    case 'graphql': case 'gql': return 'graphql';
    default: return 'plaintext';
  }
}
