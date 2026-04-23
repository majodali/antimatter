/**
 * ActivityPanel — Phase A scaffolding.
 *
 * Renders the raw event stream (source + kind + message). Intended to be
 * replaced in Phase B with an outcome-oriented view that collapses
 * rule:start/rule:end pairs into a single row per invocation, plus the
 * Phase C schedules strip on top.
 */
import { useEffect, useRef } from 'react';
import { ScrollText, Trash2, RefreshCw } from 'lucide-react';
import { ScrollArea } from '../ui/scroll-area';
import { Button } from '../ui/button';
import { ActivityEventRow } from './ActivityEventRow';
import { useActivityStore } from '@/stores/activityStore';
import { useProjectStore } from '@/stores/projectStore';

export function ActivityPanel() {
  const events = useActivityStore((s) => s.events);
  const isLoading = useActivityStore((s) => s.isLoadingBackfill);
  const clear = useActivityStore((s) => s.clear);
  const loadBackfill = useActivityStore((s) => s.loadBackfill);
  const projectId = useProjectStore((s) => s.currentProjectId);
  const bottomRef = useRef<HTMLDivElement>(null);

  // Backfill recent events when the panel mounts or the project changes.
  // Live events stream in via subscribeToActivityStream() (wired in main.tsx).
  useEffect(() => {
    if (projectId) void loadBackfill(projectId);
  }, [projectId, loadBackfill]);

  // Auto-scroll to bottom when new events arrive.
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [events.length]);

  return (
    <div className="h-full flex flex-col bg-card">
      <div className="px-3 py-2 border-b border-border flex items-center justify-between">
        <div className="flex items-center gap-2">
          <ScrollText className="h-4 w-4 text-primary" />
          <h3 className="text-sm font-medium">Activity</h3>
          <span className="text-xs text-muted-foreground">{events.length}</span>
        </div>
        <div className="flex items-center gap-1">
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7"
            onClick={() => projectId && loadBackfill(projectId)}
            disabled={isLoading || !projectId}
            title="Refresh backfill"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${isLoading ? 'animate-spin' : ''}`} />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7"
            onClick={clear}
            title="Clear local view"
          >
            <Trash2 className="h-3.5 w-3.5" />
          </Button>
        </div>
      </div>

      <ScrollArea className="flex-1">
        {events.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-center p-4">
            <ScrollText className="h-12 w-12 text-muted-foreground mb-3 opacity-50" />
            <p className="text-sm text-muted-foreground">No activity yet</p>
          </div>
        ) : (
          <div>
            {events.map((event) => (
              <ActivityEventRow key={`${event.projectId ?? ''}#${event.seq}`} event={event} />
            ))}
            <div ref={bottomRef} />
          </div>
        )}
      </ScrollArea>
    </div>
  );
}
