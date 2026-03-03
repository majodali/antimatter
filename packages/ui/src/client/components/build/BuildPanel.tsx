import { useEffect } from 'react';
import { Hammer, Settings } from 'lucide-react';
import { ScrollArea } from '../ui/scroll-area';
import { Button } from '../ui/button';
import { BuildStatusItem } from './BuildStatusItem';
import { BuildConfigEditor } from './BuildConfigEditor';
import { useBuildStore } from '@/stores/buildStore';
import { useProjectStore } from '@/stores/projectStore';
import { fetchBuildResults } from '@/lib/api';
import { onBuildUpdate } from '@/lib/ws';
import { eventLog } from '@/lib/eventLog';

export function BuildPanel() {
  const {
    rules,
    results,
    configMode,
    setResults,
    setResult,
    setConfigMode,
    loadConfig,
  } = useBuildStore();
  const currentProjectId = useProjectStore((s) => s.currentProjectId);

  // Load config and initial results on mount
  useEffect(() => {
    loadConfig(currentProjectId ?? undefined);

    fetchBuildResults(currentProjectId ?? undefined)
      .then((res) => setResults(res))
      .catch((err) => eventLog.error('build', 'Failed to load build results', String(err)));

    const unsub = onBuildUpdate((payload) => {
      setResult({
        ruleId: payload.ruleId,
        status: payload.status as any,
        startedAt: new Date().toISOString(),
        finishedAt: payload.status !== 'running' ? new Date().toISOString() : (undefined as any),
        durationMs: 0,
        diagnostics: [],
      });
    });
    return unsub;
  }, [currentProjectId]);

  const successCount = Array.from(results.values()).filter(
    (r) => r.status === 'success' || r.status === 'cached',
  ).length;
  const failureCount = Array.from(results.values()).filter((r) => r.status === 'failure').length;
  const runningCount = Array.from(results.values()).filter((r) => r.status === 'running').length;

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
            className={`h-7 w-7 ${configMode ? 'bg-accent' : ''}`}
            onClick={() => setConfigMode(!configMode)}
            title="Configure builds"
          >
            <Settings className="h-3.5 w-3.5" />
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
                  {rules.size === 0
                    ? 'Click the gear icon to configure build rules'
                    : 'Builds run automatically when files change'}
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
                    const rule = rules.get(result.ruleId);
                    return (
                      <BuildStatusItem
                        key={result.ruleId}
                        result={result}
                        ruleName={rule?.name}
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
