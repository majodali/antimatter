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
  CheckCircle2,
  XCircle,
  Circle,
  ChevronDown,
  ChevronRight,
  Loader2,
  Search,
  SkipForward,
} from 'lucide-react';
import { ScrollArea } from '../ui/scroll-area';
import { useTestResultStore } from '@/stores/testResultStore';
import { navigateToFile } from '@/lib/editor-navigation';
import { useProjectStore } from '@/stores/projectStore';
import type { ProjectTestResult } from '../../../shared/test-types.js';

// ---------------------------------------------------------------------------
// Shared components
// ---------------------------------------------------------------------------

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
// Main export — always shows project tests (CLI-based discovery).
// Functional tests (Antimatter's own) continue to run via /tests URL.
// ---------------------------------------------------------------------------

export function TestResultsPanel() {
  return <ProjectTestsView />;
}
