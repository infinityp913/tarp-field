import { useState, useRef } from 'react'
import { useSortable } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import type { FieldJob } from '../types'
import { T } from '../tokens'
import { updateSU } from '../api/field'
import { NotesModal } from './NotesModal'

interface Props {
  job: FieldJob
  online: boolean
  isUnpushed: boolean
  onNotesUpdated: (jobId: string, notes: string) => void
  onSUUpdated: (jobId: string, su_opened: string, su_closed: string) => void
  onMarkUnpushed: (jobId: string) => void
}

export function JobCard({ job, online, isUnpushed, onNotesUpdated, onSUUpdated, onMarkUnpushed }: Props) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({ id: job.job_id })

  const [suOpened, setSuOpened] = useState(job.su_opened)
  const [suClosed, setSuClosed] = useState(job.su_closed)
  const savedSuOpened = useRef(job.su_opened)
  const savedSuClosed = useRef(job.su_closed)
  const [showNotes, setShowNotes] = useState(false)

  async function handleSUBlur() {
    if (suOpened === savedSuOpened.current && suClosed === savedSuClosed.current) return
    try {
      await updateSU(job.job_id, suOpened, suClosed)
      savedSuOpened.current = suOpened
      savedSuClosed.current = suClosed
      onSUUpdated(job.job_id, suOpened, suClosed)
      onMarkUnpushed(job.job_id)
    } catch {
      setSuOpened(savedSuOpened.current)
      setSuClosed(savedSuClosed.current)
    }
  }

  const cardStyle: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.4 : 1,
    background: T.surface,
    border: `1px solid ${T.border}`,
    borderRadius: 8,
    marginBottom: 8,
    display: 'flex',
    alignItems: 'stretch',
    userSelect: 'none',
    cursor: 'grab',
  }

  const hasNotes = job.notes.trim().length > 0

  return (
    <>
      <div ref={setNodeRef} style={cardStyle} {...attributes} {...listeners}>
        {/* Drag handle — visual indicator only */}
        <div
          style={{
            width: 28,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            color: T.textMuted,
            fontSize: 16,
            flexShrink: 0,
            borderRight: `1px solid ${T.border}`,
            borderRadius: '8px 0 0 8px',
            background: T.bg,
          }}
        >
          ⠿
        </div>

        {/* Card body */}
        <div style={{ flex: 1, padding: '10px 12px', minWidth: 0 }}>
          {/* Header row: job_id + badges */}
          <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 6, marginBottom: 4 }}>
            <div style={{ fontWeight: 700, fontSize: 14, color: T.text, lineHeight: 1.3 }}>{job.job_id}</div>
            <div style={{ display: 'flex', gap: 4, flexShrink: 0, alignItems: 'center' }}>
              {isUnpushed && (
                <span style={unpushedBadge} title="Has data not yet pushed to sheet">● unpushed</span>
              )}
            </div>
          </div>

          {job.su_string && (
            <div style={{ fontSize: 12, color: T.textSub, marginBottom: 8 }}>{job.su_string}</div>
          )}

          {/* SU Opened / SU Closed inputs */}
          <div style={{ display: 'flex', gap: 8, marginBottom: 8 }}>
            <div style={{ flex: 1 }}>
              <div style={suLabel}>SUs Opened</div>
              <input
                value={suOpened}
                onChange={e => setSuOpened(e.target.value)}
                onBlur={handleSUBlur}
                onPointerDown={e => e.stopPropagation()}
                placeholder="—"
                style={suInput}
              />
            </div>
            <div style={{ flex: 1 }}>
              <div style={suLabel}>SUs Closed</div>
              <input
                value={suClosed}
                onChange={e => setSuClosed(e.target.value)}
                onBlur={handleSUBlur}
                onPointerDown={e => e.stopPropagation()}
                placeholder="—"
                style={suInput}
              />
            </div>
          </div>

          {/* Notes button */}
          <button
            onPointerDown={e => e.stopPropagation()}
            onClick={e => { e.stopPropagation(); setShowNotes(true) }}
            style={{
              ...notesBtn,
              background: hasNotes ? '#eff6ff' : T.bg,
              color: hasNotes ? T.accent : T.textMuted,
              borderColor: hasNotes ? '#bfdbfe' : T.border,
            }}
          >
            ✎ {hasNotes ? 'Edit notes' : 'Add notes'}
          </button>
        </div>
      </div>

      {showNotes && (
        <NotesModal
          job={job}
          online={online}
          onClose={() => setShowNotes(false)}
          onSaved={(jobId, notes) => {
            onNotesUpdated(jobId, notes)
            onMarkUnpushed(jobId)
          }}
        />
      )}
    </>
  )
}

const unpushedBadge: React.CSSProperties = {
  fontSize: 10,
  fontWeight: 600,
  background: '#fef3c7',
  color: '#92400e',
  border: '1px solid #fcd34d',
  borderRadius: 10,
  padding: '1px 7px',
  whiteSpace: 'nowrap',
}

const suLabel: React.CSSProperties = {
  fontSize: 10,
  fontWeight: 600,
  color: T.textMuted,
  textTransform: 'uppercase',
  letterSpacing: '0.04em',
  marginBottom: 3,
}

const suInput: React.CSSProperties = {
  width: '100%',
  padding: '5px 7px',
  border: `1px solid ${T.inputBorder}`,
  borderRadius: 5,
  fontSize: 13,
  background: T.inputBg,
  color: T.text,
  outline: 'none',
  boxSizing: 'border-box',
  fontFamily: 'inherit',
}

const notesBtn: React.CSSProperties = {
  padding: '4px 10px',
  borderRadius: 5,
  border: `1px solid`,
  fontSize: 12,
  fontWeight: 600,
  cursor: 'pointer',
  width: '100%',
  textAlign: 'left',
}
