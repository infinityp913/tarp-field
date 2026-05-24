import { describe, it, expect, beforeEach, vi } from 'vitest'
import { queueDepth } from '../api/field'

beforeEach(() => {
  localStorage.clear()
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

    vi.unstubAllGlobals()
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

    vi.unstubAllGlobals()
  })
})
