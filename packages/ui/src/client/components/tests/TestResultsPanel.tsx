/**
 * TestResultsPanel — bottom panel tab showing functional test results.
 *
 * Layout:
 * - Toolbar: Run All / Run Failed buttons, filter dropdowns, summary bar
 * - Results tree: grouped by area (collapsible), each test shows pass/fail + duration
 * - Expandable detail on failure
 * - Currently-running indicator (spinner on active test)
 */

import { useState, useCallback } from 'react';
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
} from 'lucide-react';
import { ScrollArea } from '../ui/scroll-area';
import { useTestResultStore, type TestStatusFilter } from '@/stores/testResultStore';
import { runBrowserTests, getAllTestModules, getTestModulesByArea } from '@/lib/browser-test-runner';
import type { StoredTestResult } from '../../../shared/test-types.js';
import type { FeatureArea } from '../../../shared/test-types.js';

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

// ---- Components ----

function StatusIcon({ result, isRunning }: { result?: StoredTestResult; isRunning?: boolean }) {
  if (isRunning) {
    return <Loader2 className="h-3.5 w-3.5 text-blue-400 animate-spin" />;
  }
  if (!result) {
    return <Circle className="h-3.5 w-3.5 text-muted-foreground/40" />;
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
  const hasFailed = result && !result.pass;

  return (
    <div className="border-b border-border/30 last:border-b-0">
      <div
        className={`flex items-center gap-2 px-3 py-1 text-xs cursor-pointer hover:bg-accent/50 ${
          isRunning ? 'bg-blue-500/5' : ''
        }`}
        onClick={() => hasFailed && setExpanded(!expanded)}
      >
        {hasFailed ? (
          <span className="flex-shrink-0 w-3">
            {expanded ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
          </span>
        ) : (
          <span className="w-3" />
        )}
        <StatusIcon result={result} isRunning={isRunning} />
        <span className="text-muted-foreground flex-shrink-0 font-mono">{testId}</span>
        <span className="flex-1 truncate text-foreground">{testName}</span>
        {result && (
          <span className="text-muted-foreground flex-shrink-0 text-[10px]">
            {result.durationMs}ms
          </span>
        )}
      </div>
      {expanded && result && !result.pass && (
        <div className="px-10 py-2 text-xs text-red-400 bg-red-500/5 border-t border-border/30 font-mono">
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
    return r && !r.pass;
  }).length;
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

  const [error, setError] = useState<string | null>(null);

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
      if (filters.status === 'fail') return result !== undefined && !result.pass;
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
  const failedTests = results.filter((r) => !r.pass).length;
  const notRunTests = totalTests - results.length;

  // Run actions
  const handleRunAll = useCallback(async () => {
    setError(null);
    try {
      await runBrowserTests();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }, []);

  const handleRunFailed = useCallback(async () => {
    setError(null);
    try {
      await runBrowserTests(undefined, { failedOnly: true });
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }, []);

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
          title="Run all tests"
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
        >
          <RotateCcw className="h-3 w-3" />
          Run Failed
        </button>

        {/* Spacer */}
        <div className="flex-1" />

        {/* Filters */}
        <Filter className="h-3 w-3 text-muted-foreground" />
        <select
          className="text-[10px] bg-transparent border border-border rounded px-1 py-0.5 text-foreground"
          value={filters.status}
          onChange={(e) => setFilter('status', e.target.value as TestStatusFilter)}
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
        >
          <option value="all">All Areas</option>
          {allAreas.map((area) => (
            <option key={area} value={area}>
              {AREA_LABELS[area] ?? area}
            </option>
          ))}
        </select>

        {/* Summary */}
        <span className="text-[10px] text-muted-foreground flex-shrink-0">
          <span className="text-green-500">{passedTests}</span>
          {' / '}
          <span>{totalTests}</span>
          {' passing'}
          {failedTests > 0 && (
            <>
              {' · '}
              <span className="text-red-500">{failedTests} failed</span>
            </>
          )}
          {notRunTests > 0 && (
            <>
              {' · '}
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
