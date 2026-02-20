import { useEffect, useState, useRef, useCallback } from 'react';
import { Hammer, Play, Trash2, Settings, Eye, EyeOff } from 'lucide-react';
import { ScrollArea } from '../ui/scroll-area';
import { Button } from '../ui/button';
import { BuildStatusItem } from './BuildStatusItem';
import { BuildConfigEditor } from './BuildConfigEditor';
import { useBuildStore } from '@/stores/buildStore';
import { useProjectStore } from '@/stores/projectStore';
import {
  fetchBuildResults,
  executeBuildStreaming,
  fetchBuildChanges,
} from '@/lib/api';
import { onBuildUpdate } from '@/lib/ws';

export function BuildPanel() {
  const {
    targets,
    rules,
    results,
    configMode,
    watchMode,
    setResults,
    setResult,
    clearResults,
    appendOutput,
    clearOutput,
    setConfigMode,
    toggleWatchMode,
    loadConfig,
  } = useBuildStore();
  const currentProjectId = useProjectStore((s) => s.currentProjectId);
  const [isRunning, setIsRunning] = useState(false);
  const watchIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Load config and initial results on mount
  useEffect(() => {
    loadConfig(currentProjectId ?? undefined);

    fetchBuildResults(currentProjectId ?? undefined)
      .then((res) => setResults(res))
      .catch((err) => console.error('Failed to load build results:', err));

    const unsub = onBuildUpdate((payload) => {
      setResult({
        targetId: payload.targetId,
        status: payload.status as any,
        startedAt: new Date().toISOString(),
        finishedAt: payload.status !== 'running' ? new Date().toISOString() : (undefined as any),
        durationMs: 0,
        diagnostics: [],
      });
    });
    return unsub;
  }, [currentProjectId]);

  // Watch mode polling
  useEffect(() => {
    if (watchMode && !isRunning) {
      watchIntervalRef.current = setInterval(async () => {
        try {
          const stale = await fetchBuildChanges(currentProjectId ?? undefined);
          if (stale.length > 0) {
            handleRunAll();
          }
        } catch (err) {
          console.error('Watch poll failed:', err);
        }
      }, 5000);
    }

    return () => {
      if (watchIntervalRef.current) {
        clearInterval(watchIntervalRef.current);
        watchIntervalRef.current = null;
      }
    };
  }, [watchMode, isRunning, currentProjectId]);

  const handleRunAll = useCallback(async () => {
    if (isRunning) return;
    setIsRunning(true);
    clearOutput();
    try {
      const targetList = Array.from(targets.values());
      const ruleList = Array.from(rules.values());

      // Use streaming API
      await executeBuildStreaming(
        targetList,
        ruleList,
        (event) => {
          switch (event.type) {
            case 'target-started':
              if (event.targetId) {
                setResult({
                  targetId: event.targetId,
                  status: 'running',
                  startedAt: event.timestamp || new Date().toISOString(),
                  diagnostics: [],
                });
              }
              break;
            case 'target-output':
              if (event.targetId && event.line) {
                appendOutput(event.targetId, event.line);
                // Write to terminal if available
                const term = (window as any).__terminal;
                if (term) {
                  term.writeln(event.line);
                }
              }
              break;
            case 'target-completed':
              if (event.result) {
                setResult(event.result);
              }
              break;
            case 'build-complete':
              if (event.results) {
                setResults(event.results);
              }
              break;
            case 'build-error':
              console.error('Build error:', event.error);
              break;
          }
        },
        currentProjectId ?? undefined,
      );
    } catch (err) {
      console.error('Build failed:', err);
    } finally {
      setIsRunning(false);
    }
  }, [isRunning, targets, rules, currentProjectId]);

  const handleClear = () => {
    clearResults();
  };

  const runningCount = Array.from(results.values()).filter((r) => r.status === 'running').length;
  const successCount = Array.from(results.values()).filter(
    (r) => r.status === 'success' || r.status === 'cached',
  ).length;
  const failureCount = Array.from(results.values()).filter((r) => r.status === 'failure').length;

  return (
    <div className="h-full flex flex-col bg-card">
      {/* Header */}
      <div className="px-3 py-2 border-b border-border flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Hammer className="h-4 w-4 text-primary" />
          <h3 className="text-sm font-medium">Build</h3>
          {runningCount > 0 && (
            <span className="text-xs text-yellow-600 dark:text-yellow-500 animate-pulse">
              {runningCount} running
            </span>
          )}
        </div>
        <div className="flex items-center gap-1">
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7"
            onClick={toggleWatchMode}
            title={watchMode ? 'Disable watch mode' : 'Enable watch mode'}
          >
            {watchMode ? (
              <EyeOff className="h-3.5 w-3.5 text-primary" />
            ) : (
              <Eye className="h-3.5 w-3.5" />
            )}
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className={`h-7 w-7 ${configMode ? 'bg-accent' : ''}`}
            onClick={() => setConfigMode(!configMode)}
            title="Configure builds"
          >
            <Settings className="h-3.5 w-3.5" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7"
            onClick={handleRunAll}
            disabled={isRunning}
            title="Run all targets"
          >
            <Play className="h-3.5 w-3.5" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7"
            onClick={handleClear}
            title="Clear results"
          >
            <Trash2 className="h-3.5 w-3.5" />
          </Button>
        </div>
      </div>

      {configMode ? (
        <BuildConfigEditor />
      ) : (
        <>
          {/* Summary */}
          {results.size > 0 && (
            <div className="px-3 py-2 border-b border-border bg-accent/30">
              <div className="flex items-center gap-4 text-xs">
                <div className="flex items-center gap-1">
                  <span className="text-muted-foreground">Total:</span>
                  <span className="font-medium">{results.size}</span>
                </div>
                <div className="flex items-center gap-1">
                  <span className="text-green-600 dark:text-green-500">&#10003;</span>
                  <span className="font-medium">{successCount}</span>
                </div>
                <div className="flex items-center gap-1">
                  <span className="text-red-600 dark:text-red-500">&#10007;</span>
                  <span className="font-medium">{failureCount}</span>
                </div>
                {watchMode && (
                  <span className="text-xs text-primary ml-auto">Watch active</span>
                )}
              </div>
            </div>
          )}

          {/* Results list */}
          <ScrollArea className="flex-1">
            {results.size === 0 ? (
              <div className="flex flex-col items-center justify-center h-full text-center p-4">
                <Hammer className="h-12 w-12 text-muted-foreground mb-3 opacity-50" />
                <p className="text-sm text-muted-foreground">No build results yet</p>
                <p className="text-xs text-muted-foreground mt-1">
                  {targets.size === 0
                    ? 'Click the gear icon to configure build targets'
                    : 'Click the play button to run builds'}
                </p>
              </div>
            ) : (
              <div className="divide-y divide-border">
                {Array.from(results.values())
                  .sort((a, b) => {
                    const priority: Record<string, number> = {
                      running: 0,
                      failure: 1,
                      success: 2,
                      cached: 3,
                      pending: 4,
                      skipped: 5,
                    };
                    return (priority[a.status] ?? 6) - (priority[b.status] ?? 6);
                  })
                  .map((result) => {
                    const target = targets.get(result.targetId);
                    const rule = target && rules.get(target.ruleId);
                    return (
                      <BuildStatusItem
                        key={result.targetId}
                        result={result}
                        targetName={rule?.name}
                      />
                    );
                  })}
              </div>
            )}
          </ScrollArea>
        </>
      )}
    </div>
  );
}
