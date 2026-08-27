/**
 * Checkpoint Management Panel
 * Slides in as an overlay panel with a visual tree of checkpoints.
 * Create / Delete / Revert operations with confirmation.
 */
import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { vmApi } from '@/lib/api'
import { Camera, Plus, Trash2, RotateCcw, X, ChevronRight } from 'lucide-react'
import { formatDistanceToNow } from 'date-fns'

interface Checkpoint {
  Id: string; Name: string; SnapshotType: string
  CreationTime: string; ParentSnapshotId: string | null; SizeGB: number
}

interface VM { Name: string; hypervisor_id: string; hypervisor_hostname: string }

export default function CheckpointPanel({ vm, onClose }: { vm: VM; onClose: () => void }) {
  const qc = useQueryClient()
  const [newName, setNewName] = useState('')
  const [creating, setCreating] = useState(false)
  const cacheKey = ['checkpoints', vm.hypervisor_id, vm.Name]

  const { data: checkpoints = [], isLoading } = useQuery<Checkpoint[]>({
    queryKey: cacheKey,
    queryFn: () => vmApi.checkpoints(vm.hypervisor_id, vm.Name),
  })

  const createMut = useMutation({
    mutationFn: (name: string) => vmApi.createCheckpoint(vm.hypervisor_id, vm.Name, name),
    onSuccess: () => { qc.invalidateQueries({ queryKey: cacheKey }); setNewName(''); setCreating(false) },
  })

  const deleteMut = useMutation({
    mutationFn: (snap: Checkpoint) => vmApi.deleteCheckpoint(vm.hypervisor_id, vm.Name, snap.Id),
    onSuccess: () => qc.invalidateQueries({ queryKey: cacheKey }),
  })

  const revertMut = useMutation({
    mutationFn: (snap: Checkpoint) => vmApi.revertCheckpoint(vm.hypervisor_id, vm.Name, snap.Id),
    onSuccess: () => qc.invalidateQueries({ queryKey: cacheKey }),
  })

  // Build simple tree: roots have no parent
  const roots = checkpoints.filter((c) => !c.ParentSnapshotId)
  const byParent = checkpoints.reduce<Record<string, Checkpoint[]>>((acc, c) => {
    if (c.ParentSnapshotId) {
      acc[c.ParentSnapshotId] = [...(acc[c.ParentSnapshotId] ?? []), c]
    }
    return acc
  }, {})

  function renderNode(c: Checkpoint, depth = 0): React.ReactNode {
    const children = byParent[c.Id] ?? []
    return (
      <div key={c.Id}>
        <div
          className="flex items-center gap-2 px-3 py-2 rounded-md group"
          style={{ marginLeft: depth * 16, background: depth % 2 ? 'var(--surface-2)' : 'transparent' }}
        >
          {depth > 0 && <ChevronRight size={12} style={{ color: 'var(--text-muted)', flexShrink: 0 }} />}
          <Camera size={13} style={{ color: 'var(--accent)', flexShrink: 0 }} />
          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium truncate" style={{ color: 'var(--text)' }}>{c.Name}</p>
            <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
              {formatDistanceToNow(new Date(c.CreationTime), { addSuffix: true })} · {c.SizeGB} GB
            </p>
          </div>
          <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
            <button
              className="btn-ghost p-1" title="Revert to this checkpoint"
              onClick={() => { if (confirm(`Revert VM "${vm.Name}" to "${c.Name}"?`)) revertMut.mutate(c) }}
            >
              <RotateCcw size={13} style={{ color: 'var(--warning)' }} />
            </button>
            <button
              className="btn-ghost p-1" title="Delete checkpoint"
              onClick={() => { if (confirm(`Delete checkpoint "${c.Name}"?`)) deleteMut.mutate(c) }}
            >
              <Trash2 size={13} style={{ color: 'var(--danger)' }} />
            </button>
          </div>
        </div>
        {children.map((child) => renderNode(child, depth + 1))}
      </div>
    )
  }

  return (
    <div
      className="fixed inset-y-0 right-0 w-96 flex flex-col border-l shadow-2xl z-50"
      style={{ background: 'var(--surface)', borderColor: 'var(--border)' }}
    >
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b" style={{ borderColor: 'var(--border)' }}>
        <div>
          <h2 className="text-sm font-semibold" style={{ color: 'var(--text)' }}>Checkpoints</h2>
          <p className="text-xs" style={{ color: 'var(--text-muted)' }}>{vm.Name}</p>
        </div>
        <button className="btn-ghost p-1.5" onClick={onClose}><X size={16} /></button>
      </div>

      {/* Create */}
      <div className="p-3 border-b" style={{ borderColor: 'var(--border)' }}>
        {creating ? (
          <div className="flex gap-2">
            <input
              autoFocus className="input h-8 text-xs flex-1" placeholder="Checkpoint name…"
              value={newName} onChange={(e) => setNewName(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter' && newName.trim()) createMut.mutate(newName.trim()) }}
            />
            <button className="btn-primary text-xs px-2.5" disabled={!newName.trim() || createMut.isPending}
              onClick={() => createMut.mutate(newName.trim())}>
              {createMut.isPending ? '…' : 'Create'}
            </button>
            <button className="btn-ghost text-xs px-2" onClick={() => setCreating(false)}><X size={13} /></button>
          </div>
        ) : (
          <button className="btn-ghost w-full justify-center text-xs gap-1.5" onClick={() => setCreating(true)}>
            <Plus size={13} /> New Checkpoint
          </button>
        )}
      </div>

      {/* Tree */}
      <div className="flex-1 overflow-y-auto p-2 virt-scroll">
        {isLoading && <p className="text-xs p-2" style={{ color: 'var(--text-muted)' }}>Loading…</p>}
        {!isLoading && checkpoints.length === 0 && (
          <p className="text-xs p-3 text-center" style={{ color: 'var(--text-muted)' }}>No checkpoints yet.</p>
        )}
        {roots.map((c) => renderNode(c))}
      </div>
    </div>
  )
}
