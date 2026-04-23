/**
 * Thin toast helper — a one-liner wrapper around the toast store.
 *
 * Replaces the old `lib/eventLog.ts` façade. The event-log half of that
 * module was removed in Phase A of the Activity Panel redesign: the client
 * no longer emits synthetic "activity events" for its own UI actions
 * (file saves, editor events, chat tool calls, etc.). That noise only
 * muddled the real server-side workflow outcomes the panel is meant to
 * surface.
 *
 * Toasts are a separate concern — short-lived status pops for the user —
 * and they stay.
 */
import { useToastStore } from '@/stores/toastStore';

export const toast = {
  info:    (message: string, detail?: string) => useToastStore.getState().addToast('info', message, detail),
  success: (message: string, detail?: string) => useToastStore.getState().addToast('success', message, detail),
  warning: (message: string, detail?: string) => useToastStore.getState().addToast('warning', message, detail),
  error:   (message: string, detail?: string) => useToastStore.getState().addToast('error', message, detail),
};
