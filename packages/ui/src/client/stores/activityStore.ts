import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { createProjectStorage } from '@/lib/storePersist';
import { fetchSystemEvents } from '@/lib/api';
import type { SystemEvent } from '@/lib/api';

export type EventCategory =
  | 'build'
  | 'chat'
  | 'file'
  | 'editor'
  | 'project'
  | 'network'
  | 'system'
  | 'workspace'
  | 'deploy'
  | 'secrets'
  | 'agent';

export type EventLevel = 'info' | 'warn' | 'error';

export interface ActivityEvent {
  id: string;
  timestamp: string;
  category: EventCategory;
  level: EventLevel;
  message: string;
  detail?: string;
  /** Source of the event: 'client' for local UI events, 'lambda'/'workspace' for server events */
  source?: 'client' | 'lambda' | 'workspace';
}

const MAX_EVENTS = 500;

let idCounter = 0;
function nextId(): string {
  return `ev-${Date.now().toString(36)}-${(idCounter++).toString(36)}`;
}

interface ActivityState {
  events: ActivityEvent[];
  serverEvents: ActivityEvent[];
  isLoadingServerEvents: boolean;
  emit: (category: EventCategory, level: EventLevel, message: string, detail?: string) => void;
  clear: () => void;
  loadServerEvents: (projectId?: string) => Promise<void>;
  /** Get all events (client + server) merged and sorted by timestamp */
  getAllEvents: () => ActivityEvent[];
}

/** Convert a server SystemEvent to an ActivityEvent */
function toActivityEvent(e: SystemEvent): ActivityEvent {
  return {
    id: e.id,
    timestamp: e.timestamp,
    category: e.category as EventCategory,
    level: e.level,
    message: e.message,
    detail: e.detail ? JSON.stringify(e.detail) : undefined,
    source: e.source,
  };
}

export const useActivityStore = create<ActivityState>()(
  persist(
    (set, get) => ({
      events: [],
      serverEvents: [],
      isLoadingServerEvents: false,

      emit: (category, level, message, detail) => {
        const event: ActivityEvent = {
          id: nextId(),
          timestamp: new Date().toISOString(),
          category,
          level,
          message,
          detail,
          source: 'client',
        };
        set((state) => {
          const events = [...state.events, event];
          // Ring buffer: drop oldest when exceeding max
          if (events.length > MAX_EVENTS) {
            return { events: events.slice(events.length - MAX_EVENTS) };
          }
          return { events };
        });
      },

      clear: () => set({ events: [], serverEvents: [] }),

      loadServerEvents: async (projectId?: string) => {
        set({ isLoadingServerEvents: true });
        try {
          const events = await fetchSystemEvents(projectId, 1, 200);
          set({ serverEvents: events.map(toActivityEvent), isLoadingServerEvents: false });
        } catch {
          // Server events may not be available yet (no workspace, no events logged)
          set({ isLoadingServerEvents: false });
        }
      },

      getAllEvents: () => {
        const { events, serverEvents } = get();
        // Merge client and server events, deduplicate by id, sort by timestamp
        const merged = new Map<string, ActivityEvent>();
        for (const e of serverEvents) {
          merged.set(e.id, e);
        }
        for (const e of events) {
          merged.set(e.id, e);
        }
        return Array.from(merged.values()).sort(
          (a, b) => a.timestamp.localeCompare(b.timestamp),
        );
      },
    }),
    {
      name: 'antimatter-activity',
      storage: createProjectStorage('activity'),
      partialize: (state) => ({
        events: state.events,
      }),
    },
  ),
);
