/**
 * ActivityPanel — outcome-level live tail.
 *
 * Phase B: the panel renders one row per rule invocation / schedule fire
 * (see `lib/outcomeProjection.ts`), not per raw event. File-change
 * storms that match no rule silently disappear; rule failures surface
 * the error message right on the row; logs/execs/utils are available
 * under an expand.
 *
 * Stick-to-bottom live tail: auto-scrolls only when the user is already
 * at the bottom. Scroll up → a floating "N new" pill appears to resume.
 *
 * Phase C adds the schedules strip above the list.
 * Phase D adds double-click-to-source navigation on rows.
 */
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { ScrollText, Trash2, RefreshCw, ArrowDown } from 'lucide-react';
import { ScrollArea } from '../ui/scroll-area';
import { Button } from '../ui/button';
import { OutcomeRow } from './OutcomeRow';
import { useActivityStore } from '@/stores/activityStore';
import { useProjectStore } from '@/stores/projectStore';
import { projectOutcomes } from '@/lib/outcomeProjection';

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

  // Fold raw events → outcomes. Pure and fast; memo keyed on events reference
  // (store replaces `events` on append, so ref equality is sufficient).
  const outcomes = useMemo(() => projectOutcomes(events), [events]);

  // Backfill when the panel mounts or the project changes.
  useEffect(() => {
    if (projectId) void loadBackfill(projectId);
  }, [projectId, loadBackfill]);

  // Track whether the user is at/near the bottom.
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

  // Auto-follow when pinned; otherwise bump the unseen counter.
  useLayoutEffect(() => {
    const el = viewportRef.current;
    if (!el) return;
    if (isPinned) {
      el.scrollTop = el.scrollHeight;
    } else {
      setUnseenCount((n) => Math.min(n + 1, 999));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [outcomes.length]);

  const jumpToLatest = () => {
    const el = viewportRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
    setIsPinned(true);
    setUnseenCount(0);
  };

  // Summary counts for the header (errors get called out).
  const errorCount = useMemo(
    () => outcomes.reduce((n, o) => (o.status === 'error' ? n + 1 : n), 0),
    [outcomes],
  );
  const runningCount = useMemo(
    () => outcomes.reduce((n, o) => (o.status === 'running' ? n + 1 : n), 0),
    [outcomes],
  );

  return (
    <div className="h-full flex flex-col bg-card relative">
      <div className="px-3 py-2 border-b border-border flex items-center justify-between">
        <div className="flex items-center gap-2">
          <ScrollText className="h-4 w-4 text-primary" />
          <h3 className="text-sm font-medium">Activity</h3>
          <span className="text-xs text-muted-foreground">{outcomes.length}</span>
          {errorCount > 0 && (
            <span className="text-xs text-red-500 font-medium">{errorCount} failed</span>
          )}
          {runningCount > 0 && (
            <span className="text-xs text-muted-foreground">{runningCount} running</span>
          )}
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
        {outcomes.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-center p-4">
            <ScrollText className="h-12 w-12 text-muted-foreground mb-3 opacity-50" />
            <p className="text-sm text-muted-foreground">
              {events.length > 0 ? 'No rule outcomes yet' : 'No activity yet'}
            </p>
            {events.length > 0 && (
              <p className="text-[10px] text-muted-foreground mt-1">
                {events.length} raw events — see <span className="font-mono">/logs</span> for the full stream
              </p>
            )}
          </div>
        ) : (
          <div>
            {outcomes.map((o) => <OutcomeRow key={o.key} outcome={o} />)}
          </div>
        )}
      </ScrollArea>

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
