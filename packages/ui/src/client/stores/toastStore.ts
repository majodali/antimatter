import { create } from 'zustand';

export type ToastLevel = 'info' | 'success' | 'warning' | 'error';

export interface Toast {
  readonly id: string;
  readonly level: ToastLevel;
  readonly message: string;
  readonly detail?: string;
  readonly timestamp: string;
  readonly action?: {
    readonly label: string;
    readonly onClick: () => void;
  };
}

/** Default auto-dismiss durations by level (ms). Error toasts are persistent. */
const AUTO_DISMISS: Record<ToastLevel, number | null> = {
  info: 3000,
  success: 3000,
  warning: 5000,
  error: null, // persistent — must be manually dismissed
};

const MAX_TOASTS = 5;

let idCounter = 0;
function nextId(): string {
  return `toast-${Date.now().toString(36)}-${(idCounter++).toString(36)}`;
}

interface ToastState {
  toasts: Toast[];
  addToast: (
    level: ToastLevel,
    message: string,
    detail?: string,
    action?: Toast['action'],
  ) => string;
  dismissToast: (id: string) => void;
  clearAll: () => void;
}

export const useToastStore = create<ToastState>()((set) => ({
  toasts: [],

  addToast: (level, message, detail, action) => {
    const id = nextId();
    const toast: Toast = {
      id,
      level,
      message,
      detail,
      timestamp: new Date().toISOString(),
      action,
    };

    set((state) => {
      const toasts = [...state.toasts, toast];
      // Keep only the newest MAX_TOASTS
      return { toasts: toasts.slice(-MAX_TOASTS) };
    });

    // Auto-dismiss based on level
    const duration = AUTO_DISMISS[level];
    if (duration !== null) {
      setTimeout(() => {
        set((state) => ({ toasts: state.toasts.filter((t) => t.id !== id) }));
      }, duration);
    }

    return id;
  },

  dismissToast: (id) => {
    set((state) => ({ toasts: state.toasts.filter((t) => t.id !== id) }));
  },

  clearAll: () => {
    set({ toasts: [] });
  },
}));
