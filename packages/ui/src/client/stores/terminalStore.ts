import { create } from 'zustand';

interface TerminalLine {
  id: string;
  text: string;
  timestamp: string;
  type: 'output' | 'error' | 'info' | 'success';
}

interface TerminalStore {
  lines: TerminalLine[];
  isRunning: boolean;

  addLine: (text: string, type?: TerminalLine['type']) => void;
  addLines: (lines: string[], type?: TerminalLine['type']) => void;
  clear: () => void;
  setRunning: (isRunning: boolean) => void;
}

export const useTerminalStore = create<TerminalStore>((set) => ({
  lines: [],
  isRunning: false,

  addLine: (text, type = 'output') =>
    set((state) => ({
      lines: [
        ...state.lines,
        {
          id: Math.random().toString(36).substring(7),
          text,
          timestamp: new Date().toISOString(),
          type,
        },
      ],
    })),

  addLines: (lines, type = 'output') =>
    set((state) => ({
      lines: [
        ...state.lines,
        ...lines.map((text) => ({
          id: Math.random().toString(36).substring(7),
          text,
          timestamp: new Date().toISOString(),
          type,
        })),
      ],
    })),

  clear: () => set({ lines: [] }),

  setRunning: (isRunning) => set({ isRunning }),
}));
