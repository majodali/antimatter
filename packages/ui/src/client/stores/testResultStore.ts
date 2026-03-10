/**
 * Zustand store for functional test results.
 *
 * Tracks test run state, results, and provides filtering/grouping selectors.
 * Used by the Test Results panel and the in-browser test runner.
 */

import { create } from 'zustand';
import type {
  FeatureArea,
  TestModule,
  StoredTestResult,
  TestRunSummary,
} from '../../shared/test-types.js';

// ---- Filters ----

export type TestStatusFilter = 'all' | 'pass' | 'fail' | 'not-run';

export interface TestResultFilters {
  readonly status: TestStatusFilter;
  readonly area: FeatureArea | 'all';
  readonly fixture: 'all' | 'api' | 'service' | 'browser';
}

// ---- Store interface ----

interface TestResultState {
  // State
  results: StoredTestResult[];
  runs: TestRunSummary[];
  isRunning: boolean;
  currentTestId: string | null;
  filters: TestResultFilters;
  expandedAreas: Set<string>;

  // Actions — mutators
  setResults: (results: StoredTestResult[]) => void;
  addResult: (result: StoredTestResult) => void;
  addRun: (run: TestRunSummary) => void;
  setRunning: (running: boolean) => void;
  setCurrentTest: (testId: string | null) => void;
  setFilter: (key: keyof TestResultFilters, value: string) => void;
  toggleArea: (area: string) => void;
  expandAll: () => void;
  collapseAll: () => void;
  clearResults: () => void;

  // Selectors
  getFilteredResults: () => StoredTestResult[];
  getResultsByArea: () => Map<string, StoredTestResult[]>;
  getSummary: () => { total: number; passed: number; failed: number; notRun: number };
  getResultForTest: (testId: string) => StoredTestResult | undefined;
}

export const useTestResultStore = create<TestResultState>()((set, get) => ({
  // ---- Initial state ----
  results: [],
  runs: [],
  isRunning: false,
  currentTestId: null,
  filters: { status: 'all', area: 'all', fixture: 'all' },
  expandedAreas: new Set<string>(),

  // ---- Actions ----

  setResults: (results) => set({ results }),

  addResult: (result) =>
    set((state) => {
      // Replace existing result for the same test+fixture, or add new
      const existing = state.results.findIndex(
        (r) => r.id === result.id && r.fixture === result.fixture,
      );
      if (existing >= 0) {
        const updated = [...state.results];
        updated[existing] = result;
        return { results: updated };
      }
      return { results: [...state.results, result] };
    }),

  addRun: (run) =>
    set((state) => ({
      runs: [...state.runs, run].slice(-50), // keep last 50 runs
    })),

  setRunning: (running) => set({ isRunning: running }),

  setCurrentTest: (testId) => set({ currentTestId: testId }),

  setFilter: (key, value) =>
    set((state) => ({
      filters: { ...state.filters, [key]: value },
    })),

  toggleArea: (area) =>
    set((state) => {
      const expanded = new Set(state.expandedAreas);
      if (expanded.has(area)) {
        expanded.delete(area);
      } else {
        expanded.add(area);
      }
      return { expandedAreas: expanded };
    }),

  expandAll: () => {
    const areas = new Set<string>();
    for (const r of get().results) {
      areas.add(r.area);
    }
    set({ expandedAreas: areas });
  },

  collapseAll: () => set({ expandedAreas: new Set() }),

  clearResults: () => set({ results: [], runs: [], currentTestId: null }),

  // ---- Selectors ----

  getFilteredResults: () => {
    const { results, filters } = get();
    return results.filter((r) => {
      if (filters.status === 'pass' && !r.pass) return false;
      if (filters.status === 'fail' && r.pass) return false;
      if (filters.area !== 'all' && r.area !== filters.area) return false;
      if (filters.fixture !== 'all' && r.fixture !== filters.fixture) return false;
      return true;
    });
  },

  getResultsByArea: () => {
    const filtered = get().getFilteredResults();
    const byArea = new Map<string, StoredTestResult[]>();
    for (const r of filtered) {
      const list = byArea.get(r.area) ?? [];
      list.push(r);
      byArea.set(r.area, list);
    }
    return byArea;
  },

  getSummary: () => {
    const { results } = get();
    const passed = results.filter((r) => r.pass).length;
    const failed = results.filter((r) => !r.pass).length;
    return {
      total: results.length,
      passed,
      failed,
      notRun: 0, // Will be calculated when we know total test count
    };
  },

  getResultForTest: (testId: string) => {
    return get().results.find((r) => r.id === testId);
  },
}));
