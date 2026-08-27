import { create } from 'zustand'
import { persist } from 'zustand/middleware'

interface ThemeState {
  theme: 'light' | 'dark'
  toggle: () => void
}

export const useThemeStore = create<ThemeState>()(
  persist(
    (set, get) => ({
      theme: 'dark',
      toggle: () => set({ theme: get().theme === 'dark' ? 'light' : 'dark' }),
    }),
    { name: 'hv-theme' }
  )
)
