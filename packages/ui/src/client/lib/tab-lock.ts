/**
 * Tab-level project locking — prevents two browser tabs from opening
 * the same project, which would cause localStorage read/write collisions
 * for project-scoped Zustand persistence keys.
 *
 * Mechanism:
 *  - Each tab generates a unique ID on load.
 *  - acquireLock(projectId) writes { tabId, timestamp } to localStorage.
 *  - A heartbeat interval (5s) keeps the timestamp fresh.
 *  - Locks with timestamps older than LOCK_TIMEOUT_MS are considered stale.
 *  - beforeunload releases all locks held by this tab.
 */

// Persist TAB_ID in sessionStorage so it survives hard refreshes.
// Without this, a hard-refreshed tab gets a new UUID and its own previous
// lock looks like it belongs to "another tab", causing clearProject().
const TAB_ID = sessionStorage.getItem('antimatter-tab-id') ?? crypto.randomUUID();
sessionStorage.setItem('antimatter-tab-id', TAB_ID);
const LOCK_PREFIX = 'antimatter-project-lock-';
const HEARTBEAT_INTERVAL_MS = 5000;
const LOCK_TIMEOUT_MS = 15000;

interface LockValue {
  tabId: string;
  timestamp: number;
}

/** Projects this tab currently holds locks for. */
const heldLocks = new Map<string, ReturnType<typeof setInterval>>();

function lockKey(projectId: string): string {
  return LOCK_PREFIX + projectId;
}

function readLock(projectId: string): LockValue | null {
  try {
    const raw = localStorage.getItem(lockKey(projectId));
    if (!raw) return null;
    return JSON.parse(raw) as LockValue;
  } catch {
    return null;
  }
}

function writeLock(projectId: string): void {
  localStorage.setItem(
    lockKey(projectId),
    JSON.stringify({ tabId: TAB_ID, timestamp: Date.now() } satisfies LockValue),
  );
}

/**
 * Attempt to acquire a project lock for this tab.
 * Returns true if the lock was acquired, false if another tab holds it.
 */
export function acquireLock(projectId: string): boolean {
  const existing = readLock(projectId);
  if (existing && existing.tabId !== TAB_ID) {
    // Another tab holds the lock — check if stale
    if (Date.now() - existing.timestamp < LOCK_TIMEOUT_MS) {
      return false;
    }
    // Stale lock — take over
  }

  writeLock(projectId);
  if (!heldLocks.has(projectId)) {
    const timer = setInterval(() => writeLock(projectId), HEARTBEAT_INTERVAL_MS);
    heldLocks.set(projectId, timer);
  }
  return true;
}

/**
 * Release a project lock held by this tab.
 */
export function releaseLock(projectId: string): void {
  const existing = readLock(projectId);
  if (existing && existing.tabId === TAB_ID) {
    localStorage.removeItem(lockKey(projectId));
  }
  const timer = heldLocks.get(projectId);
  if (timer) {
    clearInterval(timer);
    heldLocks.delete(projectId);
  }
}

/**
 * Check whether another tab holds a fresh lock on this project.
 */
export function isLockedByOther(projectId: string): boolean {
  const existing = readLock(projectId);
  if (!existing) return false;
  if (existing.tabId === TAB_ID) return false;
  return Date.now() - existing.timestamp < LOCK_TIMEOUT_MS;
}

/**
 * Listen for lock changes from other tabs.
 * Returns an unsubscribe function.
 */
export function onLockChanged(callback: (projectId: string) => void): () => void {
  const handler = (e: StorageEvent) => {
    if (e.key && e.key.startsWith(LOCK_PREFIX)) {
      callback(e.key.slice(LOCK_PREFIX.length));
    }
  };
  window.addEventListener('storage', handler);
  return () => window.removeEventListener('storage', handler);
}

// Release all locks when the tab closes.
window.addEventListener('beforeunload', () => {
  for (const projectId of heldLocks.keys()) {
    const existing = readLock(projectId);
    if (existing && existing.tabId === TAB_ID) {
      localStorage.removeItem(lockKey(projectId));
    }
  }
});
