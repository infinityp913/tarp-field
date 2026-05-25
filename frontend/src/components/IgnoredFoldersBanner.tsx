import type { IgnoredFolder } from '../api/field'
import { STAGE_LABELS } from '../types'

const MAX_IGNORED_SHOWN = 8

type Props = {
  folders: IgnoredFolder[]
  onDismiss: () => void
}

export function IgnoredFoldersBanner({ folders, onDismiss }: Props) {
  if (folders.length === 0) return null

  return (
    <div style={bannerStyle}>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 13, fontWeight: 700, color: '#92400e', marginBottom: 4 }}>
          ⚠ {folders.length} folder{folders.length !== 1 ? 's' : ''} not shown — name does not match{' '}
          <code style={codeBadge}>Pgram_Job_###</code>
        </div>
        <div style={{ fontSize: 12, color: '#78350f', lineHeight: 1.5 }}>
          {folders.slice(0, MAX_IGNORED_SHOWN).map((f, i) => (
            <span key={i}>
              <code style={codeBadge}>{f.name}</code>
              <span style={{ opacity: 0.7 }}>
                {' '}in {STAGE_LABELS[f.stage]}{f.parent && ` › ${f.parent}`}
              </span>
              {i < Math.min(folders.length, MAX_IGNORED_SHOWN) - 1 ? ', ' : ''}
            </span>
          ))}
          {folders.length > MAX_IGNORED_SHOWN && (
            <span> … and {folders.length - MAX_IGNORED_SHOWN} more</span>
          )}
          <div style={{ marginTop: 4, opacity: 0.85 }}>
            Rename to start with <code style={codeBadge}>Pgram_Job_</code> followed by digits
            (e.g. <code style={codeBadge}>Pgram_Job_123_SU17001</code>) and click ↻ Refresh.
          </div>
        </div>
      </div>
      <button onClick={onDismiss} style={dismissBtn} title="Hide this warning">
        ✕
      </button>
    </div>
  )
}

const codeBadge: React.CSSProperties = { background: '#fef3c7', padding: '0 4px', borderRadius: 3 }

const bannerStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'flex-start',
  justifyContent: 'space-between',
  gap: 12,
  margin: '0 24px 12px',
  padding: '12px 16px',
  background: '#fffbeb',
  border: '1px solid #fcd34d',
  borderRadius: 8,
}

const dismissBtn: React.CSSProperties = {
  background: 'transparent',
  border: 'none',
  color: '#92400e',
  fontSize: 16,
  fontWeight: 700,
  cursor: 'pointer',
  padding: '0 4px',
  lineHeight: 1,
  flexShrink: 0,
}
