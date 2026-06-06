import { describe, it, expect } from 'vitest'
import { resolveDropStage } from '../App'
import type { FieldJob } from '../types'

const jobs: FieldJob[] = [
  { job_id: 'Pgram_Job_110', su_string: 'SU21014-21016', trench: 'Trench 21000', stage: 'aligned', notes: '', su_opened: '', su_closed: '', last_updated: '' },
  { job_id: 'Pgram_Job_158', su_string: 'SU24009-24010', trench: 'Trench 24000', stage: 'raw_images', notes: '', su_opened: '', su_closed: '', last_updated: '' },
  { job_id: 'Pgram_Job_100', su_string: 'SU21011-21013', trench: 'Trench 21000', stage: 'moved_to_msi', notes: '', su_opened: '', su_closed: '', last_updated: '' },
]

describe('resolveDropStage', () => {
  it('returns the stage key directly when over.id is a stage key', () => {
    expect(resolveDropStage('raw_images', jobs)).toBe('raw_images')
    expect(resolveDropStage('aligned', jobs)).toBe('aligned')
    expect(resolveDropStage('moved_to_msi', jobs)).toBe('moved_to_msi')
  })

  it('resolves the stage from the card when over.id is a job_id (drop-on-card scenario)', () => {
    // This is the core regression: dropping onto Pgram_Job_110 (in aligned) should
    // resolve to "aligned", not fail because "Pgram_Job_110" is not a stage key.
    expect(resolveDropStage('Pgram_Job_110', jobs)).toBe('aligned')
    expect(resolveDropStage('Pgram_Job_158', jobs)).toBe('raw_images')
    expect(resolveDropStage('Pgram_Job_100', jobs)).toBe('moved_to_msi')
  })

  it('returns null for an over.id that is neither a stage key nor a known job_id', () => {
    expect(resolveDropStage('Pgram_Job_999', jobs)).toBeNull()
    expect(resolveDropStage('', jobs)).toBeNull()
  })

  it('handles an empty jobs array — stage keys still resolve, job_ids return null', () => {
    expect(resolveDropStage('aligned', [])).toBe('aligned')
    expect(resolveDropStage('Pgram_Job_001', [])).toBeNull()
  })
})
