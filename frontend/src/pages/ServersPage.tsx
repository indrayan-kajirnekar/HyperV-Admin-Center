/**
 * Servers Page
 * Full management UI for Hyper-V hosts (hypervisors).
 * - Searchable / filterable table with online/offline badges
 * - Register new server, edit, toggle online/offline, delete
 * - Per-row VM count from cache (zero latency)
 * - Folder assignment visible inline
 */
import { useState, useMemo } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { serverApi, folderApi } from '@/lib/api'
import {
  Server, Plus, Pencil, Trash2, ToggleLeft, ToggleRight,
  Search, X, Cpu,
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
  created_at?: string
  last_seen_at?: string
}

interface FolderData { id: string; name: string }

export default function ServersPage() {
  const qc = useQueryClient()
  const [filter, setFilter] = useState('')
  const [statusFilter, setStatusFilter] = useState<'All' | 'Online' | 'Offline'>('All')
  const [showRegister, setShowRegister] = useState(false)
  const [editServer, setEditServer] = useState<HypervisorRecord | null>(null)

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
      <div
        className="flex items-center gap-2 px-6 py-3 border-b"
        style={{ borderColor: 'var(--border)', background: 'var(--surface)' }}
      >
        <div className="relative flex-1 max-w-xs">
          <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2"
            style={{ color: 'var(--text-muted)' }} />
          <input
            className="input pl-8 h-8 text-xs"
            placeholder="Search by hostname, name or folder…"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
          />
          {filter && (
            <button className="absolute right-2 top-1/2 -translate-y-1/2"
              style={{ color: 'var(--text-muted)' }} onClick={() => setFilter('')}>
              <X size={13} />
            </button>
          )}
        </div>
        <div className="flex rounded-md overflow-hidden border" style={{ borderColor: 'var(--border)' }}>
          {(['All', 'Online', 'Offline'] as const).map((opt) => (
            <button
              key={opt}
              className="px-3 py-1 text-xs font-medium transition-colors"
              style={{
                background: statusFilter === opt ? 'var(--accent)' : 'var(--surface)',
                color: statusFilter === opt ? '#fff' : 'var(--text-muted)',
              }}
              onClick={() => setStatusFilter(opt)}
            >
              {opt}
            </button>
          ))}
        </div>
      </div>

      {/* Table header */}
      <div
        className="flex items-center gap-3 px-6 py-2 text-xs font-semibold uppercase tracking-wide border-b"
        style={{ color: 'var(--text-muted)', borderColor: 'var(--border)', background: 'var(--surface)' }}
      >
        <span className="flex-[2]">Hostname / Name</span>
        <span className="w-20">Status</span>
        <span className="flex-1">Folder</span>
        <span className="w-20 text-right">VMs</span>
        <span className="w-28 text-right">CPU Cores</span>
        <span className="w-28 text-right">RAM (GB)</span>
        <span className="w-28 text-right">Storage (GB)</span>
        <span className="w-28 text-right">Actions</span>
      </div>

      {/* Rows */}
      <div className="flex-1 overflow-y-auto virt-scroll" style={{ background: 'var(--bg)' }}>
        {isLoading && (
          Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="flex items-center gap-3 px-6 py-3 border-b animate-pulse"
              style={{ borderColor: 'var(--border)' }}>
              {[...[2, 1, 1, 1, 1, 1, 1, 1]].map((w, j) => (
                <span key={j} className={`flex-[${w}] h-4 rounded`}
                  style={{ background: 'var(--surface-2)', flexBasis: `${w * 60}px` }} />
              ))}
            </div>
          ))
        )}

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
          <div
            key={s.id}
            className="flex items-center gap-3 px-6 py-3 border-b table-row-hover"
            style={{ borderColor: 'var(--border)' }}
          >
            {/* Hostname / Name */}
            <div className="flex-[2] min-w-0">
              <p className="text-sm font-medium truncate" style={{ color: 'var(--text)' }}>
                {s.display_name ?? s.hostname}
              </p>
              {s.display_name && (
                <p className="text-xs font-mono truncate" style={{ color: 'var(--text-muted)' }}>
                  {s.hostname}
                </p>
              )}
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
            <span className="w-20 text-right">
              <span className="inline-flex items-center gap-1 text-xs font-medium tabular-nums"
                style={{ color: 'var(--text)' }}>
                <Cpu size={12} style={{ color: 'var(--accent)' }} />
                {s.vm_count}
              </span>
            </span>

            {/* Capacities */}
            <span className="w-28 text-right text-xs tabular-nums" style={{ color: 'var(--text-muted)' }}>
              {s.total_cpu_cores ?? '—'}
            </span>
            <span className="w-28 text-right text-xs tabular-nums" style={{ color: 'var(--text-muted)' }}>
              {s.total_memory_gb != null ? s.total_memory_gb.toFixed(0) : '—'}
            </span>
            <span className="w-28 text-right text-xs tabular-nums" style={{ color: 'var(--text-muted)' }}>
              {s.total_storage_gb != null ? s.total_storage_gb.toFixed(0) : '—'}
            </span>

            {/* Actions */}
            <div className="w-28 flex items-center justify-end gap-0.5">
              <button
                className="btn-ghost p-1.5" title={s.is_online ? 'Mark offline' : 'Mark online'}
                onClick={() => toggleMut.mutate(s.id)}
                disabled={toggleMut.isPending}
              >
                {s.is_online
                  ? <ToggleRight size={16} style={{ color: 'var(--success)' }} />
                  : <ToggleLeft size={16} style={{ color: 'var(--text-muted)' }} />}
              </button>
              <button
                className="btn-ghost p-1.5" title="Edit server"
                onClick={() => setEditServer(s)}
              >
                <Pencil size={13} />
              </button>
              <button
                className="btn-ghost p-1.5" title="Remove server"
                onClick={() => {
                  if (confirm(`Remove server "${s.display_name ?? s.hostname}"?\nThis does not delete any VMs.`)) {
                    deleteMut.mutate(s.id)
                  }
                }}
              >
                <Trash2 size={13} style={{ color: 'var(--danger)' }} />
              </button>
            </div>
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
  const [form, setForm] = useState({
    hostname:       existing?.hostname ?? '',
    display_name:   existing?.display_name ?? '',
    folder_id:      existing?.folder_id ?? '',
    total_cpu_cores:   existing?.total_cpu_cores ?? '',
    total_memory_gb:   existing?.total_memory_gb ?? '',
    total_storage_gb:  existing?.total_storage_gb ?? '',
  })
  const [apiError, setApiError] = useState('')

  function set(k: string, v: unknown) { setForm((f) => ({ ...f, [k]: v })); setApiError('') }
  const numOrNull = (v: unknown) => (v === '' || v === null || v === undefined) ? null : Number(v)

  const mut = useMutation({
    mutationFn: () => {
      const body = {
        hostname:        form.hostname,
        display_name:    form.display_name || null,
        folder_id:       form.folder_id || null,
        total_cpu_cores:   numOrNull(form.total_cpu_cores),
        total_memory_gb:   numOrNull(form.total_memory_gb),
        total_storage_gb:  numOrNull(form.total_storage_gb),
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
      <div
        className="w-full max-w-md rounded-xl border shadow-2xl"
        style={{ background: 'var(--surface)', borderColor: 'var(--border)' }}
      >
        {/* Header */}
        <div
          className="flex items-center justify-between px-5 py-4 border-b"
          style={{ borderColor: 'var(--border)' }}
        >
          <div className="flex items-center gap-2">
            <Server size={16} style={{ color: 'var(--accent)' }} />
            <h2 className="text-sm font-semibold" style={{ color: 'var(--text)' }}>
              {existing ? 'Edit Server' : 'Register Hyper-V Server'}
            </h2>
          </div>
          <button className="btn-ghost p-1.5" onClick={onClose}><X size={16} /></button>
        </div>

        <div className="p-5 space-y-4">
          {apiError && (
            <div
              className="rounded-md border p-3 text-xs"
              style={{ borderColor: 'var(--danger)', background: 'rgba(220,38,38,0.08)', color: 'var(--danger)' }}
            >
              {apiError}
            </div>
          )}

          {/* Hostname */}
          <div>
            <label className="block text-xs font-medium mb-1" style={{ color: 'var(--text-muted)' }}>
              Hostname / IP Address <span style={{ color: 'var(--danger)' }}>*</span>
            </label>
            <input
              className="input font-mono"
              placeholder="host1.corp.local or 192.168.1.10"
              value={form.hostname}
              onChange={(e) => set('hostname', e.target.value)}
              autoFocus={!existing}
            />
            <p className="text-xs mt-1" style={{ color: 'var(--text-muted)' }}>
              Must be reachable via WinRM from the HyperVision backend.
            </p>
          </div>

          {/* Display Name */}
          <div>
            <label className="block text-xs font-medium mb-1" style={{ color: 'var(--text-muted)' }}>
              Display Name <span style={{ color: 'var(--text-muted)' }}>(optional)</span>
            </label>
            <input
              className="input"
              placeholder="e.g. HV-Node-01"
              value={form.display_name}
              onChange={(e) => set('display_name', e.target.value)}
            />
          </div>

          {/* Folder */}
          <div>
            <label className="block text-xs font-medium mb-1" style={{ color: 'var(--text-muted)' }}>
              Assign to Folder
            </label>
            <select className="select" value={form.folder_id} onChange={(e) => set('folder_id', e.target.value)}>
              <option value="">— Unassigned —</option>
              {folders.map((f) => (
                <option key={f.id} value={f.id}>{f.name}</option>
              ))}
            </select>
          </div>

          {/* Capacities */}
          <div className="border-t pt-4" style={{ borderColor: 'var(--border)' }}>
            <p className="text-xs font-semibold uppercase tracking-wide mb-3" style={{ color: 'var(--text-muted)' }}>
              Physical Capacity <span className="normal-case font-normal">(optional — used for quota calculations)</span>
            </p>
            <div className="grid grid-cols-3 gap-3">
              <div>
                <label className="block text-xs font-medium mb-1" style={{ color: 'var(--text-muted)' }}>CPU Cores</label>
                <input
                  type="number" min={1} className="input"
                  placeholder="e.g. 32"
                  value={form.total_cpu_cores}
                  onChange={(e) => set('total_cpu_cores', e.target.value)}
                />
              </div>
              <div>
                <label className="block text-xs font-medium mb-1" style={{ color: 'var(--text-muted)' }}>RAM (GB)</label>
                <input
                  type="number" min={0} step={1} className="input"
                  placeholder="e.g. 256"
                  value={form.total_memory_gb}
                  onChange={(e) => set('total_memory_gb', e.target.value)}
                />
              </div>
              <div>
                <label className="block text-xs font-medium mb-1" style={{ color: 'var(--text-muted)' }}>Storage (GB)</label>
                <input
                  type="number" min={0} step={1} className="input"
                  placeholder="e.g. 4096"
                  value={form.total_storage_gb}
                  onChange={(e) => set('total_storage_gb', e.target.value)}
                />
              </div>
            </div>
          </div>
        </div>

        <div
          className="flex justify-end gap-2 px-5 py-4 border-t"
          style={{ borderColor: 'var(--border)' }}
        >
          <button className="btn-ghost" onClick={onClose}>Cancel</button>
          <button
            className="btn-primary"
            disabled={!form.hostname.trim() || mut.isPending}
            onClick={() => mut.mutate()}
          >
            {mut.isPending ? 'Saving…' : existing ? 'Save Changes' : 'Register Server'}
          </button>
        </div>
      </div>
    </div>
  )
}
