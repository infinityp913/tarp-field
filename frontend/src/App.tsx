import { useState, useEffect, useCallback, useRef } from 'react'
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
import {
  fetchJobs,
  moveStage,
  pushToSheets,
  replayQueue,
  queueDepth,
  fetchSheetUrl,
  fetchAuthStatus,
  triggerReauth,
} from './api/field'

const FIELD_ORDER: FieldStage[] = ['raw_images', 'aligned', 'moved_to_msi']

function isValidFieldMove(from: FieldStage, to: FieldStage): boolean {
  if (from === to) return false
  const fi = FIELD_ORDER.indexOf(from)
  const ti = FIELD_ORDER.indexOf(to)
  return ti < fi || ti === fi + 1
}

async function handleQuit() {
  if (!window.confirm('Shut down the TARP Field server and close the app?')) return
  await fetch('/api/shutdown', { method: 'POST' }).catch(() => {})
  window.close()
}

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
type ReauthState = 'idle' | 'waiting' | 'ok' | 'error'

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
  const [trenchFilter, setTrenchFilter] = useState('All Trenches')
  const [online, setOnline] = useState(navigator.onLine)
  const [pendingCount, setPendingCount] = useState(0)
  const [pushState, setPushState] = useState<PushState>('idle')
  const [lastPushAt, setLastPushAt] = useState<number | null>(null)
  const [sheetUrl, setSheetUrl] = useState<string | null>(null)
  const [unpushedJobIds, setUnpushedJobIds] = useState<Set<string>>(new Set())
  const [authError, setAuthError] = useState(false)
  const [hasCredentials, setHasCredentials] = useState(false)
  const [reauthState, setReauthState] = useState<ReauthState>('idle')
  const [, forceUpdate] = useState(0)
  const isPushingRef = useRef(false)

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

  useEffect(() => {
    fetchSheetUrl().then(url => { if (url) setSheetUrl(url) })
  }, [])

  const pollAuthStatus = useCallback(async () => {
    const s = await fetchAuthStatus()
    setAuthError(s.auth_error)
    setHasCredentials(s.has_credentials)
  }, [])

  useEffect(() => {
    pollAuthStatus()
    const t = setInterval(pollAuthStatus, 60_000)
    return () => clearInterval(t)
  }, [pollAuthStatus])

  const handleReauth = useCallback(async () => {
    setReauthState('waiting')
    try {
      await triggerReauth()
      setReauthState('ok')
      setAuthError(false)
      await pollAuthStatus()
    } catch {
      setReauthState('error')
    }
  }, [pollAuthStatus])

  function handleMarkUnpushed(jobId: string) {
    setUnpushedJobIds(prev => new Set([...prev, jobId]))
  }

  function handleSUUpdated(jobId: string, su_opened: string, su_closed: string) {
    setJobs(prev => prev.map(j => j.job_id === jobId ? { ...j, su_opened, su_closed } : j))
  }

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

    if (!isValidFieldMove(job.stage, targetStage)) {
      return  // red column was the visual cue during drag
    }

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

  const handlePush = useCallback(async () => {
    if (isPushingRef.current) return
    isPushingRef.current = true
    setPushState('pushing')
    try {
      await pushToSheets()
      setLastPushAt(Date.now())
      setPushState('ok')
      setUnpushedJobIds(new Set())
    } catch {
      setPushState('error')
    }
    setTimeout(() => {
      setPushState('idle')
      isPushingRef.current = false
    }, 4000)
  }, [])

  // Auto-push every 5 minutes
  useEffect(() => {
    const iv = setInterval(handlePush, 300_000)
    return () => clearInterval(iv)
  }, [handlePush])

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
    <div style={{ minHeight: "100vh", background: T.bg, color: T.text }}>
      {/* Header */}
      <div style={headerStyle}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <div>
            <div
              style={{
                fontWeight: 800,
                fontSize: 16,
                color: T.text,
                letterSpacing: "-0.01em",
              }}
            >
              TARP Field Dashboard (Alienware Laptop)
            </div>
            <div style={{ fontSize: 12, color: T.textMuted, marginTop: 1 }}>
              Season 2026
            </div>
          </div>
          {!online && pendingCount > 0 && (
            <span style={queueBadge}>{pendingCount} queued</span>
          )}
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          {sheetUrl && (
            <a href={sheetUrl} target="_blank" rel="noopener noreferrer" style={openSheetBtn}>
              ↗ Open Sheet
            </a>
          )}
          <button
            onClick={handlePush}
            disabled={pushState === "pushing" || !online}
            style={{
              padding: "7px 16px",
              borderRadius: 6,
              border: "none",
              background: pushBg,
              color: "#fff",
              fontWeight: 700,
              fontSize: 13,
              cursor: pushState === "pushing" || !online ? "default" : "pointer",
              opacity: !online ? 0.5 : 1,
              transition: "background 0.2s",
              whiteSpace: "nowrap",
            }}
          >
            {pushLabel}
            {unpushedJobIds.size > 0 && pushState === 'idle' && (
              <span style={{ marginLeft: 6, fontSize: 11, fontWeight: 700, opacity: 0.9 }}>
                ({unpushedJobIds.size} unpushed)
              </span>
            )}
          </button>
          <button onClick={handleQuit} style={quitBtn} title="Shut down server and close app">
            ✕ Quit
          </button>
        </div>
      </div>

      {/* Toolbar */}
      <div style={toolbarStyle}>
        <select
          value={trenchFilter}
          onChange={(e) => setTrenchFilter(e.target.value)}
          style={selectStyle}
        >
          <option>All Trenches</option>
          {trenches.map((t) => (
            <option key={t}>{t}</option>
          ))}
        </select>

        {trenchFilter !== "All Trenches" && (
          <span style={filterChip}>
            {trenchFilter}
            <button
              onClick={() => setTrenchFilter("All Trenches")}
              style={chipClear}
              title="Clear filter"
            >
              ✕
            </button>
          </span>
        )}

        <span style={{ fontSize: 13, color: T.textMuted }}>
          {filtered.length} job{filtered.length !== 1 ? "s" : ""}
          {trenchFilter !== "All Trenches" && ` of ${jobs.length}`}
        </span>

        <button onClick={loadJobs} style={refreshBtn}>
          ↻ Refresh
        </button>
      </div>

      {(authError || reauthState === 'error') && hasCredentials && (
        <div style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          padding: '10px 24px',
          background: '#fef2f2',
          borderBottom: '1px solid #fca5a5',
          gap: 12,
        }}>
          <span style={{ fontSize: 13, color: '#b91c1c', fontWeight: 600 }}>
            {reauthState === 'error'
              ? 'Re-authentication failed. Try again or restart the server.'
              : 'Google Sheets token is invalid or was revoked. Re-authenticate to restore sync.'}
          </span>
          <button
            onClick={handleReauth}
            disabled={reauthState === 'waiting'}
            style={{
              padding: '6px 14px', borderRadius: 6, border: 'none',
              background: reauthState === 'waiting' ? '#9ca3af' : '#dc2626',
              color: '#fff', fontWeight: 700, fontSize: 12,
              cursor: reauthState === 'waiting' ? 'default' : 'pointer',
              whiteSpace: 'nowrap', flexShrink: 0,
            }}
          >
            {reauthState === 'waiting' ? '⟳ Waiting for browser…' : '↻ Re-authenticate'}
          </button>
        </div>
      )}

      {/* Board */}
      <div style={{ padding: "0 24px 32px" }}>
        <DndContext
          sensors={sensors}
          onDragStart={handleDragStart}
          onDragOver={(e) =>
            setOverColumn(e.over ? (e.over.id as FieldStage) : null)
          }
          onDragEnd={handleDragEnd}
          onDragCancel={() => {
            setActiveJob(null);
            setOverColumn(null);
          }}
        >
          <div
            style={{
              display: "flex",
              gap: 12,
              overflowX: "auto",
              paddingBottom: 12,
            }}
          >
            {FIELD_STAGES.map((stage) => (
              <KanbanColumn
                key={stage}
                stage={stage}
                label={STAGE_LABELS[stage]}
                jobs={byStage(stage)}
                isOver={overColumn === stage}
                isValidTarget={activeJob ? isValidFieldMove(activeJob.stage, stage) : true}
                online={online}
                unpushedJobIds={unpushedJobIds}
                onNotesUpdated={handleNotesUpdated}
                onSUUpdated={handleSUUpdated}
                onMarkUnpushed={handleMarkUnpushed}
              />
            ))}
          </div>

          <DragOverlay>
            {activeJob ? <OverlayCard job={activeJob} /> : null}
          </DragOverlay>
        </DndContext>
      </div>

    </div>
  );
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

const openSheetBtn: React.CSSProperties = {
  padding: '6px 12px',
  borderRadius: 6,
  border: `1px solid ${T.border}`,
  background: T.surface,
  fontSize: 13,
  fontWeight: 600,
  color: T.textSub,
  textDecoration: 'none',
  whiteSpace: 'nowrap',
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

const quitBtn: React.CSSProperties = {
  padding: '6px 12px',
  borderRadius: 6,
  border: '1px solid #fca5a5',
  background: 'transparent',
  fontSize: 12,
  fontWeight: 600,
  color: '#dc2626',
  cursor: 'pointer',
}
