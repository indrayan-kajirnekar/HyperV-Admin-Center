import { Outlet, NavLink, useNavigate } from 'react-router-dom'
import { useAuthStore } from '@/stores/authStore'
import { useThemeStore } from '@/stores/themeStore'
import { useWebSocket } from '@/hooks/useWebSocket'
import { useState } from 'react'
import ChangePasswordModal from '@/components/auth/ChangePasswordModal'
import {
  LayoutDashboard, Monitor, Server, FolderOpen,
  Users, ClipboardList, Sun, Moon, KeyRound,
  LogOut, WifiOff, ChevronRight,
} from 'lucide-react'

const NAV = [
  { to: '/',        label: 'Overview',      icon: LayoutDashboard, end: true },
  { to: '/vms',     label: 'Virtual Machines', icon: Monitor },
  { to: '/servers', label: 'Servers',        icon: Server },
  { to: '/folders', label: 'Folders & Quotas', icon: FolderOpen },
  { to: '/users',   label: 'Users & Groups', icon: Users },
  { to: '/audit',   label: 'Audit Log',      icon: ClipboardList },
]

export default function AppShell() {
  const { email, fullName, role, logout } = useAuthStore()
  const { theme, toggle }                 = useThemeStore()
  const { connected }                     = useWebSocket()
  const navigate                          = useNavigate()
  const [showPwd, setShowPwd]             = useState(false)

  function handleLogout() { logout(); navigate('/login') }

  const initials = (fullName ?? email ?? 'A')
    .split(' ').map(w => w[0]?.toUpperCase() ?? '').slice(0, 2).join('')

  return (
    <div className="flex h-full overflow-hidden">

      {/* ── Sidebar ──────────────────────────────────────────────────────── */}
      <aside className="flex flex-col w-56 shrink-0 h-full overflow-hidden"
        style={{ background: 'var(--sidebar-bg)', borderRight: '1px solid rgba(255,255,255,0.06)' }}>

        {/* Brand */}
        <div className="flex items-center gap-2.5 px-4 h-14 shrink-0 border-b"
          style={{ borderColor: 'rgba(255,255,255,0.08)' }}>
          <div className="w-7 h-7 rounded flex items-center justify-center shrink-0"
            style={{ background: 'var(--accent)' }}>
            <Server size={14} color="#fff" />
          </div>
          <div>
            <span className="text-sm font-bold text-white">HyperVision</span>
            <p className="text-xs" style={{ color: 'var(--sidebar-text)', opacity: 0.6 }}>Admin Center</p>
          </div>
        </div>

        {/* Nav */}
        <nav className="flex-1 overflow-y-auto py-3">
          <p className="sidebar-section">Navigation</p>
          {NAV.map(({ to, label, icon: Icon, end }) => (
            <NavLink key={to} to={to} end={end}
              className={({ isActive }) =>
                `sidebar-item ${isActive ? 'sidebar-item-active' : ''}`}>
              {({ isActive }) => (
                <>
                  <Icon size={16} className="shrink-0" />
                  <span className="flex-1 text-sm">{label}</span>
                  {isActive && <ChevronRight size={13} style={{ opacity: 0.5 }} />}
                </>
              )}
            </NavLink>
          ))}
        </nav>

        {/* Connection status */}
        <div className="px-4 py-2 border-t flex items-center gap-2"
          style={{ borderColor: 'rgba(255,255,255,0.06)' }}>
          {connected
            ? <><span className="pulse-live" /><span className="text-xs" style={{ color: 'var(--sidebar-text)', opacity: 0.7 }}>Live</span></>
            : <><WifiOff size={12} style={{ color: 'var(--danger)' }} /><span className="text-xs" style={{ color: 'var(--danger)' }}>Offline</span></>}
        </div>

        {/* User footer */}
        <div className="px-3 pb-3 border-t pt-3" style={{ borderColor: 'rgba(255,255,255,0.06)' }}>
          <div className="flex items-center gap-2.5 mb-2">
            <div className="w-8 h-8 rounded-full flex items-center justify-center shrink-0 text-xs font-bold text-white"
              style={{ background: 'var(--accent)' }}>{initials}</div>
            <div className="flex-1 min-w-0">
              <p className="text-xs font-semibold truncate text-white">{fullName ?? email}</p>
              <p className="text-xs truncate" style={{ color: 'var(--sidebar-text)', opacity: 0.6 }}>{role}</p>
            </div>
          </div>
          <div className="flex items-center gap-1">
            <button className="btn-ghost p-1.5 flex-1 justify-center rounded"
              title="Toggle theme" onClick={toggle}
              style={{ color: 'var(--sidebar-text)' }}>
              {theme === 'dark' ? <Sun size={14} /> : <Moon size={14} />}
            </button>
            <button className="btn-ghost p-1.5 flex-1 justify-center rounded"
              title="Change password" onClick={() => setShowPwd(true)}
              style={{ color: 'var(--sidebar-text)' }}>
              <KeyRound size={14} />
            </button>
            <button className="btn-ghost p-1.5 flex-1 justify-center rounded"
              title="Log out" onClick={handleLogout}
              style={{ color: 'var(--sidebar-text)' }}>
              <LogOut size={14} />
            </button>
          </div>
        </div>
      </aside>

      {/* ── Main content ─────────────────────────────────────────────────── */}
      <main className="flex-1 overflow-hidden flex flex-col min-w-0">
        <Outlet />
      </main>

      {showPwd && <ChangePasswordModal onClose={() => setShowPwd(false)} />}
    </div>
  )
}
