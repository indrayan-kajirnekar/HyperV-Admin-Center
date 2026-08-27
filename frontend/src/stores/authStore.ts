import { create } from 'zustand'
import { persist } from 'zustand/middleware'

interface AuthState {
  token: string | null
  userId: string | null
  email: string | null
  role: string | null
  fullName: string | null
  setAuth: (data: { token: string; userId: string; email: string; role: string; fullName: string }) => void
  logout: () => void
}

export const useAuthStore = create<AuthState>()(
  persist(
    (set) => ({
      token: null,
      userId: null,
      email: null,
      role: null,
      fullName: null,
      setAuth: ({ token, userId, email, role, fullName }) =>
        set({ token, userId, email, role, fullName }),
      logout: () => set({ token: null, userId: null, email: null, role: null, fullName: null }),
    }),
    { name: 'hv-auth' }
  )
)
