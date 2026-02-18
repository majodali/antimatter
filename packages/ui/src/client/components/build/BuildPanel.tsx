import { useEffect, useState } from 'react';
import { Hammer, Play, Trash2 } from 'lucide-react';
import { ScrollArea } from '../ui/scroll-area';
import { Button } from '../ui/button';
import { BuildStatusItem } from './BuildStatusItem';
import { useBuildStore } from '@/stores/buildStore';
import { fetchBuildResults, executeBuild } from '@/lib/api';
import { onBuildUpdate } from '@/lib/ws';

export function BuildPanel() {
  const { targets, rules, results, setTargets, setRules, setResults, setResult, clearResults } = useBuildStore();
  const [isRunning, setIsRunning] = useState(false);

  // Load initial results and subscribe to WS updates
  useEffect(() => {
    fetchBuildResults()
      .then((res) => setResults(res))
      .catch((err) => console.error('Failed to load build results:', err));

    const unsub = onBuildUpdate((payload) => {
      setResult({
        targetId: payload.targetId,
        status: payload.status as any,
        startedAt: new Date().toISOString(),
        finishedAt: payload.status !== 'running' ? new Date().toISOString() : undefined as any,
        durationMs: 0,
        diagnostics: [],
      });
    });
    return unsub;
  }, []);

  const runningCount = Array.from(results.values()).filter(
    (r) => r.status === 'running'
  ).length;

  const successCount = Array.from(results.values()).filter(
    (r) => r.status === 'success' || r.status === 'cached'
  ).length;

  const failureCount = Array.from(results.values()).filter(
    (r) => r.status === 'failure'
  ).length;

  const handleRunAll = async () => {
    if (isRunning) return;
    setIsRunning(true);
    try {
      const targetList = Array.from(targets.values());
      const ruleList = Array.from(rules.values());
      if (targetList.length === 0) return;
      const buildResults = await executeBuild(targetList, ruleList);
      setResults(buildResults);
    } catch (err) {
      console.error('Build failed:', err);
    } finally {
      setIsRunning(false);
    }
  };

  const handleClear = () => {
    clearResults();
  };

  return (
    <div className="h-full flex flex-col bg-card">
      {/* Header */}
      <div className="px-3 py-2 border-b border-border flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Hammer className="h-4 w-4 text-primary" />
          <h3 className="text-sm font-medium">Build Status</h3>
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

      {/* Summary */}
      {results.size > 0 && (
        <div className="px-3 py-2 border-b border-border bg-accent/30">
          <div className="flex items-center gap-4 text-xs">
            <div className="flex items-center gap-1">
              <span className="text-muted-foreground">Total:</span>
              <span className="font-medium">{results.size}</span>
            </div>
            <div className="flex items-center gap-1">
              <span className="text-green-600 dark:text-green-500">✓</span>
              <span className="font-medium">{successCount}</span>
            </div>
            <div className="flex items-center gap-1">
              <span className="text-red-600 dark:text-red-500">✗</span>
              <span className="font-medium">{failureCount}</span>
            </div>
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
              Click the play button to run builds
            </p>
          </div>
        ) : (
          <div className="divide-y divide-border">
            {Array.from(results.values())
              .sort((a, b) => {
                // Sort by status priority (running > failure > success > cached > pending)
                const priority = {
                  running: 0,
                  failure: 1,
                  success: 2,
                  cached: 3,
                  pending: 4,
                  skipped: 5,
                };
                return priority[a.status] - priority[b.status];
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
    </div>
  );
}
