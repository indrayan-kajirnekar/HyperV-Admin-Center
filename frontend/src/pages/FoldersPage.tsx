/**
 * Folders & Quotas Page
 * - Folder tree with expandable quota usage bars
 * - Inline quota editor
 * - Hypervisor registration and folder assignment
 */
import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { folderApi } from '@/lib/api'
import {
  FolderOpen, Folder, Plus, Pencil, Trash2, Server, X, ChevronRight, ChevronDown,
} from 'lucide-react'
import PageHeader from '@/components/shared/PageHeader'

interface FolderData {
  id: string; name: string; parent_id: string | null; description?: string
  quota_storage_gb?: number; quota_memory_gb?: number; quota_cpu_pct?: number
  quota_max_vms?: number; soft_quota_storage_gb?: number; soft_quota_memory_gb?: number
  usage?: { storage_gb: number; memory_gb: number; cpu_pct: number; vm_count: number }
}

interface Hypervisor {
  id: string; hostname: string; display_name?: string; folder_id?: string; is_online: boolean
}

export default function FoldersPage() {
  const qc = useQueryClient()
  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  const [editFolder, setEditFolder] = useState<FolderData | null>(null)
  const [showCreateFolder, setShowCreateFolder] = useState(false)
  const [showAddHypervisor, setShowAddHypervisor] = useState(false)

  const { data: folders = [] } = useQuery<FolderData[]>({ queryKey: ['folders'], queryFn: folderApi.list })
  const { data: hypervisors = [] } = useQuery<Hypervisor[]>({ queryKey: ['hypervisors'], queryFn: folderApi.hypervisors })

  const deleteMut = useMutation({
    mutationFn: (id: string) => folderApi.delete(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['folders'] }),
  })

  const roots = folders.filter((f) => !f.parent_id)
  const byParent = folders.reduce<Record<string, FolderData[]>>((a, f) => {
    if (f.parent_id) a[f.parent_id] = [...(a[f.parent_id] ?? []), f]
    return a
  }, {})

  function toggle(id: string) {
    setExpanded((s) => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n })
  }

  function renderFolder(f: FolderData, depth = 0): React.ReactNode {
    const children = byParent[f.id] ?? []
    const isExpanded = expanded.has(f.id)
    const folderHyps = hypervisors.filter((h) => h.folder_id === f.id)
    return (
      <div key={f.id}>
        <div
          className="flex items-center gap-2 px-4 py-2.5 rounded-md group cursor-pointer hover:bg-[var(--surface-2)]"
          style={{ marginLeft: depth * 20 }}
          onClick={() => toggle(f.id)}
        >
          <span style={{ color: 'var(--text-muted)', flexShrink: 0 }}>
            {children.length > 0
              ? isExpanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />
              : <span className="w-3.5" />}
          </span>
          {isExpanded ? <FolderOpen size={16} style={{ color: 'var(--accent)' }} /> : <Folder size={16} style={{ color: 'var(--accent)' }} />}
          <span className="flex-1 text-sm font-medium" style={{ color: 'var(--text)' }}>{f.name}</span>

          {/* Quota bars */}
          {f.quota_storage_gb && (
            <QuotaBar label="Storage" used={f.usage?.storage_gb ?? 0} max={f.quota_storage_gb} unit="GB" />
          )}
          {f.quota_memory_gb && (
            <QuotaBar label="RAM" used={f.usage?.memory_gb ?? 0} max={f.quota_memory_gb} unit="GB" />
          )}

          {/* Actions */}
          <div className="flex gap-1 opacity-0 group-hover:opacity-100" onClick={(e) => e.stopPropagation()}>
            <button className="btn-ghost p-1" title="Edit quotas" onClick={() => setEditFolder(f)}>
              <Pencil size={12} />
            </button>
            <button className="btn-ghost p-1" title="Delete folder"
              onClick={() => { if (confirm(`Delete folder "${f.name}"?`)) deleteMut.mutate(f.id) }}>
              <Trash2 size={12} style={{ color: 'var(--danger)' }} />
            </button>
          </div>
        </div>

        {/* Hypervisors in this folder */}
        {isExpanded && folderHyps.length > 0 && (
          <div style={{ marginLeft: (depth + 1) * 20 + 4 }}>
            {folderHyps.map((h) => (
              <div key={h.id} className="flex items-center gap-2 px-4 py-1.5 text-xs" style={{ color: 'var(--text-muted)' }}>
                <Server size={12} />
                <span className={h.is_online ? 'text-green-500' : 'text-red-500'}>
                  {h.display_name ?? h.hostname}
                </span>
                <span className="badge" style={{ background: h.is_online ? 'var(--success)' : 'var(--danger)', color: '#fff', opacity: 0.9 }}>
                  {h.is_online ? 'online' : 'offline'}
                </span>
              </div>
            ))}
          </div>
        )}

        {/* Children */}
        {isExpanded && children.map((c) => renderFolder(c, depth + 1))}
      </div>
    )
  }

  return (
    <div className="flex flex-col h-full">
      <PageHeader
        title="Folders & Quotas"
        subtitle={`${folders.length} folders · ${hypervisors.length} hypervisors`}
        actions={
          <div className="flex gap-2">
            <button className="btn-ghost text-xs" onClick={() => setShowAddHypervisor(true)}>
              <Server size={13} /> Add Hypervisor
            </button>
            <button className="btn-primary" onClick={() => setShowCreateFolder(true)}>
              <Plus size={14} /> New Folder
            </button>
          </div>
        }
      />

      <div className="flex-1 overflow-y-auto p-6">
        <div className="card space-y-0.5">
          {roots.length === 0 && (
            <p className="text-sm p-4 text-center" style={{ color: 'var(--text-muted)' }}>
              No folders yet. Create your first folder to organize hypervisors and VMs.
            </p>
          )}
          {roots.map((f) => renderFolder(f))}
        </div>

        {/* Hypervisors without folder */}
        {hypervisors.filter((h) => !h.folder_id).length > 0 && (
          <div className="mt-6">
            <h3 className="text-xs font-semibold uppercase tracking-wide mb-2" style={{ color: 'var(--text-muted)' }}>
              Unassigned Hypervisors
            </h3>
            <div className="card space-y-2">
              {hypervisors.filter((h) => !h.folder_id).map((h) => (
                <div key={h.id} className="flex items-center gap-2 py-1 text-sm" style={{ color: 'var(--text)' }}>
                  <Server size={14} />
                  <span>{h.display_name ?? h.hostname}</span>
                  <span className={`badge ${h.is_online ? 'badge-running' : 'badge-offline'}`}>
                    {h.is_online ? 'online' : 'offline'}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {showCreateFolder && <FolderFormModal folders={folders} onClose={() => setShowCreateFolder(false)} />}
      {editFolder && <FolderFormModal folders={folders} existing={editFolder} onClose={() => setEditFolder(null)} />}
      {showAddHypervisor && <HypervisorFormModal folders={folders} onClose={() => setShowAddHypervisor(false)} />}
    </div>
  )
}

function QuotaBar({ label, used, max, unit }: { label: string; used: number; max: number; unit: string }) {
  const pct = Math.min((used / max) * 100, 100)
  const color = pct > 90 ? 'var(--danger)' : pct > 70 ? 'var(--warning)' : 'var(--success)'
  return (
    <div className="flex items-center gap-1.5 text-xs" style={{ color: 'var(--text-muted)' }}>
      <span>{label}</span>
      <div className="w-20 h-1.5 rounded-full" style={{ background: 'var(--border)' }}>
        <div className="h-full rounded-full transition-all" style={{ width: `${pct}%`, background: color }} />
      </div>
      <span className="tabular-nums">{used.toFixed(1)}/{max}{unit}</span>
    </div>
  )
}

function FolderFormModal({ folders, existing, onClose }: { folders: FolderData[]; existing?: FolderData | null; onClose: () => void }) {
  const qc = useQueryClient()
  const [form, setForm] = useState({
    name: existing?.name ?? '',
    parent_id: existing?.parent_id ?? '',
    description: existing?.description ?? '',
    quota_storage_gb: existing?.quota_storage_gb ?? '',
    quota_memory_gb: existing?.quota_memory_gb ?? '',
    quota_cpu_pct: existing?.quota_cpu_pct ?? '',
    quota_max_vms: existing?.quota_max_vms ?? '',
  })

  function set(k: string, v: unknown) { setForm((f) => ({ ...f, [k]: v })) }
  const numOrNull = (v: unknown) => v === '' ? null : Number(v)

  const mut = useMutation({
    mutationFn: () => {
      const body = {
        name: form.name, parent_id: form.parent_id || null, description: form.description,
        quota_storage_gb: numOrNull(form.quota_storage_gb),
        quota_memory_gb: numOrNull(form.quota_memory_gb),
        quota_cpu_pct: numOrNull(form.quota_cpu_pct),
        quota_max_vms: numOrNull(form.quota_max_vms),
      }
      return existing ? folderApi.update(existing.id, body) : folderApi.create(body)
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['folders'] }); onClose() },
  })

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div className="w-full max-w-md rounded-xl border shadow-2xl" style={{ background: 'var(--surface)', borderColor: 'var(--border)' }}>
        <div className="flex items-center justify-between px-5 py-4 border-b" style={{ borderColor: 'var(--border)' }}>
          <h2 className="text-sm font-semibold" style={{ color: 'var(--text)' }}>{existing ? 'Edit Folder' : 'New Folder'}</h2>
          <button className="btn-ghost p-1.5" onClick={onClose}><X size={16} /></button>
        </div>
        <div className="p-5 space-y-4">
          <div>
            <label className="block text-xs font-medium mb-1" style={{ color: 'var(--text-muted)' }}>Name</label>
            <input className="input" value={form.name} onChange={(e) => set('name', e.target.value)} />
          </div>
          <div>
            <label className="block text-xs font-medium mb-1" style={{ color: 'var(--text-muted)' }}>Parent folder</label>
            <select className="select" value={form.parent_id} onChange={(e) => set('parent_id', e.target.value)}>
              <option value="">Root level</option>
              {folders.filter(f => f.id !== existing?.id).map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}
            </select>
          </div>
          <div className="border-t pt-4" style={{ borderColor: 'var(--border)' }}>
            <p className="text-xs font-semibold uppercase tracking-wide mb-3" style={{ color: 'var(--text-muted)' }}>Hard Quotas (leave blank = unlimited)</p>
            <div className="grid grid-cols-2 gap-3">
              {[
                { k: 'quota_storage_gb', label: 'Max Storage (GB)' },
                { k: 'quota_memory_gb',  label: 'Max RAM (GB)' },
                { k: 'quota_cpu_pct',    label: 'Max CPU (%)' },
                { k: 'quota_max_vms',    label: 'Max VMs' },
              ].map(({ k, label }) => (
                <div key={k}>
                  <label className="block text-xs font-medium mb-1" style={{ color: 'var(--text-muted)' }}>{label}</label>
                  <input type="number" className="input" value={(form as any)[k]}
                    onChange={(e) => set(k, e.target.value)} placeholder="∞" />
                </div>
              ))}
            </div>
          </div>
        </div>
        <div className="flex justify-end gap-2 px-5 py-4 border-t" style={{ borderColor: 'var(--border)' }}>
          <button className="btn-ghost" onClick={onClose}>Cancel</button>
          <button className="btn-primary" disabled={!form.name || mut.isPending} onClick={() => mut.mutate()}>
            {mut.isPending ? 'Saving…' : existing ? 'Save Changes' : 'Create Folder'}
          </button>
        </div>
      </div>
    </div>
  )
}

function HypervisorFormModal({ folders, onClose }: { folders: FolderData[]; onClose: () => void }) {
  const qc = useQueryClient()
  const [hostname, setHostname] = useState('')
  const [displayName, setDisplayName] = useState('')
  const [folderId, setFolderId] = useState('')

  const mut = useMutation({
    mutationFn: () => folderApi.addHypervisor({ hostname, display_name: displayName || null, folder_id: folderId || null }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['hypervisors'] }); onClose() },
  })

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div className="w-full max-w-sm rounded-xl border shadow-2xl" style={{ background: 'var(--surface)', borderColor: 'var(--border)' }}>
        <div className="flex items-center justify-between px-5 py-4 border-b" style={{ borderColor: 'var(--border)' }}>
          <h2 className="text-sm font-semibold" style={{ color: 'var(--text)' }}>Register Hypervisor</h2>
          <button className="btn-ghost p-1.5" onClick={onClose}><X size={16} /></button>
        </div>
        <div className="p-5 space-y-4">
          <div>
            <label className="block text-xs font-medium mb-1" style={{ color: 'var(--text-muted)' }}>Hostname / IP</label>
            <input className="input" placeholder="host1.corp.local" value={hostname} onChange={(e) => setHostname(e.target.value)} />
          </div>
          <div>
            <label className="block text-xs font-medium mb-1" style={{ color: 'var(--text-muted)' }}>Display Name</label>
            <input className="input" placeholder="Optional" value={displayName} onChange={(e) => setDisplayName(e.target.value)} />
          </div>
          <div>
            <label className="block text-xs font-medium mb-1" style={{ color: 'var(--text-muted)' }}>Assign to Folder</label>
            <select className="select" value={folderId} onChange={(e) => setFolderId(e.target.value)}>
              <option value="">Unassigned</option>
              {folders.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}
            </select>
          </div>
        </div>
        <div className="flex justify-end gap-2 px-5 py-4 border-t" style={{ borderColor: 'var(--border)' }}>
          <button className="btn-ghost" onClick={onClose}>Cancel</button>
          <button className="btn-primary" disabled={!hostname || mut.isPending} onClick={() => mut.mutate()}>
            {mut.isPending ? 'Registering…' : 'Register'}
          </button>
        </div>
      </div>
    </div>
  )
}
