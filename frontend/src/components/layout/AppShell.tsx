import { useState } from 'react'
import { Outlet, NavLink, useNavigate } from 'react-router-dom'
import { useAuthStore } from '@/stores/authStore'
import { useThemeStore } from '@/stores/themeStore'
import { useWebSocket } from '@/hooks/useWebSocket'
import { useEventBus } from '@/stores/eventBusStore'
import {
  Server, FolderOpen, Users, ClipboardList,
  Sun, Moon, LogOut, WifiOff, Cpu, KeyRound,
} from 'lucide-react'
import ChangePasswordModal from '@/components/auth/ChangePasswordModal'

const NAV = [
  { to: '/vms',     label: 'Virtual Machines', icon: Cpu },
  { to: '/servers', label: 'Servers',           icon: Server },
  { to: '/folders', label: 'Folders & Quotas',  icon: FolderOpen },
  { to: '/users',   label: 'Users & Groups',    icon: Users },
  { to: '/audit',   label: 'Audit Log',         icon: ClipboardList },
]

export default function AppShell() {
  useWebSocket()
  const { fullName, email, role, logout } = useAuthStore()
  const { theme, toggle } = useThemeStore()
  const navigate = useNavigate()
  const connected = useEventBus((s) => s.connected)
  const [showChangePassword, setShowChangePassword] = useState(false)

  function handleLogout() {
    logout()
    navigate('/login')
  }

  return (
    <div className="flex h-screen overflow-hidden" style={{ background: 'var(--bg)' }}>
      {/* ── Sidebar ─────────────────────────────────────────────────────── */}
      <aside
        className="flex w-56 flex-shrink-0 flex-col border-r"
        style={{ background: 'var(--surface)', borderColor: 'var(--border)' }}
      >
        {/* Brand */}
        <div className="flex items-center gap-2.5 px-4 py-4 border-b" style={{ borderColor: 'var(--border)' }}>
          <Server size={20} style={{ color: 'var(--accent)' }} strokeWidth={1.8} />
          <span className="text-sm font-bold tracking-tight" style={{ color: 'var(--text)' }}>
            Hyper<span style={{ color: 'var(--accent)' }}>Vision</span>
          </span>
        </div>

        {/* Nav */}
        <nav className="flex-1 space-y-0.5 p-2 pt-3">
          {NAV.map(({ to, label, icon: Icon }) => (
            <NavLink key={to} to={to}>
              {({ isActive }) => (
                <span className={isActive ? 'sidebar-item-active' : 'sidebar-item'}>
                  <Icon size={16} strokeWidth={1.8} />
                  {label}
                </span>
              )}
            </NavLink>
          ))}
        </nav>

        {/* Footer */}
        <div className="border-t p-3 space-y-2" style={{ borderColor: 'var(--border)' }}>
          {/* WS status */}
          <div className="flex items-center gap-1.5 px-1 text-xs" style={{ color: 'var(--text-muted)' }}>
            {connected
              ? <><span className="pulse-live" /><span>Live</span></>
              : <><WifiOff size={12} /><span>Reconnecting…</span></>
            }
          </div>
          {/* User info */}
          <div className="rounded-md px-2 py-1.5" style={{ background: 'var(--surface-2)' }}>
            <p className="text-xs font-medium truncate" style={{ color: 'var(--text)' }}>{fullName}</p>
            <p className="text-xs truncate" style={{ color: 'var(--text-muted)' }}>{email}</p>
            <span className="mt-1 inline-block badge bg-brand-100 text-brand-700 dark:bg-brand-950/50 dark:text-brand-300">
              {role?.replace('_', ' ')}
            </span>
          </div>
          {/* Actions */}
          <div className="grid grid-cols-2 gap-1">
            <button className="btn-ghost text-xs justify-center" onClick={toggle}>
              {theme === 'dark' ? <Sun size={13} /> : <Moon size={13} />}
              {theme === 'dark' ? 'Light' : 'Dark'}
            </button>
            <button className="btn-ghost text-xs justify-center" onClick={() => setShowChangePassword(true)}>
              <KeyRound size={13} />
              Password
            </button>
            <button className="btn-ghost text-xs justify-center col-span-2" onClick={handleLogout}>
              <LogOut size={13} />
              Logout
            </button>
          </div>
        </div>
      </aside>

      {/* ── Main ────────────────────────────────────────────────────────── */}
      <main className="flex flex-1 flex-col overflow-hidden">
        <div className="flex-1 overflow-y-auto">
          <Outlet />
        </div>
      </main>

      {showChangePassword && (
        <ChangePasswordModal onClose={() => setShowChangePassword(false)} />
      )}
    </div>
  )
}
