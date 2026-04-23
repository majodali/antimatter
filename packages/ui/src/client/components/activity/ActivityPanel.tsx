/**
 * ActivityPanel — Phase A scaffolding with stick-to-bottom live-tail behaviour.
 *
 * Renders the raw event stream (source + kind + message). The panel auto-
 * scrolls to the newest event only when the user is already at the bottom;
 * if they've scrolled up to inspect a specific row, new events accumulate
 * quietly below and a "Jump to latest" pill appears so they can resume
 * tailing on demand.
 *
 * Intended to be replaced in Phase B with an outcome-oriented view that
 * collapses rule:start/rule:end pairs into a single row per invocation,
 * plus the Phase C schedules strip on top.
 */
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { ScrollText, Trash2, RefreshCw, ArrowDown } from 'lucide-react';
import { ScrollArea } from '../ui/scroll-area';
import { Button } from '../ui/button';
import { ActivityEventRow } from './ActivityEventRow';
import { useActivityStore } from '@/stores/activityStore';
import { useProjectStore } from '@/stores/projectStore';

/** Distance (px) from bottom within which we consider the viewport "pinned". */
const STICK_THRESHOLD_PX = 32;

export function ActivityPanel() {
  const events = useActivityStore((s) => s.events);
  const isLoading = useActivityStore((s) => s.isLoadingBackfill);
  const clear = useActivityStore((s) => s.clear);
  const loadBackfill = useActivityStore((s) => s.loadBackfill);
  const projectId = useProjectStore((s) => s.currentProjectId);

  const viewportRef = useRef<HTMLDivElement | null>(null);
  const [isPinned, setIsPinned] = useState(true);
  const [unseenCount, setUnseenCount] = useState(0);

  // Backfill recent events when the panel mounts or the project changes.
  // Live events stream in via subscribeToActivityStream() (wired in main.tsx).
  useEffect(() => {
    if (projectId) void loadBackfill(projectId);
  }, [projectId, loadBackfill]);

  // Track whether the user is at/near the bottom. This drives the auto-follow
  // decision — we only scroll into view when they're already pinned.
  useEffect(() => {
    const el = viewportRef.current;
    if (!el) return;
    const onScroll = () => {
      const distance = el.scrollHeight - el.scrollTop - el.clientHeight;
      const pinned = distance <= STICK_THRESHOLD_PX;
      setIsPinned(pinned);
      if (pinned) setUnseenCount(0);
    };
    el.addEventListener('scroll', onScroll, { passive: true });
    onScroll();
    return () => el.removeEventListener('scroll', onScroll);
  }, []);

  // When new events arrive, either stick to bottom (if pinned) or surface an
  // "N new" counter so the user knows there's something fresh to look at.
  //
  // useLayoutEffect so the scroll happens before paint — avoids a visible jump.
  useLayoutEffect(() => {
    const el = viewportRef.current;
    if (!el) return;
    if (isPinned) {
      el.scrollTop = el.scrollHeight;
    } else {
      setUnseenCount((n) => Math.min(n + 1, 999));
    }
    // Only depend on events.length: we want to react to appends, not scroll-
    // driven re-renders (which would double-increment unseenCount).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [events.length]);

  const jumpToLatest = () => {
    const el = viewportRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
    setIsPinned(true);
    setUnseenCount(0);
  };

  return (
    <div className="h-full flex flex-col bg-card relative">
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

      <ScrollArea className="flex-1" viewportRef={viewportRef}>
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
          </div>
        )}
      </ScrollArea>

      {/* Floating "jump to latest" pill — only visible when the user has
          scrolled up from the bottom and new events have arrived. */}
      {!isPinned && unseenCount > 0 && (
        <button
          type="button"
          onClick={jumpToLatest}
          className="absolute bottom-3 left-1/2 -translate-x-1/2 flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-primary text-primary-foreground text-xs shadow-lg hover:opacity-90 transition-opacity"
          title="Scroll to latest and resume live follow"
        >
          <ArrowDown className="h-3 w-3" />
          {unseenCount === 999 ? '999+' : unseenCount} new
        </button>
      )}
    </div>
  );
}
