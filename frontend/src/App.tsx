import { useState, useEffect, useCallback } from 'react'
import {
  DndContext,
  DragEndEvent,
  DragOverlay,
  DragStartEvent,
  PointerSensor,
  useSensor,
  useSensors,
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
    <div style={{
      background: T.surface, border: `1px solid ${T.border}`,
      borderRadius: 8, padding: '10px 12px',
      boxShadow: '0 4px 16px rgba(0,0,0,0.15)', width: 280,
    }}>
      <div style={{ fontWeight: 600, fontSize: 14, color: T.text }}>{job.job_id}</div>
      {job.su_string && <div style={{ fontSize: 12, color: T.textSub, marginTop: 2 }}>{job.su_string}</div>}
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
  const [trenchFilter, setTrenchFilter] = useState('All Trenches')
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

  useEffect(() => {
    loadJobs()
    const iv = setInterval(loadJobs, 300_000)
    return () => clearInterval(iv)
  }, [loadJobs])

  useEffect(() => {
    const iv = setInterval(() => forceUpdate(n => n + 1), 30_000)
    return () => clearInterval(iv)
  }, [])

  useEffect(() => {
    function handleOnline() {
      setOnline(true)
      replayQueue().then(replayed => {
        if (replayed > 0) loadJobs()
        setPendingCount(queueDepth())
      })
    }
    function handleOffline() { setOnline(false) }
    window.addEventListener('online', handleOnline)
    window.addEventListener('offline', handleOffline)
    return () => {
      window.removeEventListener('online', handleOnline)
      window.removeEventListener('offline', handleOffline)
    }
  }, [loadJobs])

  useEffect(() => { setPendingCount(queueDepth()) }, [])

  // Derive trench list from loaded jobs
  const trenches = [...new Set(jobs.map(j => j.trench).filter(Boolean))].sort()

  const filtered = trenchFilter === 'All Trenches'
    ? jobs
    : jobs.filter(j => j.trench === trenchFilter)

  const byStage = (stage: FieldStage) => filtered.filter(j => j.stage === stage)

  function handleDragStart(e: DragStartEvent) {
    setActiveJob(jobs.find(j => j.job_id === e.active.id) ?? null)
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

    setJobs(prev => prev.map(j => j.job_id === jobId ? { ...j, stage: targetStage } : j))
    try {
      const updated = await moveStage(jobId, targetStage, online)
      if (updated) setJobs(prev => prev.map(j => j.job_id === jobId ? updated : j))
      setPendingCount(queueDepth())
    } catch {
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

  const pushLabel =
    pushState === 'pushing' ? 'Pushing…'
    : pushState === 'ok' ? '✓ Pushed!'
    : pushState === 'error' ? 'Push failed'
    : lastPushAt ? `↑ Push to Sheet · ${timeAgo(lastPushAt)}`
    : '↑ Push to Sheet'

  const pushBg =
    !online ? T.inputBorder
    : pushState === 'pushing' ? '#f59e0b'
    : pushState === 'ok' ? '#22c55e'
    : pushState === 'error' ? '#ef4444'
    : T.accent

  return (
    <div style={{ minHeight: '100vh', background: T.bg, color: T.text }}>
      {/* Header */}
      <div style={headerStyle}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <div>
            <div style={{ fontWeight: 800, fontSize: 16, color: T.text, letterSpacing: '-0.01em' }}>
              TARP Field
            </div>
            <div style={{ fontSize: 12, color: T.textMuted, marginTop: 1 }}>Season 2026</div>
          </div>
          {!online && pendingCount > 0 && (
            <span style={queueBadge}>{pendingCount} queued</span>
          )}
        </div>

        <button
          onClick={handlePush}
          disabled={pushState === 'pushing' || !online}
          style={{
            padding: '7px 16px',
            borderRadius: 6,
            border: 'none',
            background: pushBg,
            color: '#fff',
            fontWeight: 700,
            fontSize: 13,
            cursor: pushState === 'pushing' || !online ? 'default' : 'pointer',
            opacity: !online ? 0.5 : 1,
            transition: 'background 0.2s',
            whiteSpace: 'nowrap',
          }}
        >
          {pushLabel}
        </button>
      </div>

      {/* Toolbar */}
      <div style={toolbarStyle}>
        <select
          value={trenchFilter}
          onChange={e => setTrenchFilter(e.target.value)}
          style={selectStyle}
        >
          <option>All Trenches</option>
          {trenches.map(t => <option key={t}>{t}</option>)}
        </select>

        {trenchFilter !== 'All Trenches' && (
          <span style={filterChip}>
            {trenchFilter}
            <button onClick={() => setTrenchFilter('All Trenches')} style={chipClear} title="Clear filter">✕</button>
          </span>
        )}

        <span style={{ fontSize: 13, color: T.textMuted }}>
          {filtered.length} job{filtered.length !== 1 ? 's' : ''}
          {trenchFilter !== 'All Trenches' && ` of ${jobs.length}`}
        </span>

        <button onClick={loadJobs} style={refreshBtn}>↻ Refresh</button>
        <button onClick={() => setShowCreate(true)} style={addBtn}>+ New Job</button>
      </div>

      {/* Board */}
      <div style={{ padding: '0 24px 32px' }}>
        <DndContext
          sensors={sensors}
          onDragStart={handleDragStart}
          onDragOver={e => setOverColumn(e.over ? (e.over.id as FieldStage) : null)}
          onDragEnd={handleDragEnd}
          onDragCancel={() => { setActiveJob(null); setOverColumn(null) }}
        >
          <div style={{ display: 'flex', gap: 12, overflowX: 'auto', paddingBottom: 12 }}>
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

const headerStyle: React.CSSProperties = {
  background: T.surface,
  borderBottom: `1px solid ${T.border}`,
  padding: '14px 24px',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  position: 'sticky',
  top: 0,
  zIndex: 100,
}

const toolbarStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 12,
  padding: '12px 24px',
  flexWrap: 'wrap',
}

const queueBadge: React.CSSProperties = {
  fontSize: 11,
  background: '#fef3c7',
  color: '#92400e',
  border: '1px solid #fcd34d',
  borderRadius: 10,
  padding: '1px 8px',
}


const selectStyle: React.CSSProperties = {
  padding: '7px 12px', borderRadius: 6, border: `1px solid ${T.inputBorder}`,
  fontSize: 14, background: T.inputBg, color: T.text, cursor: 'pointer', outline: 'none',
}

const filterChip: React.CSSProperties = {
  display: 'inline-flex', alignItems: 'center', gap: 6,
  background: T.chipBg, color: T.chipText, borderRadius: 20,
  padding: '3px 10px 3px 12px', fontSize: 13, fontWeight: 600,
}

const chipClear: React.CSSProperties = {
  background: 'none', border: 'none', cursor: 'pointer',
  color: T.chipText, padding: 0, fontSize: 12, lineHeight: 1,
  display: 'flex', alignItems: 'center',
}

const refreshBtn: React.CSSProperties = {
  padding: '7px 14px', borderRadius: 6, border: `1px solid ${T.border}`,
  background: T.surface, cursor: 'pointer', fontSize: 14, color: T.textSub,
}

const addBtn: React.CSSProperties = {
  padding: '7px 14px', borderRadius: 6, border: 'none',
  background: T.accent, color: '#fff', fontWeight: 600, cursor: 'pointer', fontSize: 14,
}
