import { useDroppable } from '@dnd-kit/core'
import { SortableContext, verticalListSortingStrategy } from '@dnd-kit/sortable'
import type { FieldJob, FieldStage } from '../types'
import { T } from '../tokens'
import { JobCard } from './JobCard'

interface Props {
  stage: FieldStage
  label: string
  jobs: FieldJob[]
  isOver: boolean
  isValidTarget?: boolean
  online: boolean
  unpushedJobIds: Set<string>
  onNotesUpdated: (jobId: string, notes: string) => void
  onSUUpdated: (jobId: string, su_opened: string, su_closed: string) => void
  onMarkUnpushed: (jobId: string) => void
}

export function KanbanColumn({ stage, label, jobs, isOver, isValidTarget = true, online, unpushedJobIds, onNotesUpdated, onSUUpdated, onMarkUnpushed }: Props) {
  const { setNodeRef } = useDroppable({ id: stage })

  const invalidHover = isOver && !isValidTarget

  return (
    <div
      style={{
        flex: 1,
        minWidth: 240,
        maxWidth: 380,
        background: invalidHover ? '#fef2f2' : isOver ? T.colBgOver : T.colBg,
        borderRadius: 10,
        padding: '12px 10px',
        border: invalidHover ? '2px dashed #ef4444' : '2px solid transparent',
        transition: 'background 0.15s, border-color 0.15s',
        display: 'flex',
        flexDirection: 'column',
        minHeight: 200,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
        <span style={{ fontWeight: 700, fontSize: 14, color: T.text }}>{label}</span>
        <span
          style={{
            background: T.badgeBg,
            color: T.badgeText,
            fontSize: 11,
            fontWeight: 600,
            borderRadius: 10,
            padding: '1px 8px',
          }}
        >
          {jobs.length}
        </span>
      </div>
      <div ref={setNodeRef} style={{ flex: 1 }}>
        <SortableContext items={jobs.map(j => j.job_id)} strategy={verticalListSortingStrategy}>
          {jobs.map(job => (
            <JobCard
              key={job.job_id}
              job={job}
              online={online}
              isUnpushed={unpushedJobIds.has(job.job_id)}
              onNotesUpdated={onNotesUpdated}
              onSUUpdated={onSUUpdated}
              onMarkUnpushed={onMarkUnpushed}
            />
          ))}
        </SortableContext>
        {jobs.length === 0 && (
          <div
            style={{
              textAlign: 'center',
              color: T.textMuted,
              fontSize: 12,
              padding: '24px 0',
              border: `1px dashed ${T.border}`,
              borderRadius: 6,
            }}
          >
            Drop here
          </div>
        )}
      </div>
    </div>
  )
}
