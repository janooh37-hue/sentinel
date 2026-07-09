import { describe, expect, it } from 'vitest'

import { papersOf } from './recordPapers'

const signedBook = {
  id: 1,
  ref_number: 'HR-1',
  versions: [
    {
      version_no: 1,
      document_id: 5,
      status: 'approved',
      signed_pdf_url: '/api/v1/documents/5/download?format=pdf',
    },
  ],
  attachment_paths: ['book_attachments/1/scan.pdf'],
}

const draftBook = {
  id: 2,
  ref_number: 'HR-2',
  versions: [{ version_no: 1, document_id: 9, status: 'none' }],
  attachment_paths: [],
}

describe('papersOf', () => {
  it('emits a distinct original-form paper and a signed-copy paper', () => {
    const papers = papersOf(signedBook as never)
    const kinds = papers.map((p) => p.kind)
    expect(kinds).toContain('generated')
    expect(kinds).toContain('signed')
    const original = papers.find((p) => p.kind === 'generated')!
    expect(original.url).toContain('original=true')
    expect(original.downloadUrl).toContain('original=true')
    const signed = papers.find((p) => p.kind === 'signed')!
    expect(signed.url).not.toContain('original=true')
  })

  it('tags scan papers with their attachment index', () => {
    const scan = papersOf(signedBook as never).find((p) => p.kind === 'scan')!
    expect(scan.attachmentIndex).toBe(0)
  })

  it('still shows the original form for an unsigned draft', () => {
    const papers = papersOf(draftBook as never)
    expect(papers.map((p) => p.kind)).toEqual(['generated'])
    expect(papers[0].url).toContain('original=true')
  })

})
