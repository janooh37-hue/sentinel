import { describe, expect, it } from 'vitest'
import type { JobStatusResponse } from '@/lib/api'
import { savedGenerationFromJob } from './savedGeneration'

const completedJob: JobStatusResponse = {
  job_id: 'job-1',
  status: 'done',
  submission_id: 'submission-1',
  book_id: 42,
  documents: [{
    role: 'primary',
    document_id: 9,
    template_id: 'Salary Deduction Form',
    ref_number: '1/5/GSSG/141',
    docx_url: '/api/v1/documents/9/download?format=docx',
    pdf_url: '/api/v1/documents/9/download?format=pdf',
  }],
  error_code: null,
  error_message: null,
}

describe('savedGenerationFromJob', () => {
  it('extracts the completed primary document', () => {
    expect(savedGenerationFromJob(completedJob)).toEqual({
      bookId: 42,
      docId: 9,
      ref: '1/5/GSSG/141',
    })
  })

  it('rejects preview documents', () => {
    expect(savedGenerationFromJob({
      ...completedJob,
      documents: completedJob.documents?.map((document) => ({ ...document, ref_number: 'DRAFT' })),
    })).toBeNull()
  })

  it('rejects a job without a book', () => {
    expect(savedGenerationFromJob({ ...completedJob, book_id: null })).toBeNull()
  })

  it('rejects a job without a primary document', () => {
    expect(savedGenerationFromJob({
      ...completedJob,
      documents: completedJob.documents?.map((document) => ({ ...document, role: 'companion' })),
    })).toBeNull()
  })

  it('rejects a primary document without an id', () => {
    const malformedJob = {
      ...completedJob,
      documents: completedJob.documents?.map((document) => ({ ...document, document_id: undefined })),
    } as unknown as JobStatusResponse
    expect(savedGenerationFromJob(malformedJob)).toBeNull()
  })
})
