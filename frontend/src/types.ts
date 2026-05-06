export type FieldStage = 'not_started' | 'aligned' | 'move_to_msi'

export interface FieldJob {
  job_id: string
  su_string: string
  trench: string
  stage: FieldStage
  notes: string
  last_updated: string
}

export const STAGE_LABELS: Record<FieldStage, string> = {
  not_started: 'Not Started',
  aligned: 'Aligned',
  move_to_msi: 'Move to MSI',
}

export const FIELD_STAGES: FieldStage[] = ['not_started', 'aligned', 'move_to_msi']
