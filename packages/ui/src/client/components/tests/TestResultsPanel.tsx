/**
 * TestResultsPanel — bottom panel tab showing functional test results.
 *
 * Layout:
 * - Toolbar: Run All / Run Failed buttons, tab status, filter dropdowns, summary bar
 * - Results tree: grouped by area (collapsible), each test shows pass/fail/unsupported + duration
 * - Expandable detail on failure or unsupported
 * - Currently-running indicator (spinner on active test)
 *
 * "Run All" triggers the TestOrchestrator which opens a disposable test project
 * in a separate tab, runs tests via BroadcastChannel, and streams results back.
 */

import { useState, useCallback, useRef } from 'react';
import {
  Play,
  RotateCcw,
  CheckCircle2,
  XCircle,
  Circle,
  ChevronDown,
  ChevronRight,
  Loader2,
  Filter,
  AlertTriangle,
  ExternalLink,
} from 'lucide-react';
import { ScrollArea } from '../ui/scroll-area';
import { useTestResultStore, type TestStatusFilter, type TestTabStatus } from '@/stores/testResultStore';
import { getAllTestModules, getTestModulesByArea } from '@/lib/browser-test-runner';
import { TestOrchestrator } from '@/lib/test-orchestrator';
import type { StoredTestResult } from '../../../shared/test-types.js';

// ---- Area display names ----

const AREA_LABELS: Record<string, string> = {
  'editor': 'Code Editor',
  'file-explorer': 'File Explorer',
  'problems': 'Problems Panel',
  'workflow': 'Workflow Engine',
  'build': 'Build System',
  'deploy': 'Deployment',
  'git': 'Git Integration',
  'chat': 'AI Chat',
  'terminal': 'Terminal',
  'widget': 'Widget System',
  'auth': 'Authentication',
  'secrets': 'Secrets Management',
  'infra': 'Infrastructure',
  'workspace': 'Workspace Server',
  'logging': 'Logging',
  'test-infra': 'Test Infrastructure',
};

// ---- Tab status display ----

const TAB_STATUS_LABELS: Record<TestTabStatus, string> = {
  'idle': '',
  'creating': 'Creating test project...',
  'loading': 'Loading test tab...',
  'ready': 'Test tab ready',
  'running': 'Running tests...',
  'cleaning': 'Cleaning up...',
};

// ---- Components ----

function StatusIcon({ result, isRunning }: { result?: StoredTestResult; isRunning?: boolean }) {
  if (isRunning) {
    return <Loader2 className="h-3.5 w-3.5 text-blue-400 animate-spin" />;
  }
  if (!result) {
    return <Circle className="h-3.5 w-3.5 text-muted-foreground/40" />;
  }
  if (result.status === 'unsupported') {
    return <AlertTriangle className="h-3.5 w-3.5 text-amber-500" />;
  }
  if (result.pass) {
    return <CheckCircle2 className="h-3.5 w-3.5 text-green-500" />;
  }
  return <XCircle className="h-3.5 w-3.5 text-red-500" />;
}

function TestRow({
  testId,
  testName,
  result,
  isRunning,
}: {
  testId: string;
  testName: string;
  result?: StoredTestResult;
  isRunning: boolean;
}) {
  const [expanded, setExpanded] = useState(false);
  const hasDetail = result && (!result.pass || result.status === 'unsupported');
  const isUnsupported = result?.status === 'unsupported';

  return (
    <div className="border-b border-border/30 last:border-b-0" data-testid={`test-result-row-${testId}`}>
      <div
        className={`flex items-center gap-2 px-3 py-1 text-xs cursor-pointer hover:bg-accent/50 ${
          isRunning ? 'bg-blue-500/5' : ''
        } ${isUnsupported ? 'bg-amber-500/5' : ''}`}
        onClick={() => hasDetail && setExpanded(!expanded)}
      >
        {hasDetail ? (
          <span className="flex-shrink-0 w-3">
            {expanded ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
          </span>
        ) : (
          <span className="w-3" />
        )}
        <StatusIcon result={result} isRunning={isRunning} />
        <span className="text-muted-foreground flex-shrink-0 font-mono">{testId}</span>
        <span className={`flex-1 truncate ${isUnsupported ? 'text-amber-400' : 'text-foreground'}`}>
          {testName}
        </span>
        {isUnsupported && (
          <span className="text-[9px] font-medium text-amber-500 bg-amber-500/10 rounded px-1 flex-shrink-0">
            UNSUPPORTED
          </span>
        )}
        {result && (
          <span className="text-muted-foreground flex-shrink-0 text-[10px]">
            {result.durationMs}ms
          </span>
        )}
      </div>
      {expanded && result && hasDetail && (
        <div
          className={`px-10 py-2 text-xs border-t border-border/30 font-mono ${
            isUnsupported
              ? 'text-amber-400 bg-amber-500/5'
              : 'text-red-400 bg-red-500/5'
          }`}
        >
          {result.detail}
        </div>
      )}
    </div>
  );
}

function AreaGroup({
  area,
  tests,
  results,
  currentTestId,
  isRunning,
}: {
  area: string;
  tests: { id: string; name: string }[];
  results: Map<string, StoredTestResult>;
  currentTestId: string | null;
  isRunning: boolean;
}) {
  const [collapsed, setCollapsed] = useState(false);
  const passCount = tests.filter((t) => results.get(t.id)?.pass).length;
  const failCount = tests.filter((t) => {
    const r = results.get(t.id);
    return r && !r.pass && r.status !== 'unsupported';
  }).length;
  const unsupportedCount = tests.filter((t) => results.get(t.id)?.status === 'unsupported').length;
  const totalCount = tests.length;

  return (
    <div>
      {/* Area header */}
      <div
        className="flex items-center gap-1.5 px-2 py-1 text-xs font-medium text-foreground bg-muted/50 sticky top-0 cursor-pointer hover:bg-muted"
        onClick={() => setCollapsed(!collapsed)}
      >
        {collapsed ? (
          <ChevronRight className="h-3.5 w-3.5" />
        ) : (
          <ChevronDown className="h-3.5 w-3.5" />
        )}
        <span className="truncate">{AREA_LABELS[area] ?? area}</span>
        <span className="ml-auto flex items-center gap-2 flex-shrink-0">
          {passCount > 0 && (
            <span className="text-green-500 text-[10px]">{passCount} pass</span>
          )}
          {failCount > 0 && (
            <span className="text-red-500 text-[10px]">{failCount} fail</span>
          )}
          {unsupportedCount > 0 && (
            <span className="text-amber-500 text-[10px]">{unsupportedCount} unsupported</span>
          )}
          <span className="text-muted-foreground text-[10px]">{totalCount} total</span>
        </span>
      </div>
      {/* Test rows */}
      {!collapsed &&
        tests.map((test) => (
          <TestRow
            key={test.id}
            testId={test.id}
            testName={test.name}
            result={results.get(test.id)}
            isRunning={isRunning && currentTestId === test.id}
          />
        ))}
    </div>
  );
}

// ---- Main panel ----

export function TestResultsPanel() {
  const results = useTestResultStore((s) => s.results);
  const isRunning = useTestResultStore((s) => s.isRunning);
  const currentTestId = useTestResultStore((s) => s.currentTestId);
  const filters = useTestResultStore((s) => s.filters);
  const setFilter = useTestResultStore((s) => s.setFilter);
  const testTabStatus = useTestResultStore((s) => s.testTabStatus);

  const [error, setError] = useState<string | null>(null);
  const orchestratorRef = useRef<TestOrchestrator | null>(null);

  // Build results lookup map
  const resultMap = new Map<string, StoredTestResult>();
  for (const r of results) {
    resultMap.set(r.id, r);
  }

  // Get all test modules grouped by area
  const modulesByArea = getTestModulesByArea();
  const allModules = getAllTestModules();

  // Apply filters to determine which areas/tests to show
  const filteredAreas: [string, { id: string; name: string }[]][] = [];
  for (const [area, tests] of modulesByArea) {
    if (filters.area !== 'all' && area !== filters.area) continue;

    const filteredTests = tests.filter((t) => {
      const result = resultMap.get(t.id);
      if (filters.status === 'pass') return result?.pass === true;
      if (filters.status === 'fail') return result !== undefined && !result.pass && result.status !== 'unsupported';
      if (filters.status === 'not-run') return result === undefined;
      return true;
    });

    if (filteredTests.length > 0) {
      filteredAreas.push([area, filteredTests.map((t) => ({ id: t.id, name: t.name }))]);
    }
  }

  // Summary counts
  const totalTests = allModules.length;
  const passedTests = results.filter((r) => r.pass).length;
  const failedTests = results.filter((r) => !r.pass && r.status !== 'unsupported').length;
  const unsupportedTests = results.filter((r) => r.status === 'unsupported').length;
  const notRunTests = totalTests - results.length;

  // Run actions — cross-tab via TestOrchestrator
  const handleRunAll = useCallback(async () => {
    setError(null);
    try {
      if (!orchestratorRef.current) {
        orchestratorRef.current = new TestOrchestrator();
      }
      await orchestratorRef.current.runTests();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }, []);

  const handleRunFailed = useCallback(async () => {
    setError(null);
    try {
      if (!orchestratorRef.current) {
        orchestratorRef.current = new TestOrchestrator();
      }
      const failedIds = results
        .filter((r) => !r.pass && r.status !== 'unsupported')
        .map((r) => r.id);
      await orchestratorRef.current.runTests({ testIds: failedIds });
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }, [results]);

  // Get unique areas for filter dropdown
  const allAreas = Array.from(modulesByArea.keys()).sort();

  return (
    <div className="h-full flex flex-col">
      {/* Toolbar */}
      <div className="flex items-center gap-2 px-3 py-1.5 border-b border-border bg-card/50 flex-shrink-0">
        {/* Run buttons */}
        <button
          className="flex items-center gap-1 px-2 py-0.5 text-xs font-medium rounded
            bg-green-600/20 text-green-400 hover:bg-green-600/30
            disabled:opacity-50 disabled:cursor-not-allowed"
          onClick={handleRunAll}
          disabled={isRunning}
          title="Run all tests (opens disposable test project in new tab)"
          data-testid="test-results-run-all-btn"
        >
          {isRunning ? (
            <Loader2 className="h-3 w-3 animate-spin" />
          ) : (
            <Play className="h-3 w-3" />
          )}
          Run All
        </button>
        <button
          className="flex items-center gap-1 px-2 py-0.5 text-xs font-medium rounded
            bg-amber-600/20 text-amber-400 hover:bg-amber-600/30
            disabled:opacity-50 disabled:cursor-not-allowed"
          onClick={handleRunFailed}
          disabled={isRunning || failedTests === 0}
          title="Re-run failed tests"
          data-testid="test-results-run-failed-btn"
        >
          <RotateCcw className="h-3 w-3" />
          Run Failed
        </button>

        {/* Tab status indicator */}
        {testTabStatus !== 'idle' && (
          <span className="flex items-center gap-1 text-[10px] text-blue-400">
            <ExternalLink className="h-3 w-3" />
            {TAB_STATUS_LABELS[testTabStatus]}
          </span>
        )}

        {/* Spacer */}
        <div className="flex-1" />

        {/* Filters */}
        <Filter className="h-3 w-3 text-muted-foreground" />
        <select
          className="text-[10px] bg-transparent border border-border rounded px-1 py-0.5 text-foreground"
          value={filters.status}
          onChange={(e) => setFilter('status', e.target.value as TestStatusFilter)}
          data-testid="test-results-status-filter"
        >
          <option value="all">All</option>
          <option value="pass">Passed</option>
          <option value="fail">Failed</option>
          <option value="not-run">Not Run</option>
        </select>
        <select
          className="text-[10px] bg-transparent border border-border rounded px-1 py-0.5 text-foreground"
          value={filters.area}
          onChange={(e) => setFilter('area', e.target.value)}
          data-testid="test-results-area-filter"
        >
          <option value="all">All Areas</option>
          {allAreas.map((area) => (
            <option key={area} value={area}>
              {AREA_LABELS[area] ?? area}
            </option>
          ))}
        </select>

        {/* Summary */}
        <span className="text-[10px] text-muted-foreground flex-shrink-0" data-testid="test-results-summary">
          <span className="text-green-500">{passedTests}</span>
          {' / '}
          <span>{totalTests}</span>
          {' passing'}
          {failedTests > 0 && (
            <>
              {' \u00b7 '}
              <span className="text-red-500">{failedTests} failed</span>
            </>
          )}
          {unsupportedTests > 0 && (
            <>
              {' \u00b7 '}
              <span className="text-amber-500">{unsupportedTests} unsupported</span>
            </>
          )}
          {notRunTests > 0 && (
            <>
              {' \u00b7 '}
              <span>{notRunTests} not run</span>
            </>
          )}
        </span>
      </div>

      {/* Error banner */}
      {error && (
        <div className="px-3 py-1 text-xs text-red-400 bg-red-500/10 border-b border-border">
          {error}
        </div>
      )}

      {/* Results tree */}
      <ScrollArea className="flex-1">
        {filteredAreas.length === 0 ? (
          <div className="h-full flex items-center justify-center text-muted-foreground text-sm py-8">
            {results.length === 0 ? 'No test results yet. Click "Run All" to start.' : 'No tests match current filters'}
          </div>
        ) : (
          <div className="py-1">
            {filteredAreas.map(([area, tests]) => (
              <AreaGroup
                key={area}
                area={area}
                tests={tests}
                results={resultMap}
                currentTestId={currentTestId}
                isRunning={isRunning}
              />
            ))}
          </div>
        )}
      </ScrollArea>
    </div>
  );
}
