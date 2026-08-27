/**
 * ConsoleModal
 * Opens an in-app VM console using a WebSocket-based noVNC-style viewer.
 * The backend issues a short-lived token; this component opens the WS URL
 * and renders the terminal/screen inside the modal frame.
 */
import { useEffect, useRef, useState } from 'react'
import { vmApi } from '@/lib/api'
import { X, Maximize2, Minimize2, MonitorPlay } from 'lucide-react'

interface Props {
  vmName: string
  hypervisorId: string
  onClose: () => void
}

export default function ConsoleModal({ vmName, hypervisorId, onClose }: Props) {
  const iframeRef = useRef<HTMLIFrameElement>(null)
  const [status, setStatus] = useState<'connecting' | 'ready' | 'error'>('connecting')
  const [errMsg, setErrMsg] = useState('')
  const [fullscreen, setFullscreen] = useState(false)
  const [consoleUrl, setConsoleUrl] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    vmApi.consoleToken(hypervisorId, vmName)
      .then((data: { token: string; ws_url: string }) => {
        if (cancelled) return
        // Build the noVNC viewer URL — served by the backend WebSocket proxy
        // The token encodes which VM/host to connect to server-side
        const wsPath = data.ws_url.replace('/api/v1', '')
        const viewerUrl = `/api/v1/ws/console/viewer?token=${data.token}&wsPath=${encodeURIComponent(wsPath)}`
        setConsoleUrl(viewerUrl)
        setStatus('ready')
      })
      .catch((e: any) => {
        if (cancelled) return
        setErrMsg(e?.response?.data?.detail ?? 'Failed to open console session.')
        setStatus('error')
      })
    return () => { cancelled = true }
  }, [hypervisorId, vmName])

  const modalClass = fullscreen
    ? 'fixed inset-0 z-50 flex flex-col'
    : 'fixed inset-0 z-50 flex items-center justify-center bg-black/60'

  const panelClass = fullscreen
    ? 'flex flex-col w-full h-full'
    : 'flex flex-col w-full max-w-4xl rounded-xl border shadow-2xl'

  return (
    <div className={modalClass}>
      <div className={panelClass} style={{ background: '#111', borderColor: 'var(--border)' }}>
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b shrink-0"
          style={{ borderColor: 'var(--border)', background: 'var(--surface)' }}>
          <div className="flex items-center gap-2">
            <MonitorPlay size={15} style={{ color: 'var(--accent)' }} />
            <span className="text-sm font-semibold" style={{ color: 'var(--text)' }}>
              Console — {vmName}
            </span>
            <span className={`badge text-xs ${status === 'ready' ? 'badge-running' : status === 'error' ? 'badge-offline' : 'badge-paused'}`}>
              {status === 'connecting' ? 'Connecting…' : status === 'ready' ? 'Connected' : 'Error'}
            </span>
          </div>
          <div className="flex items-center gap-1">
            <button className="btn-ghost p-1.5" title={fullscreen ? 'Exit fullscreen' : 'Fullscreen'}
              onClick={() => setFullscreen((f) => !f)}>
              {fullscreen ? <Minimize2 size={14} /> : <Maximize2 size={14} />}
            </button>
            <button className="btn-ghost p-1.5" onClick={onClose}><X size={16} /></button>
          </div>
        </div>

        {/* Console viewport */}
        <div className="flex-1 relative overflow-hidden" style={{ background: '#000', minHeight: fullscreen ? 0 : 480 }}>
          {status === 'connecting' && (
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-3"
              style={{ color: 'var(--text-muted)' }}>
              <div className="w-8 h-8 border-2 border-t-transparent rounded-full animate-spin"
                style={{ borderColor: 'var(--accent)' }} />
              <p className="text-sm">Opening console session for <strong style={{ color: 'var(--text)' }}>{vmName}</strong>…</p>
            </div>
          )}

          {status === 'error' && (
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 p-6"
              style={{ color: 'var(--danger)' }}>
              <MonitorPlay size={36} strokeWidth={1} />
              <p className="text-sm font-semibold">Console unavailable</p>
              <p className="text-xs text-center" style={{ color: 'var(--text-muted)', maxWidth: 360 }}>{errMsg}</p>
              <p className="text-xs text-center" style={{ color: 'var(--text-muted)', maxWidth: 360 }}>
                Ensure the VM is running and the backend has RDP/VNC access to the Hyper-V host.
              </p>
            </div>
          )}

          {status === 'ready' && consoleUrl && (
            <iframe
              ref={iframeRef}
              src={consoleUrl}
              className="w-full h-full border-0"
              title={`Console: ${vmName}`}
              sandbox="allow-scripts allow-same-origin allow-forms"
            />
          )}
        </div>

        {/* Hint bar */}
        {status === 'ready' && (
          <div className="px-4 py-2 text-xs border-t shrink-0"
            style={{ borderColor: 'var(--border)', background: 'var(--surface)', color: 'var(--text-muted)' }}>
            Click inside the console to capture keyboard input · Press <kbd className="px-1 py-0.5 rounded text-xs"
              style={{ background: 'var(--surface-2)', border: '1px solid var(--border)' }}>Ctrl+Alt+Delete</kbd> to send SAK
          </div>
        )}
      </div>
    </div>
  )
}
