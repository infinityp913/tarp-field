import { useEffect, useRef, useState } from 'react'
import type { FieldJob } from '../types'
import { updateNotes } from '../api/field'
import { T } from '../tokens'

interface Props {
  job: FieldJob
  online: boolean
  onClose: () => void
  onSaved: (jobId: string, notes: string) => void
}

function savedAgo(ts: number | null): string {
  if (ts === null) return ''
  const s = Math.floor((Date.now() - ts) / 1000)
  if (s < 60) return 'just now'
  return `${Math.floor(s / 60)}m ago`
}

export function NotesModal({ job, online, onClose, onSaved }: Props) {
  const [notes, setNotes] = useState(job.notes)
  const [savedNotes, setSavedNotes] = useState(job.notes)
  const [saving, setSaving] = useState(false)
  const [lastSaved, setLastSaved] = useState<number | null>(null)
  const [, tick] = useState(0)

  const isDirty = notes !== savedNotes

  // Refresh "X ago" label every 30s
  useEffect(() => {
    const iv = setInterval(() => tick(n => n + 1), 30_000)
    return () => clearInterval(iv)
  }, [])

  const notesRef = useRef(notes)
  useEffect(() => { notesRef.current = notes }, [notes])
  const savedNotesRef = useRef(savedNotes)

  async function doSave(currentNotes: string, closeAfter: boolean) {
    setSaving(true)
    try {
      await updateNotes(job.job_id, currentNotes, online)
      setSavedNotes(currentNotes)
      savedNotesRef.current = currentNotes
      setLastSaved(Date.now())
      onSaved(job.job_id, currentNotes)
      if (closeAfter) onClose()
    } catch {
      // stay open on error so user doesn't lose notes
    } finally {
      setSaving(false)
    }
  }

  // 15-min auto-save if dirty
  useEffect(() => {
    const iv = setInterval(() => {
      if (notesRef.current !== savedNotesRef.current) {
        doSave(notesRef.current, false)
      }
    }, 15 * 60 * 1000)
    return () => clearInterval(iv)
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // Close on Escape
  useEffect(() => {
    function onKey(e: KeyboardEvent) { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  return (
    <div style={overlay} onClick={e => { if (e.target === e.currentTarget) onClose() }}>
      <div style={dialog}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 16 }}>
          <div>
            <div style={{ fontWeight: 700, fontSize: 16, color: T.text }}>{job.job_id}</div>
            {job.su_string && <div style={{ fontSize: 13, color: T.textSub, marginTop: 2 }}>{job.su_string}</div>}
          </div>
          <button onClick={onClose} style={closeBtn}>✕</button>
        </div>

        <label style={labelStyle}>Field Notes</label>
        <textarea
          value={notes}
          onChange={e => setNotes(e.target.value)}
          autoFocus
          placeholder="Drone vs. handheld, weather, anything unusual, which SUs photographed..."
          style={textareaStyle}
        />

        {!online && (
          <div style={{ fontSize: 12, color: T.textMuted, marginTop: 6 }}>
            Offline — will sync when reconnected
          </div>
        )}

        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: 14 }}>
          <div style={{ fontSize: 12 }}>
            {isDirty
              ? <span style={{ color: '#d97706', fontWeight: 600 }}>● Unsaved changes</span>
              : lastSaved
                ? <span style={{ color: T.textMuted }}>Saved {savedAgo(lastSaved)}</span>
                : null
            }
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <button onClick={onClose} style={btnSecondary}>Cancel</button>
            <button
              onClick={() => doSave(notes, true)}
              disabled={saving || !isDirty}
              style={{ ...btnPrimary, opacity: !isDirty ? 0.45 : 1, cursor: !isDirty ? 'default' : 'pointer' }}
            >
              {saving ? 'Saving…' : 'Save Notes'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

const overlay: React.CSSProperties = {
  position: 'fixed', inset: 0, background: 'rgba(15,23,42,0.45)',
  display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000,
}
const dialog: React.CSSProperties = {
  background: T.surface, borderRadius: 12, padding: 24, width: 460,
  boxShadow: '0 8px 32px rgba(0,0,0,0.18)', border: `1px solid ${T.border}`,
}
const labelStyle: React.CSSProperties = {
  display: 'block', fontSize: 13, fontWeight: 600, color: T.textSub, marginBottom: 6,
}
const textareaStyle: React.CSSProperties = {
  width: '100%', minHeight: 120, padding: '10px 12px',
  border: `1px solid ${T.inputBorder}`, borderRadius: 8, fontSize: 14,
  resize: 'vertical', fontFamily: 'inherit', outline: 'none',
  background: T.inputBg, color: T.text, boxSizing: 'border-box',
  lineHeight: 1.5,
}
const closeBtn: React.CSSProperties = {
  background: 'none', border: 'none', cursor: 'pointer',
  fontSize: 18, color: T.textMuted, padding: 4, flexShrink: 0,
}
const btnPrimary: React.CSSProperties = {
  padding: '8px 18px', borderRadius: 6, border: 'none',
  background: T.accent, color: '#fff', fontWeight: 600, fontSize: 14, cursor: 'pointer',
}
const btnSecondary: React.CSSProperties = {
  padding: '8px 18px', borderRadius: 6, border: `1px solid ${T.border}`,
  background: T.surface, color: T.textSub, fontWeight: 600, fontSize: 14, cursor: 'pointer',
}
