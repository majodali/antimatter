import { useEffect, useState, useCallback } from 'react';
import { Rocket, Play, Trash2, Settings, Server } from 'lucide-react';
import { ScrollArea } from '../ui/scroll-area';
import { Button } from '../ui/button';
import { DeployStatusItem } from './DeployStatusItem';
import { DeployConfigEditor } from './DeployConfigEditor';
import { EnvironmentList } from './EnvironmentList';
import { useDeployStore } from '@/stores/deployStore';
import { useProjectStore } from '@/stores/projectStore';
import { fetchDeployResults, executeDeployStreaming } from '@/lib/api';
import { eventLog } from '@/lib/eventLog';
import { cn } from '@/lib/utils';

type DeployView = 'deploy' | 'environments';

export function DeployPanel() {
  const [view, setView] = useState<DeployView>('deploy');
  const {
    targets,
    modules,
    results,
    configMode,
    isDeploying,
    setResults,
    setResult,
    clearResults,
    appendOutput,
    clearOutput,
    setConfigMode,
    setDeploying,
    loadConfig,
  } = useDeployStore();
  const currentProjectId = useProjectStore((s) => s.currentProjectId);

  // Load config and initial results on mount
  useEffect(() => {
    loadConfig(currentProjectId ?? undefined);

    fetchDeployResults(currentProjectId ?? undefined)
      .then((res) => setResults(res))
      .catch((err) => eventLog.error('deploy', 'Failed to load deploy results', String(err)));
  }, [currentProjectId]);

  const handleDeployAll = useCallback(async () => {
    if (isDeploying) return;
    setDeploying(true);
    clearOutput();
    eventLog.info('deploy', 'Deployment started');
    try {
      await executeDeployStreaming(
        undefined,
        (event) => {
          switch (event.type) {
            case 'step-started':
              if (event.targetId || event.moduleId) {
                setResult({
                  targetId: event.targetId ?? event.moduleId ?? '',
                  moduleId: event.moduleId ?? '',
                  status: 'running',
                  steps: [],
                  startedAt: event.timestamp || new Date().toISOString(),
                });
              }
              break;
            case 'step-output':
              if ((event.targetId || event.moduleId) && event.output) {
                appendOutput(event.targetId ?? event.moduleId ?? '', event.output);
                const term = (window as any).__terminal;
                if (term) {
                  term.writeln(event.output);
                }
              }
              break;
            case 'step-completed':
              if (event.result) {
                setResult(event.result);
              }
              break;
            case 'deploy-complete':
              if (event.results) {
                setResults(event.results);
              }
              break;
            case 'deploy-error':
              eventLog.error('deploy', 'Deployment error', event.error);
              break;
          }
        },
        currentProjectId ?? undefined,
      );
    } catch (err) {
      eventLog.error('deploy', 'Deployment failed', String(err));
    } finally {
      eventLog.info('deploy', 'Deployment complete');
      setDeploying(false);
    }
  }, [isDeploying, currentProjectId]);

  const handleClear = () => {
    clearResults();
  };

  const runningCount = Array.from(results.values()).filter((r) => r.status === 'running').length;
  const successCount = Array.from(results.values()).filter((r) => r.status === 'success').length;
  const failureCount = Array.from(results.values()).filter((r) => r.status === 'failed').length;

  return (
    <div className="h-full flex flex-col bg-card">
      {/* Header */}
      <div className="px-3 py-2 border-b border-border flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Rocket className="h-4 w-4 text-primary" />
          {/* View toggle tabs */}
          <div className="flex items-center gap-0.5 bg-accent/40 rounded p-0.5">
            <button
              className={cn(
                'px-2 py-0.5 rounded text-xs font-medium transition-colors',
                view === 'deploy'
                  ? 'bg-background text-foreground shadow-sm'
                  : 'text-muted-foreground hover:text-foreground',
              )}
              onClick={() => setView('deploy')}
            >
              Deploy
            </button>
            <button
              className={cn(
                'px-2 py-0.5 rounded text-xs font-medium transition-colors',
                view === 'environments'
                  ? 'bg-background text-foreground shadow-sm'
                  : 'text-muted-foreground hover:text-foreground',
              )}
              onClick={() => setView('environments')}
            >
              Environments
            </button>
          </div>
          {view === 'deploy' && runningCount > 0 && (
            <span className="text-xs text-yellow-600 dark:text-yellow-500 animate-pulse">
              {runningCount} running
            </span>
          )}
        </div>
        {view === 'deploy' && (
          <div className="flex items-center gap-1">
            <Button
              variant="ghost"
              size="icon"
              className={`h-7 w-7 ${configMode ? 'bg-accent' : ''}`}
              onClick={() => setConfigMode(!configMode)}
              title="Configure deployments"
            >
              <Settings className="h-3.5 w-3.5" />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7"
              onClick={handleDeployAll}
              disabled={isDeploying}
              title="Deploy all targets"
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
        )}
      </div>

      {view === 'environments' ? (
        <EnvironmentList />
      ) : configMode ? (
        <DeployConfigEditor />
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
                <Rocket className="h-12 w-12 text-muted-foreground mb-3 opacity-50" />
                <p className="text-sm text-muted-foreground">No deployment results yet</p>
                <p className="text-xs text-muted-foreground mt-1">
                  {targets.size === 0
                    ? 'Click the gear icon to configure deployment targets'
                    : 'Click the play button to deploy'}
                </p>
              </div>
            ) : (
              <div className="divide-y divide-border">
                {Array.from(results.values())
                  .sort((a, b) => {
                    const priority: Record<string, number> = {
                      running: 0,
                      failed: 1,
                      success: 2,
                      skipped: 3,
                    };
                    return (priority[a.status] ?? 4) - (priority[b.status] ?? 4);
                  })
                  .map((result) => {
                    const mod = modules.get(result.moduleId);
                    return (
                      <DeployStatusItem
                        key={result.targetId}
                        result={result}
                        moduleName={mod?.name}
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
