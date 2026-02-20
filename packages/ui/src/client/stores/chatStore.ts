import { create } from 'zustand';
import type { Message } from '@antimatter/agent-framework';
import type { Identifier } from '@antimatter/project-model';

export interface ChatMessage extends Message {
  id: string;
  agentRole?: string;
}

interface ChatStore {
  messages: ChatMessage[];
  isTyping: boolean;
  currentAgent: Identifier | null;
  streamingMessageId: string | null;
  abortController: AbortController | null;
  pendingMessage: string | null;

  addMessage: (message: Omit<ChatMessage, 'id' | 'timestamp'>) => string;
  addStreamingMessage: () => string;
  appendToMessage: (id: string, delta: string) => void;
  finalizeStreaming: () => void;
  setTyping: (isTyping: boolean) => void;
  setCurrentAgent: (agentId: Identifier) => void;
  clearMessages: () => void;
  setAbortController: (controller: AbortController | null) => void;
  cancelChat: () => void;
  setPendingMessage: (message: string | null) => void;
  setMessageAgentRole: (id: string, agentRole: string) => void;
}

export const useChatStore = create<ChatStore>((set, get) => ({
  messages: [],
  isTyping: false,
  currentAgent: 'assistant' as Identifier,
  streamingMessageId: null,
  abortController: null,
  pendingMessage: null,

  addMessage: (message) => {
    const id = Math.random().toString(36).substring(7);
    set((state) => ({
      messages: [
        ...state.messages,
        {
          ...message,
          id,
          timestamp: new Date().toISOString(),
        },
      ],
    }));
    return id;
  },

  addStreamingMessage: () => {
    const id = Math.random().toString(36).substring(7);
    set((state) => ({
      streamingMessageId: id,
      messages: [
        ...state.messages,
        {
          id,
          role: 'assistant' as const,
          content: '',
          timestamp: new Date().toISOString(),
        },
      ],
    }));
    return id;
  },

  appendToMessage: (id, delta) =>
    set((state) => ({
      messages: state.messages.map((msg) =>
        msg.id === id ? { ...msg, content: msg.content + delta } : msg,
      ),
    })),

  finalizeStreaming: () =>
    set({ streamingMessageId: null }),

  setTyping: (isTyping) => set({ isTyping }),

  setCurrentAgent: (agentId) => set({ currentAgent: agentId }),

  clearMessages: () => set({ messages: [], streamingMessageId: null }),

  setAbortController: (controller) => set({ abortController: controller }),

  cancelChat: () => {
    const { abortController } = get();
    if (abortController) {
      abortController.abort();
      set({ abortController: null, isTyping: false, streamingMessageId: null });
    }
  },

  setPendingMessage: (message) => set({ pendingMessage: message }),

  setMessageAgentRole: (id, agentRole) =>
    set((state) => ({
      messages: state.messages.map((msg) =>
        msg.id === id ? { ...msg, agentRole } : msg,
      ),
    })),
}));
