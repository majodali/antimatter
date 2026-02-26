import { create } from 'zustand';

export type EventCategory =
  | 'build'
  | 'chat'
  | 'file'
  | 'editor'
  | 'project'
  | 'network'
  | 'system';

export type EventLevel = 'info' | 'warn' | 'error';

export interface ActivityEvent {
  id: string;
  timestamp: string;
  category: EventCategory;
  level: EventLevel;
  message: string;
  detail?: string;
}

const MAX_EVENTS = 500;

let idCounter = 0;
function nextId(): string {
  return `ev-${Date.now().toString(36)}-${(idCounter++).toString(36)}`;
}

interface ActivityState {
  events: ActivityEvent[];
  emit: (category: EventCategory, level: EventLevel, message: string, detail?: string) => void;
  clear: () => void;
}

export const useActivityStore = create<ActivityState>((set) => ({
  events: [],

  emit: (category, level, message, detail) => {
    const event: ActivityEvent = {
      id: nextId(),
      timestamp: new Date().toISOString(),
      category,
      level,
      message,
      detail,
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

  clear: () => set({ events: [] }),
}));
