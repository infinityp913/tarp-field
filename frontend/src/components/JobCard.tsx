import { useState, useRef } from 'react'
import { useSortable } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import type { FieldJob } from '../types'
import { T } from '../tokens'
import { updateNotes } from '../api/field'

interface Props {
  job: FieldJob
  online: boolean
  onNotesUpdated: (jobId: string, notes: string) => void
}

export function JobCard({ job, online, onNotesUpdated }: Props) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({ id: job.job_id })

  const [expanded, setExpanded] = useState(false)
  const [notes, setNotes] = useState(job.notes)
  const savedNotes = useRef(job.notes)

  async function handleNotesBlur() {
    if (notes === savedNotes.current) return
    try {
      await updateNotes(job.job_id, notes, online)
      savedNotes.current = notes
      onNotesUpdated(job.job_id, notes)
    } catch {
      setNotes(savedNotes.current)
    }
  }

  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.4 : 1,
    background: T.surface,
    border: `1px solid ${T.border}`,
    borderRadius: 8,
    padding: '10px 12px',
    marginBottom: 8,
    cursor: 'grab',
    userSelect: 'none',
  }

  return (
    <div ref={setNodeRef} style={style} {...attributes} {...listeners}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <div>
          <div style={{ fontWeight: 600, fontSize: 14, color: T.text }}>{job.job_id}</div>
          {job.su_string && (
            <div style={{ fontSize: 12, color: T.textSub, marginTop: 2 }}>{job.su_string}</div>
          )}
          {job.trench && (
            <div style={{ fontSize: 12, color: T.textMuted, marginTop: 1 }}>{job.trench}</div>
          )}
        </div>
        <button
          onPointerDown={e => e.stopPropagation()}
          onClick={e => { e.stopPropagation(); setExpanded(v => !v) }}
          style={{
            background: 'none',
            border: 'none',
            cursor: 'pointer',
            fontSize: 12,
            color: T.accent,
            padding: '2px 4px',
            flexShrink: 0,
          }}
          title="Toggle notes"
        >
          {expanded ? '▲' : '▼'} notes
        </button>
      </div>

      {expanded && (
        <div onPointerDown={e => e.stopPropagation()} style={{ marginTop: 8 }}>
          <textarea
            value={notes}
            onChange={e => setNotes(e.target.value)}
            onBlur={handleNotesBlur}
            placeholder="SUs open/closed, drone vs. handheld, anything unusual…"
            rows={3}
            style={{
              width: '100%',
              resize: 'vertical',
              fontSize: 12,
              fontFamily: 'inherit',
              background: T.inputBg,
              border: `1px solid ${T.inputBorder}`,
              borderRadius: 4,
              padding: '6px 8px',
              color: T.text,
              outline: 'none',
            }}
          />
          {!online && (
            <div style={{ fontSize: 11, color: T.textMuted, marginTop: 2 }}>
              Offline — changes will sync when reconnected
            </div>
          )}
        </div>
      )}
    </div>
  )
}
