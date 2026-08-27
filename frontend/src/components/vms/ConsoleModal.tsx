/**
 * ConsoleModal
 * Connects to the backend WebSocket console proxy (/api/v1/ws/console/{token})
 * and renders live VM screenshots (base64 JPEG frames) at ~1 fps.
 *
 * Protocol (server → client):
 *   { type: "frame",  data: "<base64-jpeg>" }
 *   { type: "info",   vm: "...", host: "...", message: "..." }
 *   { type: "error",  message: "..." }
 *   { type: "ping" }
 */
import { useEffect, useRef, useState, useCallback } from 'react'
import { vmApi } from '@/lib/api'
import { X, Maximize2, Minimize2, MonitorPlay, RefreshCw } from 'lucide-react'

interface Props {
  vmName: string
  hypervisorId: string
  onClose: () => void
}

type Status = 'connecting' | 'ready' | 'error'

export default function ConsoleModal({ vmName, hypervisorId, onClose }: Props) {
  const [status, setStatus]       = useState<Status>('connecting')
  const [errMsg, setErrMsg]       = useState('')
  const [fullscreen, setFullscreen] = useState(false)
  const [frameUrl, setFrameUrl]   = useState<string | null>(null)
  const [fps, setFps]             = useState(0)
  const wsRef   = useRef<WebSocket | null>(null)
  const frameCount = useRef(0)
  const fpsTimer   = useRef<ReturnType<typeof setInterval> | null>(null)

  const connect = useCallback(() => {
    setStatus('connecting')
    setErrMsg('')
    setFrameUrl(null)

    vmApi.consoleToken(hypervisorId, vmName)
      .then((data: { token: string; ws_url: string }) => {
        // Build WS URL — same host as the page, relative path
        const proto = window.location.protocol === 'https:' ? 'wss' : 'ws'
        const wsUrl = `${proto}://${window.location.host}/api/v1/ws/console/${data.token}`

        const ws = new WebSocket(wsUrl)
        wsRef.current = ws

        ws.onopen = () => {
          // Start FPS counter
          fpsTimer.current = setInterval(() => {
            setFps(frameCount.current)
            frameCount.current = 0
          }, 1000)
        }

        ws.onmessage = (event) => {
          try {
            const msg = JSON.parse(event.data) as {
              type: string; data?: string; message?: string
            }
            if (msg.type === 'frame' && msg.data) {
              setFrameUrl(`data:image/jpeg;base64,${msg.data}`)
              setStatus('ready')
              frameCount.current += 1
            } else if (msg.type === 'error' && msg.message) {
              setErrMsg(msg.message)
              setStatus('error')
            }
            // info / ping — no UI action needed
          } catch { /* ignore malformed */ }
        }

        ws.onerror = () => {
          setErrMsg('WebSocket connection error.')
          setStatus('error')
        }

        ws.onclose = (ev) => {
          if (fpsTimer.current) clearInterval(fpsTimer.current)
          if (ev.code === 4401) {
            setErrMsg('Console token expired. Click Reconnect to try again.')
            setStatus('error')
          }
        }
      })
      .catch((e: any) => {
        setErrMsg(e?.response?.data?.detail ?? 'Failed to issue console session token.')
        setStatus('error')
      })
  }, [hypervisorId, vmName])

  // Initial connection
  useEffect(() => {
    connect()
    return () => {
      wsRef.current?.close()
      if (fpsTimer.current) clearInterval(fpsTimer.current)
    }
  }, [connect])

  const modalClass = fullscreen
    ? 'fixed inset-0 z-50 flex flex-col'
    : 'fixed inset-0 z-50 flex items-center justify-center bg-black/60'

  const panelClass = fullscreen
    ? 'flex flex-col w-full h-full'
    : 'flex flex-col w-full max-w-5xl rounded-xl border shadow-2xl'

  return (
    <div className={modalClass}>
      <div className={panelClass} style={{ background: '#111', borderColor: 'var(--border)' }}>

        {/* ── Header ─────────────────────────────────────────────── */}
        <div className="flex items-center justify-between px-4 py-3 border-b shrink-0"
          style={{ borderColor: 'var(--border)', background: 'var(--surface)' }}>
          <div className="flex items-center gap-2">
            <MonitorPlay size={15} style={{ color: 'var(--accent)' }} />
            <span className="text-sm font-semibold" style={{ color: 'var(--text)' }}>
              Console — {vmName}
            </span>
            <span className={`badge text-xs ${
              status === 'ready'       ? 'badge-running'
              : status === 'error'    ? 'badge-offline'
              : 'badge-paused'
            }`}>
              {status === 'connecting' ? 'Connecting…'
               : status === 'ready'   ? `Live · ${fps} fps`
               : 'Error'}
            </span>
          </div>
          <div className="flex items-center gap-1">
            {status === 'error' && (
              <button className="btn-ghost p-1.5" title="Reconnect" onClick={connect}>
                <RefreshCw size={14} />
              </button>
            )}
            <button className="btn-ghost p-1.5" title={fullscreen ? 'Exit fullscreen' : 'Fullscreen'}
              onClick={() => setFullscreen((f) => !f)}>
              {fullscreen ? <Minimize2 size={14} /> : <Maximize2 size={14} />}
            </button>
            <button className="btn-ghost p-1.5" onClick={() => {
              wsRef.current?.close()
              onClose()
            }}><X size={16} /></button>
          </div>
        </div>

        {/* ── Console viewport ────────────────────────────────────── */}
        <div className="flex-1 relative overflow-hidden"
          style={{ background: '#000', minHeight: fullscreen ? 0 : 500 }}>

          {status === 'connecting' && (
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-3"
              style={{ color: 'var(--text-muted)' }}>
              <div className="w-8 h-8 border-2 border-t-transparent rounded-full animate-spin"
                style={{ borderColor: 'var(--accent)' }} />
              <p className="text-sm">Opening console for <strong style={{ color: 'var(--text)' }}>{vmName}</strong>…</p>
            </div>
          )}

          {status === 'error' && (
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 p-6"
              style={{ color: 'var(--danger)' }}>
              <MonitorPlay size={40} strokeWidth={1} />
              <p className="text-sm font-semibold">Console unavailable</p>
              <p className="text-xs text-center" style={{ color: 'var(--text-muted)', maxWidth: 400 }}>{errMsg}</p>
              <button className="btn-secondary mt-2 text-xs" onClick={connect}>
                <RefreshCw size={13} /> Reconnect
              </button>
            </div>
          )}

          {/* Live screenshot frames */}
          {frameUrl && (
            <img
              src={frameUrl}
              alt={`Console: ${vmName}`}
              className="w-full h-full object-contain"
              style={{ imageRendering: 'pixelated' }}
              draggable={false}
            />
          )}
        </div>

        {/* ── Hint bar ────────────────────────────────────────────── */}
        {status === 'ready' && (
          <div className="px-4 py-2 text-xs border-t shrink-0"
            style={{ borderColor: 'var(--border)', background: 'var(--surface)', color: 'var(--text-muted)' }}>
            Read-only screenshot view · ~1 fps via WinRM · For full interactive console use
            <strong style={{ color: 'var(--text)' }}> VMConnect.exe</strong> on the Hyper-V host
          </div>
        )}

      </div>
    </div>
  )
}
