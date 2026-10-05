import { describe, expect, it } from 'vitest'

import type { ApprovalLogItem } from '@/lib/api'

import {
  approvalItemPapers,
  defaultPaperKey,
  paperCountOf,
  paperKey,
  paperResetSignature,
  papersOf,
  paperUrl,
  type Paper,
} from './recordPapers'

const STAFF = { inmateReporter: false }
const INMATE = { inmateReporter: true }

const signedBook = {
  id: 1,
  ref_number: 'HR-1',
  approval_state: 'approved',
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
  approval_state: 'none',
  versions: [{ version_no: 1, document_id: 9, status: 'none' }],
  attachment_paths: [],
}

const pendingBookWithScan = {
  id: 3,
  ref_number: 'HR-3',
  approval_state: 'pending',
  versions: [{ version_no: 1, document_id: 11, status: 'pending' }],
  attachment_paths: ['book_attachments/3/scan.pdf'],
}

const importedBook = {
  id: 4,
  ref_number: 'HR-4',
  approval_state: 'approved',
  versions: [],
  attachment_paths: [],
  imported_doc: {
    pdf_url: '/api/v1/vault/9/file.pdf',
    download_url: '/api/v1/vault/9/file.docx',
    filename: 'file.docx',
  },
}

describe('papersOf', () => {
  it('orders signed → generated → scans for staff, with original=true only on the generated paper', () => {
    const papers = papersOf(signedBook as never, STAFF)
    expect(papers.map((p) => p.kind)).toEqual(['signed', 'generated', 'scan'])
    const original = papers[1]
    expect(original.url).toContain('original=true')
    expect(original.downloadUrl).toContain('original=true')
    expect(papers[0].url).not.toContain('original=true')
  })

  it('places imported before scans', () => {
    const book = {
      ...importedBook,
      attachment_paths: ['book_attachments/4/scan.pdf'],
    }
    expect(papersOf(book as never, STAFF).map((p) => p.kind)).toEqual(['imported', 'scan'])
  })

  it('tags scan papers with their attachment index', () => {
    const scan = papersOf(signedBook as never, STAFF).find((p) => p.kind === 'scan')!
    expect(scan.attachmentIndex).toBe(0)
  })

  it('still shows the original form for an unsigned draft (staff)', () => {
    const papers = papersOf(draftBook as never, STAFF)
    expect(papers.map((p) => p.kind)).toEqual(['generated'])
    expect(papers[0].url).toContain('original=true')
  })

  it('inmate reporter, approved with a signed copy and a scan: exactly [signed]', () => {
    const papers = papersOf(signedBook as never, INMATE)
    expect(papers.map((p) => p.kind)).toEqual(['signed'])
  })

  it('inmate reporter, unsigned with a scan: exactly [generated] and no original=true', () => {
    for (const book of [pendingBookWithScan, { ...draftBook, attachment_paths: ['a/scan.pdf'] }]) {
      const papers = papersOf(book as never, INMATE)
      expect(papers.map((p) => p.kind)).toEqual(['generated'])
      expect(papers[0].url).not.toContain('original=true')
      expect(papers[0].downloadUrl).not.toContain('original=true')
    }
  })

  describe('content tokens in URLs (a changed paper must get a new URL)', () => {
    const scanUrls = (paths: string[]): string[] =>
      papersOf({ ...signedBook, attachment_paths: paths } as never, STAFF)
        .filter((p) => p.kind === 'scan')
        .map((p) => p.url)

    it('scan URL changes when the file at an index is replaced', () => {
      const before = scanUrls(['book_attachments/1/aaa-scan.pdf', 'book_attachments/1/bbb-scan.pdf'])
      const after = scanUrls(['book_attachments/1/ccc-scan.pdf', 'book_attachments/1/bbb-scan.pdf'])
      expect(after[0]).not.toBe(before[0])
      expect(after[1]).toBe(before[1])
      expect(before[0]).toMatch(/^\/api\/v1\/books\/1\/attachments\/0\?v=[0-9a-f]+$/)
    })

    it('the survivor of a deleted earlier scan does not reuse the deleted scan URL', () => {
      const before = scanUrls(['book_attachments/1/aaa-scan.pdf', 'book_attachments/1/bbb-scan.pdf'])
      const after = scanUrls(['book_attachments/1/bbb-scan.pdf'])
      expect(after[0]).not.toBe(before[0])
    })

    it('the scan download URL carries the token too', () => {
      const scan = papersOf(signedBook as never, STAFF).find((p) => p.kind === 'scan')!
      expect(scan.downloadUrl).toMatch(/\?v=[0-9a-f]+$/)
    })

    it('signed and generated URLs change with included_papers_revision', () => {
      const at = (revision: number): Paper[] =>
        papersOf({ ...signedBook, included_papers_revision: revision } as never, STAFF)
      const [signed1, generated1] = at(1)
      const [signed2, generated2] = at(2)
      expect(signed2.url).not.toBe(signed1.url)
      expect(signed1.url).toBe('/api/v1/documents/5/download?format=pdf&rev=1')
      expect(generated2.url).not.toBe(generated1.url)
      expect(generated1.url).toContain('original=true')
      expect(generated1.downloadUrl).toBe(generated1.url)
    })

    it('appends the revision with ? when the signed URL has no query', () => {
      const book = {
        ...signedBook,
        included_papers_revision: 4,
        versions: [
          { version_no: 1, document_id: 5, status: 'approved', signed_pdf_url: '/api/v1/books/1/versions/7/signed-document' },
        ],
      }
      expect(papersOf(book as never, STAFF)[0].url).toBe(
        '/api/v1/books/1/versions/7/signed-document?rev=4',
      )
    })

    it('inmate reporters get the revision on their generated paper', () => {
      const a = papersOf({ ...pendingBookWithScan, included_papers_revision: 1 } as never, INMATE)[0]
      const b = papersOf({ ...pendingBookWithScan, included_papers_revision: 2 } as never, INMATE)[0]
      expect(a.url).not.toBe(b.url)
      expect(a.url).not.toContain('original=true')
    })
  })
})

describe('paperCountOf', () => {
  it('staff: counts signed, original, imported and scans', () => {
    expect(paperCountOf(signedBook as never, STAFF)).toBe(3)
    expect(paperCountOf(importedBook as never, STAFF)).toBe(1)
  })

  it('inmate reporter, signed: only the signed copy (no original, no scans)', () => {
    expect(paperCountOf(signedBook as never, INMATE)).toBe(1)
  })

  it('inmate reporter, unsigned: the generated paper only', () => {
    expect(paperCountOf(pendingBookWithScan as never, INMATE)).toBe(1)
  })

  it('always equals papersOf().length for the same role', () => {
    for (const book of [signedBook, draftBook, pendingBookWithScan, importedBook]) {
      for (const opts of [STAFF, INMATE]) {
        expect(paperCountOf(book as never, opts)).toBe(papersOf(book as never, opts).length)
      }
    }
  })
})

describe('paperKey / defaultPaperKey', () => {
  it('keys scans by attachment index', () => {
    const book = { ...signedBook, attachment_paths: ['a/1.pdf', 'a/2.png'] }
    expect(papersOf(book as never, STAFF).map(paperKey)).toEqual([
      'signed',
      'generated',
      'scan-0',
      'scan-1',
    ])
  })

  it('approved in-app signed → signed', () => {
    const book = { ...signedBook, attachment_paths: [] }
    const papers = papersOf(book as never, STAFF)
    expect(defaultPaperKey(book, papers)).toBe('signed')
  })

  it('approved scan-signed → signed', () => {
    const papers = papersOf(signedBook as never, STAFF)
    expect(defaultPaperKey(signedBook, papers)).toBe('signed')
  })

  it('imported-approved with no signed copy → imported', () => {
    const papers = papersOf(importedBook as never, STAFF)
    expect(defaultPaperKey(importedBook, papers)).toBe('imported')
  })

  it('pending → generated', () => {
    const papers = papersOf(pendingBookWithScan as never, STAFF)
    expect(defaultPaperKey(pendingBookWithScan, papers)).toBe('generated')
  })

  it('is null without papers', () => {
    expect(defaultPaperKey({ approval_state: 'none' }, [])).toBeNull()
  })
})

describe('paperResetSignature', () => {
  it('changes when a signed copy lands', () => {
    const before = { ...signedBook, approval_state: 'pending', versions: [{ version_no: 1, document_id: 5, status: 'pending' }], attachment_paths: [] }
    const after = { ...signedBook, attachment_paths: [] }
    const a = paperResetSignature(before, papersOf(before as never, STAFF))
    const b = paperResetSignature(after, papersOf(after as never, STAFF))
    expect(a).not.toBe(b)
    expect(b).toBe('1:approved:signed,generated')
  })
})

describe('paperUrl', () => {
  it('builds pinned, original and signed-marker URLs', () => {
    expect(paperUrl({ documentId: 7 })).toBe('/api/v1/documents/7/download?format=pdf')
    expect(paperUrl({ documentId: 7, versionId: 3, original: true })).toBe(
      '/api/v1/documents/7/download?format=pdf&version_id=3&original=true',
    )
    expect(paperUrl({ documentId: 7, signed: true })).toBe(
      '/api/v1/documents/7/download?format=pdf&rev=signed',
    )
  })

  it('folds the package revision into the same rev marker', () => {
    expect(paperUrl({ documentId: 7, revision: 3 })).toBe('/api/v1/documents/7/download?format=pdf&rev=3')
    expect(paperUrl({ documentId: 7, signed: true, revision: 3 })).toBe(
      '/api/v1/documents/7/download?format=pdf&rev=signed-3',
    )
  })
})

describe('approvalItemPapers', () => {
  const item = (over: Partial<ApprovalLogItem>): ApprovalLogItem =>
    ({
      book_id: 1,
      ref_number: 'HR-1',
      status: 'pending',
      priority: 'Normal',
      access_scope: 'full',
      document_id: 7,
      version_id: 4,
      ...over,
    }) as ApprovalLogItem

  it('pins version_id and sets original=true on the original of an approved item', () => {
    const papers = approvalItemPapers(item({ status: 'approved' }), STAFF)
    expect(papers.map((p) => p.kind)).toEqual(['signed', 'generated'])
    expect(papers[0].url).toBe('/api/v1/books/1/versions/4/signed-document')
    expect(papers[1].url).toBe('/api/v1/documents/7/download?format=pdf&version_id=4&original=true')
  })

  it('skips the original for inmate reporters', () => {
    const papers = approvalItemPapers(item({ status: 'approved' }), INMATE)
    expect(papers.map((p) => p.kind)).toEqual(['signed'])
  })

  it('non-approved items get the generated paper pinned to the version, without original', () => {
    const papers = approvalItemPapers(item({}), STAFF)
    expect(papers.map((p) => p.kind)).toEqual(['generated'])
    expect(papers[0].url).toBe('/api/v1/documents/7/download?format=pdf&version_id=4')
  })

  it('has no papers without a document', () => {
    expect(approvalItemPapers(item({ document_id: null }), STAFF)).toEqual([])
  })
})
