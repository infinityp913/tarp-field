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
  online: boolean
  onNotesUpdated: (jobId: string, notes: string) => void
}

export function KanbanColumn({ stage, label, jobs, isOver, online, onNotesUpdated }: Props) {
  const { setNodeRef } = useDroppable({ id: stage })

  return (
    <div
      style={{
        flex: 1,
        minWidth: 240,
        maxWidth: 380,
        background: isOver ? T.colBgOver : T.colBg,
        borderRadius: 10,
        padding: '12px 10px',
        transition: 'background 0.15s',
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
              onNotesUpdated={onNotesUpdated}
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
