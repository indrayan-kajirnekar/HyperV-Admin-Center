/**
 * Folders & Quotas Page
 * Two completely separated tabs:
 *   1. Folders — tree view, folder CRUD, hypervisor assignment, file upload
 *   2. Storage Quotas — per-folder and per-user quota configuration
 */
import { useState, useRef } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { folderApi, serverApi } from '@/lib/api'
import {
  FolderOpen, Folder, Plus, Pencil, Trash2, Server, X,
  ChevronRight, ChevronDown, Upload, HardDrive, Users,
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

type Tab = 'folders' | 'quotas'

export default function FoldersPage() {
  const [tab, setTab] = useState<Tab>('folders')

  return (
    <div className="flex flex-col h-full">
      <PageHeader title="Folders & Storage" subtitle="Manage folder hierarchy and quota policies" />

      {/* Tab bar */}
      <div className="flex border-b px-6 gap-0" style={{ borderColor: 'var(--border)', background: 'var(--surface)' }}>
        {([
          { id: 'folders', label: 'Folders', icon: <Folder size={13} /> },
          { id: 'quotas',  label: 'Storage Quotas', icon: <HardDrive size={13} /> },
        ] as { id: Tab; label: string; icon: React.ReactNode }[]).map((t) => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className="flex items-center gap-1.5 px-4 py-3 text-xs font-medium border-b-2 transition-colors"
            style={{
              borderColor: tab === t.id ? 'var(--accent)' : 'transparent',
              color: tab === t.id ? 'var(--accent)' : 'var(--text-muted)',
            }}
          >
            {t.icon}{t.label}
          </button>
        ))}
      </div>

      {tab === 'folders' && <FoldersTab />}
      {tab === 'quotas'  && <QuotasTab />}
    </div>
  )
}

// ─── Folders Tab ──────────────────────────────────────────────────────────────

function FoldersTab() {
  const qc = useQueryClient()
  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  const [editFolder, setEditFolder] = useState<FolderData | null>(null)
  const [showCreate, setShowCreate] = useState(false)
  const [uploadTarget, setUploadTarget] = useState<Hypervisor | null>(null)

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
              : <span className="w-3.5 inline-block" />}
          </span>
          {isExpanded
            ? <FolderOpen size={16} style={{ color: 'var(--accent)' }} />
            : <Folder size={16} style={{ color: 'var(--accent)' }} />}
          <span className="flex-1 text-sm font-medium" style={{ color: 'var(--text)' }}>{f.name}</span>

          <div className="flex gap-1 opacity-0 group-hover:opacity-100" onClick={(e) => e.stopPropagation()}>
            <button className="btn-ghost p-1" title="Edit folder" onClick={() => setEditFolder(f)}>
              <Pencil size={12} />
            </button>
            <button className="btn-ghost p-1" title="Delete folder"
              onClick={() => { if (confirm(`Delete folder "${f.name}"?`)) deleteMut.mutate(f.id) }}>
              <Trash2 size={12} style={{ color: 'var(--danger)' }} />
            </button>
          </div>
        </div>

        {isExpanded && folderHyps.length > 0 && (
          <div style={{ marginLeft: (depth + 1) * 20 + 4 }}>
            {folderHyps.map((h) => (
              <div key={h.id} className="flex items-center gap-2 px-4 py-1.5 text-xs group"
                style={{ color: 'var(--text-muted)' }}>
                <Server size={12} />
                <span className={h.is_online ? 'text-green-500' : 'text-red-500'}>
                  {h.display_name ?? h.hostname}
                </span>
                <span className={`badge ${h.is_online ? 'badge-running' : 'badge-offline'}`}>
                  {h.is_online ? 'online' : 'offline'}
                </span>
                {/* Upload button per hypervisor */}
                <button
                  className="btn-ghost p-0.5 ml-1 opacity-0 group-hover:opacity-100 text-xs flex items-center gap-0.5"
                  title={`Upload file to ${h.hostname}`}
                  style={{ color: 'var(--accent)' }}
                  onClick={() => setUploadTarget(h)}
                >
                  <Upload size={11} /> Upload
                </button>
              </div>
            ))}
          </div>
        )}

        {isExpanded && children.map((c) => renderFolder(c, depth + 1))}
      </div>
    )
  }

  return (
    <div className="flex-1 overflow-y-auto p-6">
      <div className="flex justify-between items-center mb-4">
        <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
          {folders.length} folders · {hypervisors.length} hypervisors
        </p>
        <button className="btn-primary" onClick={() => setShowCreate(true)}>
          <Plus size={14} /> New Folder
        </button>
      </div>

      <div className="card space-y-0.5">
        {roots.length === 0 && (
          <p className="text-sm p-4 text-center" style={{ color: 'var(--text-muted)' }}>
            No folders yet. Create your first folder to organize hypervisors and VMs.
          </p>
        )}
        {roots.map((f) => renderFolder(f))}
      </div>

      {hypervisors.filter((h) => !h.folder_id).length > 0 && (
        <div className="mt-6">
          <h3 className="text-xs font-semibold uppercase tracking-wide mb-2" style={{ color: 'var(--text-muted)' }}>
            Unassigned Hypervisors
          </h3>
          <div className="card space-y-2">
            {hypervisors.filter((h) => !h.folder_id).map((h) => (
              <div key={h.id} className="flex items-center gap-2 py-1 text-sm group" style={{ color: 'var(--text)' }}>
                <Server size={14} />
                <span>{h.display_name ?? h.hostname}</span>
                <span className={`badge ${h.is_online ? 'badge-running' : 'badge-offline'}`}>
                  {h.is_online ? 'online' : 'offline'}
                </span>
                <button
                  className="btn-ghost p-0.5 ml-1 opacity-0 group-hover:opacity-100 text-xs flex items-center gap-0.5"
                  style={{ color: 'var(--accent)' }}
                  onClick={() => setUploadTarget(h)}
                >
                  <Upload size={11} /> Upload
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {showCreate && <FolderFormModal folders={folders} onClose={() => setShowCreate(false)} />}
      {editFolder && <FolderFormModal folders={folders} existing={editFolder} onClose={() => setEditFolder(null)} />}
      {uploadTarget && <UploadModal hypervisor={uploadTarget} onClose={() => setUploadTarget(null)} />}
    </div>
  )
}

// ─── Storage Quotas Tab ───────────────────────────────────────────────────────

function QuotasTab() {
  const [mode, setMode] = useState<'folder' | 'user'>('folder')
  const { data: folders = [] } = useQuery<FolderData[]>({ queryKey: ['folders'], queryFn: folderApi.list })

  return (
    <div className="flex-1 overflow-y-auto p-6 space-y-4">
      {/* Mode selector — folder quotas vs user quotas */}
      <div className="flex items-center gap-3">
        <p className="text-xs font-semibold uppercase tracking-wide" style={{ color: 'var(--text-muted)' }}>
          Assign quotas to:
        </p>
        <div className="flex rounded-md overflow-hidden border" style={{ borderColor: 'var(--border)' }}>
          {(['folder', 'user'] as const).map((m) => (
            <button
              key={m}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium transition-colors"
              style={{
                background: mode === m ? 'var(--accent)' : 'var(--surface)',
                color: mode === m ? '#fff' : 'var(--text-muted)',
              }}
              onClick={() => setMode(m)}
            >
              {m === 'folder' ? <Folder size={12} /> : <Users size={12} />}
              {m === 'folder' ? 'Folders' : 'Users'}
            </button>
          ))}
        </div>
      </div>

      {mode === 'folder' && (
        <div className="space-y-3">
          {folders.length === 0 && (
            <p className="text-sm" style={{ color: 'var(--text-muted)' }}>No folders yet. Create folders first.</p>
          )}
          {folders.map((f) => (
            <FolderQuotaRow key={f.id} folder={f} />
          ))}
        </div>
      )}

      {mode === 'user' && (
        <div className="card p-4">
          <p className="text-sm" style={{ color: 'var(--text-muted)' }}>
            User-level quota overrides are configured on the <strong>Users & Groups</strong> page via the Permissions tab.
          </p>
        </div>
      )}
    </div>
  )
}

function FolderQuotaRow({ folder }: { folder: FolderData }) {
  const qc = useQueryClient()
  const [editing, setEditing] = useState(false)
  const [form, setForm] = useState({
    quota_storage_gb:      folder.quota_storage_gb ?? '',
    quota_memory_gb:       folder.quota_memory_gb ?? '',
    quota_cpu_pct:         folder.quota_cpu_pct ?? '',
    quota_max_vms:         folder.quota_max_vms ?? '',
    soft_quota_storage_gb: folder.soft_quota_storage_gb ?? '',
    soft_quota_memory_gb:  folder.soft_quota_memory_gb ?? '',
  })

  const mut = useMutation({
    mutationFn: () => {
      const numOrNull = (v: unknown) => v === '' ? null : Number(v)
      return folderApi.update(folder.id, {
        quota_storage_gb:      numOrNull(form.quota_storage_gb),
        quota_memory_gb:       numOrNull(form.quota_memory_gb),
        quota_cpu_pct:         numOrNull(form.quota_cpu_pct),
        quota_max_vms:         numOrNull(form.quota_max_vms),
        soft_quota_storage_gb: numOrNull(form.soft_quota_storage_gb),
        soft_quota_memory_gb:  numOrNull(form.soft_quota_memory_gb),
      })
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['folders'] }); setEditing(false) },
  })

  const fields = [
    { k: 'quota_storage_gb',      label: 'Max Storage (GB)',      soft: false },
    { k: 'soft_quota_storage_gb', label: 'Soft Storage (GB)',     soft: true },
    { k: 'quota_memory_gb',       label: 'Max RAM (GB)',          soft: false },
    { k: 'soft_quota_memory_gb',  label: 'Soft RAM (GB)',         soft: true },
    { k: 'quota_cpu_pct',         label: 'Max CPU (%)',           soft: false },
    { k: 'quota_max_vms',         label: 'Max VMs',               soft: false },
  ]

  return (
    <div className="card p-4 space-y-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Folder size={14} style={{ color: 'var(--accent)' }} />
          <span className="text-sm font-medium" style={{ color: 'var(--text)' }}>{folder.name}</span>
        </div>
        <button className="btn-ghost p-1" onClick={() => setEditing((e) => !e)}>
          <Pencil size={12} />
        </button>
      </div>

      {/* Current quota summary */}
      {!editing && (
        <div className="grid grid-cols-3 gap-2 text-xs" style={{ color: 'var(--text-muted)' }}>
          {fields.filter((f) => !f.soft).map(({ k, label }) => (
            <span key={k}>{label}: <strong style={{ color: 'var(--text)' }}>{(folder as any)[k] ?? '∞'}</strong></span>
          ))}
        </div>
      )}

      {/* Inline quota editor */}
      {editing && (
        <div className="space-y-3">
          <div className="grid grid-cols-3 gap-2">
            {fields.map(({ k, label, soft }) => (
              <div key={k}>
                <label className="block text-xs font-medium mb-1" style={{ color: soft ? 'var(--warning)' : 'var(--text-muted)' }}>
                  {label}
                </label>
                <input type="number" min={0} className="input" placeholder="∞"
                  value={(form as any)[k]} onChange={(e) => setForm((f) => ({ ...f, [k]: e.target.value }))} />
              </div>
            ))}
          </div>
          <div className="flex gap-2 justify-end">
            <button className="btn-ghost text-xs" onClick={() => setEditing(false)}>Cancel</button>
            <button className="btn-primary text-xs" disabled={mut.isPending} onClick={() => mut.mutate()}>
              {mut.isPending ? 'Saving…' : 'Save Quotas'}
            </button>
          </div>
        </div>
      )}

      {/* Usage bars */}
      {folder.usage && (
        <div className="flex gap-4 pt-1 border-t" style={{ borderColor: 'var(--border)' }}>
          {folder.quota_storage_gb && (
            <QuotaBar label="Storage" used={folder.usage.storage_gb} max={folder.quota_storage_gb} unit="GB" />
          )}
          {folder.quota_memory_gb && (
            <QuotaBar label="RAM" used={folder.usage.memory_gb} max={folder.quota_memory_gb} unit="GB" />
          )}
        </div>
      )}
    </div>
  )
}

// ─── Upload Modal ─────────────────────────────────────────────────────────────

function UploadModal({ hypervisor, onClose }: { hypervisor: Hypervisor; onClose: () => void }) {
  const [destPath, setDestPath] = useState('C:\\ISOs\\')
  const [file, setFile] = useState<File | null>(null)
  const [status, setStatus] = useState<'idle' | 'uploading' | 'done' | 'error'>('idle')
  const [errMsg, setErrMsg] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)

  async function upload() {
    if (!file) return
    setStatus('uploading')
    try {
      await serverApi.uploadFile(hypervisor.id, destPath + file.name, file)
      setStatus('done')
    } catch (e: any) {
      setErrMsg(e?.response?.data?.detail ?? 'Upload failed.')
      setStatus('error')
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div className="w-full max-w-sm rounded-xl border shadow-2xl"
        style={{ background: 'var(--surface)', borderColor: 'var(--border)' }}>
        <div className="flex items-center justify-between px-5 py-4 border-b" style={{ borderColor: 'var(--border)' }}>
          <div className="flex items-center gap-2">
            <Upload size={15} style={{ color: 'var(--accent)' }} />
            <h2 className="text-sm font-semibold" style={{ color: 'var(--text)' }}>
              Upload to {hypervisor.display_name ?? hypervisor.hostname}
            </h2>
          </div>
          <button className="btn-ghost p-1.5" onClick={onClose}><X size={16} /></button>
        </div>

        <div className="p-5 space-y-4">
          {status === 'done' && (
            <div className="rounded-md border p-3 text-xs" style={{ borderColor: 'var(--success)', background: 'rgba(34,197,94,0.08)', color: 'var(--success)' }}>
              ✓ File uploaded successfully to {destPath}{file?.name}
            </div>
          )}
          {status === 'error' && (
            <div className="rounded-md border p-3 text-xs" style={{ borderColor: 'var(--danger)', background: 'rgba(220,38,38,0.08)', color: 'var(--danger)' }}>
              {errMsg}
            </div>
          )}

          <div>
            <label className="block text-xs font-medium mb-1" style={{ color: 'var(--text-muted)' }}>
              Destination directory on host
            </label>
            <input className="input font-mono text-xs" value={destPath}
              onChange={(e) => setDestPath(e.target.value)} />
          </div>

          <div>
            <label className="block text-xs font-medium mb-2" style={{ color: 'var(--text-muted)' }}>File</label>
            <div
              className="border-2 border-dashed rounded-lg p-4 text-center cursor-pointer"
              style={{ borderColor: 'var(--border)' }}
              onClick={() => inputRef.current?.click()}
            >
              {file
                ? <p className="text-xs font-medium" style={{ color: 'var(--text)' }}>{file.name} ({(file.size / 1024 / 1024).toFixed(1)} MB)</p>
                : <p className="text-xs" style={{ color: 'var(--text-muted)' }}>Click to select a file (ISO, etc.)</p>}
            </div>
            <input ref={inputRef} type="file" className="hidden"
              onChange={(e) => { setFile(e.target.files?.[0] ?? null); setStatus('idle') }} />
          </div>
        </div>

        <div className="flex justify-end gap-2 px-5 py-4 border-t" style={{ borderColor: 'var(--border)' }}>
          <button className="btn-ghost" onClick={onClose}>{status === 'done' ? 'Close' : 'Cancel'}</button>
          {status !== 'done' && (
            <button className="btn-primary" disabled={!file || status === 'uploading'} onClick={upload}>
              {status === 'uploading' ? 'Uploading…' : 'Upload'}
            </button>
          )}
        </div>
      </div>
    </div>
  )
}

// ─── Shared helpers ───────────────────────────────────────────────────────────

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
  })

  function set(k: string, v: unknown) { setForm((f) => ({ ...f, [k]: v as string })) }

  const mut = useMutation({
    mutationFn: () => {
      const body = { name: form.name, parent_id: form.parent_id || null, description: form.description }
      return existing ? folderApi.update(existing.id, body) : folderApi.create(body)
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['folders'] }); onClose() },
  })

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div className="w-full max-w-sm rounded-xl border shadow-2xl"
        style={{ background: 'var(--surface)', borderColor: 'var(--border)' }}>
        <div className="flex items-center justify-between px-5 py-4 border-b" style={{ borderColor: 'var(--border)' }}>
          <h2 className="text-sm font-semibold" style={{ color: 'var(--text)' }}>{existing ? 'Edit Folder' : 'New Folder'}</h2>
          <button className="btn-ghost p-1.5" onClick={onClose}><X size={16} /></button>
        </div>
        <div className="p-5 space-y-4">
          <div>
            <label className="block text-xs font-medium mb-1" style={{ color: 'var(--text-muted)' }}>Name</label>
            <input className="input" value={form.name} autoFocus onChange={(e) => set('name', e.target.value)} />
          </div>
          <div>
            <label className="block text-xs font-medium mb-1" style={{ color: 'var(--text-muted)' }}>Parent folder</label>
            <select className="select" value={form.parent_id} onChange={(e) => set('parent_id', e.target.value)}>
              <option value="">Root level</option>
              {folders.filter((f) => f.id !== existing?.id).map((f) => (
                <option key={f.id} value={f.id}>{f.name}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-xs font-medium mb-1" style={{ color: 'var(--text-muted)' }}>Description</label>
            <input className="input" value={form.description} onChange={(e) => set('description', e.target.value)} />
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
