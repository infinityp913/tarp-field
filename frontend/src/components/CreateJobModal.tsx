import { useState } from 'react'
import { T } from '../tokens'

interface Props {
  onClose: () => void
  onCreate: (jobId: string, suString: string) => void
}

export function CreateJobModal({ onClose, onCreate }: Props) {
  const [jobNum, setJobNum] = useState('')
  const [suString, setSuString] = useState('')
  const [error, setError] = useState('')

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    const num = jobNum.trim()
    if (!num || !/^\d+$/.test(num)) {
      setError('Enter a valid job number (digits only)')
      return
    }
    onCreate(`Pgram_Job_${num}`, suString.trim())
    onClose()
  }

  const overlay: React.CSSProperties = {
    position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.3)',
    display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 100,
  }
  const modal: React.CSSProperties = {
    background: T.surface, border: `1px solid ${T.border}`, borderRadius: 10,
    padding: 24, width: 360, boxShadow: '0 8px 32px rgba(0,0,0,0.12)',
  }
  const input: React.CSSProperties = {
    width: '100%', padding: '8px 10px', fontSize: 14,
    background: T.inputBg, border: `1px solid ${T.inputBorder}`,
    borderRadius: 6, color: T.text, fontFamily: 'inherit', outline: 'none',
  }
  const btn: React.CSSProperties = {
    padding: '8px 18px', borderRadius: 6, border: 'none',
    fontWeight: 600, fontSize: 14, cursor: 'pointer',
  }

  return (
    <div style={overlay} onClick={onClose}>
      <div style={modal} onClick={e => e.stopPropagation()}>
        <div style={{ fontWeight: 700, fontSize: 16, marginBottom: 16, color: T.text }}>New Job</div>
        <form onSubmit={handleSubmit}>
          <div style={{ marginBottom: 12 }}>
            <label style={{ fontSize: 12, color: T.textSub, display: 'block', marginBottom: 4 }}>
              Job number
            </label>
            <input
              style={input}
              value={jobNum}
              onChange={e => setJobNum(e.target.value)}
              placeholder="e.g. 696"
              autoFocus
            />
          </div>
          <div style={{ marginBottom: 16 }}>
            <label style={{ fontSize: 12, color: T.textSub, display: 'block', marginBottom: 4 }}>
              SU string (optional)
            </label>
            <input
              style={input}
              value={suString}
              onChange={e => setSuString(e.target.value)}
              placeholder="e.g. SU16014-16015"
            />
          </div>
          {error && <div style={{ fontSize: 12, color: '#ef4444', marginBottom: 8 }}>{error}</div>}
          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
            <button type="button" style={{ ...btn, background: T.colBg, color: T.text }} onClick={onClose}>
              Cancel
            </button>
            <button type="submit" style={{ ...btn, background: T.accent, color: '#fff' }}>
              Create
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
