/**
 * Audit Log Page
 * - Live event stream via WebSocket, new entries appear at the top without refresh
 * - Filter by resource type, status, user
 * - Virtualised list for performance with thousands of rows
 */
import { useState, useRef } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useVirtualizer } from '@tanstack/react-virtual'
import { auditApi } from '@/lib/api'
import { useEventBus } from '@/stores/eventBusStore'
import { formatDistanceToNow } from 'date-fns'
import { Search, X } from 'lucide-react'
import PageHeader from '@/components/shared/PageHeader'

const STATUS_BADGE: Record<string, string> = {
  success: 'badge-running',
  failure: 'badge-offline',
  warning: 'badge-paused',
}

const ACTION_ICONS: Record<string, string> = {
  'vm.start': '▶', 'vm.stop': '⏹', 'vm.restart': '↺',
  'vm.create': '✚', 'vm.delete': '✖', 'vm.create.quota_blocked': '⚠',
  'checkpoint.create': '📷', 'checkpoint.delete': '🗑', 'checkpoint.revert': '↩',
  'user.create': '👤', 'user.update': '✏', 'user.delete': '🗑',
  'folder.create': '📁', 'folder.update': '✏', 'folder.delete': '🗑',
  'hypervisor.register': '🖥',
}

export default function AuditPage() {
  const [filter, setFilter] = useState('')
  const [statusFilter, setStatusFilter] = useState('All')
  const [resourceFilter, setResourceFilter] = useState('All')
  const parentRef = useRef<HTMLDivElement>(null)

  // Historical logs from API
  const { data: historical = [] } = useQuery({
    queryKey: ['audit'],
    queryFn: () => auditApi.list({ limit: 500 }),
    staleTime: 10_000,
  })

  // Live events from WebSocket event bus
  const liveEvents = useEventBus((s) => s.events.filter((e) => e.type === 'audit'))
  const connected = useEventBus((s) => s.connected)

  // Merge live (deduplicated) + historical
  const historicalIds = new Set(historical.map((e: any) => e.id))
  const deduped = liveEvents.filter((e) => !historicalIds.has(e.id))
  const allLogs: any[] = [...deduped, ...historical]

  const filtered = allLogs.filter((log) => {
    const q = filter.toLowerCase()
    const matchesText = !q || log.action?.toLowerCase().includes(q)
      || log.resource_name?.toLowerCase().includes(q)
      || log.user_email?.toLowerCase().includes(q)
    const matchesStatus = statusFilter === 'All' || log.status === statusFilter
    const matchesResource = resourceFilter === 'All' || log.resource_type === resourceFilter
    return matchesText && matchesStatus && matchesResource
  })

  const rowVirtualizer = useVirtualizer({
    count: filtered.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => 52,
    overscan: 15,
  })

  const resourceTypes = ['All', ...Array.from(new Set(allLogs.map((l: any) => l.resource_type).filter(Boolean)))]

  return (
    <div className="flex flex-col h-full">
      <PageHeader
        title="Audit Log"
        subtitle={
          <span className="flex items-center gap-2">
            {connected ? <><span className="pulse-live" /><span>Live stream active</span></> : 'Offline'}
            {' · '}{filtered.length} events
          </span>
        }
      />

      {/* Toolbar */}
      <div className="flex items-center gap-2 px-6 py-3 border-b" style={{ borderColor: 'var(--border)', background: 'var(--surface)' }}>
        <div className="relative flex-1 max-w-xs">
          <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2" style={{ color: 'var(--text-muted)' }} />
          <input
            className="input pl-8 h-8 text-xs" placeholder="Search action, resource, user…"
            value={filter} onChange={(e) => setFilter(e.target.value)}
          />
          {filter && (
            <button className="absolute right-2 top-1/2 -translate-y-1/2" onClick={() => setFilter('')}
              style={{ color: 'var(--text-muted)' }}><X size={13} /></button>
          )}
        </div>
        <select className="select h-8 text-xs w-28" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
          {['All', 'success', 'failure', 'warning'].map((s) => <option key={s}>{s}</option>)}
        </select>
        <select className="select h-8 text-xs w-32" value={resourceFilter} onChange={(e) => setResourceFilter(e.target.value)}>
          {resourceTypes.map((s) => <option key={s}>{s}</option>)}
        </select>
      </div>

      {/* Header */}
      <div className="flex items-center gap-4 px-6 py-2 text-xs font-semibold uppercase tracking-wide border-b"
           style={{ color: 'var(--text-muted)', borderColor: 'var(--border)', background: 'var(--surface)' }}>
        <span className="w-6" />
        <span className="flex-[2]">Action</span>
        <span className="flex-[2]">Resource</span>
        <span className="flex-1">User</span>
        <span className="w-24">Status</span>
        <span className="w-36 text-right">Time</span>
      </div>

      {/* Virtualised rows */}
      <div ref={parentRef} className="flex-1 virt-scroll" style={{ background: 'var(--bg)' }}>
        <div style={{ height: rowVirtualizer.getTotalSize(), position: 'relative' }}>
          {rowVirtualizer.getVirtualItems().map((row) => {
            const log = filtered[row.index]
            if (!log) return null
            const isLive = deduped.some((e) => e.id === log.id)
            return (
              <div
                key={log.id}
                className="flex items-center gap-4 px-6 border-b"
                style={{
                  position: 'absolute', top: row.start, width: '100%', height: row.size,
                  borderColor: 'var(--border)',
                  background: isLive ? 'rgba(99,102,241,0.05)' : 'transparent',
                }}
              >
                <span className="w-6 text-base leading-none">{ACTION_ICONS[log.action] ?? '·'}</span>
                <span className="flex-[2] min-w-0">
                  <span className="text-sm font-medium font-mono" style={{ color: 'var(--text)' }}>{log.action}</span>
                </span>
                <span className="flex-[2] text-xs truncate" style={{ color: 'var(--text-muted)' }}>
                  {log.resource_type} · {log.resource_name ?? log.resource_id ?? '—'}
                </span>
                <span className="flex-1 text-xs truncate" style={{ color: 'var(--text-muted)' }}>{log.user_email ?? '—'}</span>
                <span className="w-24">
                  <span className={STATUS_BADGE[log.status] ?? 'badge-stopped'}>{log.status}</span>
                </span>
                <span className="w-36 text-right text-xs" style={{ color: 'var(--text-muted)' }}>
                  {log.ts || log.created_at
                    ? formatDistanceToNow(new Date(log.ts ?? log.created_at), { addSuffix: true })
                    : '—'}
                </span>
              </div>
            )
          })}
        </div>
        {filtered.length === 0 && (
          <div className="flex items-center justify-center h-32 text-sm" style={{ color: 'var(--text-muted)' }}>
            No audit events match your filter.
          </div>
        )}
      </div>
    </div>
  )
}
