/**
 * Headless browser test runner — executes functional tests on the server
 * using Puppeteer/Playwright against a disposable test project.
 *
 * This fixture runs a real browser (headless Chromium) so that DOM-based
 * tests exercise the same code paths as the browser-tab fixture, but
 * without requiring a user's browser tab to be open.
 *
 * Lifecycle:
 * 1. Create a disposable test project via API
 * 2. Launch headless Chromium
 * 3. Navigate to /?project={id}
 * 4. Wait for app to load (file tree visible)
 * 5. Call window.__runTests(testIds, options) via page.evaluate
 * 6. Capture console logs, screenshots on failure
 * 7. Clean up: close browser, delete test project
 *
 * Prerequisites:
 * - Chromium installed on the server (e.g. `apt install chromium-browser`)
 * - `puppeteer-core` as an optional dependency
 */

import type { StoredTestResult, TestRunSummary, TestTrace } from '../../shared/test-types.js';

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

export interface HeadlessTestRunnerConfig {
  /** Base URL of the Antimatter frontend (e.g. http://localhost:3000 or CloudFront URL). */
  baseUrl: string;
  /** API base URL for creating/deleting test projects. */
  apiBaseUrl: string;
  /**
   * Cognito access token used to (a) authenticate the disposable-project
   * create/delete calls and (b) authenticate the browser page via
   * `window.__HEADLESS_TOKEN__` injection. When omitted, both calls go
   * unauthenticated — only viable against a fully open API.
   */
  authToken?: string;
  /** Path to Chromium executable (auto-detected if omitted). */
  chromiumPath?: string;
  /** Test run timeout in ms (default: 300_000 = 5 min). */
  timeoutMs?: number;
}

export interface HeadlessTestRunOptions {
  testIds?: string[];
  area?: string;
  failedOnly?: boolean;
}

// ---------------------------------------------------------------------------
// Runner
// ---------------------------------------------------------------------------

/**
 * Run functional tests in a headless browser.
 *
 * Returns the TestRunSummary with trace data on failures.
 * If Puppeteer is not available, throws with a descriptive error.
 */
export async function runHeadlessTests(
  config: HeadlessTestRunnerConfig,
  options: HeadlessTestRunOptions = {},
): Promise<TestRunSummary> {
  // Dynamically import puppeteer-core to keep it optional
  let puppeteer: typeof import('puppeteer-core');
  try {
    puppeteer = await import('puppeteer-core');
  } catch {
    throw new Error(
      'Headless test runner requires puppeteer-core. ' +
      'Install it with: npm install puppeteer-core',
    );
  }

  const timeoutMs = config.timeoutMs ?? 300_000;
  let browser: Awaited<ReturnType<typeof puppeteer.launch>> | null = null;
  let testProjectId: string | null = null;

  try {
    // 1. Create disposable test project
    const authHeaders: Record<string, string> = { 'Content-Type': 'application/json' };
    if (config.authToken) authHeaders['Authorization'] = `Bearer ${config.authToken}`;
    const createResp = await fetch(`${config.apiBaseUrl}/projects`, {
      method: 'POST',
      headers: authHeaders,
      body: JSON.stringify({ name: `__headless_test_${Date.now()}` }),
    });
    if (!createResp.ok) {
      throw new Error(`Failed to create test project: ${createResp.status} ${await createResp.text()}`);
    }
    const project = (await createResp.json()) as { id: string };
    testProjectId = project.id;

    // 2. Launch headless browser
    const executablePath = config.chromiumPath ?? findChromium();
    browser = await puppeteer.launch({
      headless: true,
      executablePath,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-gpu',
      ],
    });

    const page = await browser.newPage();

    // Capture console output for diagnostics
    const consoleLogs: string[] = [];
    page.on('console', (msg) => {
      consoleLogs.push(`[${msg.type()}] ${msg.text()}`);
    });
    page.on('pageerror', (err) => {
      consoleLogs.push(`[page-error] ${err.message}`);
    });

    // 3a. Inject the Cognito token before any page script runs. `auth.ts`
    // and `AuthGate.tsx` both read `window.__HEADLESS_TOKEN__` and treat
    // its presence as a signed-in session — no Amplify redirect, no
    // localStorage seeding required.
    if (config.authToken) {
      const token = config.authToken;
      await page.evaluateOnNewDocument((t: string) => {
        (window as unknown as { __HEADLESS_TOKEN__?: string }).__HEADLESS_TOKEN__ = t;
      }, token);
    }

    // 3b. Navigate to test project
    const url = `${config.baseUrl}/?project=${encodeURIComponent(testProjectId)}`;
    await page.goto(url, { waitUntil: 'networkidle0', timeout: 60_000 });

    // 4. Wait for app to load (file tree or empty state)
    await page.waitForSelector(
      '[data-testid^="file-tree-item-"], [data-testid="file-explorer-empty"], [data-testid="main-layout"]',
      { timeout: 30_000 },
    );

    // 5. Wait for __runTests to appear — the client's automation handler
    // installs it lazily. If it doesn't show up within 15 s, fail clearly.
    await page.waitForFunction(
      () => typeof (window as any).__runTests === 'function',
      { timeout: 15_000 },
    ).catch(() => {
      // Fall through; page.evaluate below will produce a descriptive error.
    });

    // 6. Run tests via the exposed __runTests global
    const summary = await page.evaluate(
      async (testIds?: string[], testOptions?: { area?: string; failedOnly?: boolean }) => {
        const runner = (window as any).__runTests;
        if (!runner) {
          throw new Error('window.__runTests is not available — browser-test-runner not loaded');
        }
        return runner(testIds?.length ? testIds : undefined, testOptions ?? {});
      },
      options.testIds ?? [],
      { area: options.area, failedOnly: options.failedOnly },
    ) as TestRunSummary;

    // 6. Augment failed results with console logs
    const augmentedResults: StoredTestResult[] = summary.results.map((r) => {
      if (!r.pass && !r.trace) {
        return {
          ...r,
          fixture: 'headless' as const,
          trace: { consoleLogs: [...consoleLogs] } satisfies TestTrace,
        };
      }
      return { ...r, fixture: 'headless' as const };
    });

    return {
      ...summary,
      fixture: 'headless',
      results: augmentedResults,
    };
  } finally {
    // 7. Cleanup
    if (browser) {
      await browser.close().catch(() => {});
    }
    if (testProjectId) {
      const cleanupHeaders: Record<string, string> = {};
      if (config.authToken) cleanupHeaders['Authorization'] = `Bearer ${config.authToken}`;
      await fetch(`${config.apiBaseUrl}/projects/${testProjectId}`, {
        method: 'DELETE',
        headers: cleanupHeaders,
      }).catch(() => {});
    }
  }
}

// ---------------------------------------------------------------------------
// Chromium detection
// ---------------------------------------------------------------------------

/**
 * Find a Chromium/Chrome executable on the system.
 * Checks CHROMIUM_PATH env var first, then common paths by platform.
 */
export function findChromium(): string {
  const { existsSync } = require('fs') as typeof import('fs');

  // Environment variable override
  if (process.env.CHROMIUM_PATH && existsSync(process.env.CHROMIUM_PATH)) {
    return process.env.CHROMIUM_PATH;
  }

  const candidates = [
    // Linux (EC2 / Amazon Linux)
    '/usr/bin/chromium-browser',
    '/usr/bin/chromium',
    '/usr/bin/google-chrome',
    '/usr/bin/google-chrome-stable',
    '/snap/bin/chromium',
    // macOS
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    // Windows
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  ];

  for (const path of candidates) {
    if (existsSync(path)) return path;
  }

  // Fallback — let Puppeteer fail with a clear error
  return candidates[0];
}
