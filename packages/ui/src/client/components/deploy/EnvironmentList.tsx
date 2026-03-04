import { useEffect, useRef } from 'react';
import { Loader2, ExternalLink, Trash2, Server } from 'lucide-react';
import { ScrollArea } from '../ui/scroll-area';
import { Button } from '../ui/button';
import { useInfraEnvironmentStore } from '@/stores/infraEnvironmentStore';
import type { InfraEnvironment, InfraEnvironmentStatus } from '@antimatter/project-model';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function relativeTime(iso: string): string {
  const now = Date.now();
  const then = new Date(iso).getTime();
  const diffMs = now - then;

  if (diffMs < 60_000) return 'just now';
  if (diffMs < 3600_000) return `${Math.floor(diffMs / 60_000)}m ago`;
  if (diffMs < 86400_000) return `${Math.floor(diffMs / 3600_000)}h ago`;
  return `${Math.floor(diffMs / 86400_000)}d ago`;
}

function statusBadge(status: InfraEnvironmentStatus) {
  switch (status) {
    case 'active':
      return (
        <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-medium bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400">
          <span className="w-1.5 h-1.5 rounded-full bg-green-500" />
          active
        </span>
      );
    case 'destroying':
      return (
        <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-medium bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-400">
          <Loader2 className="h-3 w-3 animate-spin" />
          destroying
        </span>
      );
    case 'destroyed':
      return (
        <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-medium bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400">
          destroyed
        </span>
      );
    case 'failed':
      return (
        <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-medium bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400">
          <span className="w-1.5 h-1.5 rounded-full bg-red-500" />
          failed
        </span>
      );
  }
}

// ---------------------------------------------------------------------------
// EnvironmentItem
// ---------------------------------------------------------------------------

function EnvironmentItem({ env }: { env: InfraEnvironment }) {
  const terminateEnvironment = useInfraEnvironmentStore((s) => s.terminateEnvironment);
  const isTerminating = env.status === 'destroying' || env.status === 'destroyed';

  return (
    <div className="px-3 py-2.5">
      {/* Top row: envId + status */}
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0">
          <span className="text-sm font-semibold truncate">{env.envId}</span>
          {statusBadge(env.status)}
        </div>
        <div className="flex items-center gap-1 shrink-0">
          <span className="text-[10px] text-muted-foreground">
            {relativeTime(env.createdAt)}
          </span>
          <Button
            variant="ghost"
            size="icon"
            className="h-6 w-6 text-red-500 hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-950/30"
            onClick={() => terminateEnvironment(env.envId)}
            disabled={isTerminating}
            title="Terminate environment"
          >
            <Trash2 className="h-3 w-3" />
          </Button>
        </div>
      </div>

      {/* Description */}
      {env.description && (
        <p className="text-xs text-muted-foreground mt-0.5 truncate">{env.description}</p>
      )}

      {/* Stack name */}
      <p className="text-[10px] text-muted-foreground mt-0.5 font-mono">{env.stackName}</p>

      {/* URLs */}
      <div className="flex flex-wrap gap-x-3 gap-y-0.5 mt-1">
        {env.outputs.websiteUrl && (
          <a
            href={env.outputs.websiteUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1 text-[11px] text-blue-600 dark:text-blue-400 hover:underline"
          >
            <ExternalLink className="h-3 w-3" />
            Website
          </a>
        )}
        {env.outputs.apiUrl && (
          <a
            href={env.outputs.apiUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1 text-[11px] text-blue-600 dark:text-blue-400 hover:underline"
          >
            <ExternalLink className="h-3 w-3" />
            API
          </a>
        )}
      </div>

      {/* Error message */}
      {env.error && (
        <p className="text-[11px] text-red-500 mt-1 truncate">{env.error}</p>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// EnvironmentList
// ---------------------------------------------------------------------------

export function EnvironmentList() {
  const { environments, isLoading, loadEnvironments } = useInfraEnvironmentStore();
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Load on mount
  useEffect(() => {
    loadEnvironments();
  }, []);

  // Poll when any environment is in 'destroying' state
  useEffect(() => {
    const hasDestroying = environments.some((e) => e.status === 'destroying');

    if (hasDestroying && !pollRef.current) {
      pollRef.current = setInterval(() => {
        loadEnvironments();
      }, 10_000);
    } else if (!hasDestroying && pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }

    return () => {
      if (pollRef.current) {
        clearInterval(pollRef.current);
        pollRef.current = null;
      }
    };
  }, [environments]);

  if (isLoading && environments.length === 0) {
    return (
      <div className="flex items-center justify-center h-full">
        <Loader2 className="h-5 w-5 text-muted-foreground animate-spin" />
      </div>
    );
  }

  if (environments.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-full text-center p-4">
        <Server className="h-12 w-12 text-muted-foreground mb-3 opacity-50" />
        <p className="text-sm text-muted-foreground">No environments deployed</p>
        <p className="text-xs text-muted-foreground mt-1">
          Deploy via CDK and register environments to track them here
        </p>
      </div>
    );
  }

  return (
    <ScrollArea className="h-full">
      <div className="divide-y divide-border">
        {environments.map((env) => (
          <EnvironmentItem key={env.envId} env={env} />
        ))}
      </div>
    </ScrollArea>
  );
}
