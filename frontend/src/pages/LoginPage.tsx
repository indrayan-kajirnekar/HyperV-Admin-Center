import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { api } from '@/lib/api'
import { useAuthStore } from '@/stores/authStore'
import { Server, Eye, EyeOff } from 'lucide-react'

export default function LoginPage() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [showPass, setShowPass] = useState(false)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const setAuth = useAuthStore((s) => s.setAuth)
  const navigate = useNavigate()

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError('')
    setLoading(true)
    try {
      const form = new URLSearchParams()
      form.append('username', email)
      form.append('password', password)
      const res = await api.post('/auth/token', form, {
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      })
      const d = res.data
      setAuth({ token: d.access_token, userId: d.user_id, email: d.email, role: d.role, fullName: d.full_name })
      navigate('/vms')
    } catch {
      setError('Invalid email or password.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center px-4" style={{ background: 'var(--bg)' }}>
      <div className="w-full max-w-sm">
        {/* Brand */}
        <div className="mb-8 text-center">
          <div className="inline-flex items-center justify-center w-12 h-12 rounded-xl mb-3"
               style={{ background: 'var(--accent)', color: '#fff' }}>
            <Server size={24} strokeWidth={1.8} />
          </div>
          <h1 className="text-xl font-bold" style={{ color: 'var(--text)' }}>
            Hyper<span style={{ color: 'var(--accent)' }}>Vision</span>
          </h1>
          <p className="text-sm mt-1" style={{ color: 'var(--text-muted)' }}>
            Hyper-V Management Platform
          </p>
        </div>

        {/* Form */}
        <form className="card space-y-4" onSubmit={handleSubmit}>
          <div>
            <label className="block text-xs font-medium mb-1" style={{ color: 'var(--text-muted)' }}>
              Email address
            </label>
            <input
              type="email" required autoFocus className="input"
              value={email} onChange={(e) => setEmail(e.target.value)}
              placeholder="admin@corp.local"
            />
          </div>
          <div>
            <label className="block text-xs font-medium mb-1" style={{ color: 'var(--text-muted)' }}>
              Password
            </label>
            <div className="relative">
              <input
                type={showPass ? 'text' : 'password'} required className="input pr-9"
                value={password} onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••"
              />
              <button
                type="button" className="absolute right-2 top-1/2 -translate-y-1/2"
                style={{ color: 'var(--text-muted)' }} onClick={() => setShowPass((v) => !v)}
              >
                {showPass ? <EyeOff size={15} /> : <Eye size={15} />}
              </button>
            </div>
          </div>
          {error && <p className="text-xs" style={{ color: 'var(--danger)' }}>{error}</p>}
          <button
            type="submit" disabled={loading}
            className="btn-primary w-full justify-center py-2 text-sm font-semibold"
          >
            {loading ? 'Signing in…' : 'Sign in'}
          </button>
        </form>
      </div>
    </div>
  )
}
