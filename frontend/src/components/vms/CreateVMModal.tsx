import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { vmApi, folderApi, serverApi } from '@/lib/api'
import { X, Disc, Plus, Trash2, HardDrive } from 'lucide-react'

interface Props { onClose: () => void }

interface ISOFile { Name: string; FullName: string; SizeMB: number }

export default function CreateVMModal({ onClose }: Props) {
  const qc = useQueryClient()
  const { data: hypervisors = [] } = useQuery({ queryKey: ['hypervisors'], queryFn: folderApi.hypervisors })
  const { data: folders = [] } = useQuery({ queryKey: ['folders'], queryFn: folderApi.list })

  const [form, setForm] = useState({
    name: '', hypervisor_id: '', folder_id: '',
    memory_gb: 2, cpu_count: 2, disk_gb: 40,
    switch_name: 'Default Switch', generation: 2,
    iso_path: '',
    nic2_switch: '',
    nic3_switch: '',
    vm_path: '',        // e.g. D:\VMs  — blank = server default (C:\VMs)
  })
  const [quotaError, setQuotaError] = useState<string[]>([])
  const [showISOPicker, setShowISOPicker] = useState(false)

  // Extra NICs state (can add up to 2 additional = 3 total)
  const [extraNICs, setExtraNICs] = useState<string[]>([])

  // Drives from selected host
  interface DriveInfo { Drive: string; FreeGB: number; TotalGB: number }
  const { data: drives = [] } = useQuery<DriveInfo[]>({
    queryKey: ['drives', form.hypervisor_id],
    queryFn: () => serverApi.listDrives(form.hypervisor_id),
    enabled: !!form.hypervisor_id,
  })

  // ISO list from host
  const { data: isos = [], isFetching: loadingISOs } = useQuery<ISOFile[]>({
    queryKey: ['isos', form.hypervisor_id],
    queryFn: () => serverApi.listISOs(form.hypervisor_id),
    enabled: !!form.hypervisor_id && showISOPicker,
  })

  const mut = useMutation({
    mutationFn: () => vmApi.create({
      ...form,
      iso_path: form.iso_path || null,
      nic2_switch: extraNICs[0] || null,
      nic3_switch: extraNICs[1] || null,
      vm_path: form.vm_path || null,
    }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['vms'] }); onClose() },
    onError: (err: any) => {
      const violations = err?.response?.data?.detail?.violations
      if (violations) setQuotaError(violations)
      else setQuotaError([err?.response?.data?.detail ?? 'Failed to create VM.'])
    },
  })

  function set(k: string, v: unknown) { setForm((f) => ({ ...f, [k]: v })); setQuotaError([]) }

  function addNIC() {
    if (extraNICs.length < 2) setExtraNICs((n) => [...n, 'Default Switch'])
  }
  function removeNIC(i: number) { setExtraNICs((n) => n.filter((_, idx) => idx !== i)) }
  function setNIC(i: number, v: string) { setExtraNICs((n) => n.map((x, idx) => idx === i ? v : x)) }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div className="w-full max-w-lg rounded-xl border shadow-2xl overflow-y-auto max-h-[92vh]"
        style={{ background: 'var(--surface)', borderColor: 'var(--border)' }}>

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

          {/* Name */}
          <Field label="VM Name">
            <input className="input" value={form.name} onChange={(e) => set('name', e.target.value)}
              placeholder="e.g. WebServer-01" autoFocus />
          </Field>

          {/* Hypervisor + Folder */}
          <div className="grid grid-cols-2 gap-3">
            <Field label="Hypervisor *">
              <select className="select" value={form.hypervisor_id}
                onChange={(e) => { set('hypervisor_id', e.target.value); set('iso_path', '') }}>
                <option value="">Select host…</option>
                {hypervisors.map((h: any) => (
                  <option key={h.id} value={h.id}>{h.display_name ?? h.hostname}</option>
                ))}
              </select>
            </Field>
            <Field label="Folder (optional)">
              <select className="select" value={form.folder_id} onChange={(e) => set('folder_id', e.target.value)}>
                <option value="">None</option>
                {folders.map((f: any) => <option key={f.id} value={f.id}>{f.name}</option>)}
              </select>
            </Field>
          </div>

          {/* Resources */}
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

          {/* Generation + VM Storage Drive */}
          <div className="grid grid-cols-2 gap-3">
            <Field label="Generation">
              <select className="select" value={form.generation}
                onChange={(e) => set('generation', parseInt(e.target.value))}>
                <option value={2}>Gen 2 (UEFI)</option>
                <option value={1}>Gen 1 (BIOS)</option>
              </select>
            </Field>
            <Field label="VM Storage Drive">
              <select
                className="select"
                value={form.vm_path}
                onChange={(e) => set('vm_path', e.target.value)}
                disabled={!form.hypervisor_id || drives.length === 0}
              >
                <option value="">Default (C:\VMs)</option>
                {drives.map((d) => (
                  <option key={d.Drive} value={`${d.Drive}\\VMs`}>
                    {d.Drive}\VMs — {d.FreeGB} GB free / {d.TotalGB} GB total
                  </option>
                ))}
              </select>
              {form.hypervisor_id && drives.length === 0 && (
                <p className="text-xs mt-1" style={{ color: 'var(--text-muted)' }}>
                  Select a hypervisor to load drives
                </p>
              )}
            </Field>
          </div>

          {/* ── Network Adapters (up to 3) ─────────────────────────────────── */}
          <div className="border-t pt-4" style={{ borderColor: 'var(--border)' }}>
            <div className="flex items-center justify-between mb-3">
              <p className="text-xs font-semibold uppercase tracking-wide" style={{ color: 'var(--text-muted)' }}>
                Network Adapters
              </p>
              {extraNICs.length < 2 && (
                <button className="btn-ghost text-xs flex items-center gap-1" onClick={addNIC}>
                  <Plus size={11} /> Add NIC
                </button>
              )}
            </div>

            {/* NIC 1 — always present */}
            <div className="space-y-2">
              <div className="flex items-center gap-2">
                <span className="text-xs w-12 shrink-0" style={{ color: 'var(--text-muted)' }}>NIC 1</span>
                <input className="input flex-1" placeholder="Virtual Switch name"
                  value={form.switch_name}
                  onChange={(e) => set('switch_name', e.target.value)} />
              </div>

              {/* Extra NICs */}
              {extraNICs.map((sw, i) => (
                <div key={i} className="flex items-center gap-2">
                  <span className="text-xs w-12 shrink-0" style={{ color: 'var(--text-muted)' }}>NIC {i + 2}</span>
                  <input className="input flex-1" placeholder="Virtual Switch name"
                    value={sw} onChange={(e) => setNIC(i, e.target.value)} />
                  <button className="btn-ghost p-1.5" onClick={() => removeNIC(i)}>
                    <Trash2 size={12} style={{ color: 'var(--danger)' }} />
                  </button>
                </div>
              ))}
            </div>
          </div>

          {/* ── ISO Attachment ────────────────────────────────────────────── */}
          <div className="border-t pt-4" style={{ borderColor: 'var(--border)' }}>
            <div className="flex items-center justify-between mb-2">
              <p className="text-xs font-semibold uppercase tracking-wide" style={{ color: 'var(--text-muted)' }}>
                Boot ISO
              </p>
              {form.hypervisor_id && (
                <button
                  className="btn-ghost text-xs flex items-center gap-1"
                  onClick={() => setShowISOPicker((v) => !v)}
                >
                  <Disc size={11} /> {showISOPicker ? 'Hide' : 'Browse ISOs'}
                </button>
              )}
            </div>

            {/* Manual path entry */}
            <input className="input font-mono text-xs" placeholder="C:\ISOs\ubuntu.iso  (leave blank for no ISO)"
              value={form.iso_path} onChange={(e) => set('iso_path', e.target.value)} />

            {/* ISO browser from host */}
            {showISOPicker && form.hypervisor_id && (
              <div className="mt-2 rounded-md border overflow-hidden" style={{ borderColor: 'var(--border)' }}>
                {loadingISOs && (
                  <p className="text-xs p-3" style={{ color: 'var(--text-muted)' }}>Loading ISOs from host…</p>
                )}
                {!loadingISOs && isos.length === 0 && (
                  <p className="text-xs p-3" style={{ color: 'var(--text-muted)' }}>
                    No .iso files found in C:\ISOs on this host. Upload one from the Folders page.
                  </p>
                )}
                {isos.map((iso) => (
                  <div
                    key={iso.FullName}
                    className="flex items-center gap-2 px-3 py-2 cursor-pointer hover:bg-[var(--surface-2)] text-xs border-b"
                    style={{
                      borderColor: 'var(--border)',
                      background: form.iso_path === iso.FullName ? 'var(--surface-2)' : undefined,
                    }}
                    onClick={() => { set('iso_path', iso.FullName); setShowISOPicker(false) }}
                  >
                    <Disc size={12} style={{ color: 'var(--accent)', flexShrink: 0 }} />
                    <span className="flex-1 font-mono" style={{ color: 'var(--text)' }}>{iso.Name}</span>
                    <span style={{ color: 'var(--text-muted)' }}>{iso.SizeMB} MB</span>
                  </div>
                ))}
              </div>
            )}

            {form.iso_path && (
              <div className="flex items-center gap-1.5 mt-1 text-xs" style={{ color: 'var(--accent)' }}>
                <Disc size={11} />
                <span>ISO will be attached and set as first boot device</span>
              </div>
            )}
          </div>
        </div>

        {/* Footer */}
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
