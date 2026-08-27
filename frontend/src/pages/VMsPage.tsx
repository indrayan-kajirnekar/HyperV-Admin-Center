/**
 * VM Lifecycle Dashboard
 * - Virtualised data table (TanStack Virtual) — handles 1000+ rows without lag
 * - Per-row action menu: Start, Stop (graceful/force), Restart, Delete, Checkpoints
 * - Optimistic UI: state badge updates immediately, background confirmation via WS
 * - No blocking modal loaders — skeleton rows during initial load only
 */
import { useState, useMemo, useRef, useCallback } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useVirtualizer } from '@tanstack/react-virtual'
import { vmApi } from '@/lib/api'
import { Play, Square, RotateCcw, Trash2, Camera, Search, Plus, X, MonitorPlay, Disc } from 'lucide-react'
import { clsx } from 'clsx'
import CheckpointPanel from '@/components/vms/CheckpointPanel'
import CreateVMModal from '@/components/vms/CreateVMModal'
import ConsoleModal from '@/components/vms/ConsoleModal'
import PageHeader from '@/components/shared/PageHeader'

interface VM {
  Name: string; Id: string; State: string; CPUUsage: number
  MemoryAssignedGB: number; DiskGB: number; HostName: string
  hypervisor_id: string; hypervisor_hostname: string; Uptime: string
  Status: string; Version: string
}

const STATE_BADGE: Record<string, string> = {
  Running: 'badge-running', Stopped: 'badge-stopped', Saved: 'badge-paused',
  Paused: 'badge-paused', Off: 'badge-stopped',
}

const COLS = [
  { key: 'Name',            label: 'Name',      w: 'flex-[2]' },
  { key: 'State',           label: 'State',     w: 'w-24' },
  { key: 'CPUUsage',        label: 'CPU %',     w: 'w-20 text-right' },
  { key: 'MemoryAssignedGB',label: 'RAM (GB)',  w: 'w-24 text-right' },
  { key: 'DiskGB',          label: 'Disk (GB)', w: 'w-24 text-right' },
  { key: 'hypervisor_hostname', label: 'Host', w: 'flex-1' },
  { key: 'Uptime',          label: 'Uptime',    w: 'w-32' },
  { key: '_actions',        label: '',          w: 'w-28 text-right' },
]

export default function VMsPage() {
  const qc = useQueryClient()
  const [filter, setFilter] = useState('')
  const [stateFilter, setStateFilter] = useState('All')
  const [selected, setSelected] = useState<VM | null>(null)
  const [checkpointVM, setCheckpointVM] = useState<VM | null>(null)
  const [consoleVM, setConsoleVM] = useState<VM | null>(null)
  const [showCreate, setShowCreate] = useState(false)
  const [optimistic, setOptimistic] = useState<Record<string, string>>({})
  const parentRef = useRef<HTMLDivElement>(null)

  const { data: vms = [], isLoading } = useQuery<VM[]>({
    queryKey: ['vms'],
    queryFn: vmApi.list,
    refetchInterval: 20_000,
  })

  const filtered = useMemo(() => {
    const q = filter.toLowerCase()
    return vms.filter((vm) => {
      const matchesText = !q || vm.Name.toLowerCase().includes(q) || vm.hypervisor_hostname.toLowerCase().includes(q)
      const matchesState = stateFilter === 'All' || vm.State === stateFilter
      return matchesText && matchesState
    })
  }, [vms, filter, stateFilter])

  const rowVirtualizer = useVirtualizer({
    count: isLoading ? 10 : filtered.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => 44,
    overscan: 20,
  })

  const actionMut = useMutation({
    mutationFn: ({ vm, action }: { vm: VM; action: string }) =>
      vmApi.action(vm.hypervisor_id, vm.Name, action),
    onMutate: ({ vm, action }) => {
      const stateMap: Record<string, string> = {
        start: 'Running', stop: 'Stopped', stop_graceful: 'Stopped',
        restart: 'Running', suspend: 'Paused', resume: 'Running',
      }
      if (stateMap[action]) setOptimistic((p) => ({ ...p, [vm.Id]: stateMap[action] }))
    },
    onSettled: () => qc.invalidateQueries({ queryKey: ['vms'] }),
  })

  const deleteMut = useMutation({
    mutationFn: (vm: VM) => vmApi.delete(vm.hypervisor_id, vm.Name),
    onMutate: (vm) => setOptimistic((p) => ({ ...p, [vm.Id]: 'Deleting…' })),
    onSettled: () => qc.invalidateQueries({ queryKey: ['vms'] }),
  })

  const ejectCDMut = useMutation({
    mutationFn: (vm: VM) => vmApi.ejectCD(vm.hypervisor_id, vm.Name),
  })

  const states = useMemo(() => ['All', ...Array.from(new Set(vms.map((v) => v.State)))], [vms])

  const getState = useCallback((vm: VM) => optimistic[vm.Id] ?? vm.State, [optimistic])

  return (
    <div className="flex flex-col h-full">
      <PageHeader
        title="Virtual Machines"
        subtitle={`${filtered.length} of ${vms.length} VMs`}
        actions={
          <button className="btn-primary" onClick={() => setShowCreate(true)}>
            <Plus size={14} /> New VM
          </button>
        }
      />

      {/* Toolbar */}
      <div className="flex items-center gap-2 px-6 py-3 border-b" style={{ borderColor: 'var(--border)', background: 'var(--surface)' }}>
        <div className="relative flex-1 max-w-xs">
          <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2" style={{ color: 'var(--text-muted)' }} />
          <input
            className="input pl-8 h-8 text-xs" placeholder="Filter by name or host…"
            value={filter} onChange={(e) => setFilter(e.target.value)}
          />
          {filter && (
            <button className="absolute right-2 top-1/2 -translate-y-1/2" onClick={() => setFilter('')}
              style={{ color: 'var(--text-muted)' }}><X size={13} /></button>
          )}
        </div>
        <select className="select h-8 text-xs w-32" value={stateFilter} onChange={(e) => setStateFilter(e.target.value)}>
          {states.map((s) => <option key={s}>{s}</option>)}
        </select>
      </div>

      {/* Table header */}
      <div className="flex items-center gap-3 px-6 py-2 text-xs font-semibold uppercase tracking-wide border-b"
           style={{ color: 'var(--text-muted)', borderColor: 'var(--border)', background: 'var(--surface)' }}>
        {COLS.map((c) => <span key={c.key} className={c.w}>{c.label}</span>)}
      </div>

      {/* Virtualised body */}
      <div ref={parentRef} className="flex-1 virt-scroll" style={{ background: 'var(--bg)' }}>
        <div style={{ height: rowVirtualizer.getTotalSize(), position: 'relative' }}>
          {isLoading
            ? Array.from({ length: 8 }).map((_, i) => <SkeletonRow key={i} />)
            : rowVirtualizer.getVirtualItems().map((row) => {
                const vm = filtered[row.index]
                if (!vm) return null
                const state = getState(vm)
                return (
                  <div
                    key={vm.Id}
                    className={clsx('flex items-center gap-3 px-6 border-b table-row-hover cursor-pointer',
                      selected?.Id === vm.Id && 'bg-[var(--surface-2)]')}
                    style={{
                      position: 'absolute', top: row.start, width: '100%',
                      height: row.size, borderColor: 'var(--border)',
                    }}
                    onClick={() => setSelected(vm === selected ? null : vm)}
                  >
                    <span className="flex-[2] text-sm font-medium truncate" style={{ color: 'var(--text)' }}>{vm.Name}</span>
                    <span className="w-24">
                      <span className={STATE_BADGE[state] ?? 'badge-stopped'}>{state}</span>
                    </span>
                    <span className="w-20 text-right text-xs tabular-nums" style={{ color: 'var(--text-muted)' }}>{vm.CPUUsage}%</span>
                    <span className="w-24 text-right text-xs tabular-nums" style={{ color: 'var(--text-muted)' }}>{vm.MemoryAssignedGB}</span>
                    <span className="w-24 text-right text-xs tabular-nums" style={{ color: 'var(--text-muted)' }}>{vm.DiskGB}</span>
                    <span className="flex-1 text-xs truncate" style={{ color: 'var(--text-muted)' }}>{vm.hypervisor_hostname}</span>
                    <span className="w-32 text-xs font-mono" style={{ color: 'var(--text-muted)' }}>{vm.Uptime}</span>
                    <span className="w-28 flex items-center gap-1 justify-end" onClick={(e) => e.stopPropagation()}>
                      <ActionBar vm={vm} state={state}
                        onAction={(a) => actionMut.mutate({ vm, action: a })}
                        onDelete={() => deleteMut.mutate(vm)}
                        onCheckpoints={() => setCheckpointVM(vm)}
                        onConsole={() => setConsoleVM(vm)}
                        onEjectCD={() => ejectCDMut.mutate(vm)}
                      />
                    </span>
                  </div>
                )
              })
          }
        </div>
        {!isLoading && filtered.length === 0 && (
          <div className="flex items-center justify-center h-32 text-sm" style={{ color: 'var(--text-muted)' }}>
            No virtual machines match your filter.
          </div>
        )}
      </div>

      {/* Checkpoint side panel */}
      {checkpointVM && (
        <CheckpointPanel vm={checkpointVM} onClose={() => setCheckpointVM(null)} />
      )}

      {/* Console modal */}
      {consoleVM && (
        <ConsoleModal
          vmName={consoleVM.Name}
          hypervisorId={consoleVM.hypervisor_id}
          onClose={() => setConsoleVM(null)}
        />
      )}

      {/* Create VM modal */}
      {showCreate && <CreateVMModal onClose={() => setShowCreate(false)} />}
    </div>
  )
}

function ActionBar({ vm, state, onAction, onDelete, onCheckpoints, onConsole, onEjectCD }: {
  vm: VM; state: string
  onAction: (a: string) => void
  onDelete: () => void
  onCheckpoints: () => void
  onConsole: () => void
  onEjectCD: () => void
}) {
  const isRunning = state === 'Running'
  return (
    <div className="flex items-center gap-0.5">
      {!isRunning && (
        <button className="btn-ghost p-1.5 text-xs" title="Start" onClick={() => onAction('start')}>
          <Play size={13} className="text-green-500" />
        </button>
      )}
      {isRunning && (
        <>
          <button className="btn-ghost p-1.5 text-xs" title="Stop (Graceful)" onClick={() => onAction('stop_graceful')}>
            <Square size={13} className="text-yellow-500" />
          </button>
          <button className="btn-ghost p-1.5 text-xs" title="Restart" onClick={() => onAction('restart')}>
            <RotateCcw size={13} style={{ color: 'var(--accent)' }} />
          </button>
          <button className="btn-ghost p-1.5 text-xs" title="Open Console" onClick={onConsole}>
            <MonitorPlay size={13} style={{ color: 'var(--accent)' }} />
          </button>
          <button className="btn-ghost p-1.5 text-xs" title="Eject CD/DVD" onClick={() => {
            if (confirm(`Eject ISO/DVD from "${vm.Name}"?`)) onEjectCD()
          }}>
            <Disc size={13} style={{ color: 'var(--text-muted)' }} />
          </button>
        </>
      )}
      <button className="btn-ghost p-1.5 text-xs" title="Checkpoints" onClick={onCheckpoints}>
        <Camera size={13} style={{ color: 'var(--text-muted)' }} />
      </button>
      <button className="btn-ghost p-1.5 text-xs" title="Delete VM" onClick={() => {
        if (confirm(`Delete VM "${vm.Name}"? This is irreversible.`)) onDelete()
      }}>
        <Trash2 size={13} style={{ color: 'var(--danger)' }} />
      </button>
    </div>
  )
}

function SkeletonRow() {
  return (
    <div className="flex items-center gap-3 px-6 py-3 border-b animate-pulse" style={{ borderColor: 'var(--border)' }}>
      {[...COLS].map((c) => (
        <span key={c.key} className={clsx(c.w, 'h-4 rounded')} style={{ background: 'var(--surface-2)' }} />
      ))}
    </div>
  )
}
