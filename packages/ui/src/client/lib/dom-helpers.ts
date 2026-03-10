/**
 * DOM automation utilities for the browser test framework.
 *
 * All test automation goes through these helpers, which interact
 * exclusively with DOM elements via data-testid selectors.
 * This ensures tests verify real UI behavior, not internal state.
 */

// ---- Error types ----

/**
 * Thrown when a UI capability does not exist — the required DOM element
 * was not found. This is distinct from a test failure: it means the
 * feature hasn't been implemented in the UI yet.
 */
export class UINotSupportedError extends Error {
  public readonly operation: string;
  public readonly selector: string;

  constructor(operation: string, selector: string, message?: string) {
    super(
      message ??
        `UI does not support "${operation}": element [data-testid="${selector}"] not found`,
    );
    this.name = 'UINotSupportedError';
    this.operation = operation;
    this.selector = selector;
  }
}

// ---- Configuration ----

export interface WaitOptions {
  /** Max time to wait in ms (default 5000). */
  timeoutMs?: number;
  /** Polling interval in ms (default 100). */
  intervalMs?: number;
}

/** Small delay to let React process state updates after DOM mutations. */
const REACT_SETTLE_MS = 80;

async function settle(): Promise<void> {
  await new Promise((r) => setTimeout(r, REACT_SETTLE_MS));
}

// ---- Core helpers ----

/**
 * Build a CSS selector for a data-testid value.
 */
function sel(testId: string): string {
  return `[data-testid="${testId}"]`;
}

/**
 * Find a single element by data-testid. Returns null if not found.
 */
export function queryElement(testId: string): HTMLElement | null {
  return document.querySelector<HTMLElement>(sel(testId));
}

/**
 * Find a single element by data-testid.
 * Throws UINotSupportedError if not found.
 */
export function findElement(testId: string, operation: string): HTMLElement {
  const el = queryElement(testId);
  if (!el) {
    throw new UINotSupportedError(operation, testId);
  }
  return el;
}

/**
 * Check whether an element with the given data-testid exists in the DOM.
 */
export function elementExists(testId: string): boolean {
  return queryElement(testId) !== null;
}

/**
 * Find all elements whose data-testid starts with the given prefix.
 */
export function findAllByTestIdPrefix(prefix: string): HTMLElement[] {
  return Array.from(
    document.querySelectorAll<HTMLElement>(`[data-testid^="${prefix}"]`),
  );
}

// ---- Wait helpers ----

/**
 * Wait for an element with the given data-testid to appear in the DOM.
 * Resolves with the element, or rejects after timeout.
 */
export async function waitForElement(
  testId: string,
  options?: WaitOptions,
): Promise<HTMLElement> {
  const timeout = options?.timeoutMs ?? 5000;
  const interval = options?.intervalMs ?? 100;
  const deadline = Date.now() + timeout;

  while (Date.now() < deadline) {
    const el = queryElement(testId);
    if (el) return el;
    await new Promise((r) => setTimeout(r, interval));
  }

  throw new Error(
    `Timed out waiting for [data-testid="${testId}"] after ${timeout}ms`,
  );
}

/**
 * Wait for an element to disappear from the DOM.
 */
export async function waitForElementGone(
  testId: string,
  options?: WaitOptions,
): Promise<void> {
  const timeout = options?.timeoutMs ?? 5000;
  const interval = options?.intervalMs ?? 100;
  const deadline = Date.now() + timeout;

  while (Date.now() < deadline) {
    if (!queryElement(testId)) return;
    await new Promise((r) => setTimeout(r, interval));
  }

  throw new Error(
    `Timed out waiting for [data-testid="${testId}"] to disappear after ${timeout}ms`,
  );
}

/**
 * Wait for a generic condition to become true.
 */
export async function waitFor(
  condition: () => boolean | Promise<boolean>,
  options?: WaitOptions & { message?: string },
): Promise<void> {
  const timeout = options?.timeoutMs ?? 5000;
  const interval = options?.intervalMs ?? 100;
  const deadline = Date.now() + timeout;

  while (Date.now() < deadline) {
    if (await condition()) return;
    await new Promise((r) => setTimeout(r, interval));
  }

  throw new Error(
    options?.message ?? `Condition not met within ${timeout}ms`,
  );
}

// ---- Interaction helpers ----

/**
 * Click an element by data-testid.
 * Dispatches realistic mousedown → mouseup → click events.
 * Throws UINotSupportedError if the element doesn't exist.
 */
export async function clickElement(
  testId: string,
  operation: string,
): Promise<void> {
  const el = findElement(testId, operation);
  el.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }));
  el.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, cancelable: true }));
  el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
  await settle();
}

/**
 * Type text into an input element by data-testid.
 * Clears existing value first, then sets value and dispatches input/change events.
 */
export async function typeIntoElement(
  testId: string,
  text: string,
  operation: string,
): Promise<void> {
  const el = findElement(testId, operation) as HTMLInputElement;
  el.focus();
  // Clear existing value
  el.value = '';
  el.dispatchEvent(new Event('input', { bubbles: true }));
  // Set new value
  el.value = text;
  el.dispatchEvent(new Event('input', { bubbles: true }));
  el.dispatchEvent(new Event('change', { bubbles: true }));
  await settle();
}

/**
 * Press Enter on an element by data-testid.
 */
export async function pressEnter(testId: string): Promise<void> {
  const el = queryElement(testId);
  if (!el) return;
  el.dispatchEvent(
    new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', bubbles: true, cancelable: true }),
  );
  await settle();
}

/**
 * Press Escape on an element by data-testid.
 */
export async function pressEscape(testId: string): Promise<void> {
  const el = queryElement(testId);
  if (!el) return;
  el.dispatchEvent(
    new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', bubbles: true, cancelable: true }),
  );
  await settle();
}

/**
 * Read text content from an element by data-testid.
 */
export function getTextContent(testId: string, operation: string): string {
  const el = findElement(testId, operation);
  return el.textContent?.trim() ?? '';
}

/**
 * Select an option in a <select> element by data-testid.
 */
export async function selectOption(
  testId: string,
  value: string,
  operation: string,
): Promise<void> {
  const el = findElement(testId, operation) as HTMLSelectElement;
  el.value = value;
  el.dispatchEvent(new Event('change', { bubbles: true }));
  await settle();
}

// ---- File tree folder expansion ----

/**
 * Expand all collapsed folders in the file tree.
 *
 * Reads `data-expanded="false"` on folder rows and clicks each collapsed
 * folder to expand it. Repeats until no new collapsed folders appear
 * (expanding a folder may reveal nested collapsed folders).
 *
 * @param maxPasses - Safety limit on expansion rounds (default 10)
 */
export async function expandAllFolders(maxPasses = 10): Promise<void> {
  for (let pass = 0; pass < maxPasses; pass++) {
    const collapsedFolders = Array.from(
      document.querySelectorAll<HTMLElement>(
        '[data-type="directory"][data-expanded="false"]',
      ),
    );

    if (collapsedFolders.length === 0) break;

    for (const folder of collapsedFolders) {
      // Click the folder row to toggle it open
      folder.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }));
      folder.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, cancelable: true }));
      folder.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    }

    // Wait for React to render newly-revealed children
    await settle();
    await new Promise((r) => setTimeout(r, 100));
  }
}

/**
 * Ensure all ancestor folders for a given path are expanded so the
 * target element becomes visible in the DOM.
 *
 * For path "src/components/App.tsx", this expands "src" then "src/components".
 *
 * @param targetPath - The file/folder path to make visible
 */
export async function ensureParentFoldersExpanded(targetPath: string): Promise<void> {
  const segments = targetPath.split('/');
  // Walk each ancestor: for "a/b/c.ts" we need to expand "a" then "a/b"
  for (let i = 1; i < segments.length; i++) {
    const ancestorPath = segments.slice(0, i).join('/');
    const encodedPath = encodePathForTestId(ancestorPath);
    const testId = `file-tree-item-${encodedPath}`;

    const el = queryElement(testId);
    if (!el) {
      // Ancestor folder doesn't exist in tree yet — wait a bit and retry
      await new Promise((r) => setTimeout(r, 200));
      const retryEl = queryElement(testId);
      if (!retryEl) continue; // Still not there — skip (may not exist yet)
    }

    const folderEl = el ?? queryElement(testId);
    if (folderEl && folderEl.getAttribute('data-expanded') === 'false') {
      // Folder is collapsed — click to expand
      folderEl.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }));
      folderEl.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, cancelable: true }));
      folderEl.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
      await settle();
      await new Promise((r) => setTimeout(r, 100));
    }
  }
}

// ---- Path encoding ----

/**
 * Encode a file path for use in data-testid attributes.
 * Replaces / with -- to produce valid selectors.
 */
export function encodePathForTestId(path: string): string {
  return path.replace(/\//g, '--');
}

/**
 * Decode a data-testid path back to a file path.
 * Replaces -- with /.
 */
export function decodeTestIdToPath(testId: string): string {
  return testId.replace(/--/g, '/');
}
