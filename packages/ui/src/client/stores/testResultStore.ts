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
  ProjectTestResult,
  ProjectTestRunSummary,
} from '../../shared/test-types.js';

// ---- Filters ----

export type TestStatusFilter = 'all' | 'pass' | 'fail' | 'not-run';

export interface TestResultFilters {
  readonly status: TestStatusFilter;
  readonly area: FeatureArea | 'all';
  readonly fixture: 'all' | 'api' | 'service' | 'browser';
}

// ---- Tab status for cross-tab test lifecycle ----

export type TestTabStatus = 'idle' | 'creating' | 'loading' | 'ready' | 'running' | 'cleaning';

// ---- Store interface ----

interface TestResultState {
  // State
  results: StoredTestResult[];
  runs: TestRunSummary[];
  isRunning: boolean;
  currentTestId: string | null;
  filters: TestResultFilters;
  expandedAreas: Set<string>;
  /** ID of the disposable test project (cross-tab mode). */
  testProjectId: string | null;
  /** Lifecycle status of the cross-tab test executor. */
  testTabStatus: TestTabStatus;
  /** Whether the "popup blocked" modal is visible. */
  showTestTabModal: boolean;
  /** Last error from a test run (for diagnosing silent failures). */
  lastError: string | null;
  /** Incremental logs streamed from the test tab during execution (testId → lines). */
  liveLogs: Record<string, string[]>;

  // Project test state (vitest/jest CLI-based)
  projectRunner: 'vitest' | 'jest' | 'unknown' | null;
  projectTestFiles: string[];
  projectResults: ProjectTestResult[];
  projectRunSummary: ProjectTestRunSummary | null;
  isDiscoveringProject: boolean;
  isRunningProject: boolean;

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
  setTestProjectId: (id: string | null) => void;
  setTestTabStatus: (status: TestTabStatus) => void;
  setShowTestTabModal: (show: boolean) => void;
  setLastError: (error: string | null) => void;
  appendLogs: (testId: string, logs: string[]) => void;

  // Project test actions
  setProjectRunner: (runner: 'vitest' | 'jest' | 'unknown' | null) => void;
  setProjectTestFiles: (files: string[]) => void;
  setProjectResults: (results: ProjectTestResult[]) => void;
  setProjectRunSummary: (summary: ProjectTestRunSummary | null) => void;
  setDiscoveringProject: (v: boolean) => void;
  setRunningProject: (v: boolean) => void;

  // Selectors
  getFilteredResults: () => StoredTestResult[];
  getResultsByArea: () => Map<string, StoredTestResult[]>;
  getSummary: () => { total: number; passed: number; failed: number; unsupported: number; notRun: number };
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
  testProjectId: null,
  testTabStatus: 'idle',
  showTestTabModal: false,
  lastError: null,
  liveLogs: {},
  projectRunner: null,
  projectTestFiles: [],
  projectResults: [],
  projectRunSummary: null,
  isDiscoveringProject: false,
  isRunningProject: false,

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

  clearResults: () => set({ results: [], runs: [], currentTestId: null, liveLogs: {} }),

  setTestProjectId: (id) => set({ testProjectId: id }),

  setTestTabStatus: (status) => set({ testTabStatus: status }),
  setShowTestTabModal: (show) => set({ showTestTabModal: show }),
  setLastError: (error) => set({ lastError: error }),

  appendLogs: (testId, logs) =>
    set((state) => ({
      liveLogs: {
        ...state.liveLogs,
        [testId]: [...(state.liveLogs[testId] ?? []), ...logs],
      },
    })),

  // ---- Project test actions ----

  setProjectRunner: (runner) => set({ projectRunner: runner }),
  setProjectTestFiles: (files) => set({ projectTestFiles: files }),
  setProjectResults: (results) => set({ projectResults: results }),
  setProjectRunSummary: (summary) => set({ projectRunSummary: summary }),
  setDiscoveringProject: (v) => set({ isDiscoveringProject: v }),
  setRunningProject: (v) => set({ isRunningProject: v }),

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
    const unsupported = results.filter((r) => r.status === 'unsupported').length;
    const failed = results.filter((r) => !r.pass && r.status !== 'unsupported').length;
    return {
      total: results.length,
      passed,
      failed,
      unsupported,
      notRun: 0, // Will be calculated when we know total test count
    };
  },

  getResultForTest: (testId: string) => {
    return get().results.find((r) => r.id === testId);
  },
}));
