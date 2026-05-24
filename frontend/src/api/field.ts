import type { FieldJob, FieldStage } from '../types'

// -------------------------------------------------------------------
// Offline queue — persisted to localStorage so it survives refreshes
// -------------------------------------------------------------------

const QUEUE_KEY = 'tarp_field_queue'

type QueuedAction =
  | { type: 'move'; jobId: string; targetStage: FieldStage }
  | { type: 'notes'; jobId: string; notes: string }
  | { type: 'create'; jobId: string; suString: string; trench: string }
  | { type: 'push' }

function loadQueue(): QueuedAction[] {
  try {
    return JSON.parse(localStorage.getItem(QUEUE_KEY) ?? '[]')
  } catch {
    return []
  }
}

function saveQueue(q: QueuedAction[]) {
  localStorage.setItem(QUEUE_KEY, JSON.stringify(q))
}

function enqueue(action: QueuedAction) {
  const q = loadQueue()
  q.push(action)
  saveQueue(q)
}

export function queueDepth(): number {
  return loadQueue().length
}

async function _fetch<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, init)
  if (!res.ok) {
    const text = await res.text().catch(() => res.statusText)
    throw new Error(text)
  }
  return res.json() as Promise<T>
}

// -------------------------------------------------------------------
// API calls (raw — no offline handling)
// -------------------------------------------------------------------

export async function fetchJobs(): Promise<FieldJob[]> {
  return _fetch('/api/field/jobs')
}

export type IgnoredFolder = {
  name: string
  stage: FieldStage
  parent: string  // empty for top-level; "Trench XXX" if nested
}

export async function fetchIgnoredFolders(): Promise<IgnoredFolder[]> {
  try {
    return await _fetch<IgnoredFolder[]>('/api/field/ignored-folders')
  } catch {
    return []
  }
}

async function _moveStage(jobId: string, targetStage: FieldStage): Promise<FieldJob> {
  return _fetch(`/api/field/jobs/${encodeURIComponent(jobId)}/stage`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ target_stage: targetStage }),
  })
}

async function _updateNotes(jobId: string, notes: string): Promise<FieldJob> {
  return _fetch(`/api/field/jobs/${encodeURIComponent(jobId)}/notes`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ notes }),
  })
}

async function _createJob(jobId: string, suString: string): Promise<FieldJob> {
  return _fetch('/api/field/jobs', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ job_id: jobId, su_string: suString }),
  })
}

async function _push(): Promise<{ pushed: number }> {
  return _fetch('/api/field/push', { method: 'POST' })
}

export async function updateSU(
  jobId: string,
  su_opened: string,
  su_closed: string,
): Promise<FieldJob> {
  return _fetch(`/api/field/jobs/${encodeURIComponent(jobId)}/su`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ su_opened, su_closed }),
  })
}

export async function fetchSheetUrl(): Promise<string | null> {
  try {
    const data = await _fetch<{ sheet_url: string | null }>('/api/field/sheet-url')
    return data.sheet_url
  } catch {
    return null
  }
}

export async function fetchAuthStatus(): Promise<{ auth_error: boolean; has_credentials: boolean }> {
  try {
    return await _fetch('/api/field/auth-status')
  } catch {
    return { auth_error: false, has_credentials: false }
  }
}

export async function triggerReauth(): Promise<void> {
  await _fetch('/api/field/auth', { method: 'POST' })
}

// -------------------------------------------------------------------
// Offline-aware wrappers — queue on failure, replay on reconnect
// -------------------------------------------------------------------

export async function moveStage(
  jobId: string,
  targetStage: FieldStage,
  online: boolean,
): Promise<FieldJob | null> {
  if (!online) {
    enqueue({ type: 'move', jobId, targetStage })
    return null
  }
  try {
    return await _moveStage(jobId, targetStage)
  } catch {
    enqueue({ type: 'move', jobId, targetStage })
    throw new Error('Queued (offline)')
  }
}

export async function updateNotes(
  jobId: string,
  notes: string,
  online: boolean,
): Promise<FieldJob | null> {
  if (!online) {
    enqueue({ type: 'notes', jobId, notes })
    return null
  }
  try {
    return await _updateNotes(jobId, notes)
  } catch {
    enqueue({ type: 'notes', jobId, notes })
    throw new Error('Queued (offline)')
  }
}

export async function createJob(
  jobId: string,
  suString: string,
  online: boolean,
): Promise<FieldJob | null> {
  if (!online) {
    enqueue({ type: 'create', jobId, suString, trench: '' })
    return null
  }
  try {
    return await _createJob(jobId, suString)
  } catch {
    enqueue({ type: 'create', jobId, suString, trench: '' })
    throw new Error('Queued (offline)')
  }
}

export async function pushToSheets(): Promise<{ pushed: number }> {
  return _push()
}

// -------------------------------------------------------------------
// Replay queue — call when coming back online
// -------------------------------------------------------------------

export async function replayQueue(): Promise<number> {
  const q = loadQueue()
  if (q.length === 0) return 0

  let replayed = 0
  const failed: QueuedAction[] = []

  for (const action of q) {
    try {
      if (action.type === 'move') {
        await _moveStage(action.jobId, action.targetStage)
      } else if (action.type === 'notes') {
        await _updateNotes(action.jobId, action.notes)
      } else if (action.type === 'create') {
        await _createJob(action.jobId, action.suString)
      } else if (action.type === 'push') {
        await _push()
      }
      replayed++
    } catch {
      failed.push(action)
    }
  }

  saveQueue(failed)
  return replayed
}
