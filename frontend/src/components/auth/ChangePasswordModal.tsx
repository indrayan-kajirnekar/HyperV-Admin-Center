/**
 * Change Password Modal
 * - Validates current password before accepting new one
 * - Works immediately after an admin-triggered password reset
 * - Shows field-level error from API
 * - Password strength indicator
 */
import { useState } from 'react'
import { useMutation } from '@tanstack/react-query'
import { authApi } from '@/lib/api'
import { X, Eye, EyeOff, KeyRound, CheckCircle } from 'lucide-react'

interface Props { onClose: () => void }

function strengthLabel(p: string): { label: string; color: string; width: string } {
  if (p.length === 0) return { label: '', color: 'var(--border)', width: '0%' }
  let score = 0
  if (p.length >= 8)  score++
  if (p.length >= 12) score++
  if (/[A-Z]/.test(p)) score++
  if (/[0-9]/.test(p)) score++
  if (/[^A-Za-z0-9]/.test(p)) score++
  if (score <= 1) return { label: 'Weak',   color: 'var(--danger)',  width: '25%' }
  if (score <= 2) return { label: 'Fair',   color: 'var(--warning)', width: '50%' }
  if (score <= 3) return { label: 'Good',   color: 'var(--info)',    width: '75%' }
  return              { label: 'Strong', color: 'var(--success)', width: '100%' }
}

export default function ChangePasswordModal({ onClose }: Props) {
  const [current, setCurrent] = useState('')
  const [next, setNext] = useState('')
  const [confirm, setConfirm] = useState('')
  const [showCurrent, setShowCurrent] = useState(false)
  const [showNext, setShowNext] = useState(false)
  const [successMsg, setSuccessMsg] = useState('')

  const strength = strengthLabel(next)
  const mismatch = confirm.length > 0 && next !== confirm
  const canSubmit = current.length > 0 && next.length >= 8 && next === confirm && !mismatch

  const mut = useMutation({
    mutationFn: () => authApi.changePassword(current, next),
    onSuccess: () => {
      setSuccessMsg('Password changed successfully. You can close this window.')
      setCurrent(''); setNext(''); setConfirm('')
    },
  })

  const apiError: string | null = mut.error
    ? (mut.error as any)?.response?.data?.detail ?? 'Something went wrong. Please try again.'
    : null

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div
        className="w-full max-w-sm rounded-xl border shadow-2xl"
        style={{ background: 'var(--surface)', borderColor: 'var(--border)' }}
      >
        {/* Header */}
        <div
          className="flex items-center justify-between px-5 py-4 border-b"
          style={{ borderColor: 'var(--border)' }}
        >
          <div className="flex items-center gap-2">
            <KeyRound size={16} style={{ color: 'var(--accent)' }} />
            <h2 className="text-sm font-semibold" style={{ color: 'var(--text)' }}>
              Change Password
            </h2>
          </div>
          <button className="btn-ghost p-1.5" onClick={onClose}><X size={16} /></button>
        </div>

        <div className="p-5 space-y-4">
          {/* Success state */}
          {successMsg ? (
            <div
              className="flex items-start gap-2 rounded-md border p-3 text-sm"
              style={{ borderColor: 'var(--success)', background: 'rgba(22,163,74,0.08)', color: 'var(--success)' }}
            >
              <CheckCircle size={16} className="mt-0.5 flex-shrink-0" />
              <span>{successMsg}</span>
            </div>
          ) : (
            <>
              {/* API error */}
              {apiError && (
                <div
                  className="rounded-md border p-3 text-xs"
                  style={{ borderColor: 'var(--danger)', background: 'rgba(220,38,38,0.08)', color: 'var(--danger)' }}
                >
                  {apiError}
                </div>
              )}

              {/* Current password */}
              <div>
                <label className="block text-xs font-medium mb-1" style={{ color: 'var(--text-muted)' }}>
                  Current Password
                </label>
                <div className="relative">
                  <input
                    type={showCurrent ? 'text' : 'password'}
                    className="input pr-9"
                    placeholder="Your current password"
                    value={current}
                    onChange={(e) => setCurrent(e.target.value)}
                    autoFocus
                  />
                  <button
                    type="button"
                    className="absolute right-2 top-1/2 -translate-y-1/2"
                    style={{ color: 'var(--text-muted)' }}
                    onClick={() => setShowCurrent((v) => !v)}
                  >
                    {showCurrent ? <EyeOff size={14} /> : <Eye size={14} />}
                  </button>
                </div>
              </div>

              {/* New password */}
              <div>
                <label className="block text-xs font-medium mb-1" style={{ color: 'var(--text-muted)' }}>
                  New Password
                  <span className="ml-2 font-normal">(min. 8 characters)</span>
                </label>
                <div className="relative">
                  <input
                    type={showNext ? 'text' : 'password'}
                    className="input pr-9"
                    placeholder="New password"
                    value={next}
                    onChange={(e) => setNext(e.target.value)}
                  />
                  <button
                    type="button"
                    className="absolute right-2 top-1/2 -translate-y-1/2"
                    style={{ color: 'var(--text-muted)' }}
                    onClick={() => setShowNext((v) => !v)}
                  >
                    {showNext ? <EyeOff size={14} /> : <Eye size={14} />}
                  </button>
                </div>
                {/* Strength bar */}
                {next.length > 0 && (
                  <div className="mt-1.5 flex items-center gap-2">
                    <div className="flex-1 h-1 rounded-full" style={{ background: 'var(--border)' }}>
                      <div
                        className="h-full rounded-full transition-all duration-300"
                        style={{ width: strength.width, background: strength.color }}
                      />
                    </div>
                    <span className="text-xs" style={{ color: strength.color, minWidth: 40 }}>
                      {strength.label}
                    </span>
                  </div>
                )}
              </div>

              {/* Confirm */}
              <div>
                <label className="block text-xs font-medium mb-1" style={{ color: 'var(--text-muted)' }}>
                  Confirm New Password
                </label>
                <input
                  type="password"
                  className="input"
                  placeholder="Repeat new password"
                  value={confirm}
                  onChange={(e) => setConfirm(e.target.value)}
                  style={mismatch ? { borderColor: 'var(--danger)' } : {}}
                />
                {mismatch && (
                  <p className="text-xs mt-1" style={{ color: 'var(--danger)' }}>
                    Passwords do not match.
                  </p>
                )}
              </div>
            </>
          )}
        </div>

        <div
          className="flex justify-end gap-2 px-5 py-4 border-t"
          style={{ borderColor: 'var(--border)' }}
        >
          <button className="btn-ghost" onClick={onClose}>
            {successMsg ? 'Close' : 'Cancel'}
          </button>
          {!successMsg && (
            <button
              className="btn-primary"
              disabled={!canSubmit || mut.isPending}
              onClick={() => mut.mutate()}
            >
              {mut.isPending ? 'Changing…' : 'Change Password'}
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
