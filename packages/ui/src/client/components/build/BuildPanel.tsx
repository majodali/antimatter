import { Hammer, Play, Settings, CheckCircle, XCircle, Loader2, Clock } from 'lucide-react';
import { ScrollArea } from '../ui/scroll-area';
import { Button } from '../ui/button';
import { WidgetBar } from '../widgets/WidgetRenderer';
import { useApplicationStore, type RuleExecutionState } from '@/stores/applicationStore';
import { useProjectStore } from '@/stores/projectStore';
import { cn } from '@/lib/utils';
import type { WidgetState } from '@antimatter/workflow';

export function BuildPanel() {
  const declarations = useApplicationStore((s) => s.getDeclarations());
  const ruleResults = useApplicationStore((s) => s.getRuleExecutionStates());
  const workflowState = useApplicationStore((s) => s.getWorkflowState()) as any;
  const loaded = useApplicationStore((s) => s.loaded);
  const runRule = useApplicationStore((s) => s.runRule);
  const emitEvent = useApplicationStore((s) => s.emitEvent);
  const currentProjectId = useProjectStore((s) => s.currentProjectId);

  // No useEffect needed — state arrives via WebSocket on connect

  const rules = declarations.rules ?? [];
  const buildWidgets = (declarations.widgets ?? []).filter((w) => w.section === 'build');
  const uiState: Record<string, WidgetState | undefined> = workflowState?._ui ?? {};

  const handleRunRule = async (ruleId: string) => {
    try {
      await runRule(ruleId, currentProjectId ?? undefined);
    } catch {
      // Error already handled by store
    }
  };

  const handleWidgetEvent = (event: { type: string; [key: string]: unknown }) => {
    emitEvent(event, currentProjectId ?? undefined);
  };

  const handleOpenConfig = () => {
    // Open .antimatter/ files in the editor
    // Use the file tree to navigate to the automation directory
    const { openFile } = (window as any).__editorActions ?? {};
    if (openFile) {
      openFile('.antimatter/build.ts');
    }
  };

  return (
    <div className="h-full flex flex-col bg-card">
      {/* Header */}
      <div className="px-3 py-2 border-b border-border flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Hammer className="h-4 w-4 text-primary" />
          <h3 className="text-sm font-medium">Build</h3>
          {rules.length > 0 && (
            <span className="text-xs text-muted-foreground">
              {rules.length} rule{rules.length !== 1 ? 's' : ''}
            </span>
          )}
        </div>
        <div className="flex items-center gap-1">
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7"
            onClick={handleOpenConfig}
            title="Open workflow configuration"
          >
            <Settings className="h-3.5 w-3.5" />
          </Button>
        </div>
      </div>

      {/* Widgets */}
      {buildWidgets.length > 0 && (
        <WidgetBar widgets={buildWidgets} widgetStates={uiState} onEvent={handleWidgetEvent} />
      )}

      {/* Rules list */}
      <ScrollArea className="flex-1">
        {rules.length === 0 && buildWidgets.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-center p-4">
            <Hammer className="h-12 w-12 text-muted-foreground mb-3 opacity-50" />
            <p className="text-sm text-muted-foreground">No workflow rules loaded</p>
            <p className="text-xs text-muted-foreground mt-1">
              {loaded
                ? 'Add rules to .antimatter/*.ts files'
                : 'Loading workflow definitions...'}
            </p>
          </div>
        ) : (
          <div className="divide-y divide-border">
            {rules.map((rule) => {
              const result = ruleResults.get(rule.id);
              return (
                <RuleItem
                  key={rule.id}
                  ruleId={rule.id}
                  name={rule.name}
                  manual={rule.manual}
                  result={result}
                  onRun={() => handleRunRule(rule.id)}
                />
              );
            })}
          </div>
        )}
      </ScrollArea>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Rule Item Component
// ---------------------------------------------------------------------------

function RuleItem({
  ruleId,
  name,
  manual,
  result,
  onRun,
}: {
  ruleId: string;
  name: string;
  manual: boolean;
  result?: RuleExecutionState;
  onRun: () => void;
}) {
  const isRunning = result?.status === 'running';

  return (
    <div className="px-3 py-2 flex items-center gap-2 group hover:bg-accent/30">
      {/* Status icon */}
      <div className="flex-shrink-0 w-4 h-4 flex items-center justify-center">
        <StatusIcon status={result?.status} />
      </div>

      {/* Rule info */}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-1.5">
          <span className="text-xs font-medium truncate">{name}</span>
          {result?.durationMs != null && result.status !== 'running' && (
            <span className="text-[10px] text-muted-foreground flex items-center gap-0.5">
              <Clock className="h-2.5 w-2.5" />
              {formatDuration(result.durationMs)}
            </span>
          )}
        </div>
        {result?.error && (
          <p className="text-[10px] text-red-600 dark:text-red-400 mt-0.5 truncate" title={result.error}>
            {result.error}
          </p>
        )}
      </div>

      {/* Run button — only shown for manual rules */}
      {manual && (
        <Button
          variant="ghost"
          size="icon"
          className="h-6 w-6 opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0"
          onClick={(e) => {
            e.stopPropagation();
            onRun();
          }}
          disabled={isRunning}
          title={`Run ${name}`}
        >
          {isRunning ? (
            <Loader2 className="h-3 w-3 animate-spin" />
          ) : (
            <Play className="h-3 w-3" />
          )}
        </Button>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function StatusIcon({ status }: { status?: string }) {
  switch (status) {
    case 'running':
      return <Loader2 className="h-3.5 w-3.5 text-yellow-600 dark:text-yellow-500 animate-spin" />;
    case 'success':
      return <CheckCircle className="h-3.5 w-3.5 text-green-600 dark:text-green-500" />;
    case 'failed':
      return <XCircle className="h-3.5 w-3.5 text-red-600 dark:text-red-500" />;
    default:
      return <div className="h-2 w-2 rounded-full bg-muted-foreground/30" />;
  }
}

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
  const mins = Math.floor(ms / 60_000);
  const secs = Math.round((ms % 60_000) / 1000);
  return `${mins}m${secs}s`;
}
