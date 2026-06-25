import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { queueDepth } from '../api/field'

beforeEach(() => {
  localStorage.clear()
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('queueDepth', () => {
  it('returns 0 when queue is empty', () => {
    expect(queueDepth()).toBe(0)
  })

  it('returns correct count after enqueuing via moveStage offline path', async () => {
    // Drive the enqueue path by calling moveStage with online=false
    const { moveStage } = await import('../api/field')
    await moveStage('Pgram_Job_1', 'aligned', false)
    expect(queueDepth()).toBe(1)
    await moveStage('Pgram_Job_2', 'moved_to_msi', false)
    expect(queueDepth()).toBe(2)
  })
})

describe('offline queue persistence', () => {
  it('survives a localStorage round-trip', async () => {
    const { moveStage } = await import('../api/field')
    await moveStage('Pgram_Job_10', 'aligned', false)
    // Reload by parsing localStorage directly — simulates page reload
    const raw = localStorage.getItem('tarp_field_queue')
    const q = JSON.parse(raw ?? '[]')
    expect(q).toHaveLength(1)
    expect(q[0]).toMatchObject({ type: 'move', jobId: 'Pgram_Job_10', targetStage: 'aligned' })
  })
})

describe('replayQueue', () => {
  it('replays queued moves and clears queue on success', async () => {
    const { moveStage, replayQueue } = await import('../api/field')

    // Queue two moves offline
    await moveStage('Pgram_Job_1', 'aligned', false)
    await moveStage('Pgram_Job_2', 'moved_to_msi', false)
    expect(queueDepth()).toBe(2)

    // Mock fetch so replay succeeds
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ job_id: 'Pgram_Job_1', stage: 'aligned' }),
    } as Response)
    vi.stubGlobal('fetch', mockFetch)

    const count = await replayQueue()
    expect(count).toBe(2)
    expect(queueDepth()).toBe(0)
  })

  it('replays queued notes updates and clears queue on success', async () => {
    const { updateNotes, replayQueue } = await import('../api/field')
    await updateNotes('Pgram_Job_3', 'some notes', false)
    expect(queueDepth()).toBe(1)

    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ job_id: 'Pgram_Job_3', notes: 'some notes' }),
    } as Response))

    const count = await replayQueue()
    expect(count).toBe(1)
    expect(queueDepth()).toBe(0)
  })

  it('replays queued job creation and clears queue on success', async () => {
    const { createJob, replayQueue } = await import('../api/field')
    await createJob('Pgram_Job_4', 'SU17001', false)
    expect(queueDepth()).toBe(1)

    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ job_id: 'Pgram_Job_4', stage: 'raw_images' }),
    } as Response))

    const count = await replayQueue()
    expect(count).toBe(1)
    expect(queueDepth()).toBe(0)
  })

  it('keeps failed items in queue when server returns error', async () => {
    const { moveStage, replayQueue } = await import('../api/field')
    await moveStage('Pgram_Job_99', 'aligned', false)

    const mockFetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 500,
      statusText: 'Server Error',
      text: async () => 'Server Error',
    } as Response)
    vi.stubGlobal('fetch', mockFetch)

    const count = await replayQueue()
    expect(count).toBe(0)
    expect(queueDepth()).toBe(1) // still in queue
  })
})

describe('fetchIgnoredFolders', () => {
  it('returns parsed folder list on success', async () => {
    const { fetchIgnoredFolders } = await import('../api/field')
    const mockFolders = [
      { name: 'PreSU17001', stage: 'raw_images', parent: '' },
      { name: 'BadChild', stage: 'aligned', parent: 'Trench 17000' },
    ]
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: async () => mockFolders,
    } as Response))

    const result = await fetchIgnoredFolders()
    expect(result).toHaveLength(2)
    expect(result[0]).toMatchObject({ name: 'PreSU17001', stage: 'raw_images', parent: '' })
    expect(result[1]).toMatchObject({ name: 'BadChild', parent: 'Trench 17000' })
  })

  it('returns empty array when fetch fails (offline-safe)', async () => {
    const { fetchIgnoredFolders } = await import('../api/field')
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('Network error')))

    const result = await fetchIgnoredFolders()
    expect(result).toEqual([])
  })

  it('returns empty array when server returns an error status', async () => {
    const { fetchIgnoredFolders } = await import('../api/field')
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: false,
      status: 500,
      statusText: 'Internal Server Error',
      text: async () => 'Internal Server Error',
    } as Response))

    const result = await fetchIgnoredFolders()
    expect(result).toEqual([])
  })

  it('returns empty array when response body is not valid JSON', async () => {
    const { fetchIgnoredFolders } = await import('../api/field')
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: async () => { throw new SyntaxError('Unexpected token') },
    } as unknown as Response))

    const result = await fetchIgnoredFolders()
    expect(result).toEqual([])
  })
})

describe('syncWithSheets', () => {
  const mockJob = {
    job_id: 'Pgram_Job_696',
    su_string: '',
    trench: '',
    stage: 'raw_images',
    notes: 'pulled note',
    su_opened: 'SU17001',
    su_closed: 'SU17002',
    last_updated: '',
  }

  it('posts to /api/field/sync and returns job list', async () => {
    const { syncWithSheets } = await import('../api/field')
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => [mockJob],
    } as Response)
    vi.stubGlobal('fetch', mockFetch)

    const result = await syncWithSheets()
    expect(mockFetch).toHaveBeenCalledWith('/api/field/sync', { method: 'POST' })
    expect(result).toHaveLength(1)
    expect(result[0]).toMatchObject({ job_id: 'Pgram_Job_696', notes: 'pulled note' })
  })

  it('throws when server returns an error status', async () => {
    const { syncWithSheets } = await import('../api/field')
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: false,
      status: 503,
      statusText: 'Service Unavailable',
      text: async () => 'Google Sheets not configured',
    } as Response))

    await expect(syncWithSheets()).rejects.toThrow()
  })
})
