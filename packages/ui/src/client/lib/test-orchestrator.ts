/**
 * TestOrchestrator — runs in the original tab (user's IDE project).
 *
 * Manages the full cross-tab test lifecycle:
 * 1. Create a disposable test project via API
 * 2. Open a new tab with that project in testMode
 * 3. Wait for the executor to signal ready
 * 4. Send run-tests command
 * 5. Receive incremental results via BroadcastChannel
 * 6. Clean up: delete test project, close tab
 */

import {
  TEST_CHANNEL_NAME,
  type OrchestratorMessage,
  type ExecutorMessage,
  type CrossTabRunOptions,
} from '../../shared/cross-tab-protocol.js';
import type { StoredTestResult, TestRunSummary } from '../../shared/test-types.js';
import { useTestResultStore } from '../stores/testResultStore.js';
import { createProject, deleteProject } from './api.js';

export class TestOrchestrator {
  private channel: BroadcastChannel;
  private testTabWindow: Window | null = null;
  private testProjectId: string | null = null;

  // Promise resolvers for async coordination
  private readyResolve: (() => void) | null = null;
  private readyReject: ((err: Error) => void) | null = null;
  private completionResolve: ((summary: TestRunSummary) => void) | null = null;
  private completionReject: ((err: Error) => void) | null = null;

  // Polling for closed tab
  private tabPollInterval: ReturnType<typeof setInterval> | null = null;

  constructor() {
    this.channel = new BroadcastChannel(TEST_CHANNEL_NAME);
    this.channel.onmessage = this.handleMessage.bind(this);
  }

  /**
   * Run the full test lifecycle:
   * create project → open tab → run tests → collect results → cleanup.
   */
  async runTests(options?: CrossTabRunOptions): Promise<TestRunSummary> {
    const store = useTestResultStore.getState();
    if (store.isRunning) {
      throw new Error('A test run is already in progress');
    }

    store.setRunning(true);
    store.clearResults();
    store.setTestTabStatus('creating');

    try {
      // 1. Create disposable test project
      const projectName = `__test_${Date.now()}`;
      const project = await createProject(projectName);
      this.testProjectId = project.id;
      store.setTestProjectId(project.id);

      // 2. Open test tab
      store.setTestTabStatus('loading');
      const url = `/?project=${encodeURIComponent(project.id)}&testMode=true`;
      this.testTabWindow = window.open(url, '_blank');

      if (!this.testTabWindow) {
        throw new Error(
          'Failed to open test tab — pop-up blocker may be active. Please allow pop-ups for this site.',
        );
      }

      // Start polling for premature tab close
      this.startTabPolling();

      // 3. Wait for executor to signal ready
      await this.waitForReady(30_000);
      store.setTestTabStatus('ready');

      // 4. Send run command
      store.setTestTabStatus('running');
      this.send({ type: 'run-tests', testIds: options?.testIds, options });

      // 5. Wait for completion (results arrive incrementally via messages)
      const summary = await this.waitForCompletion(300_000); // 5 min timeout

      return summary;
    } catch (err) {
      // Surface error in store
      const message = err instanceof Error ? err.message : String(err);
      throw new Error(`Test run failed: ${message}`);
    } finally {
      // 6. Cleanup
      await this.cleanup();
      store.setRunning(false);
      store.setTestTabStatus('idle');
    }
  }

  /**
   * Send a message to the executor tab.
   */
  private send(msg: OrchestratorMessage): void {
    this.channel.postMessage(msg);
  }

  /**
   * Handle incoming messages from the executor tab.
   */
  private handleMessage(event: MessageEvent<ExecutorMessage>): void {
    const msg = event.data;

    switch (msg.type) {
      case 'pong':
        // Response to ping — not currently used
        break;

      case 'ready':
        this.readyResolve?.();
        break;

      case 'test-start':
        useTestResultStore.getState().setCurrentTest(msg.testId);
        break;

      case 'test-result':
        useTestResultStore.getState().addResult(msg.result);
        break;

      case 'run-complete':
        useTestResultStore.getState().addRun(msg.summary);
        this.completionResolve?.(msg.summary);
        break;

      case 'error':
        this.completionReject?.(new Error(msg.message));
        break;

      case 'closing':
        // Executor is shutting down
        break;
    }
  }

  /**
   * Wait for the executor to signal 'ready'.
   */
  private waitForReady(timeoutMs: number): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      this.readyResolve = resolve;
      this.readyReject = reject;

      setTimeout(() => {
        reject(new Error(`Test tab did not become ready within ${timeoutMs / 1000}s`));
      }, timeoutMs);
    });
  }

  /**
   * Wait for the executor to signal 'run-complete'.
   */
  private waitForCompletion(timeoutMs: number): Promise<TestRunSummary> {
    return new Promise<TestRunSummary>((resolve, reject) => {
      this.completionResolve = resolve;
      this.completionReject = reject;

      setTimeout(() => {
        reject(new Error(`Test run did not complete within ${timeoutMs / 1000}s`));
      }, timeoutMs);
    });
  }

  /**
   * Poll to detect if the test tab was closed prematurely.
   */
  private startTabPolling(): void {
    this.stopTabPolling();
    this.tabPollInterval = setInterval(() => {
      if (this.testTabWindow && this.testTabWindow.closed) {
        this.stopTabPolling();
        this.readyReject?.(new Error('Test tab was closed before tests completed'));
        this.completionReject?.(new Error('Test tab was closed before tests completed'));
      }
    }, 1000);
  }

  private stopTabPolling(): void {
    if (this.tabPollInterval) {
      clearInterval(this.tabPollInterval);
      this.tabPollInterval = null;
    }
  }

  /**
   * Clean up: tell executor to close, delete test project, close tab.
   */
  private async cleanup(): Promise<void> {
    this.stopTabPolling();

    const store = useTestResultStore.getState();
    store.setTestTabStatus('cleaning');

    // Tell executor to close
    this.send({ type: 'cleanup' });

    // Delete the disposable test project (best-effort)
    if (this.testProjectId) {
      try {
        await deleteProject(this.testProjectId);
      } catch {
        console.warn('[test-orchestrator] Failed to delete test project:', this.testProjectId);
      }
    }

    // Close tab if still open (may already be closed by executor)
    if (this.testTabWindow && !this.testTabWindow.closed) {
      this.testTabWindow.close();
    }

    store.setTestProjectId(null);
    this.testProjectId = null;
    this.testTabWindow = null;
    this.readyResolve = null;
    this.readyReject = null;
    this.completionResolve = null;
    this.completionReject = null;
  }

  /**
   * Dispose the orchestrator and release the BroadcastChannel.
   */
  dispose(): void {
    this.stopTabPolling();
    this.channel.close();
  }
}
