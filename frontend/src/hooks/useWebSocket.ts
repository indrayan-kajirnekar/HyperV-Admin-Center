import { useEffect, useRef } from 'react'
import { useAuthStore } from '@/stores/authStore'
import { useEventBus } from '@/stores/eventBusStore'
import { useQueryClient } from '@tanstack/react-query'

const WS_URL = `${window.location.protocol === 'https:' ? 'wss' : 'ws'}://${window.location.host}/api/v1/ws/events`

let reconnectTimer: ReturnType<typeof setTimeout> | null = null

export function useWebSocket(): { connected: boolean } {
  const ws = useRef<WebSocket | null>(null)
  const { push, setConnected, connected } = useEventBus()
  const token = useAuthStore((s) => s.token)
  const queryClient = useQueryClient()

  useEffect(() => {
    if (!token) return

    function connect() {
      const socket = new WebSocket(`${WS_URL}?token=${token}`)
      ws.current = socket

      socket.onopen = () => {
        setConnected(true)
        if (reconnectTimer) { clearTimeout(reconnectTimer); reconnectTimer = null }
      }

      socket.onmessage = (ev) => {
        try {
          const data = JSON.parse(ev.data)
          if (data.type === 'ping') return
          push({ ...data, id: data.id ?? crypto.randomUUID(), ts: data.ts ?? new Date().toISOString() })
          // Invalidate VM query on background poll update
          if (data.type === 'vm_list_updated') {
            queryClient.invalidateQueries({ queryKey: ['vms'] })
          }
        } catch { /* ignore malformed */ }
      }

      socket.onclose = () => {
        setConnected(false)
        ws.current = null
        reconnectTimer = setTimeout(connect, 3000)
      }

      socket.onerror = () => { socket.close() }
    }

    connect()
    return () => {
      if (reconnectTimer) clearTimeout(reconnectTimer)
      ws.current?.close()
    }
  }, [token]) // eslint-disable-line react-hooks/exhaustive-deps

  return { connected }
}
