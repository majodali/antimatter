/**
 * Test results API route.
 *
 * POST /api/test-results   — Store a test run summary
 * GET  /api/test-results   — Retrieve latest test results
 * DELETE /api/test-results — Clear stored results
 */

import { Router } from 'express';
import type { TestRunSummary } from '../../shared/test-types.js';

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
