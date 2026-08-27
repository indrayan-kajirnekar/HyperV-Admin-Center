import { create } from 'zustand'

interface WsEvent {
  id: string
  type: string
  ts: string
  [key: string]: unknown
}

interface EventBusState {
  events: WsEvent[]
  connected: boolean
  push: (e: WsEvent) => void
  setConnected: (v: boolean) => void
  clear: () => void
}

export const useEventBus = create<EventBusState>((set) => ({
  events: [],
  connected: false,
  push: (e) => set((s) => ({ events: [e, ...s.events].slice(0, 500) })),
  setConnected: (v) => set({ connected: v }),
  clear: () => set({ events: [] }),
}))
