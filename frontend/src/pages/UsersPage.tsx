/**
 * Users & Groups Tab — Multi-Tenant RBAC
 * - User table with role badges, activate/deactivate, edit, delete
 * - Group table with member counts and expand view
 * - Permission assignment matrix (user/group → folder/hypervisor × role)
 */
import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { userApi, folderApi } from '@/lib/api'
import { Users, UserPlus, ShieldCheck, Trash2, Pencil, Plus, X, ChevronDown, ChevronRight } from 'lucide-react'
import PageHeader from '@/components/shared/PageHeader'

const ROLE_BADGE: Record<string, string> = {
  super_admin:   'bg-purple-100 text-purple-700 dark:bg-purple-950/50 dark:text-purple-300',
  cluster_admin: 'bg-blue-100 text-blue-700 dark:bg-blue-950/50 dark:text-blue-300',
  vm_operator:   'bg-green-100 text-green-700 dark:bg-green-950/50 dark:text-green-300',
  read_only:     'bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400',
}

const ROLES = ['super_admin', 'cluster_admin', 'vm_operator', 'read_only']

export default function UsersPage() {
  const qc = useQueryClient()
  const [tab, setTab] = useState<'users' | 'groups' | 'permissions'>('users')
  const [showCreate, setShowCreate] = useState(false)
  const [editUser, setEditUser] = useState<any>(null)

  const { data: users = [] } = useQuery({ queryKey: ['users'], queryFn: userApi.list })
  const { data: groups = [] } = useQuery({ queryKey: ['groups'], queryFn: userApi.groups })

  const deleteMut = useMutation({
    mutationFn: (id: string) => userApi.delete(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['users'] }),
  })

  const tabs = [
    { id: 'users',       label: `Users (${users.length})` },
    { id: 'groups',      label: `Groups (${groups.length})` },
    { id: 'permissions', label: 'Permissions' },
  ] as const

  return (
    <div className="flex flex-col h-full">
      <PageHeader
        title="Users & Groups"
        subtitle="Role-based access control"
        actions={
          <button className="btn-primary" onClick={() => setShowCreate(true)}>
            <UserPlus size={14} /> Add User
          </button>
        }
      />

      {/* Tabs */}
      <div className="flex gap-1 px-6 pt-4 border-b" style={{ borderColor: 'var(--border)' }}>
        {tabs.map(({ id, label }) => (
          <button
            key={id}
            className={`px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors ${
              tab === id
                ? 'border-[var(--accent)] text-[var(--accent)]'
                : 'border-transparent text-[var(--text-muted)] hover:text-[var(--text)]'
            }`}
            onClick={() => setTab(id)}
          >
            {label}
          </button>
        ))}
      </div>

      <div className="flex-1 overflow-y-auto p-6">
        {/* ── Users Tab ─────────────────────────────────── */}
        {tab === 'users' && (
          <div className="card overflow-hidden p-0">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-left" style={{ borderColor: 'var(--border)', background: 'var(--surface-2)' }}>
                  {['Full Name', 'Email', 'Role', 'Status', 'Groups', ''].map((h) => (
                    <th key={h} className="px-4 py-2.5 text-xs font-semibold uppercase tracking-wide" style={{ color: 'var(--text-muted)' }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {users.map((u: any) => (
                  <tr key={u.id} className="border-b table-row-hover" style={{ borderColor: 'var(--border)' }}>
                    <td className="px-4 py-3 font-medium" style={{ color: 'var(--text)' }}>{u.full_name}</td>
                    <td className="px-4 py-3 text-xs" style={{ color: 'var(--text-muted)' }}>{u.email}</td>
                    <td className="px-4 py-3">
                      <span className={`badge ${ROLE_BADGE[u.role] ?? ''}`}>{u.role.replace('_', ' ')}</span>
                    </td>
                    <td className="px-4 py-3">
                      <span className={u.is_active ? 'badge-running' : 'badge-offline'}>
                        {u.is_active ? 'Active' : 'Disabled'}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-xs" style={{ color: 'var(--text-muted)' }}>
                      {u.groups?.map((g: any) => g.name).join(', ') || '—'}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex gap-1 justify-end">
                        <button className="btn-ghost p-1.5" title="Edit" onClick={() => setEditUser(u)}><Pencil size={13} /></button>
                        <button className="btn-ghost p-1.5" title="Delete"
                          onClick={() => { if (confirm(`Delete user ${u.email}?`)) deleteMut.mutate(u.id) }}>
                          <Trash2 size={13} style={{ color: 'var(--danger)' }} />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {/* ── Groups Tab ─────────────────────────────────── */}
        {tab === 'groups' && <GroupsTab groups={groups} />}

        {/* ── Permissions Tab ────────────────────────────── */}
        {tab === 'permissions' && <PermissionsTab users={users} groups={groups} />}
      </div>

      {showCreate && <UserFormModal onClose={() => setShowCreate(false)} />}
      {editUser && <UserFormModal existing={editUser} onClose={() => setEditUser(null)} />}
    </div>
  )
}

function GroupsTab({ groups }: { groups: any[] }) {
  const qc = useQueryClient()
  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  const [showCreate, setShowCreate] = useState(false)

  const createMut = useMutation({
    mutationFn: (body: { name: string; description: string }) => userApi.createGroup(body),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['groups'] }); setShowCreate(false) },
  })

  function toggle(id: string) {
    setExpanded((s) => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n })
  }

  return (
    <div className="space-y-3">
      <div className="flex justify-end">
        <button className="btn-primary text-xs" onClick={() => setShowCreate(true)}><Plus size={12} /> New Group</button>
      </div>
      {showCreate && <GroupCreateInline onSave={(n, d) => createMut.mutate({ name: n, description: d })} onCancel={() => setShowCreate(false)} />}
      <div className="card space-y-0 p-0 overflow-hidden">
        {groups.map((g: any) => (
          <div key={g.id} className="border-b" style={{ borderColor: 'var(--border)' }}>
            <div
              className="flex items-center gap-2 px-4 py-3 cursor-pointer hover:bg-[var(--surface-2)]"
              onClick={() => toggle(g.id)}
            >
              {expanded.has(g.id) ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
              <ShieldCheck size={14} style={{ color: 'var(--accent)' }} />
              <span className="flex-1 text-sm font-medium" style={{ color: 'var(--text)' }}>{g.name}</span>
              <span className="text-xs" style={{ color: 'var(--text-muted)' }}>{g.member_count} members</span>
            </div>
            {expanded.has(g.id) && (
              <div className="px-10 pb-3 space-y-1">
                {g.members?.length === 0 && <p className="text-xs" style={{ color: 'var(--text-muted)' }}>No members.</p>}
                {g.members?.map((m: any) => (
                  <div key={m.id} className="flex items-center gap-2 text-xs py-0.5" style={{ color: 'var(--text-muted)' }}>
                    <Users size={11} /> {m.full_name} · {m.email}
                  </div>
                ))}
              </div>
            )}
          </div>
        ))}
        {groups.length === 0 && <p className="text-sm p-4 text-center" style={{ color: 'var(--text-muted)' }}>No groups yet.</p>}
      </div>
    </div>
  )
}

function GroupCreateInline({ onSave, onCancel }: { onSave: (n: string, d: string) => void; onCancel: () => void }) {
  const [name, setName] = useState('')
  const [desc, setDesc] = useState('')
  return (
    <div className="card flex items-end gap-2 p-3">
      <div className="flex-1"><label className="text-xs mb-1 block" style={{ color: 'var(--text-muted)' }}>Group Name</label>
        <input className="input h-8 text-xs" value={name} onChange={(e) => setName(e.target.value)} />
      </div>
      <div className="flex-1"><label className="text-xs mb-1 block" style={{ color: 'var(--text-muted)' }}>Description</label>
        <input className="input h-8 text-xs" value={desc} onChange={(e) => setDesc(e.target.value)} />
      </div>
      <button className="btn-primary text-xs" disabled={!name} onClick={() => onSave(name, desc)}>Save</button>
      <button className="btn-ghost text-xs" onClick={onCancel}><X size={13} /></button>
    </div>
  )
}

function PermissionsTab({ users, groups }: { users: any[]; groups: any[] }) {
  const { data: folders = [] } = useQuery({ queryKey: ['folders'], queryFn: folderApi.list })
  const { data: hypervisors = [] } = useQuery({ queryKey: ['hypervisors'], queryFn: folderApi.hypervisors })

  const [form, setForm] = useState({
    subject_type: 'user', user_id: '', group_id: '',
    resource_type: 'folder', resource_id: '', role: 'vm_operator',
  })

  const mut = useMutation({
    mutationFn: () => userApi.assignPermission({
      user_id: form.subject_type === 'user' ? form.user_id : null,
      group_id: form.subject_type === 'group' ? form.group_id : null,
      resource_type: form.resource_type, resource_id: form.resource_id, role: form.role,
    }),
  })

  function set(k: string, v: string) { setForm((f) => ({ ...f, [k]: v })) }
  const resources = form.resource_type === 'folder' ? folders : hypervisors

  return (
    <div className="card max-w-xl space-y-4">
      <p className="text-sm font-semibold" style={{ color: 'var(--text)' }}>Assign Permission</p>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="text-xs font-medium mb-1 block" style={{ color: 'var(--text-muted)' }}>Subject type</label>
          <select className="select" value={form.subject_type} onChange={(e) => set('subject_type', e.target.value)}>
            <option value="user">User</option>
            <option value="group">Group</option>
          </select>
        </div>
        <div>
          <label className="text-xs font-medium mb-1 block" style={{ color: 'var(--text-muted)' }}>
            {form.subject_type === 'user' ? 'User' : 'Group'}
          </label>
          {form.subject_type === 'user'
            ? <select className="select" value={form.user_id} onChange={(e) => set('user_id', e.target.value)}>
                <option value="">Select user…</option>
                {users.map((u: any) => <option key={u.id} value={u.id}>{u.email}</option>)}
              </select>
            : <select className="select" value={form.group_id} onChange={(e) => set('group_id', e.target.value)}>
                <option value="">Select group…</option>
                {groups.map((g: any) => <option key={g.id} value={g.id}>{g.name}</option>)}
              </select>
          }
        </div>
        <div>
          <label className="text-xs font-medium mb-1 block" style={{ color: 'var(--text-muted)' }}>Resource type</label>
          <select className="select" value={form.resource_type} onChange={(e) => set('resource_type', e.target.value)}>
            <option value="folder">Folder</option>
            <option value="hypervisor">Hypervisor</option>
          </select>
        </div>
        <div>
          <label className="text-xs font-medium mb-1 block" style={{ color: 'var(--text-muted)' }}>Resource</label>
          <select className="select" value={form.resource_id} onChange={(e) => set('resource_id', e.target.value)}>
            <option value="">Select…</option>
            {resources.map((r: any) => <option key={r.id} value={r.id}>{r.name ?? r.hostname}</option>)}
          </select>
        </div>
        <div>
          <label className="text-xs font-medium mb-1 block" style={{ color: 'var(--text-muted)' }}>Role</label>
          <select className="select" value={form.role} onChange={(e) => set('role', e.target.value)}>
            {ROLES.map((r) => <option key={r} value={r}>{r.replace('_', ' ')}</option>)}
          </select>
        </div>
      </div>
      {mut.isSuccess && <p className="text-xs" style={{ color: 'var(--success)' }}>✓ Permission assigned.</p>}
      {mut.isError && <p className="text-xs" style={{ color: 'var(--danger)' }}>Failed to assign permission.</p>}
      <button
        className="btn-primary"
        disabled={mut.isPending || !form.resource_id || (!form.user_id && !form.group_id)}
        onClick={() => mut.mutate()}
      >
        {mut.isPending ? 'Assigning…' : 'Assign Permission'}
      </button>
    </div>
  )
}

function UserFormModal({ existing, onClose }: { existing?: any; onClose: () => void }) {
  const qc = useQueryClient()
  const [form, setForm] = useState({
    email: existing?.email ?? '', full_name: existing?.full_name ?? '',
    password: '', role: existing?.role ?? 'read_only', is_active: existing?.is_active ?? true,
  })

  function set(k: string, v: unknown) { setForm((f) => ({ ...f, [k]: v })) }

  const mut = useMutation({
    mutationFn: () => existing
      ? userApi.update(existing.id, { full_name: form.full_name, role: form.role, is_active: form.is_active, password: form.password || undefined })
      : userApi.create({ email: form.email, full_name: form.full_name, password: form.password, role: form.role }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['users'] }); onClose() },
  })

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div className="w-full max-w-sm rounded-xl border shadow-2xl" style={{ background: 'var(--surface)', borderColor: 'var(--border)' }}>
        <div className="flex items-center justify-between px-5 py-4 border-b" style={{ borderColor: 'var(--border)' }}>
          <h2 className="text-sm font-semibold" style={{ color: 'var(--text)' }}>{existing ? 'Edit User' : 'New User'}</h2>
          <button className="btn-ghost p-1.5" onClick={onClose}><X size={16} /></button>
        </div>
        <div className="p-5 space-y-3">
          {!existing && (
            <div>
              <label className="text-xs font-medium mb-1 block" style={{ color: 'var(--text-muted)' }}>Email</label>
              <input type="email" className="input" value={form.email} onChange={(e) => set('email', e.target.value)} />
            </div>
          )}
          <div>
            <label className="text-xs font-medium mb-1 block" style={{ color: 'var(--text-muted)' }}>Full Name</label>
            <input className="input" value={form.full_name} onChange={(e) => set('full_name', e.target.value)} />
          </div>
          <div>
            <label className="text-xs font-medium mb-1 block" style={{ color: 'var(--text-muted)' }}>
              {existing ? 'New Password (leave blank to keep)' : 'Password'}
            </label>
            <input type="password" className="input" value={form.password} onChange={(e) => set('password', e.target.value)} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs font-medium mb-1 block" style={{ color: 'var(--text-muted)' }}>Role</label>
              <select className="select" value={form.role} onChange={(e) => set('role', e.target.value)}>
                {ROLES.map((r) => <option key={r} value={r}>{r.replace('_', ' ')}</option>)}
              </select>
            </div>
            {existing && (
              <div>
                <label className="text-xs font-medium mb-1 block" style={{ color: 'var(--text-muted)' }}>Status</label>
                <select className="select" value={String(form.is_active)} onChange={(e) => set('is_active', e.target.value === 'true')}>
                  <option value="true">Active</option>
                  <option value="false">Disabled</option>
                </select>
              </div>
            )}
          </div>
        </div>
        <div className="flex justify-end gap-2 px-5 py-4 border-t" style={{ borderColor: 'var(--border)' }}>
          <button className="btn-ghost" onClick={onClose}>Cancel</button>
          <button
            className="btn-primary"
            disabled={mut.isPending || !form.full_name || (!existing && (!form.email || !form.password))}
            onClick={() => mut.mutate()}
          >
            {mut.isPending ? 'Saving…' : existing ? 'Save Changes' : 'Create User'}
          </button>
        </div>
      </div>
    </div>
  )
}
