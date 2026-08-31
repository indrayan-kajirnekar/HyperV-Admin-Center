/**
 * Dashboard — Windows Admin Center–style overview
 * - Summary stat cards (total VMs, running, servers, alerts)
 * - Per-server health cards with live CPU/RAM gauges and drive bars
 * - VM state breakdown donut
 * - Recent audit events feed
 */
import { useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { serverApi, vmApi, auditApi } from '@/lib/api'
import { Server, Monitor, AlertTriangle, CheckCircle, HardDrive, Cpu, MemoryStick, Activity } from 'lucide-react'
import { Link } from 'react-router-dom'

interface HV { id: string; hostname: string; display_name?: string; is_online: boolean
  total_cpu_cores?: number; total_memory_gb?: number; total_storage_gb?: number; vm_count: number }
interface VM { Name: string; State: string; CPUUsage: number; MemoryAssignedGB?: number
  hypervisor_id: string; hypervisor_hostname: string }
interface AuditEvent { id: string; action: string; resource_name?: string; user_email?: string
  status: string; created_at: string }
interface DriveInfo { Drive: string; FreeGB: number; TotalGB: number }

/* ── Mini SVG arc gauge ─────────────────────────────────────────────────────── */
function ArcGauge({ value, max, color, size = 72 }: { value: number; max: number; color: string; size?: number }) {
  const pct   = max > 0 ? Math.min(value / max, 1) : 0
  const r     = (size - 10) / 2
  const circ  = Math.PI * r   // half-circle
  const fill  = circ * pct
  const cx    = size / 2
  const cy    = size / 2 + r * 0.1
  return (
    <svg width={size} height={size / 2 + 8} viewBox={`0 0 ${size} ${size / 2 + 10}`}>
      <path d={`M ${cx - r},${cy} A ${r},${r} 0 0,1 ${cx + r},${cy}`}
        fill="none" stroke="var(--surface-3)" strokeWidth={8} strokeLinecap="round" />
      <path d={`M ${cx - r},${cy} A ${r},${r} 0 0,1 ${cx + r},${cy}`}
        fill="none" stroke={color} strokeWidth={8} strokeLinecap="round"
        strokeDasharray={`${circ}`}
        strokeDashoffset={circ - fill}
        style={{ transition: 'stroke-dashoffset 0.6s ease' }} />
      <text x={cx} y={cy + 4} textAnchor="middle" fontSize={12} fontWeight={700}
        fill="var(--text)">{Math.round(pct * 100)}%</text>
    </svg>
  )
}

/* ── Server health card ─────────────────────────────────────────────────────── */
function ServerCard({ hv, vms }: { hv: HV; vms: VM[] }) {
  const myVMs    = vms.filter(v => v.hypervisor_id === hv.id)
  const running  = myVMs.filter(v => v.State === 'Running').length
  const avgCPU   = myVMs.length ? Math.round(myVMs.reduce((s, v) => s + (v.CPUUsage || 0), 0) / myVMs.length) : 0
  const usedRAM  = myVMs.reduce((s, v) => s + (v.MemoryAssignedGB || 0), 0)
  const totalRAM = hv.total_memory_gb ?? 0

  const { data: drives = [] } = useQuery<DriveInfo[]>({
    queryKey: ['drives', hv.id],
    queryFn: () => serverApi.listDrives(hv.id),
    enabled: hv.is_online,
    staleTime: 60_000,
    retry: 1,
  })

  return (
    <div className="card overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b" style={{ borderColor: 'var(--border)' }}>
        <div className="flex items-center gap-2.5 min-w-0">
          <div className="shrink-0 w-7 h-7 rounded flex items-center justify-center"
            style={{ background: hv.is_online ? 'var(--success-bg)' : 'var(--danger-bg)' }}>
            <Server size={14} style={{ color: hv.is_online ? 'var(--success)' : 'var(--danger)' }} />
          </div>
          <div className="min-w-0">
            <p className="text-sm font-semibold truncate" style={{ color: 'var(--text)' }}>
              {hv.display_name ?? hv.hostname}
            </p>
            {hv.display_name && (
              <p className="text-xs font-mono truncate" style={{ color: 'var(--text-muted)' }}>{hv.hostname}</p>
            )}
          </div>
        </div>
        <span className={hv.is_online ? 'badge-running' : 'badge-offline'}>
          {hv.is_online ? 'Online' : 'Offline'}
        </span>
      </div>

      {/* Gauges */}
      <div className="px-4 py-3 grid grid-cols-2 gap-2">
        <div className="flex flex-col items-center gap-1">
          <ArcGauge value={avgCPU} max={100}
            color={avgCPU > 80 ? 'var(--danger)' : avgCPU > 60 ? 'var(--warning)' : 'var(--accent)'} />
          <div className="flex items-center gap-1 text-xs" style={{ color: 'var(--text-muted)' }}>
            <Cpu size={11} /> CPU avg
          </div>
        </div>
        <div className="flex flex-col items-center gap-1">
          <ArcGauge value={usedRAM} max={totalRAM || 1}
            color={totalRAM && usedRAM / totalRAM > 0.85 ? 'var(--danger)' : 'var(--accent)'} />
          <div className="flex items-center gap-1 text-xs" style={{ color: 'var(--text-muted)' }}>
            <MemoryStick size={11} /> RAM {usedRAM.toFixed(0)}/{totalRAM} GB
          </div>
        </div>
      </div>

      {/* Drives */}
      {drives.length > 0 && (
        <div className="px-4 pb-3 space-y-2">
          {drives.map(d => {
            const usedGB = d.TotalGB - d.FreeGB
            const pct    = d.TotalGB > 0 ? (usedGB / d.TotalGB) * 100 : 0
            const color  = pct > 85 ? 'var(--danger)' : pct > 65 ? 'var(--warning)' : 'var(--success)'
            return (
              <div key={d.Drive}>
                <div className="flex items-center justify-between mb-0.5">
                  <span className="text-xs font-mono font-semibold flex items-center gap-1" style={{ color: 'var(--text)' }}>
                    <HardDrive size={10} /> {d.Drive}
                  </span>
                  <span className="text-xs tabular-nums" style={{ color: 'var(--text-muted)' }}>
                    {usedGB.toFixed(0)}/{d.TotalGB.toFixed(0)} GB
                    <span className="ml-1 font-semibold" style={{ color }}>{Math.round(pct)}%</span>
                  </span>
                </div>
                <div className="progress-bar">
                  <div className="progress-fill" style={{ width: `${pct}%`, background: color }} />
                </div>
              </div>
            )
          })}
        </div>
      )}

      {/* VM summary */}
      <div className="px-4 py-2.5 border-t flex items-center justify-between"
        style={{ borderColor: 'var(--border)', background: 'var(--surface-2)' }}>
        <div className="flex items-center gap-1.5 text-xs" style={{ color: 'var(--text-muted)' }}>
          <Monitor size={12} />
          <span>{myVMs.length} VMs · <strong style={{ color: 'var(--success)' }}>{running} running</strong></span>
        </div>
        <Link to="/servers" className="text-xs font-medium" style={{ color: 'var(--accent)' }}>
          Manage →
        </Link>
      </div>
    </div>
  )
}

/* ── VM state donut ─────────────────────────────────────────────────────────── */
function VMStateDonut({ vms }: { vms: VM[] }) {
  const counts = useMemo(() => {
    const map: Record<string, number> = {}
    vms.forEach(v => { map[v.State] = (map[v.State] || 0) + 1 })
    return map
  }, [vms])

  const palette: Record<string, string> = {
    Running: 'var(--success)', Stopped: 'var(--text-subtle)',
    Paused: 'var(--warning)', Off: 'var(--text-subtle)', Saved: 'var(--info)',
  }
  const total  = vms.length
  const slices = Object.entries(counts)
  let offset   = 0
  const r      = 30
  const circ   = 2 * Math.PI * r

  return (
    <div className="card p-5">
      <p className="card-title mb-4">VM States</p>
      {total === 0
        ? <p className="text-xs text-center py-6" style={{ color: 'var(--text-muted)' }}>No VMs registered</p>
        : (
          <div className="flex items-center gap-6">
            <svg width={88} height={88} viewBox="0 0 88 88" className="shrink-0">
              {slices.map(([state, count]) => {
                const pct  = count / total
                const dash = circ * pct
                const gap  = circ - dash
                const el   = (
                  <circle key={state} cx={44} cy={44} r={r}
                    fill="none" stroke={palette[state] ?? 'var(--border)'}
                    strokeWidth={16} strokeDasharray={`${dash} ${gap}`}
                    strokeDashoffset={-offset}
                    style={{ transition: 'stroke-dashoffset 0.4s' }} />
                )
                offset += dash
                return el
              })}
              <text x={44} y={44} textAnchor="middle" dominantBaseline="middle"
                fontSize={16} fontWeight={700} fill="var(--text)">{total}</text>
              <text x={44} y={58} textAnchor="middle" fontSize={9} fill="var(--text-muted)">total</text>
            </svg>
            <div className="space-y-1.5 flex-1">
              {slices.map(([state, count]) => (
                <div key={state} className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span className="w-2.5 h-2.5 rounded-full" style={{ background: palette[state] ?? 'var(--border)' }} />
                    <span className="text-xs" style={{ color: 'var(--text-muted)' }}>{state}</span>
                  </div>
                  <span className="text-xs font-semibold tabular-nums" style={{ color: 'var(--text)' }}>
                    {count} <span style={{ color: 'var(--text-subtle)' }}>({Math.round(count / total * 100)}%)</span>
                  </span>
                </div>
              ))}
            </div>
          </div>
        )
      }
    </div>
  )
}

/* ── Recent events feed ─────────────────────────────────────────────────────── */
function RecentEvents() {
  const { data } = useQuery<{ items: AuditEvent[] }>({
    queryKey: ['audit-recent'],
    queryFn: () => auditApi.list({ limit: 8, offset: 0 }),
    refetchInterval: 30_000,
  })
  const events = data?.items ?? (Array.isArray(data) ? (data as AuditEvent[]).slice(0, 8) : [])

  const icon = (status: string) =>
    status === 'success'
      ? <CheckCircle size={13} style={{ color: 'var(--success)' }} />
      : <AlertTriangle size={13} style={{ color: 'var(--danger)' }} />

  return (
    <div className="card overflow-hidden">
      <div className="card-header">
        <span className="card-title flex items-center gap-2">
          <Activity size={14} style={{ color: 'var(--accent)' }} /> Recent Events
        </span>
        <Link to="/audit" className="text-xs" style={{ color: 'var(--accent)' }}>View all →</Link>
      </div>
      <div>
        {events.length === 0 && (
          <p className="text-xs px-4 py-6 text-center" style={{ color: 'var(--text-muted)' }}>No events yet</p>
        )}
        {events.map((e, i) => (
          <div key={e.id ?? i}
            className="flex items-start gap-3 px-4 py-3 border-b text-xs"
            style={{ borderColor: 'var(--border)' }}>
            <span className="mt-0.5 shrink-0">{icon(e.status)}</span>
            <div className="flex-1 min-w-0">
              <p className="font-medium truncate" style={{ color: 'var(--text)' }}>{e.action}</p>
              {e.resource_name && (
                <p className="truncate" style={{ color: 'var(--text-muted)' }}>{e.resource_name}</p>
              )}
            </div>
            <span className="shrink-0 tabular-nums" style={{ color: 'var(--text-subtle)' }}>
              {e.user_email?.split('@')[0]}
            </span>
          </div>
        ))}
      </div>
    </div>
  )
}

/* ── Main dashboard ─────────────────────────────────────────────────────────── */
export default function DashboardPage() {
  const { data: servers = [] } = useQuery<HV[]>({ queryKey: ['servers'], queryFn: () => serverApi.list(), refetchInterval: 30_000 })
  const { data: vms    = [] } = useQuery<VM[]>({ queryKey: ['vms'],     queryFn: vmApi.list,             refetchInterval: 20_000 })

  const onlineCount  = servers.filter(s => s.is_online).length
  const runningVMs   = vms.filter(v => v.State === 'Running').length
  const stoppedVMs   = vms.filter(v => v.State === 'Stopped' || v.State === 'Off').length
  const offlineCount = servers.filter(s => !s.is_online).length

  const stats = [
    { label: 'Servers',         value: servers.length, sub: `${onlineCount} online`,  icon: <Server  size={18} />, color: 'var(--accent)',   href: '/servers' },
    { label: 'Virtual Machines',value: vms.length,     sub: `${runningVMs} running`,  icon: <Monitor size={18} />, color: 'var(--success)',  href: '/vms' },
    { label: 'Stopped VMs',     value: stoppedVMs,     sub: 'powered off',            icon: <Monitor size={18} />, color: 'var(--text-muted)',href: '/vms' },
    { label: 'Offline Servers', value: offlineCount,   sub: offlineCount > 0 ? 'need attention' : 'all healthy',
      icon: offlineCount > 0 ? <AlertTriangle size={18} /> : <CheckCircle size={18} />,
      color: offlineCount > 0 ? 'var(--danger)' : 'var(--success)', href: '/servers' },
  ]

  return (
    <div className="flex flex-col h-full overflow-y-auto" style={{ background: 'var(--bg)' }}>
      {/* Page header */}
      <div className="px-6 py-5 border-b shrink-0"
        style={{ borderColor: 'var(--border)', background: 'var(--surface)' }}>
        <h1 className="text-xl font-bold" style={{ color: 'var(--text)' }}>Overview</h1>
        <p className="text-xs mt-0.5" style={{ color: 'var(--text-muted)' }}>
          Hyper-V infrastructure at a glance
        </p>
      </div>

      <div className="p-6 space-y-6">
        {/* Stat cards */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          {stats.map(s => (
            <Link key={s.label} to={s.href} className="stat-card hover:shadow-md transition-shadow no-underline" style={{ textDecoration: 'none' }}>
              <div className="flex items-center justify-between">
                <span className="stat-label">{s.label}</span>
                <span style={{ color: s.color, opacity: 0.8 }}>{s.icon}</span>
              </div>
              <span className="stat-value" style={{ color: s.color }}>{s.value}</span>
              <span className="text-xs" style={{ color: 'var(--text-muted)' }}>{s.sub}</span>
            </Link>
          ))}
        </div>

        {/* Middle row: donut + events */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          <VMStateDonut vms={vms} />
          <div className="lg:col-span-2">
            <RecentEvents />
          </div>
        </div>

        {/* Server health cards */}
        {servers.length > 0 && (
          <div>
            <p className="text-sm font-semibold mb-3" style={{ color: 'var(--text)' }}>
              Server Health
            </p>
            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
              {servers.map(hv => <ServerCard key={hv.id} hv={hv} vms={vms} />)}
            </div>
          </div>
        )}

        {servers.length === 0 && (
          <div className="card p-10 flex flex-col items-center gap-4">
            <Server size={40} strokeWidth={1} style={{ color: 'var(--text-subtle)' }} />
            <div className="text-center">
              <p className="text-sm font-semibold" style={{ color: 'var(--text)' }}>No servers registered</p>
              <p className="text-xs mt-1" style={{ color: 'var(--text-muted)' }}>
                Go to the Servers page to register your first Hyper-V host.
              </p>
            </div>
            <Link to="/servers" className="btn-primary">Register a Server</Link>
          </div>
        )}
      </div>
    </div>
  )
}
