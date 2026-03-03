import { useEffect, useRef, useCallback } from 'react';
import { ScrollText, Trash2, RefreshCw } from 'lucide-react';
import { ScrollArea } from '../ui/scroll-area';
import { Button } from '../ui/button';
import { ActivityEventRow } from './ActivityEventRow';
import { useActivityStore } from '@/stores/activityStore';

export function ActivityPanel() {
  const events = useActivityStore((s) => s.events);
  const serverEvents = useActivityStore((s) => s.serverEvents);
  const isLoadingServerEvents = useActivityStore((s) => s.isLoadingServerEvents);
  const clear = useActivityStore((s) => s.clear);
  const loadServerEvents = useActivityStore((s) => s.loadServerEvents);
  const getAllEvents = useActivityStore((s) => s.getAllEvents);
  const bottomRef = useRef<HTMLDivElement>(null);

  const allEvents = getAllEvents();

  // Load server events on mount
  useEffect(() => {
    loadServerEvents();
  }, [loadServerEvents]);

  // Auto-scroll to bottom when new events arrive
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [events.length, serverEvents.length]);

  const handleRefresh = useCallback(() => {
    loadServerEvents();
  }, [loadServerEvents]);

  return (
    <div className="h-full flex flex-col bg-card">
      {/* Header */}
      <div className="px-3 py-2 border-b border-border flex items-center justify-between">
        <div className="flex items-center gap-2">
          <ScrollText className="h-4 w-4 text-primary" />
          <h3 className="text-sm font-medium">Activity</h3>
          <span className="text-xs text-muted-foreground">{allEvents.length}</span>
        </div>
        <div className="flex items-center gap-1">
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7"
            onClick={handleRefresh}
            disabled={isLoadingServerEvents}
            title="Refresh server events"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${isLoadingServerEvents ? 'animate-spin' : ''}`} />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7"
            onClick={clear}
            title="Clear activity log"
          >
            <Trash2 className="h-3.5 w-3.5" />
          </Button>
        </div>
      </div>

      {/* Events list */}
      <ScrollArea className="flex-1">
        {allEvents.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-center p-4">
            <ScrollText className="h-12 w-12 text-muted-foreground mb-3 opacity-50" />
            <p className="text-sm text-muted-foreground">No activity yet</p>
          </div>
        ) : (
          <div>
            {allEvents.map((event) => (
              <ActivityEventRow key={event.id} event={event} />
            ))}
            <div ref={bottomRef} />
          </div>
        )}
      </ScrollArea>
    </div>
  );
}
