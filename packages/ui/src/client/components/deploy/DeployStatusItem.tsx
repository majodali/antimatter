import { useState } from 'react';
import { ChevronDown, ChevronRight, Loader2, CheckCircle, XCircle, MinusCircle } from 'lucide-react';
import type { DeploymentResult } from '@antimatter/project-model';

interface DeployStatusItemProps {
  result: DeploymentResult;
  moduleName?: string;
}

function formatDuration(ms?: number): string {
  if (!ms) return '';
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
  const mins = Math.floor(ms / 60000);
  const secs = Math.floor((ms % 60000) / 1000);
  return `${mins}m ${secs}s`;
}

function statusIcon(status: string) {
  switch (status) {
    case 'running':
      return <Loader2 className="h-4 w-4 text-yellow-500 animate-spin" />;
    case 'success':
      return <CheckCircle className="h-4 w-4 text-green-500" />;
    case 'failed':
      return <XCircle className="h-4 w-4 text-red-500" />;
    case 'skipped':
      return <MinusCircle className="h-4 w-4 text-gray-400" />;
    default:
      return <MinusCircle className="h-4 w-4 text-gray-400" />;
  }
}

function statusBadge(status: string) {
  const colors: Record<string, string> = {
    running: 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-400',
    success: 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400',
    failed: 'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400',
    skipped: 'bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400',
  };
  return (
    <span className={`px-1.5 py-0.5 rounded text-[10px] font-medium ${colors[status] ?? colors.skipped}`}>
      {status}
    </span>
  );
}

export function DeployStatusItem({ result, moduleName }: DeployStatusItemProps) {
  const [expanded, setExpanded] = useState(false);
  const hasSteps = result.steps && result.steps.length > 0;

  return (
    <div className="px-3 py-2">
      <div
        className={`flex items-center gap-2 ${hasSteps ? 'cursor-pointer' : ''}`}
        onClick={() => hasSteps && setExpanded(!expanded)}
      >
        {hasSteps ? (
          expanded ? (
            <ChevronDown className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
          ) : (
            <ChevronRight className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
          )
        ) : (
          <span className="w-3.5" />
        )}
        {statusIcon(result.status as string)}
        <span className="text-sm font-medium truncate flex-1">
          {moduleName ?? result.moduleId}
        </span>
        {result.durationMs != null && (
          <span className="text-xs text-muted-foreground">
            {formatDuration(result.durationMs)}
          </span>
        )}
        {statusBadge(result.status as string)}
      </div>

      {result.error && !expanded && (
        <div className="ml-9 mt-1 text-xs text-red-500 truncate">{result.error}</div>
      )}

      {expanded && result.steps && (
        <div className="ml-6 mt-2 space-y-1.5 border-l border-border pl-3">
          {result.steps.map((step, i) => (
            <div key={i} className="flex items-center gap-2 text-xs">
              {statusIcon(step.status as string)}
              <span className="font-medium capitalize w-14">{step.step}</span>
              {step.durationMs != null && (
                <span className="text-muted-foreground">{formatDuration(step.durationMs)}</span>
              )}
              {statusBadge(step.status as string)}
            </div>
          ))}

          {/* Show output if any step has output */}
          {result.steps.some((s) => s.output || s.error) && (
            <div className="mt-2 rounded bg-accent/30 p-2 text-xs font-mono max-h-40 overflow-y-auto">
              {result.steps
                .filter((s) => s.output || s.error)
                .map((s, i) => (
                  <div key={i} className="mb-1">
                    <span className="font-semibold capitalize">{s.step}:</span>{' '}
                    <span className={s.error ? 'text-red-500' : 'text-muted-foreground'}>
                      {s.error ?? s.output}
                    </span>
                  </div>
                ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
