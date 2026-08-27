/**
 * Servers Page
 * Full management UI for Hyper-V hosts (hypervisors).
 * - Searchable / filterable table with online/offline badges
 * - Click row to expand: live drive usage (C:, D:, …) + VM list from host
 * - Register new server (2-step: verify creds → save), edit, toggle, delete
 * - Inline "New Folder" creation inside the modal
 */
import { useState, useMemo } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { serverApi, folderApi, vmApi } from '@/lib/api'
import {
  Server, Plus, Pencil, Trash2, ToggleLeft, ToggleRight,
  Search, X, Cpu, FolderPlus, ChevronDown, ChevronRight,
  HardDrive, Monitor,
} from 'lucide-react'
import PageHeader from '@/components/shared/PageHeader'

interface HypervisorRecord {
  id: string
  hostname: string
  display_name?: string
  folder_id?: string
  folder_name?: string
  is_online: boolean
  total_cpu_cores?: number
  total_memory_gb?: number
  total_storage_gb?: number
  vm_count: number
  has_credentials?: boolean
  winrm_username?: string
  created_at?: string
  last_seen_at?: string
}

interface FolderData { id: string; name: string }

interface DriveInfo { Drive: string; FreeGB: number; TotalGB: number }
interface VMInfo { Name: string; State: string; CPUUsage: number; MemoryAssignedGB?: number; MemoryAssigned?: number }

export default function ServersPage() {
  const qc = useQueryClient()
  const [filter, setFilter] = useState('')
  const [statusFilter, setStatusFilter] = useState<'All' | 'Online' | 'Offline'>('All')
  const [showRegister, setShowRegister] = useState(false)
  const [editServer, setEditServer] = useState<HypervisorRecord | null>(null)
  const [expandedId, setExpandedId] = useState<string | null>(null)

  const { data: servers = [], isLoading } = useQuery<HypervisorRecord[]>({
    queryKey: ['servers'],
    queryFn: () => serverApi.list(),
    refetchInterval: 30_000,
  })

  const { data: folders = [] } = useQuery<FolderData[]>({
    queryKey: ['folders'],
    queryFn: folderApi.list,
  })

  const toggleMut = useMutation({
    mutationFn: (id: string) => serverApi.toggleOnline(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['servers'] }),
  })

  const deleteMut = useMutation({
    mutationFn: (id: string) => serverApi.delete(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['servers'] })
      qc.invalidateQueries({ queryKey: ['hypervisors'] })
    },
  })

  const filtered = useMemo(() => {
    const q = filter.toLowerCase()
    return servers.filter((s) => {
      const matchesText = !q
        || s.hostname.toLowerCase().includes(q)
        || (s.display_name ?? '').toLowerCase().includes(q)
        || (s.folder_name ?? '').toLowerCase().includes(q)
      const matchesStatus =
        statusFilter === 'All'
        || (statusFilter === 'Online' && s.is_online)
        || (statusFilter === 'Offline' && !s.is_online)
      return matchesText && matchesStatus
    })
  }, [servers, filter, statusFilter])

  const onlineCount = servers.filter((s) => s.is_online).length

  return (
    <div className="flex flex-col h-full">
      <PageHeader
        title="Servers"
        subtitle={`${onlineCount} online · ${servers.length - onlineCount} offline · ${servers.length} total`}
        actions={
          <button className="btn-primary" onClick={() => setShowRegister(true)}>
            <Plus size={14} /> Register Server
          </button>
        }
      />

      {/* Toolbar */}
      <div className="flex items-center gap-2 px-6 py-3 border-b"
        style={{ borderColor: 'var(--border)', background: 'var(--surface)' }}>
        <div className="relative flex-1 max-w-xs">
          <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2"
            style={{ color: 'var(--text-muted)' }} />
          <input className="input pl-8 h-8 text-xs" placeholder="Search by hostname, name or folder…"
            value={filter} onChange={(e) => setFilter(e.target.value)} />
          {filter && (
            <button className="absolute right-2 top-1/2 -translate-y-1/2"
              style={{ color: 'var(--text-muted)' }} onClick={() => setFilter('')}>
              <X size={13} />
            </button>
          )}
        </div>
        <div className="flex rounded-md overflow-hidden border" style={{ borderColor: 'var(--border)' }}>
          {(['All', 'Online', 'Offline'] as const).map((opt) => (
            <button key={opt}
              className="px-3 py-1 text-xs font-medium transition-colors"
              style={{
                background: statusFilter === opt ? 'var(--accent)' : 'var(--surface)',
                color: statusFilter === opt ? '#fff' : 'var(--text-muted)',
              }}
              onClick={() => setStatusFilter(opt)}>
              {opt}
            </button>
          ))}
        </div>
      </div>

      {/* Table header */}
      <div className="flex items-center gap-3 px-6 py-2 text-xs font-semibold uppercase tracking-wide border-b"
        style={{ color: 'var(--text-muted)', borderColor: 'var(--border)', background: 'var(--surface)' }}>
        <span className="w-5" />
        <span className="flex-[2]">Hostname / Name</span>
        <span className="w-20">Status</span>
        <span className="flex-1">Folder</span>
        <span className="w-16 text-right">VMs</span>
        <span className="w-24 text-right">CPU Cores</span>
        <span className="w-24 text-right">RAM (GB)</span>
        <span className="w-28 text-right">Storage (GB)</span>
        <span className="w-24 text-right">Actions</span>
      </div>

      {/* Rows */}
      <div className="flex-1 overflow-y-auto virt-scroll" style={{ background: 'var(--bg)' }}>
        {isLoading && Array.from({ length: 5 }).map((_, i) => (
          <div key={i} className="flex items-center gap-3 px-6 py-3 border-b animate-pulse"
            style={{ borderColor: 'var(--border)' }}>
            {[2, 1, 1, 1, 1, 1, 1, 1].map((_, j) => (
              <span key={j} className="h-4 rounded flex-1" style={{ background: 'var(--surface-2)' }} />
            ))}
          </div>
        ))}

        {!isLoading && filtered.length === 0 && (
          <div className="flex flex-col items-center justify-center h-48 gap-3"
            style={{ color: 'var(--text-muted)' }}>
            <Server size={32} strokeWidth={1} />
            <p className="text-sm">
              {servers.length === 0
                ? 'No servers registered yet. Click "Register Server" to add your first Hyper-V host.'
                : 'No servers match your filter.'}
            </p>
          </div>
        )}

        {!isLoading && filtered.map((s) => (
          <div key={s.id}>
            {/* ── Main row ─────────────────────────────────────── */}
            <div
              className="flex items-center gap-3 px-6 py-3 border-b table-row-hover cursor-pointer"
              style={{ borderColor: 'var(--border)' }}
              onClick={() => setExpandedId(expandedId === s.id ? null : s.id)}
            >
              {/* Expand chevron */}
              <span className="w-5 shrink-0" style={{ color: 'var(--text-muted)' }}>
                {expandedId === s.id
                  ? <ChevronDown size={14} />
                  : <ChevronRight size={14} />}
              </span>

              {/* Hostname / Name */}
              <div className="flex-[2] min-w-0">
                <p className="text-sm font-medium truncate" style={{ color: 'var(--text)' }}>
                  {s.display_name ?? s.hostname}
                </p>
                <p className="text-xs font-mono truncate" style={{ color: 'var(--text-muted)' }}>
                  {s.display_name ? s.hostname : ''}
                  {s.winrm_username ? ` · ${s.winrm_username}` : ''}
                  {!s.has_credentials && !s.winrm_username
                    ? <span className="ml-1" style={{ color: 'var(--danger)' }}>⚠ no credentials</span>
                    : null}
                </p>
              </div>

              {/* Status */}
              <span className="w-20">
                {s.is_online
                  ? <span className="badge-running">Online</span>
                  : <span className="badge-offline">Offline</span>}
              </span>

              {/* Folder */}
              <span className="flex-1 text-xs truncate" style={{ color: 'var(--text-muted)' }}>
                {s.folder_name ?? <span style={{ opacity: 0.4 }}>—</span>}
              </span>

              {/* VM count */}
              <span className="w-16 text-right">
                <span className="inline-flex items-center gap-1 text-xs font-medium tabular-nums"
                  style={{ color: 'var(--text)' }}>
                  <Cpu size={12} style={{ color: 'var(--accent)' }} />
                  {s.vm_count}
                </span>
              </span>

              {/* Capacities */}
              <span className="w-24 text-right text-xs tabular-nums" style={{ color: 'var(--text-muted)' }}>
                {s.total_cpu_cores ?? '—'}
              </span>
              <span className="w-24 text-right text-xs tabular-nums" style={{ color: 'var(--text-muted)' }}>
                {s.total_memory_gb != null ? s.total_memory_gb.toFixed(0) : '—'}
              </span>
              <span className="w-28 text-right text-xs tabular-nums" style={{ color: 'var(--text-muted)' }}>
                {s.total_storage_gb != null ? s.total_storage_gb.toFixed(0) : '—'}
              </span>

              {/* Actions */}
              <div className="w-24 flex items-center justify-end gap-0.5" onClick={(e) => e.stopPropagation()}>
                <button className="btn-ghost p-1.5" title={s.is_online ? 'Mark offline' : 'Mark online'}
                  onClick={() => toggleMut.mutate(s.id)} disabled={toggleMut.isPending}>
                  {s.is_online
                    ? <ToggleRight size={16} style={{ color: 'var(--success)' }} />
                    : <ToggleLeft size={16} style={{ color: 'var(--text-muted)' }} />}
                </button>
                <button className="btn-ghost p-1.5" title="Edit server"
                  onClick={() => setEditServer(s)}>
                  <Pencil size={13} />
                </button>
                <button className="btn-ghost p-1.5" title="Remove server"
                  onClick={() => {
                    if (confirm(`Remove server "${s.display_name ?? s.hostname}"?\nThis does not delete any VMs.`))
                      deleteMut.mutate(s.id)
                  }}>
                  <Trash2 size={13} style={{ color: 'var(--danger)' }} />
                </button>
              </div>
            </div>

            {/* ── Expanded detail panel ────────────────────────── */}
            {expandedId === s.id && (
              <ServerDetailPanel server={s} />
            )}
          </div>
        ))}
      </div>

      {showRegister && (
        <ServerFormModal folders={folders} onClose={() => setShowRegister(false)} />
      )}
      {editServer && (
        <ServerFormModal folders={folders} existing={editServer} onClose={() => setEditServer(null)} />
      )}
    </div>
  )
}

// ─── Expanded Detail Panel ────────────────────────────────────────────────────

function ServerDetailPanel({ server }: { server: HypervisorRecord }) {
  const { data: drives = [], isLoading: drivesLoading, error: drivesError } = useQuery<DriveInfo[]>({
    queryKey: ['drives', server.id],
    queryFn: () => serverApi.listDrives(server.id),
    enabled: server.is_online,
    staleTime: 30_000,
    retry: 1,
  })

  const { data: vms = [], isLoading: vmsLoading } = useQuery<VMInfo[]>({
    queryKey: ['vms'],
    queryFn: vmApi.list,
    staleTime: 15_000,
  })

  const serverVMs = vms.filter((v: any) => v.hypervisor_id === server.id)

  const STATE_COLOR: Record<string, string> = {
    Running: 'var(--success)', Stopped: 'var(--danger)',
    Paused: 'var(--warning)', Off: 'var(--danger)',
  }

  return (
    <div className="border-b px-6 py-4 grid grid-cols-2 gap-6"
      style={{ borderColor: 'var(--border)', background: 'var(--surface-2)' }}>

      {/* ── Drive Usage ──────────────────────────────────────── */}
      <div>
        <div className="flex items-center gap-2 mb-3">
          <HardDrive size={13} style={{ color: 'var(--accent)' }} />
          <span className="text-xs font-semibold uppercase tracking-wide" style={{ color: 'var(--text-muted)' }}>
            Drive Usage
          </span>
        </div>

        {!server.is_online && (
          <p className="text-xs" style={{ color: 'var(--text-muted)' }}>Server is offline</p>
        )}
        {server.is_online && drivesLoading && (
          <div className="space-y-2">
            {[1, 2].map((i) => (
              <div key={i} className="h-10 rounded animate-pulse" style={{ background: 'var(--surface)' }} />
            ))}
          </div>
        )}
        {server.is_online && drivesError && (
          <p className="text-xs" style={{ color: 'var(--danger)' }}>
            Failed to fetch drives — check WinRM credentials
          </p>
        )}
        {server.is_online && !drivesLoading && drives.length === 0 && !drivesError && (
          <p className="text-xs" style={{ color: 'var(--text-muted)' }}>No drives returned from host</p>
        )}
        {server.is_online && drives.map((d) => {
          const usedGB = d.TotalGB - d.FreeGB
          const pct = d.TotalGB > 0 ? Math.round((usedGB / d.TotalGB) * 100) : 0
          const barColor = pct > 85 ? 'var(--danger)' : pct > 65 ? 'var(--warning)' : 'var(--accent)'
          return (
            <div key={d.Drive} className="mb-3">
              <div className="flex items-center justify-between mb-1">
                <span className="text-xs font-mono font-semibold" style={{ color: 'var(--text)' }}>
                  {d.Drive}
                </span>
                <span className="text-xs tabular-nums" style={{ color: 'var(--text-muted)' }}>
                  {usedGB.toFixed(1)} GB used / {d.TotalGB.toFixed(1)} GB total
                  <span className="ml-1 font-semibold" style={{ color: barColor }}>({pct}%)</span>
                </span>
              </div>
              <div className="h-2 rounded-full overflow-hidden" style={{ background: 'var(--border)' }}>
                <div className="h-2 rounded-full transition-all"
                  style={{ width: `${pct}%`, background: barColor }} />
              </div>
              <div className="flex justify-between text-xs mt-0.5" style={{ color: 'var(--text-muted)' }}>
                <span>{d.FreeGB.toFixed(1)} GB free</span>
              </div>
            </div>
          )
        })}
      </div>

      {/* ── VMs on this host ─────────────────────────────────── */}
      <div>
        <div className="flex items-center gap-2 mb-3">
          <Monitor size={13} style={{ color: 'var(--accent)' }} />
          <span className="text-xs font-semibold uppercase tracking-wide" style={{ color: 'var(--text-muted)' }}>
            Virtual Machines ({serverVMs.length})
          </span>
        </div>

        {vmsLoading && (
          <div className="space-y-1">
            {[1, 2, 3].map((i) => (
              <div key={i} className="h-7 rounded animate-pulse" style={{ background: 'var(--surface)' }} />
            ))}
          </div>
        )}

        {!vmsLoading && serverVMs.length === 0 && (
          <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
            {server.is_online
              ? 'No VMs found — poller may still be loading (wait ~15s and refresh)'
              : 'Server is offline'}
          </p>
        )}

        <div className="space-y-1 max-h-48 overflow-y-auto">
          {serverVMs.map((vm) => {
            const ramGB = vm.MemoryAssignedGB ?? (vm.MemoryAssigned ? vm.MemoryAssigned / 1073741824 : 0)
            return (
              <div key={vm.Name} className="flex items-center justify-between px-2 py-1.5 rounded text-xs"
                style={{ background: 'var(--surface)', border: '1px solid var(--border)' }}>
                <span className="font-medium truncate" style={{ color: 'var(--text)', maxWidth: 140 }}>{vm.Name}</span>
                <div className="flex items-center gap-3 shrink-0">
                  <span className="font-semibold" style={{ color: STATE_COLOR[vm.State] ?? 'var(--text-muted)' }}>
                    {vm.State}
                  </span>
                  <span style={{ color: 'var(--text-muted)' }}>
                    CPU {vm.CPUUsage}%
                  </span>
                  <span style={{ color: 'var(--text-muted)' }}>
                    RAM {ramGB.toFixed(1)} GB
                  </span>
                </div>
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}

// ─── Register / Edit Modal ────────────────────────────────────────────────────

function ServerFormModal({
  folders,
  existing,
  onClose,
}: {
  folders: FolderData[]
  existing?: HypervisorRecord | null
  onClose: () => void
}) {
  const qc = useQueryClient()

  const [step, setStep] = useState<'verify' | 'register'>(existing ? 'register' : 'verify')
  const [verifiedHost, setVerifiedHost] = useState(existing?.hostname ?? '')
  const [creds, setCreds] = useState({ username: existing?.winrm_username ?? '', password: '' })
  const [verifyError, setVerifyError] = useState('')

  // Inline new-folder creation
  const [showNewFolder, setShowNewFolder] = useState(false)
  const [newFolderName, setNewFolderName] = useState('')

  const createFolderMut = useMutation({
    mutationFn: (name: string) => folderApi.create({ name }),
    onSuccess: (data: any) => {
      qc.invalidateQueries({ queryKey: ['folders'] })
      set('folder_id', data.id)
      setNewFolderName('')
      setShowNewFolder(false)
    },
  })

  const [form, setForm] = useState({
    hostname:          existing?.hostname ?? '',
    display_name:      existing?.display_name ?? '',
    folder_id:         existing?.folder_id ?? '',
    total_cpu_cores:   existing?.total_cpu_cores ?? '',
    total_memory_gb:   existing?.total_memory_gb ?? '',
    total_storage_gb:  existing?.total_storage_gb ?? '',
  })
  const [apiError, setApiError] = useState('')

  function set(k: string, v: unknown) { setForm((f) => ({ ...f, [k]: v })); setApiError('') }
  const numOrNull = (v: unknown) => (v === '' || v === null || v === undefined) ? null : Number(v)

  const verifyMut = useMutation({
    mutationFn: () => serverApi.verifyCredentials({
      hostname: form.hostname,
      username: creds.username,
      password: creds.password,
    }),
    onSuccess: (data: any) => {
      setVerifiedHost(data.remote_hostname ?? form.hostname)
      setVerifyError('')
      setForm((f) => ({
        ...f,
        total_cpu_cores:  data.cpu_cores  != null ? String(data.cpu_cores)  : f.total_cpu_cores,
        total_memory_gb:  data.ram_gb     != null ? String(data.ram_gb)     : f.total_memory_gb,
        total_storage_gb: data.total_storage_gb != null ? String(data.total_storage_gb) : f.total_storage_gb,
      }))
      setStep('register')
    },
    onError: (err: any) => {
      setVerifyError(err?.response?.data?.detail ?? 'Connection failed. Check hostname and credentials.')
    },
  })

  const mut = useMutation({
    mutationFn: () => {
      const body = {
        hostname:          form.hostname,
        display_name:      form.display_name || null,
        folder_id:         form.folder_id || null,
        total_cpu_cores:   numOrNull(form.total_cpu_cores),
        total_memory_gb:   numOrNull(form.total_memory_gb),
        total_storage_gb:  numOrNull(form.total_storage_gb),
        winrm_username:    creds.username || null,
        winrm_password:    creds.password || null,
      }
      return existing
        ? serverApi.update(existing.id, body)
        : serverApi.register(body)
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['servers'] })
      qc.invalidateQueries({ queryKey: ['hypervisors'] })
      onClose()
    },
    onError: (err: any) => {
      setApiError(err?.response?.data?.detail ?? 'Failed to save server.')
    },
  })

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div className="w-full max-w-md rounded-xl border shadow-2xl"
        style={{ background: 'var(--surface)', borderColor: 'var(--border)' }}>

        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b" style={{ borderColor: 'var(--border)' }}>
          <div className="flex items-center gap-2">
            <Server size={16} style={{ color: 'var(--accent)' }} />
            <h2 className="text-sm font-semibold" style={{ color: 'var(--text)' }}>
              {existing ? 'Edit Server' : step === 'verify' ? 'Verify Server Credentials' : 'Register Hyper-V Server'}
            </h2>
          </div>
          <button className="btn-ghost p-1.5" onClick={onClose}><X size={16} /></button>
        </div>

        {/* ── STEP 1: Credential Verification ── */}
        {step === 'verify' && (
          <>
            <div className="p-5 space-y-4">
              <div className="rounded-md border p-3 text-xs"
                style={{ borderColor: 'var(--border)', background: 'var(--surface-2)', color: 'var(--text-muted)' }}>
                Credentials are verified via a live WinRM connection before the server is registered.
                They are saved per-server so the poller can fetch live VM data automatically.
              </div>
              {verifyError && (
                <div className="rounded-md border p-3 text-xs"
                  style={{ borderColor: 'var(--danger)', background: 'rgba(220,38,38,0.08)', color: 'var(--danger)' }}>
                  {verifyError}
                </div>
              )}
              <div>
                <label className="block text-xs font-medium mb-1" style={{ color: 'var(--text-muted)' }}>
                  Hostname / IP Address <span style={{ color: 'var(--danger)' }}>*</span>
                </label>
                <input className="input font-mono" placeholder="host1.corp.local or 192.168.1.10"
                  value={form.hostname} autoFocus
                  onChange={(e) => { set('hostname', e.target.value); setVerifyError('') }} />
              </div>
              <div>
                <label className="block text-xs font-medium mb-1" style={{ color: 'var(--text-muted)' }}>
                  WinRM Username <span style={{ color: 'var(--danger)' }}>*</span>
                </label>
                <input className="input font-mono" placeholder="DOMAIN\Administrator or .\Administrator"
                  value={creds.username}
                  onChange={(e) => { setCreds((c) => ({ ...c, username: e.target.value })); setVerifyError('') }} />
              </div>
              <div>
                <label className="block text-xs font-medium mb-1" style={{ color: 'var(--text-muted)' }}>
                  WinRM Password <span style={{ color: 'var(--danger)' }}>*</span>
                </label>
                <input type="password" className="input" value={creds.password}
                  onChange={(e) => { setCreds((c) => ({ ...c, password: e.target.value })); setVerifyError('') }}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && form.hostname && creds.username && creds.password) verifyMut.mutate()
                  }} />
              </div>
            </div>
            <div className="flex justify-end gap-2 px-5 py-4 border-t" style={{ borderColor: 'var(--border)' }}>
              <button className="btn-ghost" onClick={onClose}>Cancel</button>
              <button className="btn-primary"
                disabled={!form.hostname.trim() || !creds.username || !creds.password || verifyMut.isPending}
                onClick={() => verifyMut.mutate()}>
                {verifyMut.isPending ? 'Verifying…' : 'Verify & Continue'}
              </button>
            </div>
          </>
        )}

        {/* ── STEP 2: Server Details ── */}
        {step === 'register' && (
          <>
            <div className="p-5 space-y-4">
              {!existing && (
                <div className="rounded-md border p-2 text-xs flex items-center gap-2"
                  style={{ borderColor: 'var(--success)', background: 'rgba(34,197,94,0.08)', color: 'var(--success)' }}>
                  <span>✓</span>
                  <span>Connected to <strong>{verifiedHost}</strong> — credentials verified &amp; will be saved</span>
                </div>
              )}
              {apiError && (
                <div className="rounded-md border p-3 text-xs"
                  style={{ borderColor: 'var(--danger)', background: 'rgba(220,38,38,0.08)', color: 'var(--danger)' }}>
                  {apiError}
                </div>
              )}

              <div>
                <label className="block text-xs font-medium mb-1" style={{ color: 'var(--text-muted)' }}>
                  Display Name <span style={{ color: 'var(--text-muted)' }}>(optional)</span>
                </label>
                <input className="input" placeholder="e.g. HV-Node-01" value={form.display_name}
                  onChange={(e) => set('display_name', e.target.value)} autoFocus />
              </div>

              {/* Folder with inline create */}
              <div>
                <div className="flex items-center justify-between mb-1">
                  <label className="text-xs font-medium" style={{ color: 'var(--text-muted)' }}>Assign to Folder</label>
                  <button type="button" className="flex items-center gap-1 text-xs"
                    style={{ color: 'var(--accent)' }}
                    onClick={() => setShowNewFolder((v) => !v)}>
                    <FolderPlus size={12} />
                    {showNewFolder ? 'Cancel' : 'New Folder'}
                  </button>
                </div>
                {showNewFolder && (
                  <div className="flex gap-2 mb-2">
                    <input className="input flex-1 text-xs h-8" placeholder="Folder name e.g. Production"
                      autoFocus value={newFolderName}
                      onChange={(e) => setNewFolderName(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' && newFolderName.trim()) createFolderMut.mutate(newFolderName.trim())
                        if (e.key === 'Escape') setShowNewFolder(false)
                      }} />
                    <button className="btn-primary text-xs px-3 h-8"
                      disabled={!newFolderName.trim() || createFolderMut.isPending}
                      onClick={() => createFolderMut.mutate(newFolderName.trim())}>
                      {createFolderMut.isPending ? '…' : 'Create'}
                    </button>
                  </div>
                )}
                <select className="select" value={form.folder_id} onChange={(e) => set('folder_id', e.target.value)}>
                  <option value="">— Unassigned —</option>
                  {folders.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}
                </select>
              </div>

              {/* Update credentials on edit */}
              {existing && (
                <div className="border-t pt-4 space-y-3" style={{ borderColor: 'var(--border)' }}>
                  <p className="text-xs font-semibold uppercase tracking-wide" style={{ color: 'var(--text-muted)' }}>
                    Update WinRM Credentials <span className="normal-case font-normal">(leave blank to keep existing)</span>
                  </p>
                  <div>
                    <label className="block text-xs font-medium mb-1" style={{ color: 'var(--text-muted)' }}>Username</label>
                    <input className="input font-mono text-xs" placeholder="DOMAIN\username"
                      value={creds.username}
                      onChange={(e) => setCreds((c) => ({ ...c, username: e.target.value }))} />
                  </div>
                  <div>
                    <label className="block text-xs font-medium mb-1" style={{ color: 'var(--text-muted)' }}>Password</label>
                    <input type="password" className="input text-xs" placeholder="Leave blank to keep existing"
                      value={creds.password}
                      onChange={(e) => setCreds((c) => ({ ...c, password: e.target.value }))} />
                  </div>
                </div>
              )}

              <div className="border-t pt-4" style={{ borderColor: 'var(--border)' }}>
                <p className="text-xs font-semibold uppercase tracking-wide mb-3" style={{ color: 'var(--text-muted)' }}>
                  Physical Capacity <span className="normal-case font-normal">(optional — auto-filled from host)</span>
                </p>
                <div className="grid grid-cols-3 gap-3">
                  {[
                    { k: 'total_cpu_cores',  label: 'CPU Cores',   placeholder: '32' },
                    { k: 'total_memory_gb',  label: 'RAM (GB)',    placeholder: '256' },
                    { k: 'total_storage_gb', label: 'Storage (GB)', placeholder: '4096' },
                  ].map(({ k, label, placeholder }) => (
                    <div key={k}>
                      <label className="block text-xs font-medium mb-1" style={{ color: 'var(--text-muted)' }}>{label}</label>
                      <input type="number" min={0} className="input" placeholder={placeholder}
                        value={(form as any)[k]} onChange={(e) => set(k, e.target.value)} />
                    </div>
                  ))}
                </div>
              </div>
            </div>
            <div className="flex justify-between gap-2 px-5 py-4 border-t" style={{ borderColor: 'var(--border)' }}>
              {!existing && (
                <button className="btn-ghost text-xs" onClick={() => setStep('verify')}>← Back</button>
              )}
              <div className="flex gap-2 ml-auto">
                <button className="btn-ghost" onClick={onClose}>Cancel</button>
                <button className="btn-primary" disabled={mut.isPending} onClick={() => mut.mutate()}>
                  {mut.isPending ? 'Saving…' : existing ? 'Save Changes' : 'Register Server'}
                </button>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
