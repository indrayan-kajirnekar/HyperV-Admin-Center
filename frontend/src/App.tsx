import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { useAuthStore } from '@/stores/authStore'
import { useThemeStore } from '@/stores/themeStore'
import { useEffect } from 'react'
import AppShell from '@/components/layout/AppShell'
import LoginPage from '@/pages/LoginPage'
import VMsPage from '@/pages/VMsPage'
import ServersPage from '@/pages/ServersPage'
import FoldersPage from '@/pages/FoldersPage'
import UsersPage from '@/pages/UsersPage'
import AuditPage from '@/pages/AuditPage'

function RequireAuth({ children }: { children: React.ReactNode }) {
  const token = useAuthStore((s) => s.token)
  if (!token) return <Navigate to="/login" replace />
  return <>{children}</>
}

export default function App() {
  const theme = useThemeStore((s) => s.theme)
  useEffect(() => {
    document.documentElement.classList.toggle('dark', theme === 'dark')
  }, [theme])

  return (
    <BrowserRouter>
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route
          path="/"
          element={
            <RequireAuth>
              <AppShell />
            </RequireAuth>
          }
        >
          <Route index element={<Navigate to="/vms" replace />} />
          <Route path="vms" element={<VMsPage />} />
          <Route path="servers" element={<ServersPage />} />
          <Route path="folders" element={<FoldersPage />} />
          <Route path="users" element={<UsersPage />} />
          <Route path="audit" element={<AuditPage />} />
        </Route>
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  )
}
