import { useActivityStore, type EventCategory } from '@/stores/activityStore';

function emit(category: EventCategory, level: 'info' | 'warn' | 'error', message: string, detail?: string) {
  useActivityStore.getState().emit(category, level, message, detail);
}

export const eventLog = {
  info: (category: EventCategory, message: string, detail?: string) =>
    emit(category, 'info', message, detail),
  warn: (category: EventCategory, message: string, detail?: string) =>
    emit(category, 'warn', message, detail),
  error: (category: EventCategory, message: string, detail?: string) =>
    emit(category, 'error', message, detail),
};
