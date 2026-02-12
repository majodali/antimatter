import { create } from 'zustand';
import type { Message } from '@antimatter/agent-framework';
import type { Identifier } from '@antimatter/project-model';

interface ChatMessage extends Message {
  id: string;
}

interface ChatStore {
  messages: ChatMessage[];
  isTyping: boolean;
  currentAgent: Identifier | null;

  addMessage: (message: Omit<ChatMessage, 'id' | 'timestamp'>) => void;
  setTyping: (isTyping: boolean) => void;
  setCurrentAgent: (agentId: Identifier) => void;
  clearMessages: () => void;
}

export const useChatStore = create<ChatStore>((set) => ({
  messages: [],
  isTyping: false,
  currentAgent: 'assistant' as Identifier,

  addMessage: (message) =>
    set((state) => ({
      messages: [
        ...state.messages,
        {
          ...message,
          id: Math.random().toString(36).substring(7),
          timestamp: new Date().toISOString(),
        },
      ],
    })),

  setTyping: (isTyping) => set({ isTyping }),

  setCurrentAgent: (agentId) => set({ currentAgent: agentId }),

  clearMessages: () => set({ messages: [] }),
}));
