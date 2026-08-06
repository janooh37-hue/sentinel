import type { JobStatusResponse } from '@/lib/api'

export interface SavedGeneration {
  bookId: number
  docId: number
  ref: string
}

export function savedGenerationFromJob(job: JobStatusResponse): SavedGeneration | null {
  const primary = job.documents?.find((document) => document.role === 'primary')
  if (
    job.status !== 'done' ||
    job.book_id == null ||
    primary?.document_id == null ||
    !primary.ref_number ||
    primary.ref_number === 'DRAFT'
  ) return null
  return { bookId: job.book_id, docId: primary.document_id, ref: primary.ref_number }
}
