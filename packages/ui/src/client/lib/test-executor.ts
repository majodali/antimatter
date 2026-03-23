/**
 * TestExecutor — runs in the test tab (disposable test project).
 *
 * Listens for commands from the orchestrator via BroadcastChannel,
 * executes tests using the DOM-based BrowserActionContext,
 * and reports results back incrementally.
 */

import {
  TEST_CHANNEL_NAME,
  type OrchestratorMessage,
  type ExecutorMessage,
  type CrossTabRunOptions,
} from '../../shared/cross-tab-protocol.js';
import type { StoredTestResult, TestRunSummary, TestTrace } from '../../shared/test-types.js';
import { allTestModules } from '../../shared/test-modules/index.js';
import { BrowserActionContext } from './browser-action-context.js';
import { UINotSupportedError } from './dom-helpers.js';

// ---------------------------------------------------------------------------
// Console capture utility
// ---------------------------------------------------------------------------

interface ConsoleCapture {
  getLogs(): string[];
  restore(): void;
}

/**
 * Intercept console.log/warn/error to capture output during a test.
 * Calls are still forwarded to the original console methods.
 */
function startConsoleCapture(): ConsoleCapture {
  const logs: string[] = [];
  const origLog = console.log;
  const origWarn = console.warn;
  const origError = console.error;

  const fmt = (args: unknown[]) =>
    args.map((a) => (typeof a === 'string' ? a : JSON.stringify(a))).join(' ');

  console.log = (...args: unknown[]) => {
    logs.push(`[log] ${fmt(args)}`);
    origLog.apply(console, args);
  };
  console.warn = (...args: unknown[]) => {
    logs.push(`[warn] ${fmt(args)}`);
    origWarn.apply(console, args);
  };
  console.error = (...args: unknown[]) => {
    logs.push(`[error] ${fmt(args)}`);
    origError.apply(console, args);
  };

  return {
    getLogs: () => [...logs],
    restore: () => {
      console.log = origLog;
      console.warn = origWarn;
      console.error = origError;
    },
  };
}

/**
 * Capture a compact DOM snapshot of key IDE areas for diagnostics.
 */
function captureDomSnapshot(): string {
  const parts: string[] = [];

  // File explorer state
  const fileTree = document.querySelectorAll('[data-testid^="file-tree-item-"]');
  parts.push(`file-tree: ${fileTree.length} items`);

  // Editor tabs
  const tabs = document.querySelectorAll('[data-testid^="editor-tab-"]');
  const tabPaths = Array.from(tabs).map(
    (t) => (t as HTMLElement).dataset.testid?.replace('editor-tab-', '') ?? '?',
  );
  parts.push(`editor-tabs: [${tabPaths.join(', ')}]`);

  // Active file
  const activeTab = document.querySelector('[data-testid^="editor-tab-"][data-active="true"]');
  parts.push(`active-tab: ${(activeTab as HTMLElement)?.dataset.path ?? 'none'}`);

  // Main layout present?
  const mainLayout = document.querySelector('[data-testid="main-layout"]');
  parts.push(`main-layout: ${mainLayout ? 'present' : 'MISSING'}`);

  // Any visible error banners
  const errors = document.querySelectorAll('[role="alert"], .error-banner');
  if (errors.length > 0) {
    parts.push(
      `errors: ${Array.from(errors)
        .map((e) => (e as HTMLElement).textContent?.slice(0, 100))
        .join('; ')}`,
    );
  }

  return parts.join('\n');
}

export class TestExecutor {
  private channel: BroadcastChannel;
  private projectId: string;
  private aborted = false;
  /** RunId from the orchestrator — echoed on all outgoing messages. */
  private runId: string | undefined;

  constructor(projectId: string, runId?: string) {
    this.projectId = projectId;
    this.runId = runId;
    this.channel = new BroadcastChannel(TEST_CHANNEL_NAME);
    this.channel.onmessage = this.handleMessage.bind(this);
  }

  /**
   * Signal to the orchestrator that this tab is loaded and ready to run tests.
   * Waits for the file tree to load before signalling, with a safety timeout.
   */
  signalReady(): void {
    const safetyTimeout = setTimeout(() => {
      clearInterval(checkTimer);
      console.warn('[test-executor] Safety timeout — signalling ready without file tree');
      this.send({ type: 'ready', projectId: this.projectId });
    }, 30000);

    const checkTimer = setInterval(() => {
      const mainLayout = document.querySelector('[data-testid="main-layout"]');
      const fileTree = document.querySelector('[data-testid^="file-tree-item-"]')
                    || document.querySelector('[data-testid="file-explorer-empty"]');

      if (mainLayout && fileTree) {
        clearInterval(checkTimer);
        clearTimeout(safetyTimeout);
        this.send({ type: 'ready', projectId: this.projectId });
      }
    }, 200);
  }

  /**
   * Send a message to the orchestrator tab.
   * Automatically includes the runId if one has been received.
   */
  private send(msg: ExecutorMessage): void {
    if (this.runId) {
      (msg as any).runId = this.runId;
    }
    this.channel.postMessage(msg);
  }

  /**
   * Handle incoming messages from the orchestrator.
   */
  private async handleMessage(event: MessageEvent<OrchestratorMessage>): Promise<void> {
    const msg = event.data;

    switch (msg.type) {
      case 'ping':
        this.send({ type: 'pong', projectId: this.projectId });
        break;

      case 'run-tests':
        // Only respond to run-tests if runId matches (or executor has no runId yet)
        if (this.runId && msg.runId && msg.runId !== this.runId) {
          console.log(`[test-executor] Ignoring run-tests with different runId: ${msg.runId} (mine: ${this.runId})`);
          return;
        }
        // Store/confirm the runId so all responses are scoped to this run
        if (msg.runId) this.runId = msg.runId;
        try {
          await this.executeTests(msg.testIds, msg.options);
        } catch (err) {
          this.send({
            type: 'error',
            message: err instanceof Error ? err.message : String(err),
          });
        }
        break;

      case 'abort':
        this.aborted = true;
        break;

      case 'cleanup':
        this.send({ type: 'closing' });
        if (msg.keepOpen) {
          // Keep tab open for manual inspection — don't close or dispose
          return;
        }
        this.dispose();
        // Give the message time to be sent before closing
        setTimeout(() => window.close(), 200);
        break;
    }
  }

  /**
   * Execute test modules and report results incrementally.
   */
  private async executeTests(
    testIds?: string[],
    options?: CrossTabRunOptions,
  ): Promise<void> {
    this.aborted = false;

    // Filter tests
    let tests = [...allTestModules];
    if (testIds && testIds.length > 0) {
      tests = tests.filter((t) => testIds.includes(t.id));
    }
    if (options?.area) {
      tests = tests.filter((t) => t.area === options.area);
    }

    if (tests.length === 0) {
      this.send({ type: 'error', message: 'No tests match the given criteria' });
      return;
    }

    const runId = `run-${Date.now().toString(36)}`;
    const startTime = Date.now();
    const results: StoredTestResult[] = [];

    for (const test of tests) {
      if (this.aborted) break;

      this.send({ type: 'test-start', testId: test.id });

      // Each test gets a fresh BrowserActionContext
      const ctx = new BrowserActionContext({
        delayMs: options?.delayMs ?? 200,
      });
      const testStart = Date.now();

      let pass = false;
      let detail = '';
      let status: 'tested' | 'unsupported' | 'error' = 'tested';
      let trace: TestTrace | undefined;

      // Capture console output during the test
      const capture = startConsoleCapture();

      // Periodically flush new console logs to the orchestrator so they
      // survive orchestrator timeouts and are available for live inspection.
      let lastFlushedCount = 0;
      const flushInterval = setInterval(() => {
        const currentLogs = capture.getLogs();
        if (currentLogs.length > lastFlushedCount) {
          this.send({
            type: 'test-log',
            testId: test.id,
            logs: currentLogs.slice(lastFlushedCount),
          });
          lastFlushedCount = currentLogs.length;
        }
      }, 5000);

      try {
        // Per-test timeout prevents any single test from blocking the entire suite.
        const PER_TEST_TIMEOUT_MS = 120_000; // 120 seconds max per test
        const result = await Promise.race([
          test.run(ctx),
          new Promise<never>((_, reject) =>
            setTimeout(() => reject(new Error(`Test timed out after ${PER_TEST_TIMEOUT_MS / 1000}s`)), PER_TEST_TIMEOUT_MS),
          ),
        ]);
        pass = result.pass;
        detail = result.detail;
      } catch (err) {
        if (err instanceof UINotSupportedError) {
          pass = false;
          detail = `UI NOT SUPPORTED: ${err.message}`;
          status = 'unsupported';
        } else {
          pass = false;
          detail = `Uncaught error: ${err instanceof Error ? err.message : String(err)}`;
          status = 'error';
        }
      } finally {
        clearInterval(flushInterval);
        // Final flush of any remaining logs
        const finalLogs = capture.getLogs();
        if (finalLogs.length > lastFlushedCount) {
          this.send({
            type: 'test-log',
            testId: test.id,
            logs: finalLogs.slice(lastFlushedCount),
          });
        }

        // Always include console logs in trace for diagnostics.
        // DOM snapshot and error stack only on failure.
        trace = {
          consoleLogs: finalLogs,
          ...(!pass ? { domSnapshot: captureDomSnapshot() } : {}),
          ...(status === 'error' ? { errorStack: detail } : {}),
        };

        capture.restore();
      }

      const storedResult: StoredTestResult = {
        id: test.id,
        name: test.name,
        area: test.area,
        pass,
        durationMs: Date.now() - testStart,
        detail,
        runId,
        fixture: 'browser',
        timestamp: new Date().toISOString(),
        status,
        trace,
      };

      results.push(storedResult);
      this.send({ type: 'test-result', result: storedResult });
    }

    // Build and send summary
    const summary: TestRunSummary = {
      runId,
      fixture: 'browser',
      timestamp: new Date().toISOString(),
      total: results.length,
      passed: results.filter((r) => r.pass).length,
      failed: results.filter((r) => !r.pass).length,
      durationMs: Date.now() - startTime,
      results,
    };

    this.send({ type: 'run-complete', summary });
  }

  /**
   * Dispose the executor and release the BroadcastChannel.
   */
  dispose(): void {
    this.channel.close();
  }
}
