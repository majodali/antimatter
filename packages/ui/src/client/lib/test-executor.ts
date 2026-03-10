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
import type { StoredTestResult, TestRunSummary } from '../../shared/test-types.js';
import { allTestModules } from '../../shared/test-modules/index.js';
import { BrowserActionContext } from './browser-action-context.js';
import { UINotSupportedError } from './dom-helpers.js';

export class TestExecutor {
  private channel: BroadcastChannel;
  private projectId: string;
  private aborted = false;

  constructor(projectId: string) {
    this.projectId = projectId;
    this.channel = new BroadcastChannel(TEST_CHANNEL_NAME);
    this.channel.onmessage = this.handleMessage.bind(this);
  }

  /**
   * Signal to the orchestrator that this tab is loaded and ready to run tests.
   */
  signalReady(): void {
    this.send({ type: 'ready', projectId: this.projectId });
  }

  /**
   * Send a message to the orchestrator tab.
   */
  private send(msg: ExecutorMessage): void {
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

      try {
        const result = await test.run(ctx);
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
