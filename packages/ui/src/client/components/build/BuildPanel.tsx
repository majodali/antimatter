import { useEffect } from 'react';
import { Hammer, Play, Trash2, RefreshCw } from 'lucide-react';
import { ScrollArea } from '../ui/scroll-area';
import { Button } from '../ui/button';
import { BuildStatusItem } from './BuildStatusItem';
import { useBuildStore } from '@/stores/buildStore';
import type { BuildResult, BuildTarget, BuildRule } from '@antimatter/project-model';

export function BuildPanel() {
  const { targets, rules, results, setTargets, setRules, setResults, clearResults } = useBuildStore();

  // Initialize with demo data
  useEffect(() => {
    // Demo build rules
    const demoRules: BuildRule[] = [
      {
        id: 'compile-ts',
        name: 'Compile TypeScript',
        inputs: ['src/**/*.ts', 'src/**/*.tsx'],
        outputs: ['dist/**/*.js'],
        command: 'tsc',
      },
      {
        id: 'bundle',
        name: 'Bundle Application',
        inputs: ['dist/**/*.js'],
        outputs: ['dist/bundle.js'],
        command: 'vite build',
        dependsOn: ['compile-ts'],
      },
      {
        id: 'test',
        name: 'Run Tests',
        inputs: ['src/**/*.test.ts'],
        outputs: [],
        command: 'vitest run',
      },
    ];

    // Demo build targets
    const demoTargets: BuildTarget[] = [
      {
        id: 'build-core',
        ruleId: 'compile-ts',
        moduleId: '@antimatter/ui',
      },
      {
        id: 'build-bundle',
        ruleId: 'bundle',
        moduleId: '@antimatter/ui',
        dependsOn: ['build-core'],
      },
      {
        id: 'test-ui',
        ruleId: 'test',
        moduleId: '@antimatter/ui',
      },
    ];

    setRules(demoRules);
    setTargets(demoTargets);

    // Demo results showing different statuses
    const demoResults: BuildResult[] = [
      {
        targetId: 'build-core',
        status: 'success',
        startedAt: new Date(Date.now() - 5000).toISOString(),
        finishedAt: new Date(Date.now() - 2000).toISOString(),
        durationMs: 3000,
        diagnostics: [],
      },
      {
        targetId: 'build-bundle',
        status: 'cached',
        startedAt: new Date(Date.now() - 2000).toISOString(),
        finishedAt: new Date(Date.now() - 1800).toISOString(),
        durationMs: 200,
        diagnostics: [],
      },
      {
        targetId: 'test-ui',
        status: 'failure',
        startedAt: new Date(Date.now() - 8000).toISOString(),
        finishedAt: new Date(Date.now() - 5000).toISOString(),
        durationMs: 3000,
        diagnostics: [
          {
            file: 'src/components/FileExplorer.test.tsx',
            line: 42,
            column: 15,
            severity: 'error',
            message: 'Expected element to be visible but was not found',
            code: 'E001',
          },
          {
            file: 'src/components/Editor.test.tsx',
            line: 28,
            column: 10,
            severity: 'warning',
            message: 'Test timeout exceeded 5000ms',
          },
        ],
      },
    ];

    setResults(demoResults);
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

  const handleRunAll = () => {
    // In a real implementation, this would trigger the build system
    console.log('Running all build targets...');
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
