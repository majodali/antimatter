import { ChevronRight, ChevronDown, CheckCircle2, XCircle, Clock, AlertCircle, Loader2, MinusCircle, Database } from 'lucide-react';
import type { BuildResult, BuildStatus } from '@antimatter/project-model';
import { useBuildStore } from '@/stores/buildStore';
import { useFileStore } from '@/stores/fileStore';
import type { WorkspacePath } from '@antimatter/filesystem';

interface BuildStatusItemProps {
  result: BuildResult;
  targetName?: string;
}

export function BuildStatusItem({ result, targetName }: BuildStatusItemProps) {
  const { expandedTargets, toggleExpanded } = useBuildStore();
  const isExpanded = expandedTargets.has(result.targetId);
  const hasDiagnostics = result.diagnostics.length > 0;

  const statusConfig = getStatusConfig(result.status);

  const handleToggle = () => {
    if (hasDiagnostics) {
      toggleExpanded(result.targetId);
    }
  };

  return (
    <div className="border-b border-border last:border-0">
      {/* Main row */}
      <div
        className={`flex items-center gap-2 px-3 py-2 ${hasDiagnostics ? 'cursor-pointer hover:bg-accent/50' : ''}`}
        onClick={handleToggle}
      >
        {/* Expand icon */}
        <div className="w-4 flex items-center justify-center">
          {hasDiagnostics && (
            isExpanded ? (
              <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />
            ) : (
              <ChevronRight className="h-3.5 w-3.5 text-muted-foreground" />
            )
          )}
        </div>

        {/* Status icon */}
        <statusConfig.icon className={`h-4 w-4 ${statusConfig.className}`} />

        {/* Target name */}
        <span className="text-sm font-medium flex-1">
          {targetName || result.targetId}
        </span>

        {/* Duration */}
        {result.durationMs !== undefined && (
          <span className="text-xs text-muted-foreground">
            {formatDuration(result.durationMs)}
          </span>
        )}

        {/* Status badge */}
        <span
          className={`text-xs px-2 py-0.5 rounded-full ${statusConfig.badgeClassName}`}
        >
          {result.status}
        </span>
      </div>

      {/* Diagnostics */}
      {isExpanded && hasDiagnostics && (
        <div className="px-3 pb-2 space-y-1">
          {result.diagnostics.map((diagnostic, idx) => (
            <div
              key={idx}
              className={`text-xs px-3 py-1.5 rounded ${getDiagnosticClassName(diagnostic.severity)} font-mono`}
            >
              <div className="flex items-start gap-2">
                <span className="font-semibold">
                  {diagnostic.severity.toUpperCase()}:
                </span>
                <span className="flex-1">{diagnostic.message}</span>
              </div>
              {diagnostic.file && (
                <div
                  className="text-muted-foreground mt-1 cursor-pointer hover:underline hover:text-primary"
                  onClick={(e) => {
                    e.stopPropagation();
                    useFileStore.getState().setSelectedFile(diagnostic.file as WorkspacePath);
                  }}
                >
                  {diagnostic.file}
                  {diagnostic.line && `:${diagnostic.line}`}
                  {diagnostic.column && `:${diagnostic.column}`}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function getStatusConfig(status: BuildStatus) {
  switch (status) {
    case 'success':
      return {
        icon: CheckCircle2,
        className: 'text-green-600 dark:text-green-500',
        badgeClassName: 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400',
      };
    case 'cached':
      return {
        icon: Database,
        className: 'text-blue-600 dark:text-blue-500',
        badgeClassName: 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400',
      };
    case 'failure':
      return {
        icon: XCircle,
        className: 'text-red-600 dark:text-red-500',
        badgeClassName: 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400',
      };
    case 'running':
      return {
        icon: Loader2,
        className: 'text-yellow-600 dark:text-yellow-500 animate-spin',
        badgeClassName: 'bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-400',
      };
    case 'pending':
      return {
        icon: Clock,
        className: 'text-gray-500 dark:text-gray-400',
        badgeClassName: 'bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-400',
      };
    case 'skipped':
      return {
        icon: MinusCircle,
        className: 'text-gray-500 dark:text-gray-400',
        badgeClassName: 'bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-400',
      };
    default:
      return {
        icon: AlertCircle,
        className: 'text-gray-500',
        badgeClassName: 'bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-400',
      };
  }
}

function getDiagnosticClassName(severity: 'error' | 'warning' | 'info' | 'debug') {
  switch (severity) {
    case 'error':
      return 'bg-red-50 text-red-900 dark:bg-red-950/50 dark:text-red-200 border-l-2 border-red-600';
    case 'warning':
      return 'bg-yellow-50 text-yellow-900 dark:bg-yellow-950/50 dark:text-yellow-200 border-l-2 border-yellow-600';
    case 'info':
      return 'bg-blue-50 text-blue-900 dark:bg-blue-950/50 dark:text-blue-200 border-l-2 border-blue-600';
    case 'debug':
      return 'bg-gray-50 text-gray-900 dark:bg-gray-950/50 dark:text-gray-200 border-l-2 border-gray-600';
  }
}

function formatDuration(ms: number): string {
  if (ms < 1000) {
    return `${ms}ms`;
  }
  const seconds = ms / 1000;
  if (seconds < 60) {
    return `${seconds.toFixed(2)}s`;
  }
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = (seconds % 60).toFixed(0);
  return `${minutes}m ${remainingSeconds}s`;
}
