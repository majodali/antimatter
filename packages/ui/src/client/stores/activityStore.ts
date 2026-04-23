/**
 * Activity store — the client-side mirror of the worker's ActivityLog.
 *
 * Phase A of the Activity Panel redesign: the store now holds the same
 * `ActivityEvent` shape the server emits, with correlation fields
 * (operationId, correlationId, parentId, environment) intact. The
 * previous `category`-based client-side taxonomy and the 60+ `emit()`
 * call sites have been removed — client-originated UI events no longer
 * appear in the activity log. Toasts are the replacement for short-lived
 * user feedback (`lib/toast.ts`).
 *
 * Data path:
 *  1. `loadBackfill(projectId)` fetches the last N events via the worker's
 *     `activity.list` automation command when the panel mounts.
 *  2. `subscribeToStream()` wires `workspace-connection`'s
 *     `{type: 'activity-event', event}` broadcast into the store so new
 *     events stream in live.
 *
 * State is NOT persisted to localStorage: events are server-authoritative,
 * so a fresh backfill on reload is cheaper than a stale cache.
 */
import { create } from 'zustand';
import type { ActivityEvent } from '../../shared/activity-types';
import { workspaceConnection } from '@/lib/workspace-connection';

/** Max events held in memory. Bigger than the old 500 — we're streaming now. */
const MAX_EVENTS = 2000;

interface ActivityState {
  /** Events in ascending seq order. */
  events: ActivityEvent[];
  /** Per-projectId seen-seq set for dedupe across backfill + WS race. */
  seenSeqByProject: Map<string, Set<number>>;
  /** True while a backfill is in-flight. */
  isLoadingBackfill: boolean;
  /** Last error from a backfill attempt. */
  lastError: string | null;

  /** Append one event. Drops duplicate seq for the same projectId. */
  append: (event: ActivityEvent) => void;
  /** Append a batch (e.g. from REST backfill). */
  appendBatch: (events: readonly ActivityEvent[]) => void;
  /** Clear everything. */
  clear: () => void;
  /** Fetch recent events from the worker for the given project. */
  loadBackfill: (projectId: string, limit?: number) => Promise<void>;
}

function eventKey(e: ActivityEvent): string {
  return `${e.projectId ?? ''}#${e.seq}`;
}

export const useActivityStore = create<ActivityState>()((set, get) => ({
  events: [],
  seenSeqByProject: new Map(),
  isLoadingBackfill: false,
  lastError: null,

  append: (event) => {
    set((state) => {
      const pid = event.projectId ?? '';
      const seen = state.seenSeqByProject.get(pid) ?? new Set<number>();
      if (seen.has(event.seq)) return state;
      seen.add(event.seq);
      const nextSeen = new Map(state.seenSeqByProject);
      nextSeen.set(pid, seen);
      // Preserve seq order; new events almost always have the highest seq,
      // but WS can sometimes interleave with backfill, so do a small sort.
      const events = [...state.events, event].sort((a, b) => {
        if (a.loggedAt === b.loggedAt) return a.seq - b.seq;
        return a.loggedAt.localeCompare(b.loggedAt);
      });
      const trimmed = events.length > MAX_EVENTS ? events.slice(events.length - MAX_EVENTS) : events;
      return { events: trimmed, seenSeqByProject: nextSeen };
    });
  },

  appendBatch: (batch) => {
    set((state) => {
      const nextSeen = new Map(state.seenSeqByProject);
      const merged: ActivityEvent[] = [...state.events];
      for (const event of batch) {
        const pid = event.projectId ?? '';
        let seen = nextSeen.get(pid);
        if (!seen) {
          seen = new Set<number>();
          nextSeen.set(pid, seen);
        }
        if (seen.has(event.seq)) continue;
        seen.add(event.seq);
        merged.push(event);
      }
      merged.sort((a, b) => {
        if (a.loggedAt === b.loggedAt) return a.seq - b.seq;
        return a.loggedAt.localeCompare(b.loggedAt);
      });
      const trimmed = merged.length > MAX_EVENTS ? merged.slice(merged.length - MAX_EVENTS) : merged;
      return { events: trimmed, seenSeqByProject: nextSeen };
    });
  },

  clear: () => set({ events: [], seenSeqByProject: new Map(), lastError: null }),

  loadBackfill: async (projectId, limit = 500) => {
    if (!projectId) return;
    set({ isLoadingBackfill: true, lastError: null });
    try {
      const res = await fetch(
        `/workspace/${encodeURIComponent(projectId)}/api/automation/execute`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ command: 'activity.list', params: { limit } }),
        },
      );
      if (!res.ok) {
        set({ isLoadingBackfill: false, lastError: `backfill failed: ${res.status}` });
        return;
      }
      const json = await res.json();
      const events = (json?.data?.events ?? []) as ActivityEvent[];
      get().appendBatch(events);
      set({ isLoadingBackfill: false });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      set({ isLoadingBackfill: false, lastError: msg });
    }
  },
}));

// ---------------------------------------------------------------------------
// WebSocket stream wiring
//
// Subscribe to `{type: 'activity-event', event}` broadcasts from the worker's
// ActivityLog.subscribe callback. Idempotent — calling subscribeToStream more
// than once is a no-op so React strict-mode double-mounts are safe.
// ---------------------------------------------------------------------------

let wsSubscribed = false;

export function subscribeToActivityStream(): void {
  if (wsSubscribed) return;
  wsSubscribed = true;
  workspaceConnection.onMessage(
    (msg) => {
      const event = msg?.event as ActivityEvent | undefined;
      if (!event || typeof event.seq !== 'number') return;
      useActivityStore.getState().append(event);
    },
    { type: 'activity-event' },
  );
}
