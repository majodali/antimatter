/**
 * Functional tests for cross-tab isolation features.
 *
 * Exercises the tab-lock mechanism (acquireLock / releaseLock / isLockedByOther),
 * project-scoped storage isolation (createProjectStorage + setProjectIdGetter),
 * and the Zustand store integration (selectProject / clearProject).
 *
 * These tests are browser-only — they rely on localStorage and window.
 * When run in Node.js (Vitest), they return pass with a "skipped" detail.
 */

import type { TestModule, TestModuleResult } from '../test-types.js';

// ---- Helpers ----

const LOCK_PREFIX = 'antimatter-project-lock-';

/** Generate a unique project ID that won't collide with real projects. */
function fakeProjectId(): string {
  return 'test-xtab-' + crypto.randomUUID().slice(0, 8);
}

/** Read and parse a lock entry from localStorage. */
function readLockEntry(projectId: string): { tabId: string; timestamp: number } | null {
  try {
    const raw = localStorage.getItem(LOCK_PREFIX + projectId);
    if (!raw) return null;
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

/** Write a fake lock entry simulating another tab. */
function writeFakeLock(projectId: string, tabId: string, timestamp?: number): void {
  localStorage.setItem(
    LOCK_PREFIX + projectId,
    JSON.stringify({ tabId, timestamp: timestamp ?? Date.now() }),
  );
}

/** Remove a lock entry from localStorage. */
function removeLockEntry(projectId: string): void {
  localStorage.removeItem(LOCK_PREFIX + projectId);
}

/** Remove all localStorage keys with a given prefix (test cleanup). */
function cleanupLocalStorage(prefix: string): void {
  const keysToRemove: string[] = [];
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i);
    if (key && key.startsWith(prefix)) keysToRemove.push(key);
  }
  for (const key of keysToRemove) {
    localStorage.removeItem(key);
  }
}

/** Guard: skip gracefully in Node.js / non-browser environments. */
function browserOnly(): TestModuleResult | null {
  if (typeof window === 'undefined' || typeof localStorage === 'undefined') {
    return { pass: true, detail: 'Skipped: browser-only test (no window/localStorage)' };
  }
  return null;
}

// ---- Tests ----

// FT-XTAB-001
const lockAcquireRelease: TestModule = {
  id: 'FT-XTAB-001',
  name: 'Tab lock acquire and release lifecycle',
  area: 'cross-tab',
  run: async (_ctx) => {
    const skip = browserOnly();
    if (skip) return skip;

    const { acquireLock, releaseLock } = await import('../../client/lib/tab-lock.js');
    const pid = fakeProjectId();

    try {
      // Acquire lock — should succeed
      const acquired = acquireLock(pid);
      if (!acquired) {
        return { pass: false, detail: 'acquireLock returned false on first call' };
      }

      // Verify lock entry exists in localStorage
      const entry = readLockEntry(pid);
      if (!entry) {
        return { pass: false, detail: 'No lock entry in localStorage after acquireLock' };
      }
      if (!entry.tabId || typeof entry.timestamp !== 'number') {
        return { pass: false, detail: `Invalid lock entry: ${JSON.stringify(entry)}` };
      }

      // Idempotent: re-acquiring same project should succeed
      const reacquired = acquireLock(pid);
      if (!reacquired) {
        return { pass: false, detail: 'Re-acquire (idempotent) returned false' };
      }

      // Release lock
      releaseLock(pid);
      const afterRelease = readLockEntry(pid);
      if (afterRelease) {
        return { pass: false, detail: 'Lock entry still in localStorage after releaseLock' };
      }

      return { pass: true, detail: 'Lock acquired, verified in localStorage, re-acquired (idempotent), released' };
    } finally {
      removeLockEntry(pid);
    }
  },
};

// FT-XTAB-002
const lockBlocksOtherTab: TestModule = {
  id: 'FT-XTAB-002',
  name: 'Lock blocks acquisition by simulated other tab',
  area: 'cross-tab',
  run: async (_ctx) => {
    const skip = browserOnly();
    if (skip) return skip;

    const { acquireLock, isLockedByOther } = await import('../../client/lib/tab-lock.js');
    const pid = fakeProjectId();

    try {
      // Simulate another tab holding a fresh lock
      writeFakeLock(pid, 'other-tab-id-xxx');

      // This tab should be blocked
      const acquired = acquireLock(pid);
      if (acquired) {
        return { pass: false, detail: 'acquireLock succeeded despite fresh lock from another tab' };
      }

      // isLockedByOther should confirm
      const locked = isLockedByOther(pid);
      if (!locked) {
        return { pass: false, detail: 'isLockedByOther returned false for fresh lock from another tab' };
      }

      return { pass: true, detail: 'Fresh lock from another tab correctly blocks acquireLock and isLockedByOther' };
    } finally {
      removeLockEntry(pid);
    }
  },
};

// FT-XTAB-003
const staleLockRecovery: TestModule = {
  id: 'FT-XTAB-003',
  name: 'Stale lock recovery',
  area: 'cross-tab',
  run: async (_ctx) => {
    const skip = browserOnly();
    if (skip) return skip;

    const { acquireLock, isLockedByOther, releaseLock } = await import('../../client/lib/tab-lock.js');
    const pid = fakeProjectId();

    try {
      // Simulate a stale lock (20s old, past the 15s timeout)
      writeFakeLock(pid, 'dead-tab-xxx', Date.now() - 20_000);

      // isLockedByOther should return false (stale)
      const locked = isLockedByOther(pid);
      if (locked) {
        return { pass: false, detail: 'isLockedByOther returned true for stale lock (20s old)' };
      }

      // Should be able to take over the stale lock
      const acquired = acquireLock(pid);
      if (!acquired) {
        return { pass: false, detail: 'acquireLock failed to take over stale lock' };
      }

      // Verify the lock now belongs to this tab (not the dead tab)
      const entry = readLockEntry(pid);
      if (!entry) {
        return { pass: false, detail: 'No lock entry after taking over stale lock' };
      }
      if (entry.tabId === 'dead-tab-xxx') {
        return { pass: false, detail: 'Lock still belongs to dead tab after takeover' };
      }

      return { pass: true, detail: 'Stale lock detected, taken over successfully, new entry belongs to this tab' };
    } finally {
      releaseLock(pid);
      removeLockEntry(pid);
    }
  },
};

// FT-XTAB-004
const storageIsolation: TestModule = {
  id: 'FT-XTAB-004',
  name: 'Project-scoped storage isolation',
  area: 'cross-tab',
  run: async (_ctx) => {
    const skip = browserOnly();
    if (skip) return skip;

    const { createProjectStorage, setProjectIdGetter } =
      await import('../../client/lib/storePersist.js');

    const pidA = fakeProjectId();
    const pidB = fakeProjectId();
    const STORE_NAME = 'xtab-test';
    const keyA = `antimatter-${STORE_NAME}-${pidA}`;
    const keyB = `antimatter-${STORE_NAME}-${pidB}`;

    // Save original getter so we can restore it
    // (setProjectIdGetter replaces a module-level variable)
    let currentGetterId: string | null = null;
    const originalGetterProxy = () => currentGetterId;

    try {
      // Point getter at project A
      currentGetterId = pidA;
      setProjectIdGetter(originalGetterProxy);

      // Create storage — its methods call getCurrentProjectId() dynamically
      const storage = createProjectStorage(STORE_NAME);
      if (!storage) {
        return { pass: false, detail: 'createProjectStorage returned undefined' };
      }

      // Write through PersistStorage API for project A
      await storage.setItem?.('state', { state: { v: 'alpha' }, version: 0 });

      // Verify raw localStorage key for A was written
      const rawA = localStorage.getItem(keyA);
      if (!rawA || !rawA.includes('alpha')) {
        return { pass: false, detail: `Project A key missing or wrong: ${rawA}` };
      }

      // Switch getter to project B (same storage instance, different project scope)
      currentGetterId = pidB;

      // Write through PersistStorage for project B
      await storage.setItem?.('state', { state: { v: 'beta' }, version: 0 });

      // Verify raw localStorage key for B
      const rawB = localStorage.getItem(keyB);
      if (!rawB || !rawB.includes('beta')) {
        return { pass: false, detail: `Project B key missing or wrong: ${rawB}` };
      }

      // Verify project A's data is still intact (not overwritten)
      const stillA = localStorage.getItem(keyA);
      if (!stillA || !stillA.includes('alpha')) {
        return { pass: false, detail: `Project A data overwritten by B: ${stillA}` };
      }

      // Read back through PersistStorage for project A
      currentGetterId = pidA;
      const readBack = await storage.getItem?.('state');
      if (!readBack || (readBack as any).state?.v !== 'alpha') {
        return {
          pass: false,
          detail: `Expected to read 'alpha' for A, got: ${JSON.stringify(readBack)}`,
        };
      }

      return {
        pass: true,
        detail: 'Storage keys scoped by project ID; A and B isolated; read-back correct',
      };
    } finally {
      localStorage.removeItem(keyA);
      localStorage.removeItem(keyB);
      // Restore getter to something safe — the app will re-inject the real getter
      setProjectIdGetter(() => null);
    }
  },
};

// FT-XTAB-005
const storeIntegration: TestModule = {
  id: 'FT-XTAB-005',
  name: 'selectProject acquires lock, clearProject releases',
  area: 'cross-tab',
  run: async (_ctx) => {
    const skip = browserOnly();
    if (skip) return skip;

    const { useProjectStore } = await import('../../client/stores/projectStore.js');
    const pid = fakeProjectId();

    // Save original state for restoration
    const originalProjectId = useProjectStore.getState().currentProjectId;

    try {
      // selectProject should acquire lock
      useProjectStore.getState().selectProject(pid);

      const storeState = useProjectStore.getState();
      if (storeState.currentProjectId !== pid) {
        return {
          pass: false,
          detail: `selectProject didn't set currentProjectId (got ${storeState.currentProjectId})`,
        };
      }

      // Verify lock exists in localStorage
      const lockEntry = readLockEntry(pid);
      if (!lockEntry) {
        return { pass: false, detail: 'No lock entry in localStorage after selectProject' };
      }

      // clearProject should release lock
      useProjectStore.getState().clearProject();

      const lockAfter = readLockEntry(pid);
      if (lockAfter) {
        return { pass: false, detail: 'Lock entry still exists after clearProject' };
      }

      const clearedState = useProjectStore.getState();
      if (clearedState.currentProjectId !== null) {
        return {
          pass: false,
          detail: `clearProject didn't null currentProjectId (got ${clearedState.currentProjectId})`,
        };
      }

      return {
        pass: true,
        detail: 'selectProject acquires lock + sets state; clearProject releases lock + clears state',
      };
    } finally {
      // Cleanup: remove any test lock
      removeLockEntry(pid);
      // Restore original project (if any)
      if (originalProjectId) {
        useProjectStore.getState().selectProject(originalProjectId);
      }
    }
  },
};

// FT-XTAB-006
const headerLockIndicator: TestModule = {
  id: 'FT-XTAB-006',
  name: 'Header dropdown shows lock icon for locked projects',
  area: 'cross-tab',
  run: async (_ctx) => {
    const skip = browserOnly();
    if (skip) return skip;

    const pid = fakeProjectId();

    try {
      // Simulate another tab locking a project
      writeFakeLock(pid, 'other-tab-for-header-test');

      // Look for the project dropdown trigger
      const trigger = document.querySelector('[data-testid="project-dropdown"]');
      if (!trigger) {
        return {
          pass: false,
          detail: 'Missing [data-testid="project-dropdown"] — add data-testid to Header dropdown trigger',
        };
      }

      // Click to open dropdown
      (trigger as HTMLElement).click();

      // Wait a tick for dropdown to render
      await new Promise((r) => setTimeout(r, 200));

      // Look for lock indicators within the dropdown content
      const dropdownContent = document.querySelector('[data-testid="project-dropdown-content"]');
      if (!dropdownContent) {
        return {
          pass: false,
          detail: 'Missing [data-testid="project-dropdown-content"] — add data-testid to dropdown content',
        };
      }

      // Look for any lock icon elements (Lock icon from lucide-react typically rendered as svg)
      const lockIcons = dropdownContent.querySelectorAll('[data-testid="project-lock-icon"]');
      if (lockIcons.length === 0) {
        // Also check for any SVG elements that might be lock icons (fallback)
        const svgs = dropdownContent.querySelectorAll('svg');
        const hasLockClass = Array.from(svgs).some(
          (svg) => svg.classList.contains('lock-icon') || svg.closest('[data-locked="true"]'),
        );

        if (!hasLockClass) {
          return {
            pass: false,
            detail:
              'No lock indicators found in dropdown. Add data-testid="project-lock-icon" to Lock icons, or data-locked="true" to locked items',
          };
        }
      }

      // Close dropdown (press Escape)
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));

      return {
        pass: true,
        detail: 'Header dropdown renders lock indicators for projects locked by other tabs',
      };
    } finally {
      removeLockEntry(pid);
    }
  },
};

// ---- Export ----

export const crossTabTests: readonly TestModule[] = [
  lockAcquireRelease,
  lockBlocksOtherTab,
  staleLockRecovery,
  storageIsolation,
  storeIntegration,
  headerLockIndicator,
];
