export type FieldStage = 'raw_images' | 'aligned' | 'moved_to_msi'

export interface FieldJob {
  job_id: string
  su_string: string
  trench: string
  stage: FieldStage
  notes: string
  su_opened: string
  su_closed: string
  last_updated: string
}

export const STAGE_LABELS: Record<FieldStage, string> = {
  raw_images: 'Raw Images',
  aligned: 'Aligned (Preliminary)',
  moved_to_msi: 'Moved to MSI',
}

export const FIELD_STAGES: FieldStage[] = ['raw_images', 'aligned', 'moved_to_msi']
