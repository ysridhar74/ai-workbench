import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { User } from '@/types';

interface UserState {
  currentUser: User | null;
  setCurrentUser: (user: User | null) => void;
}

export const useUserStore = create<UserState>()(
  persist(
    (set) => ({
      currentUser: null,
      setCurrentUser: (currentUser) => set({ currentUser }),
    }),
    {
      name: 'ai-workbench-user',
    },
  ),
);
