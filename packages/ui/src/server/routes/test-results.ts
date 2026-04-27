/**
 * Test results API route.
 *
 * POST /api/test-results   — Store a test run summary
 * GET  /api/test-results   — Retrieve latest test results
 * DELETE /api/test-results — Clear stored results
 */

import { Router } from 'express';
import type { TestRunSummary, ProjectTestRunSummary } from '../../shared/test-types.js';
import type { WorkspaceEnvironment } from '@antimatter/workspace';

export interface TestResultsStorage {
  save(summary: TestRunSummary): Promise<void>;
  load(): Promise<TestRunSummary[]>;
  clear(): Promise<void>;
}

/**
 * In-memory test results storage (workspace server).
 * Results persist for the lifetime of the server process.
 */
export class MemoryTestResultsStorage implements TestResultsStorage {
  private results: TestRunSummary[] = [];
  private readonly maxRuns = 50;

  async save(summary: TestRunSummary): Promise<void> {
    this.results.push(summary);
    // Keep only the most recent runs
    if (this.results.length > this.maxRuns) {
      this.results = this.results.slice(-this.maxRuns);
    }
  }

  async load(): Promise<TestRunSummary[]> {
    return [...this.results];
  }

  async clear(): Promise<void> {
    this.results = [];
  }
}

/**
 * File-backed test results storage (workspace server).
 * Persists to `.antimatter-cache/test-results.json` — automatically
 * synced to S3 by the workspace S3 sync scheduler.
 */
export class FileTestResultsStorage implements TestResultsStorage {
  private results: TestRunSummary[] = [];
  private projectRuns: ProjectTestRunSummary[] = [];
  private readonly maxRuns = 50;
  private readonly storagePath: string;
  /** Optional change hook fired after every save/clear. Used by
   *  ContextLifecycleStore to trigger a status re-derivation. */
  onChange?: () => void;

  constructor(
    private readonly env: WorkspaceEnvironment,
    storagePath = '.antimatter-cache/test-results.json',
  ) {
    this.storagePath = storagePath;
  }

  /** Load persisted results from disk on startup. */
  async initialize(): Promise<void> {
    try {
      const exists = await this.env.exists(this.storagePath);
      if (!exists) return;
      const content = await this.env.readFile(this.storagePath);
      const data = JSON.parse(content) as {
        runs?: TestRunSummary[];
        projectRuns?: ProjectTestRunSummary[];
      };
      if (data.runs) this.results = data.runs;
      if (data.projectRuns) this.projectRuns = data.projectRuns;
      const total = this.results.length + this.projectRuns.length;
      if (total > 0) {
        console.log(`[test-results] Restored ${this.results.length} functional + ${this.projectRuns.length} project test run(s)`);
      }
    } catch {
      // No persisted results or corrupt file — start fresh
    }
  }

  async save(summary: TestRunSummary): Promise<void> {
    this.results.push(summary);
    if (this.results.length > this.maxRuns) {
      this.results = this.results.slice(-this.maxRuns);
    }
    await this.persist();
    this.fireChange();
  }

  async load(): Promise<TestRunSummary[]> {
    return [...this.results];
  }

  async clear(): Promise<void> {
    this.results = [];
    await this.persist();
    this.fireChange();
  }

  /** Save a project test run (vitest/jest). */
  async saveProjectRun(summary: ProjectTestRunSummary): Promise<void> {
    this.projectRuns.push(summary);
    if (this.projectRuns.length > this.maxRuns) {
      this.projectRuns = this.projectRuns.slice(-this.maxRuns);
    }
    await this.persist();
    this.fireChange();
  }

  /** Get the latest pass/fail state for every test that has ever run.
   *  Most-recent-wins across all runs. Used by ContextLifecycleStore to
   *  evaluate per-context test requirements without scanning the full
   *  history on every recompute. */
  getLatestPasses(): readonly { id: string; pass: boolean }[] {
    const latest = new Map<string, boolean>();
    // Walk in chronological order so later runs overwrite earlier ones.
    for (const run of this.results) {
      for (const r of run.results) {
        latest.set(r.id, r.pass);
      }
    }
    return [...latest].map(([id, pass]) => ({ id, pass }));
  }

  private fireChange(): void {
    if (this.onChange) {
      try { this.onChange(); } catch (err) {
        console.error('[test-results] onChange hook failed:', err);
      }
    }
  }

  /** Load all project test runs. */
  async loadProjectRuns(): Promise<ProjectTestRunSummary[]> {
    return [...this.projectRuns];
  }

  /** Get the latest project test run (most recent). */
  getLatestProjectRun(): ProjectTestRunSummary | null {
    return this.projectRuns.length > 0 ? this.projectRuns[this.projectRuns.length - 1] : null;
  }

  private async persist(): Promise<void> {
    try {
      const dir = this.storagePath.substring(0, this.storagePath.lastIndexOf('/'));
      if (dir) {
        try { await this.env.mkdir(dir); } catch { /* may exist */ }
      }
      await this.env.writeFile(this.storagePath, JSON.stringify({
        runs: this.results,
        projectRuns: this.projectRuns,
      }, null, 2));
    } catch (err) {
      console.error('[test-results] Failed to persist:', err);
    }
  }
}

export function createTestResultsRouter(storage?: TestResultsStorage): Router {
  const store = storage ?? new MemoryTestResultsStorage();
  const router = Router();

  // Store a test run summary
  router.post('/', async (req, res) => {
    try {
      const summary = req.body as TestRunSummary;
      if (!summary.runId || !summary.results) {
        res.status(400).json({ error: 'Invalid test run summary: missing runId or results' });
        return;
      }
      await store.save(summary);
      res.json({ ok: true, runId: summary.runId });
    } catch (error) {
      res.status(500).json({
        error: 'Failed to store test results',
        message: error instanceof Error ? error.message : String(error),
      });
    }
  });

  // Retrieve all stored test results
  router.get('/', async (_req, res) => {
    try {
      const runs = await store.load();
      res.json({ runs });
    } catch (error) {
      res.status(500).json({
        error: 'Failed to load test results',
        message: error instanceof Error ? error.message : String(error),
      });
    }
  });

  // Clear all stored test results
  router.delete('/', async (_req, res) => {
    try {
      await store.clear();
      res.json({ ok: true });
    } catch (error) {
      res.status(500).json({
        error: 'Failed to clear test results',
        message: error instanceof Error ? error.message : String(error),
      });
    }
  });

  return router;
}
