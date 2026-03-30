/**
 * TestResultsPanel — bottom panel tab showing test results.
 *
 * Two modes:
 * 1. **Project tests** (vitest/jest) — discovers and runs project tests via CLI.
 *    Results grouped by file. Double-click navigates to test source.
 * 2. **Functional tests** (Antimatter's own) — cross-tab BroadcastChannel tests.
 *    Results grouped by feature area.
 *
 * Auto-detects mode: if project has vitest/jest, shows project tests.
 * Falls back to functional tests otherwise.
 */

import { useState, useCallback, useRef, useEffect } from 'react';
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
  Search,
  SkipForward,
} from 'lucide-react';
import { ScrollArea } from '../ui/scroll-area';
import { useTestResultStore, type TestStatusFilter, type TestTabStatus } from '@/stores/testResultStore';
import { getAllTestModules, getTestModulesByArea } from '@/lib/browser-test-runner';
import { TestOrchestrator } from '@/lib/test-orchestrator';
import { navigateToFile } from '@/lib/editor-navigation';
import { useProjectStore } from '@/stores/projectStore';
import type { StoredTestResult, ProjectTestResult } from '../../../shared/test-types.js';

// ---------------------------------------------------------------------------
// Shared components
// ---------------------------------------------------------------------------

function StatusIconFunctional({ result, isRunning }: { result?: StoredTestResult; isRunning?: boolean }) {
  if (isRunning) return <Loader2 className="h-3.5 w-3.5 text-blue-400 animate-spin" />;
  if (!result) return <Circle className="h-3.5 w-3.5 text-muted-foreground/40" />;
  if (result.status === 'unsupported') return <AlertTriangle className="h-3.5 w-3.5 text-amber-500" />;
  if (result.pass) return <CheckCircle2 className="h-3.5 w-3.5 text-green-500" />;
  return <XCircle className="h-3.5 w-3.5 text-red-500" />;
}

function ProjectStatusIcon({ status, isRunning }: { status?: string; isRunning?: boolean }) {
  if (isRunning) return <Loader2 className="h-3.5 w-3.5 text-blue-400 animate-spin" />;
  if (!status) return <Circle className="h-3.5 w-3.5 text-muted-foreground/40" />;
  if (status === 'pass') return <CheckCircle2 className="h-3.5 w-3.5 text-green-500" />;
  if (status === 'fail') return <XCircle className="h-3.5 w-3.5 text-red-500" />;
  if (status === 'skip') return <SkipForward className="h-3.5 w-3.5 text-muted-foreground" />;
  if (status === 'todo') return <Circle className="h-3.5 w-3.5 text-blue-400" />;
  return <Circle className="h-3.5 w-3.5 text-muted-foreground/40" />;
}

// ---------------------------------------------------------------------------
// Project Tests View
// ---------------------------------------------------------------------------

async function executeAutomation(command: string, params?: Record<string, unknown>): Promise<any> {
  const projectId = useProjectStore.getState().currentProjectId;
  if (!projectId) throw new Error('No project selected');
  const res = await fetch(`/workspace/${projectId}/api/automation/execute`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ command, params: params ?? {} }),
  });
  if (!res.ok) throw new Error(`Automation failed: ${res.status}`);
  return res.json();
}

function ProjectTestRow({ result }: { result: ProjectTestResult }) {
  const [expanded, setExpanded] = useState(false);
  const hasFail = result.status === 'fail' && result.failureMessage;

  return (
    <div className="border-b border-border/30 last:border-b-0">
      <div
        className={`flex items-center gap-2 px-3 py-1 text-xs cursor-pointer hover:bg-accent/50 ${
          result.status === 'fail' ? 'bg-red-500/5' : ''
        }`}
        onClick={() => hasFail && setExpanded(!expanded)}
        onDoubleClick={(e) => {
          e.stopPropagation();
          const line = result.status === 'fail' ? result.failureLine : undefined;
          navigateToFile(result.file, line);
        }}
      >
        {hasFail ? (
          <span className="flex-shrink-0 w-3">
            {expanded ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
          </span>
        ) : (
          <span className="w-3" />
        )}
        <ProjectStatusIcon status={result.status} />
        <span className={`flex-1 truncate ${result.status === 'fail' ? 'text-red-400' : 'text-foreground'}`}>
          {result.suite ? `${result.suite} > ${result.name}` : result.name}
        </span>
        <span className="text-muted-foreground flex-shrink-0 text-[10px]">
          {result.durationMs}ms
        </span>
      </div>
      {expanded && hasFail && (
        <div className="px-8 py-2 text-xs border-t border-border/30 font-mono text-red-400 bg-red-500/5">
          <div className="whitespace-pre-wrap">{result.failureMessage}</div>
          {result.failureStack && result.failureStack !== result.failureMessage && (
            <details className="mt-2 text-red-300">
              <summary className="cursor-pointer text-[10px] text-muted-foreground hover:text-foreground">Stack trace</summary>
              <pre className="mt-1 text-[10px] whitespace-pre-wrap opacity-80">{result.failureStack}</pre>
            </details>
          )}
        </div>
      )}
    </div>
  );
}

function ProjectFileGroup({
  file,
  results,
}: {
  file: string;
  results: ProjectTestResult[];
}) {
  const [collapsed, setCollapsed] = useState(false);
  const passCount = results.filter(r => r.status === 'pass').length;
  const failCount = results.filter(r => r.status === 'fail').length;
  const skipCount = results.filter(r => r.status === 'skip' || r.status === 'todo').length;

  return (
    <div>
      <div
        className="flex items-center gap-1.5 px-2 py-1 text-xs font-medium text-foreground bg-muted/50 sticky top-0 cursor-pointer hover:bg-muted"
        onClick={() => setCollapsed(!collapsed)}
        onDoubleClick={(e) => { e.stopPropagation(); navigateToFile(file); }}
      >
        {collapsed ? <ChevronRight className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
        <span className="truncate font-mono">{file}</span>
        <span className="ml-auto flex items-center gap-2 flex-shrink-0">
          {passCount > 0 && <span className="text-green-500 text-[10px]">{passCount} pass</span>}
          {failCount > 0 && <span className="text-red-500 text-[10px]">{failCount} fail</span>}
          {skipCount > 0 && <span className="text-muted-foreground text-[10px]">{skipCount} skip</span>}
          <span className="text-muted-foreground text-[10px]">{results.length} total</span>
        </span>
      </div>
      {!collapsed && results.map(r => <ProjectTestRow key={r.id} result={r} />)}
    </div>
  );
}

function ProjectTestsView() {
  const {
    projectRunner, projectTestFiles, projectResults, projectRunSummary,
    isDiscoveringProject, isRunningProject,
    setProjectRunner, setProjectTestFiles, setProjectResults,
    setProjectRunSummary, setDiscoveringProject, setRunningProject,
  } = useTestResultStore();

  const [error, setError] = useState<string | null>(null);
  const initialized = useRef(false);

  // Auto-discover on mount
  useEffect(() => {
    if (initialized.current) return;
    initialized.current = true;
    handleDiscover();
  }, []);

  const handleDiscover = useCallback(async () => {
    setError(null);
    setDiscoveringProject(true);
    try {
      const res = await executeAutomation('tests.discover-project');
      setProjectRunner(res.runner);
      setProjectTestFiles(res.tests ?? []);
      // Also load persisted results
      try {
        const stored = await executeAutomation('tests.project-results');
        if (stored.runs?.length > 0) {
          const latest = stored.runs[stored.runs.length - 1];
          setProjectRunSummary(latest);
          setProjectResults(latest.results ?? []);
        }
      } catch { /* no persisted results */ }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setDiscoveringProject(false);
    }
  }, []);

  const handleRunAll = useCallback(async () => {
    setError(null);
    setRunningProject(true);
    try {
      const summary = await executeAutomation('tests.run-project');
      setProjectRunSummary(summary);
      setProjectResults(summary.results ?? []);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setRunningProject(false);
    }
  }, []);

  const handleRunFile = useCallback(async (file: string) => {
    setError(null);
    setRunningProject(true);
    try {
      const summary = await executeAutomation('tests.run-project', { file });
      setProjectRunSummary(summary);
      setProjectResults(summary.results ?? []);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setRunningProject(false);
    }
  }, []);

  // Group results by file
  const byFile = new Map<string, ProjectTestResult[]>();
  for (const r of projectResults) {
    const list = byFile.get(r.file) ?? [];
    list.push(r);
    byFile.set(r.file, list);
  }
  // Also show discovered files that haven't been run
  for (const file of projectTestFiles) {
    if (!byFile.has(file)) {
      byFile.set(file, []);
    }
  }
  const sortedFiles = Array.from(byFile.entries()).sort((a, b) => a[0].localeCompare(b[0]));

  const summary = projectRunSummary;
  const totalTests = summary?.total ?? 0;
  const passedTests = summary?.passed ?? 0;
  const failedTests = summary?.failed ?? 0;

  return (
    <div className="h-full flex flex-col">
      {/* Toolbar */}
      <div className="flex items-center gap-2 px-3 py-1.5 border-b border-border bg-card/50 flex-shrink-0">
        <button
          className="flex items-center gap-1 px-2 py-0.5 text-xs font-medium rounded
            bg-green-600/20 text-green-400 hover:bg-green-600/30
            disabled:opacity-50 disabled:cursor-not-allowed"
          onClick={handleRunAll}
          disabled={isRunningProject || isDiscoveringProject}
        >
          {isRunningProject ? <Loader2 className="h-3 w-3 animate-spin" /> : <Play className="h-3 w-3" />}
          Run All
        </button>
        <button
          className="flex items-center gap-1 px-2 py-0.5 text-xs font-medium rounded
            bg-blue-600/20 text-blue-400 hover:bg-blue-600/30
            disabled:opacity-50 disabled:cursor-not-allowed"
          onClick={handleDiscover}
          disabled={isDiscoveringProject || isRunningProject}
        >
          {isDiscoveringProject ? <Loader2 className="h-3 w-3 animate-spin" /> : <Search className="h-3 w-3" />}
          Discover
        </button>

        {projectRunner && (
          <span className="text-[10px] text-muted-foreground bg-muted px-1.5 py-0.5 rounded">
            {projectRunner}
          </span>
        )}

        <div className="flex-1" />

        {/* Summary */}
        {summary && (
          <span className="text-[10px] text-muted-foreground flex-shrink-0">
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
            {summary.durationMs > 0 && (
              <>
                {' \u00b7 '}
                <span>{(summary.durationMs / 1000).toFixed(1)}s</span>
              </>
            )}
          </span>
        )}
      </div>

      {error && (
        <div className="px-3 py-1 text-xs text-red-400 bg-red-500/10 border-b border-border">{error}</div>
      )}

      <ScrollArea className="flex-1">
        {sortedFiles.length === 0 ? (
          <div className="h-full flex items-center justify-center text-muted-foreground text-sm py-8">
            {isDiscoveringProject
              ? 'Discovering tests...'
              : projectTestFiles.length === 0
                ? 'No test files found. Click "Discover" to scan the project.'
                : 'No test results yet. Click "Run All" to start.'}
          </div>
        ) : (
          <div className="py-1">
            {sortedFiles.map(([file, results]) => (
              <ProjectFileGroup key={file} file={file} results={results} />
            ))}
          </div>
        )}
      </ScrollArea>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Functional Tests View (existing Antimatter tests)
// ---------------------------------------------------------------------------

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

const TAB_STATUS_LABELS: Record<TestTabStatus, string> = {
  'idle': '',
  'creating': 'Creating test project...',
  'loading': 'Loading test tab...',
  'ready': 'Test tab ready',
  'running': 'Running tests...',
  'cleaning': 'Cleaning up...',
};

function FunctionalTestRow({
  testId, testName, result, isRunning, isSuiteRunning, onRunTest,
}: {
  testId: string; testName: string; result?: StoredTestResult;
  isRunning: boolean; isSuiteRunning: boolean; onRunTest: (id: string) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const hasDetail = result && (!result.pass || result.status === 'unsupported');
  const isUnsupported = result?.status === 'unsupported';

  return (
    <div className="border-b border-border/30 last:border-b-0" data-testid={`test-result-row-${testId}`}>
      <div
        className={`flex items-center gap-2 px-3 py-1 text-xs cursor-pointer hover:bg-accent/50 ${
          isRunning ? 'bg-blue-500/5' : ''} ${isUnsupported ? 'bg-amber-500/5' : ''}`}
        onClick={() => hasDetail && setExpanded(!expanded)}
      >
        <button
          className="flex-shrink-0 w-4 h-4 flex items-center justify-center rounded
            hover:bg-green-600/30 text-muted-foreground hover:text-green-400
            disabled:opacity-30 disabled:cursor-not-allowed"
          onClick={(e) => { e.stopPropagation(); onRunTest(testId); }}
          disabled={isSuiteRunning}
          title={`Run ${testId}`}
          data-testid={`test-run-btn-${testId}`}
        >
          <Play className="h-2.5 w-2.5" />
        </button>
        {hasDetail ? (
          <span className="flex-shrink-0 w-3">
            {expanded ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
          </span>
        ) : <span className="w-3" />}
        <StatusIconFunctional result={result} isRunning={isRunning} />
        <span className="text-muted-foreground flex-shrink-0 font-mono">{testId}</span>
        <span className={`flex-1 truncate ${isUnsupported ? 'text-amber-400' : 'text-foreground'}`}>{testName}</span>
        {isUnsupported && (
          <span className="text-[9px] font-medium text-amber-500 bg-amber-500/10 rounded px-1 flex-shrink-0">UNSUPPORTED</span>
        )}
        {result && <span className="text-muted-foreground flex-shrink-0 text-[10px]">{result.durationMs}ms</span>}
      </div>
      {expanded && result && hasDetail && (
        <div className={`px-10 py-2 text-xs border-t border-border/30 font-mono ${
          isUnsupported ? 'text-amber-400 bg-amber-500/5' : 'text-red-400 bg-red-500/5'}`}>
          <div>{result.detail}</div>
          {result.trace && (
            <div className="mt-2 space-y-1.5">
              {result.trace.errorStack && (
                <details className="text-red-300">
                  <summary className="cursor-pointer text-[10px] text-muted-foreground hover:text-foreground">Stack trace</summary>
                  <pre className="mt-1 text-[10px] whitespace-pre-wrap opacity-80">{result.trace.errorStack}</pre>
                </details>
              )}
              {result.trace.consoleLogs.length > 0 && (
                <details className="text-muted-foreground">
                  <summary className="cursor-pointer text-[10px] hover:text-foreground">Console ({result.trace.consoleLogs.length} lines)</summary>
                  <pre className="mt-1 text-[10px] whitespace-pre-wrap opacity-80 max-h-40 overflow-y-auto">{result.trace.consoleLogs.join('\n')}</pre>
                </details>
              )}
              {result.trace.domSnapshot && (
                <details className="text-muted-foreground">
                  <summary className="cursor-pointer text-[10px] hover:text-foreground">DOM snapshot</summary>
                  <pre className="mt-1 text-[10px] whitespace-pre-wrap opacity-80">{result.trace.domSnapshot}</pre>
                </details>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function FunctionalAreaGroup({
  area, tests, results, currentTestId, isRunning, onRunTest,
}: {
  area: string; tests: { id: string; name: string }[];
  results: Map<string, StoredTestResult>; currentTestId: string | null;
  isRunning: boolean; onRunTest: (id: string) => void;
}) {
  const [collapsed, setCollapsed] = useState(false);
  const passCount = tests.filter(t => results.get(t.id)?.pass).length;
  const failCount = tests.filter(t => { const r = results.get(t.id); return r && !r.pass && r.status !== 'unsupported'; }).length;
  const unsupportedCount = tests.filter(t => results.get(t.id)?.status === 'unsupported').length;

  return (
    <div>
      <div
        className="flex items-center gap-1.5 px-2 py-1 text-xs font-medium text-foreground bg-muted/50 sticky top-0 cursor-pointer hover:bg-muted"
        onClick={() => setCollapsed(!collapsed)}
      >
        {collapsed ? <ChevronRight className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
        <span className="truncate">{AREA_LABELS[area] ?? area}</span>
        <span className="ml-auto flex items-center gap-2 flex-shrink-0">
          {passCount > 0 && <span className="text-green-500 text-[10px]">{passCount} pass</span>}
          {failCount > 0 && <span className="text-red-500 text-[10px]">{failCount} fail</span>}
          {unsupportedCount > 0 && <span className="text-amber-500 text-[10px]">{unsupportedCount} unsupported</span>}
          <span className="text-muted-foreground text-[10px]">{tests.length} total</span>
        </span>
      </div>
      {!collapsed && tests.map(test => (
        <FunctionalTestRow
          key={test.id} testId={test.id} testName={test.name}
          result={results.get(test.id)}
          isRunning={isRunning && currentTestId === test.id}
          isSuiteRunning={isRunning} onRunTest={onRunTest}
        />
      ))}
    </div>
  );
}

function FunctionalTestsView() {
  const results = useTestResultStore(s => s.results);
  const isRunning = useTestResultStore(s => s.isRunning);
  const currentTestId = useTestResultStore(s => s.currentTestId);
  const filters = useTestResultStore(s => s.filters);
  const setFilter = useTestResultStore(s => s.setFilter);
  const testTabStatus = useTestResultStore(s => s.testTabStatus);

  const [error, setError] = useState<string | null>(null);
  const [keepTabOpen, setKeepTabOpen] = useState(false);
  const orchestratorRef = useRef<TestOrchestrator | null>(null);

  const resultMap = new Map<string, StoredTestResult>();
  for (const r of results) resultMap.set(r.id, r);

  const modulesByArea = getTestModulesByArea();
  const allModules = getAllTestModules();

  const filteredAreas: [string, { id: string; name: string }[]][] = [];
  for (const [area, tests] of modulesByArea) {
    if (filters.area !== 'all' && area !== filters.area) continue;
    const filteredTests = tests.filter(t => {
      const result = resultMap.get(t.id);
      if (filters.status === 'pass') return result?.pass === true;
      if (filters.status === 'fail') return result !== undefined && !result.pass && result.status !== 'unsupported';
      if (filters.status === 'not-run') return result === undefined;
      return true;
    });
    if (filteredTests.length > 0) {
      filteredAreas.push([area, filteredTests.map(t => ({ id: t.id, name: t.name }))]);
    }
  }

  const totalTests = allModules.length;
  const passedTests = results.filter(r => r.pass).length;
  const failedTests = results.filter(r => !r.pass && r.status !== 'unsupported').length;
  const unsupportedTests = results.filter(r => r.status === 'unsupported').length;
  const notRunTests = totalTests - results.length;

  const handleRunAll = useCallback(async () => {
    setError(null);
    try {
      if (!orchestratorRef.current) orchestratorRef.current = new TestOrchestrator();
      await orchestratorRef.current.runTests({ keepTabOpen });
    } catch (err) { setError(err instanceof Error ? err.message : String(err)); }
  }, [keepTabOpen]);

  const handleRunFailed = useCallback(async () => {
    setError(null);
    try {
      if (!orchestratorRef.current) orchestratorRef.current = new TestOrchestrator();
      const failedIds = results.filter(r => !r.pass && r.status !== 'unsupported').map(r => r.id);
      await orchestratorRef.current.runTests({ testIds: failedIds, keepTabOpen });
    } catch (err) { setError(err instanceof Error ? err.message : String(err)); }
  }, [results]);

  const handleRunSingle = useCallback(async (testId: string) => {
    setError(null);
    try {
      if (!orchestratorRef.current) orchestratorRef.current = new TestOrchestrator();
      await orchestratorRef.current.runTests({ testIds: [testId], keepTabOpen });
    } catch (err) { setError(err instanceof Error ? err.message : String(err)); }
  }, [keepTabOpen]);

  const allAreas = Array.from(modulesByArea.keys()).sort();

  return (
    <div className="h-full flex flex-col">
      <div className="flex items-center gap-2 px-3 py-1.5 border-b border-border bg-card/50 flex-shrink-0">
        <button className="flex items-center gap-1 px-2 py-0.5 text-xs font-medium rounded bg-green-600/20 text-green-400 hover:bg-green-600/30 disabled:opacity-50 disabled:cursor-not-allowed" onClick={handleRunAll} disabled={isRunning} data-testid="test-results-run-all-btn">
          {isRunning ? <Loader2 className="h-3 w-3 animate-spin" /> : <Play className="h-3 w-3" />}
          Run All
        </button>
        <button className="flex items-center gap-1 px-2 py-0.5 text-xs font-medium rounded bg-amber-600/20 text-amber-400 hover:bg-amber-600/30 disabled:opacity-50 disabled:cursor-not-allowed" onClick={handleRunFailed} disabled={isRunning || failedTests === 0} data-testid="test-results-run-failed-btn">
          <RotateCcw className="h-3 w-3" />
          Run Failed
        </button>
        <label className="flex items-center gap-1 text-[10px] text-muted-foreground cursor-pointer select-none">
          <input type="checkbox" checked={keepTabOpen} onChange={e => setKeepTabOpen(e.target.checked)} className="h-3 w-3" disabled={isRunning} />
          Keep tab
        </label>
        {testTabStatus !== 'idle' && (
          <span className="flex items-center gap-1 text-[10px] text-blue-400">
            <ExternalLink className="h-3 w-3" />
            {TAB_STATUS_LABELS[testTabStatus]}
          </span>
        )}
        <div className="flex-1" />
        <Filter className="h-3 w-3 text-muted-foreground" />
        <select className="text-[10px] bg-transparent border border-border rounded px-1 py-0.5 text-foreground" value={filters.status} onChange={e => setFilter('status', e.target.value as TestStatusFilter)} data-testid="test-results-status-filter">
          <option value="all">All</option>
          <option value="pass">Passed</option>
          <option value="fail">Failed</option>
          <option value="not-run">Not Run</option>
        </select>
        <select className="text-[10px] bg-transparent border border-border rounded px-1 py-0.5 text-foreground" value={filters.area} onChange={e => setFilter('area', e.target.value)} data-testid="test-results-area-filter">
          <option value="all">All Areas</option>
          {allAreas.map(area => <option key={area} value={area}>{AREA_LABELS[area] ?? area}</option>)}
        </select>
        <span className="text-[10px] text-muted-foreground flex-shrink-0" data-testid="test-results-summary">
          <span className="text-green-500">{passedTests}</span>{' / '}<span>{totalTests}</span>{' passing'}
          {failedTests > 0 && <>{' \u00b7 '}<span className="text-red-500">{failedTests} failed</span></>}
          {unsupportedTests > 0 && <>{' \u00b7 '}<span className="text-amber-500">{unsupportedTests} unsupported</span></>}
          {notRunTests > 0 && <>{' \u00b7 '}<span>{notRunTests} not run</span></>}
        </span>
      </div>
      {error && <div className="px-3 py-1 text-xs text-red-400 bg-red-500/10 border-b border-border">{error}</div>}
      <ScrollArea className="flex-1">
        {filteredAreas.length === 0 ? (
          <div className="h-full flex items-center justify-center text-muted-foreground text-sm py-8">
            {results.length === 0 ? 'No test results yet. Click "Run All" to start.' : 'No tests match current filters'}
          </div>
        ) : (
          <div className="py-1">
            {filteredAreas.map(([area, tests]) => (
              <FunctionalAreaGroup key={area} area={area} tests={tests} results={resultMap} currentTestId={currentTestId} isRunning={isRunning} onRunTest={handleRunSingle} />
            ))}
          </div>
        )}
      </ScrollArea>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main panel — auto-detect mode
// ---------------------------------------------------------------------------

export function TestResultsPanel() {
  const projectRunner = useTestResultStore(s => s.projectRunner);
  const projectResults = useTestResultStore(s => s.projectResults);
  const currentProjectId = useProjectStore(s => s.currentProjectId);
  const [mode, setMode] = useState<'auto' | 'project' | 'functional'>('auto');

  // Auto-detect: show project tests if runner detected, otherwise functional
  const effectiveMode = mode !== 'auto' ? mode
    : (projectRunner || projectResults.length > 0) ? 'project' : 'functional';

  // Mode toggle (only show if project has both options)
  const showToggle = projectRunner !== null;

  return (
    <div className="h-full flex flex-col">
      {showToggle && (
        <div className="flex items-center gap-1 px-3 py-1 border-b border-border bg-card/30 flex-shrink-0">
          <button
            className={`text-[10px] px-2 py-0.5 rounded ${effectiveMode === 'project' ? 'bg-accent text-foreground' : 'text-muted-foreground hover:text-foreground'}`}
            onClick={() => setMode('project')}
          >
            Project Tests
          </button>
          <button
            className={`text-[10px] px-2 py-0.5 rounded ${effectiveMode === 'functional' ? 'bg-accent text-foreground' : 'text-muted-foreground hover:text-foreground'}`}
            onClick={() => setMode('functional')}
          >
            Functional Tests
          </button>
        </div>
      )}
      <div className="flex-1 overflow-hidden">
        {effectiveMode === 'project' ? <ProjectTestsView /> : <FunctionalTestsView />}
      </div>
    </div>
  );
}
