import type { ReactNode } from 'react'

interface Props {
  title: string
  subtitle?: ReactNode
  actions?: ReactNode
}

export default function PageHeader({ title, subtitle, actions }: Props) {
  return (
    <div
      className="flex items-center justify-between px-6 py-4 border-b"
      style={{ background: 'var(--surface)', borderColor: 'var(--border)' }}
    >
      <div>
        <h1 className="text-base font-semibold" style={{ color: 'var(--text)' }}>{title}</h1>
        {subtitle && (
          <p className="text-xs mt-0.5" style={{ color: 'var(--text-muted)' }}>
            {subtitle}
          </p>
        )}
      </div>
      {actions && <div className="flex items-center gap-2">{actions}</div>}
    </div>
  )
}
