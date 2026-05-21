import { create } from 'zustand';
import type { ChatMessage } from '@/types';

interface ChatState {
  messages: ChatMessage[];
  selectedSkill: string;
  useRag: boolean;
  useTools: boolean;
  addMessage: (msg: ChatMessage) => void;
  updateLastAssistant: (updater: (msg: ChatMessage) => ChatMessage) => void;
  clearMessages: () => void;
  setSelectedSkill: (skill: string) => void;
  setUseRag: (v: boolean) => void;
  setUseTools: (v: boolean) => void;
}

export const useChatStore = create<ChatState>((set) => ({
  messages: [],
  selectedSkill: 'general-assistant',
  useRag: true,
  useTools: true,

  addMessage: (msg) =>
    set((state) => ({ messages: [...state.messages, msg] })),

  updateLastAssistant: (updater) =>
    set((state) => {
      const copy = [...state.messages];
      for (let i = copy.length - 1; i >= 0; i--) {
        if (copy[i].role === 'assistant') {
          copy[i] = updater(copy[i]);
          break;
        }
      }
      return { messages: copy };
    }),

  clearMessages: () => set({ messages: [] }),
  setSelectedSkill: (selectedSkill) => set({ selectedSkill }),
  setUseRag: (useRag) => set({ useRag }),
  setUseTools: (useTools) => set({ useTools }),
}));
