import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { vmApi, folderApi } from '@/lib/api'
import { X } from 'lucide-react'

interface Props { onClose: () => void }

export default function CreateVMModal({ onClose }: Props) {
  const qc = useQueryClient()
  const { data: hypervisors = [] } = useQuery({ queryKey: ['hypervisors'], queryFn: folderApi.hypervisors })
  const { data: folders = [] } = useQuery({ queryKey: ['folders'], queryFn: folderApi.list })

  const [form, setForm] = useState({
    name: '', hypervisor_id: '', folder_id: '',
    memory_gb: 2, cpu_count: 2, disk_gb: 40,
    switch_name: 'Default Switch', generation: 2,
  })
  const [quotaError, setQuotaError] = useState<string[]>([])

  const mut = useMutation({
    mutationFn: () => vmApi.create(form),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['vms'] }); onClose() },
    onError: (err: any) => {
      const violations = err?.response?.data?.detail?.violations
      if (violations) setQuotaError(violations)
      else setQuotaError([err?.response?.data?.detail ?? 'Failed to create VM.'])
    },
  })

  function set(k: string, v: unknown) { setForm((f) => ({ ...f, [k]: v })); setQuotaError([]) }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div className="w-full max-w-md rounded-xl border shadow-2xl" style={{ background: 'var(--surface)', borderColor: 'var(--border)' }}>
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b" style={{ borderColor: 'var(--border)' }}>
          <h2 className="text-sm font-semibold" style={{ color: 'var(--text)' }}>Create Virtual Machine</h2>
          <button className="btn-ghost p-1.5" onClick={onClose}><X size={16} /></button>
        </div>

        <div className="p-5 space-y-4">
          {/* Quota violations */}
          {quotaError.length > 0 && (
            <div className="rounded-md border p-3 text-xs space-y-1"
                 style={{ borderColor: 'var(--danger)', background: 'rgba(220,38,38,0.08)', color: 'var(--danger)' }}>
              <p className="font-semibold">Quota exceeded — VM not created</p>
              {quotaError.map((e, i) => <p key={i}>• {e}</p>)}
            </div>
          )}

          <Field label="VM Name">
            <input className="input" value={form.name} onChange={(e) => set('name', e.target.value)} placeholder="e.g. WebServer-01" />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Hypervisor">
              <select className="select" value={form.hypervisor_id} onChange={(e) => set('hypervisor_id', e.target.value)}>
                <option value="">Select host…</option>
                {hypervisors.map((h: any) => <option key={h.id} value={h.id}>{h.display_name ?? h.hostname}</option>)}
              </select>
            </Field>
            <Field label="Folder (optional)">
              <select className="select" value={form.folder_id} onChange={(e) => set('folder_id', e.target.value)}>
                <option value="">None</option>
                {folders.map((f: any) => <option key={f.id} value={f.id}>{f.name}</option>)}
              </select>
            </Field>
          </div>
          <div className="grid grid-cols-3 gap-3">
            <Field label="RAM (GB)">
              <input type="number" className="input" value={form.memory_gb} min={0.5} step={0.5}
                onChange={(e) => set('memory_gb', parseFloat(e.target.value))} />
            </Field>
            <Field label="CPUs">
              <input type="number" className="input" value={form.cpu_count} min={1} max={128}
                onChange={(e) => set('cpu_count', parseInt(e.target.value))} />
            </Field>
            <Field label="Disk (GB)">
              <input type="number" className="input" value={form.disk_gb} min={1}
                onChange={(e) => set('disk_gb', parseFloat(e.target.value))} />
            </Field>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Virtual Switch">
              <input className="input" value={form.switch_name} onChange={(e) => set('switch_name', e.target.value)} />
            </Field>
            <Field label="Generation">
              <select className="select" value={form.generation} onChange={(e) => set('generation', parseInt(e.target.value))}>
                <option value={2}>Gen 2 (UEFI)</option>
                <option value={1}>Gen 1 (BIOS)</option>
              </select>
            </Field>
          </div>
        </div>

        <div className="flex justify-end gap-2 px-5 py-4 border-t" style={{ borderColor: 'var(--border)' }}>
          <button className="btn-ghost" onClick={onClose}>Cancel</button>
          <button
            className="btn-primary"
            disabled={mut.isPending || !form.name || !form.hypervisor_id}
            onClick={() => mut.mutate()}
          >
            {mut.isPending ? 'Creating…' : 'Create VM'}
          </button>
        </div>
      </div>
    </div>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="block text-xs font-medium mb-1" style={{ color: 'var(--text-muted)' }}>{label}</label>
      {children}
    </div>
  )
}
