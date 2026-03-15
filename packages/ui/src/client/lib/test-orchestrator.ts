/**
 * TestOrchestrator — runs in the original tab (user's IDE project).
 *
 * Manages the full cross-tab test lifecycle:
 * 1. Create a disposable test project via API
 * 2. Open a persistent test tab (or show modal if popups blocked)
 * 3. Wait for the executor to signal ready
 * 4. Send run-tests command
 * 5. Receive incremental results via BroadcastChannel
 * 6. Clean up: delete test project (tab stays open for reuse)
 *
 * Test tab strategy (unified for UI and automation):
 * - If a persistent test tab is already open → reuse it
 * - Try window.open() → save as persistent tab
 * - If popup blocked → show modal with "Open Test Tab" button (user gesture)
 */

import {
  TEST_CHANNEL_NAME,
  type OrchestratorMessage,
  type ExecutorMessage,
  type CrossTabRunOptions,
} from '../../shared/cross-tab-protocol.js';
import type { TestRunSummary } from '../../shared/test-types.js';
import { useTestResultStore } from '../stores/testResultStore.js';
import { createProject, deleteProject } from './api.js';

// ---------------------------------------------------------------------------
// Persistent test tab — shared across orchestrator instances
// ---------------------------------------------------------------------------

let persistentTestTab: Window | null = null;

// ---------------------------------------------------------------------------
// Modal coordination — Promise-based bridge to React UI
// ---------------------------------------------------------------------------

let pendingTabResolve: ((win: Window) => void) | null = null;
let pendingTabReject: ((err: Error) => void) | null = null;
let pendingTabUrl: string | null = null;

/** Get the URL the modal should open. Used by TestTabModal component. */
export function getPendingTabUrl(): string | null {
  return pendingTabUrl;
}

/**
 * Called by TestTabModal when user clicks "Open Test Tab" and window.open() succeeds.
 * Resolves the pending Promise so the orchestrator can continue.
 */
export function resolveTestTabModal(win: Window): void {
  useTestResultStore.getState().setShowTestTabModal(false);
  pendingTabResolve?.(win);
  pendingTabResolve = null;
  pendingTabReject = null;
  pendingTabUrl = null;
}

/**
 * Called by TestTabModal when user clicks "Cancel".
 * Rejects the pending Promise so the orchestrator reports failure.
 */
export function rejectTestTabModal(): void {
  useTestResultStore.getState().setShowTestTabModal(false);
  pendingTabReject?.(new Error('User cancelled — test tab not opened'));
  pendingTabResolve = null;
  pendingTabReject = null;
  pendingTabUrl = null;
}

/**
 * Show the popup-blocked modal and return a Promise that resolves
 * when the user opens the test tab via the modal button.
 */
function requestTestTabViaModal(url: string): Promise<Window> {
  return new Promise<Window>((resolve, reject) => {
    pendingTabResolve = resolve;
    pendingTabReject = reject;
    pendingTabUrl = url;
    useTestResultStore.getState().setShowTestTabModal(true);
  });
}

// ---------------------------------------------------------------------------
// TestOrchestrator
// ---------------------------------------------------------------------------

export class TestOrchestrator {
  private channel: BroadcastChannel;
  private testTabWindow: Window | null = null;
  private testProjectId: string | null = null;
  private keepTabOpen = false;

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

      // 2. Open test tab (persistent tab with modal fallback)
      store.setTestTabStatus('loading');
      const url = `/?project=${encodeURIComponent(project.id)}&testMode=true`;
      this.keepTabOpen = options?.keepTabOpen ?? false;

      await this.openOrReuseTab(url);

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
      const message = err instanceof Error ? err.message : String(err);
      throw new Error(`Test run failed: ${message}`);
    } finally {
      // 6. Cleanup
      await this.cleanup();
      store.setRunning(false);
      store.setTestTabStatus('idle');
    }
  }

  // ---- Tab management ----

  /**
   * Open a test tab using the unified strategy:
   * 1. Reuse persistent tab if alive
   * 2. Try window.open()
   * 3. Fall back to modal if popup blocked
   */
  private async openOrReuseTab(url: string): Promise<void> {
    if (persistentTestTab && !persistentTestTab.closed) {
      // Reuse: navigate the existing persistent tab to the new test project
      this.testTabWindow = persistentTestTab;
      this.testTabWindow.location.href = url;
    } else {
      // Attempt to open a new tab
      const win = window.open(url, '_blank');
      if (win) {
        this.testTabWindow = win;
        persistentTestTab = win;
      } else {
        // Popup blocked — show modal, wait for user gesture
        const modalWin = await requestTestTabViaModal(url);
        this.testTabWindow = modalWin;
        persistentTestTab = modalWin;
      }
    }

    this.startTabPolling();
  }

  // ---- Message handling ----

  private send(msg: OrchestratorMessage): void {
    this.channel.postMessage(msg);
  }

  private handleMessage(event: MessageEvent<ExecutorMessage>): void {
    const msg = event.data;

    switch (msg.type) {
      case 'pong':
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
        break;

      case 'runner-available':
        break;
    }
  }

  // ---- Async coordination ----

  private waitForReady(timeoutMs: number): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      this.readyResolve = resolve;
      this.readyReject = reject;

      setTimeout(() => {
        reject(new Error(`Test tab did not become ready within ${timeoutMs / 1000}s`));
      }, timeoutMs);
    });
  }

  private waitForCompletion(timeoutMs: number): Promise<TestRunSummary> {
    return new Promise<TestRunSummary>((resolve, reject) => {
      this.completionResolve = resolve;
      this.completionReject = reject;

      setTimeout(() => {
        reject(new Error(`Test run did not complete within ${timeoutMs / 1000}s`));
      }, timeoutMs);
    });
  }

  // ---- Tab polling ----

  private startTabPolling(): void {
    this.stopTabPolling();
    this.tabPollInterval = setInterval(() => {
      if (this.testTabWindow && this.testTabWindow.closed) {
        this.stopTabPolling();
        persistentTestTab = null; // Tab was closed — clear persistent ref
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

  // ---- Cleanup ----

  /**
   * Clean up: delete disposable test project.
   * The persistent test tab is kept alive for reuse (not closed).
   */
  private async cleanup(): Promise<void> {
    this.stopTabPolling();

    const store = useTestResultStore.getState();
    store.setTestTabStatus('cleaning');

    // Tell executor to clean up (keep tab open — it's persistent)
    this.send({ type: 'cleanup', keepOpen: true });

    if (this.keepTabOpen) {
      // Keep tab AND project alive for manual inspection
      store.setTestProjectId(null);
      this.testProjectId = null;
      return;
    }

    // Delete the disposable test project (best-effort)
    if (this.testProjectId) {
      try {
        await deleteProject(this.testProjectId);
      } catch {
        console.warn('[test-orchestrator] Failed to delete test project:', this.testProjectId);
      }
    }

    store.setTestProjectId(null);
    this.testProjectId = null;
    this.readyResolve = null;
    this.readyReject = null;
    this.completionResolve = null;
    this.completionReject = null;
  }

  /**
   * Dispose the orchestrator and release the BroadcastChannel.
   * Does NOT close the persistent test tab.
   */
  dispose(): void {
    this.stopTabPolling();
    this.channel.close();
  }
}
