import { create } from 'zustand';
import { persist } from 'zustand/middleware';

/**
 * Perspective drives which axis is primary in the IDE layout.
 * See `docs/contexts.md` § Perspectives for the model.
 *
 * Today the toggle is a placeholder that claims the header real estate
 * and persists user preference; downstream filtering/highlighting will
 * be wired as the work-context tree and runtime-context list become
 * first-class data.
 */
export type Perspective = 'build' | 'ops';

interface UIStore {
  chatPanelVisible: boolean;
  toggleChatPanel: () => void;
  setChatPanelVisible: (visible: boolean) => void;

  /** Active perspective (header toggle). Persistent per user. */
  perspective: Perspective;
  setPerspective: (p: Perspective) => void;

  /**
   * Logical id of the currently selected runtime context, surfaced in
   * the Operations panel header. Today there's typically only one
   * declared env per project, so this defaults to whatever the
   * project's `wf.environment(name, ...)` advertises (or 'production'
   * as a fallback). Persistence ensures the user's last choice is
   * restored on reload.
   */
  currentRuntimeContextId: string;
  setCurrentRuntimeContextId: (id: string) => void;
}

export const useUIStore = create<UIStore>()(
  persist(
    (set) => ({
      chatPanelVisible: true,
      toggleChatPanel: () => set((s) => ({ chatPanelVisible: !s.chatPanelVisible })),
      setChatPanelVisible: (visible) => set({ chatPanelVisible: visible }),

      perspective: 'build',
      setPerspective: (p) => set({ perspective: p }),

      currentRuntimeContextId: 'production',
      setCurrentRuntimeContextId: (id) => set({ currentRuntimeContextId: id }),
    }),
    { name: 'antimatter-ui' },
  ),
);
