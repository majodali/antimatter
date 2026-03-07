import { useActivityStore, type EventCategory } from '@/stores/activityStore';
import { useToastStore, type ToastLevel } from '@/stores/toastStore';

interface EmitOptions {
  /** Also show as a toast notification */
  toast?: boolean;
}

const LEVEL_TO_TOAST: Record<string, ToastLevel> = {
  info: 'info',
  warn: 'warning',
  error: 'error',
};

function emit(
  category: EventCategory,
  level: 'info' | 'warn' | 'error',
  message: string,
  detail?: string,
  options?: EmitOptions,
) {
  useActivityStore.getState().emit(category, level, message, detail);

  if (options?.toast) {
    useToastStore.getState().addToast(LEVEL_TO_TOAST[level], message, detail);
  }
}

export const eventLog = {
  info: (category: EventCategory, message: string, detail?: string, options?: EmitOptions) =>
    emit(category, 'info', message, detail, options),
  warn: (category: EventCategory, message: string, detail?: string, options?: EmitOptions) =>
    emit(category, 'warn', message, detail, options),
  error: (category: EventCategory, message: string, detail?: string, options?: EmitOptions) =>
    emit(category, 'error', message, detail, options),

  /** Convenience methods — show toast only (no activity log entry) */
  toast: {
    info: (message: string, detail?: string) =>
      useToastStore.getState().addToast('info', message, detail),
    success: (message: string, detail?: string) =>
      useToastStore.getState().addToast('success', message, detail),
    warning: (message: string, detail?: string) =>
      useToastStore.getState().addToast('warning', message, detail),
    error: (message: string, detail?: string) =>
      useToastStore.getState().addToast('error', message, detail),
  },
};
