import { useState, useEffect, useCallback, useRef } from 'react'
import {
  DndContext,
  DragEndEvent,
  DragOverlay,
  DragStartEvent,
  PointerSensor,
  useSensor,
  useSensors,
  useDroppable,
} from '@dnd-kit/core'
import type { FieldJob, FieldStage } from './types'
import { FIELD_STAGES, STAGE_LABELS } from './types'
import { T } from './tokens'
import { KanbanColumn } from './components/KanbanColumn'
import { CreateJobModal } from './components/CreateJobModal'
import {
  fetchJobs,
  moveStage,
  createJob,
  pushToSheets,
  replayQueue,
  queueDepth,
} from './api/field'

function OverlayCard({ job }: { job: FieldJob }) {
  return (
    <div
      style={{
        background: T.surface,
        border: `1px solid ${T.border}`,
        borderRadius: 8,
        padding: '10px 12px',
        boxShadow: '0 4px 16px rgba(0,0,0,0.15)',
        width: 280,
      }}
    >
      <div style={{ fontWeight: 600, fontSize: 14, color: T.text }}>{job.job_id}</div>
      {job.su_string && (
        <div style={{ fontSize: 12, color: T.textSub, marginTop: 2 }}>{job.su_string}</div>
      )}
    </div>
  )
}

type PushState = 'idle' | 'pushing' | 'ok' | 'error'

function timeAgo(ts: number | null): string {
  if (ts === null) return 'never'
  const s = Math.floor((Date.now() - ts) / 1000)
  if (s < 60) return 'just now'
  if (s < 3600) return `${Math.floor(s / 60)}m ago`
  return `${Math.floor(s / 3600)}h ago`
}

export default function App() {
  const [jobs, setJobs] = useState<FieldJob[]>([])
  const [activeJob, setActiveJob] = useState<FieldJob | null>(null)
  const [overColumn, setOverColumn] = useState<FieldStage | null>(null)
  const [showCreate, setShowCreate] = useState(false)
  const [online, setOnline] = useState(navigator.onLine)
  const [pendingCount, setPendingCount] = useState(0)
  const [pushState, setPushState] = useState<PushState>('idle')
  const [lastPushAt, setLastPushAt] = useState<number | null>(null)
  const [, forceUpdate] = useState(0)

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }))

  const loadJobs = useCallback(async () => {
    try {
      const data = await fetchJobs()
      setJobs(data)
    } catch {
      // stay with stale state
    }
  }, [])

  // Initial load + 60s auto-pull
  useEffect(() => {
    loadJobs()
    const iv = setInterval(loadJobs, 300_000)
    return () => clearInterval(iv)
  }, [loadJobs])

  // 30s display tick for "X ago" label
  useEffect(() => {
    const iv = setInterval(() => forceUpdate(n => n + 1), 30_000)
    return () => clearInterval(iv)
  }, [])

  // Offline/online detection + queue replay
  useEffect(() => {
    function handleOnline() {
      setOnline(true)
      replayQueue().then(replayed => {
        if (replayed > 0) loadJobs()
        setPendingCount(queueDepth())
      })
    }
    function handleOffline() {
      setOnline(false)
    }
    window.addEventListener('online', handleOnline)
    window.addEventListener('offline', handleOffline)
    return () => {
      window.removeEventListener('online', handleOnline)
      window.removeEventListener('offline', handleOffline)
    }
  }, [loadJobs])

  // Keep pending count in sync
  useEffect(() => {
    setPendingCount(queueDepth())
  }, [])

  function handleDragStart(e: DragStartEvent) {
    const job = jobs.find(j => j.job_id === e.active.id)
    setActiveJob(job ?? null)
  }

  async function handleDragEnd(e: DragEndEvent) {
    setActiveJob(null)
    setOverColumn(null)
    const { active, over } = e
    if (!over) return
    const jobId = active.id as string
    const targetStage = over.id as FieldStage
    const job = jobs.find(j => j.job_id === jobId)
    if (!job || job.stage === targetStage) return

    // Optimistic update
    setJobs(prev => prev.map(j => j.job_id === jobId ? { ...j, stage: targetStage } : j))

    try {
      const updated = await moveStage(jobId, targetStage, online)
      if (updated) {
        setJobs(prev => prev.map(j => j.job_id === jobId ? updated : j))
      }
      setPendingCount(queueDepth())
    } catch {
      // Revert on error
      setJobs(prev => prev.map(j => j.job_id === jobId ? job : j))
      setPendingCount(queueDepth())
    }
  }

  async function handleCreate(jobId: string, suString: string) {
    try {
      const newJob = await createJob(jobId, suString, online)
      if (newJob) {
        setJobs(prev => [...prev, newJob])
      } else {
        // Queued offline — add placeholder
        setJobs(prev => [
          ...prev,
          { job_id: jobId, su_string: suString, trench: '', stage: 'not_started', notes: '', last_updated: '' },
        ])
      }
      setPendingCount(queueDepth())
    } catch (err) {
      alert(`Could not create job: ${err}`)
    }
  }

  async function handlePush() {
    setPushState('pushing')
    try {
      await pushToSheets()
      setLastPushAt(Date.now())
      setPushState('ok')
    } catch {
      setPushState('error')
    }
    setTimeout(() => setPushState('idle'), 4000)
  }

  function handleNotesUpdated(jobId: string, notes: string) {
    setJobs(prev => prev.map(j => j.job_id === jobId ? { ...j, notes } : j))
  }

  const byStage = (stage: FieldStage) => jobs.filter(j => j.stage === stage)

  const pushLabel =
    pushState === 'pushing' ? 'Pushing…'
    : pushState === 'ok' ? 'Pushed!'
    : pushState === 'error' ? 'Push failed'
    : lastPushAt ? `Pushed ${timeAgo(lastPushAt)}`
    : 'Push'

  const dotColor =
    !online ? '#ef4444'
    : pushState === 'pushing' ? '#f59e0b'
    : '#22c55e'

  return (
    <div style={{ minHeight: '100vh', background: T.bg, color: T.text }}>
      {/* Header */}
      <div
        style={{
          background: T.surface,
          borderBottom: `1px solid ${T.border}`,
          padding: '0 20px',
          height: 56,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          position: 'sticky',
          top: 0,
          zIndex: 10,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ fontWeight: 700, fontSize: 16, color: T.text }}>TARP Field</span>
          {!online && pendingCount > 0 && (
            <span
              style={{
                fontSize: 11,
                background: '#fef3c7',
                color: '#92400e',
                border: '1px solid #fcd34d',
                borderRadius: 10,
                padding: '1px 8px',
              }}
            >
              {pendingCount} queued
            </span>
          )}
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <button
            onClick={() => setShowCreate(true)}
            style={{
              background: T.accent,
              color: '#fff',
              border: 'none',
              borderRadius: 6,
              padding: '6px 14px',
              fontWeight: 600,
              fontSize: 13,
              cursor: 'pointer',
            }}
          >
            + New Job
          </button>

          <button
            onClick={handlePush}
            disabled={pushState === 'pushing' || !online}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 6,
              background: T.colBg,
              border: `1px solid ${T.border}`,
              borderRadius: 20,
              padding: '4px 12px',
              fontSize: 12,
              fontWeight: 500,
              color: T.textSub,
              cursor: pushState === 'pushing' || !online ? 'default' : 'pointer',
              opacity: !online ? 0.5 : 1,
            }}
          >
            <span
              style={{
                width: 8,
                height: 8,
                borderRadius: '50%',
                background: dotColor,
                flexShrink: 0,
              }}
            />
            {pushLabel}
          </button>
        </div>
      </div>

      {/* Board */}
      <div style={{ padding: 20 }}>
        <DndContext
          sensors={sensors}
          onDragStart={handleDragStart}
          onDragOver={e => setOverColumn(e.over ? (e.over.id as FieldStage) : null)}
          onDragEnd={handleDragEnd}
          onDragCancel={() => { setActiveJob(null); setOverColumn(null) }}
        >
          <div style={{ display: 'flex', gap: 16, alignItems: 'flex-start' }}>
            {FIELD_STAGES.map(stage => (
              <KanbanColumn
                key={stage}
                stage={stage}
                label={STAGE_LABELS[stage]}
                jobs={byStage(stage)}
                isOver={overColumn === stage}
                online={online}
                onNotesUpdated={handleNotesUpdated}
              />
            ))}
          </div>

          <DragOverlay>
            {activeJob ? <OverlayCard job={activeJob} /> : null}
          </DragOverlay>
        </DndContext>
      </div>

      {showCreate && (
        <CreateJobModal onClose={() => setShowCreate(false)} onCreate={handleCreate} />
      )}
    </div>
  )
}
