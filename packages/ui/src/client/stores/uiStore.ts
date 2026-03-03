import { create } from 'zustand';
import { persist } from 'zustand/middleware';

interface UIStore {
  chatPanelVisible: boolean;
  toggleChatPanel: () => void;
  setChatPanelVisible: (visible: boolean) => void;
}

export const useUIStore = create<UIStore>()(
  persist(
    (set) => ({
      chatPanelVisible: true,
      toggleChatPanel: () => set((s) => ({ chatPanelVisible: !s.chatPanelVisible })),
      setChatPanelVisible: (visible) => set({ chatPanelVisible: visible }),
    }),
    { name: 'antimatter-ui' },
  ),
);
