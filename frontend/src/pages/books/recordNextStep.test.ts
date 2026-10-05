import { describe, expect, it } from 'vitest'

import type { BookApprovalStepRead, BookRead } from '@/lib/api'

import {
  recordNextStep,
  relativeAgo,
  reviseBlockReason,
  reviseReasonKey,
  type NextStepContext,
} from './recordNextStep'

const NOW = Date.parse('2026-10-05T12:00:00Z')

const ADMIN_CAPS = [
  'books.edit',
  'books.submit',
  'books.approve',
  'books.delete',
  'books.override_state',
  'documents.scan',
  'documents.generate',
]

function ctxOf(over: Partial<NextStepContext> = {}, caps: string[] = ADMIN_CAPS): NextStepContext {
  return {
    has: (cap) => caps.includes(cap),
    canEdit: caps.includes('books.edit'),
    canGenerate: caps.includes('documents.generate'),
    canMutateCurrent: true,
    isInmateReporter: false,
    inmateAction: 'read-only',
    isAssignee: false,
    isReviewer: false,
    hasDocument: true,
    canManageIncludedPapers: true,
    now: NOW,
    locale: 'en',
    ...over,
  }
}

function stepOf(over: Partial<BookApprovalStepRead>): BookApprovalStepRead {
  return {
    id: 1,
    step_order: 1,
    stage_label: 'Manager',
    assignee_user_id: 7,
    state: 'pending',
    note: null,
    decided_at: null,
    kind: 'approver',
    assignee_name: 'Khalid',
    ...over,
  }
}

function bookOf(state: string, over: Record<string, unknown> = {}): BookRead {
  const { steps, signedPdfUrl, ...rest } = over as {
    steps?: BookApprovalStepRead[]
    signedPdfUrl?: string | null
  }
  return {
    id: 1,
    ref_number: 'HR-1',
    approval_state: state,
    access_scope: 'full',
    voided_at: null,
    edit_session: null,
    submitted_at: '2026-10-03T12:00:00',
    created_by_user_id: 7,
    versions: [
      {
        id: 10,
        version_no: 1,
        status: state,
        template_id: 'tpl',
        has_fields: true,
        document_id: 5,
        signed_pdf_url: signedPdfUrl ?? null,
        approval_steps: steps ?? [],
      },
    ],
    ...rest,
  } as unknown as BookRead
}

describe('recordNextStep rows', () => {
  it('draft: send is primary, continue is secondary, overflow lists the document tools', () => {
    const r = recordNextStep(bookOf('none'), ctxOf())
    expect(r.status.key).toBe('draft')
    expect(r.primary).toBe('sendForApproval')
    expect(r.secondary).toEqual(['continueEditing'])
    expect(r.overflow).toEqual(
      expect.arrayContaining(['print', 'email', 'addToPdf', 'deleteDraft']),
    )
    expect(r.decide).toBeUndefined()
  })

  it('draft without submit rights promotes continue editing', () => {
    const caps = ADMIN_CAPS.filter((c) => c !== 'books.submit')
    const r = recordNextStep(bookOf('none'), ctxOf({}, caps))
    expect(r.primary).toBe('continueEditing')
    expect(r.secondary).toEqual([])
  })

  it('draft that failed to render: noDoc, continue editing, delete draft only', () => {
    const r = recordNextStep(bookOf('none'), ctxOf({ hasDocument: false }))
    expect(r.status.key).toBe('noDoc')
    expect(r.primary).toBe('continueEditing')
    expect(r.secondary).toEqual([])
    expect(r.overflow).toEqual(['deleteDraft'])
  })

  it('draft + Word session: finish editing, discard, print; names the editor', () => {
    const book = bookOf('none', { edit_session: { state: 'active', user_id: 3, user_name: 'Mariam' } })
    const r = recordNextStep(book, ctxOf())
    expect(r.status).toEqual({ key: 'wordActive', vars: { name: 'Mariam' } })
    expect(r.primary).toBe('finishEditing')
    expect(r.secondary).toEqual(['discardDraft'])
    expect(r.overflow).toEqual(['print'])
  })

  it('pending, I sign: sign & approve is the decide primary', () => {
    const r = recordNextStep(bookOf('pending', { steps: [stepOf({})] }), ctxOf({ isAssignee: true }))
    expect(r.status.key).toBe('pendingMine')
    expect(r.primary).toBe('sign')
    expect(r.decide).toBe(true)
    expect(r.secondary).toEqual(['returnForChanges', 'reject'])
    expect(r.overflow).toEqual(['markUp', 'reroute', 'scanSigned', 'print'])
  })

  it('pending, not me: no primary, change approver is secondary, names the approver and the age', () => {
    const r = recordNextStep(bookOf('pending', { steps: [stepOf({ assignee_name: 'Ahmed' })] }), ctxOf())
    expect(r.status).toEqual({
      key: 'pendingOther',
      vars: { name: 'Ahmed', ago: '2 days ago' },
    })
    expect(r.primary).toBeUndefined()
    expect(r.secondary).toEqual(['reroute'])
    expect(r.overflow).toEqual(expect.arrayContaining(['print', 'email']))
  })

  it('pending, my review: approve as reviewed / request changes', () => {
    const book = bookOf('pending', {
      steps: [stepOf({}), stepOf({ id: 2, kind: 'reviewer', assignee_user_id: 9 })],
    })
    const r = recordNextStep(book, ctxOf({ isReviewer: true }))
    expect(r.status.key).toBe('reviewMine')
    expect(r.primary).toBe('approveReviewed')
    expect(r.secondary).toEqual(['requestChanges'])
    expect(r.overflow).toEqual(['print'])
  })

  it('a pending reviewer stays actionable after the signer decided', () => {
    const r = recordNextStep(bookOf('approved'), ctxOf({ isReviewer: true }))
    expect(r.status.key).toBe('reviewMine')
    expect(r.primary).toBe('approveReviewed')
  })

  it('awaiting scan: scan signed copy is the primary', () => {
    const r = recordNextStep(bookOf('awaiting_scan'), ctxOf())
    expect(r.status.key).toBe('awaitingScan')
    expect(r.primary).toBe('scanSigned')
    expect(r.secondary).toEqual([])
    expect(r.overflow).toEqual(['print', 'email'])
  })

  it('approved: download signed is the primary; the signer and date fill the status', () => {
    const book = bookOf('approved', {
      signedPdfUrl: '/signed.pdf',
      steps: [stepOf({ state: 'approved', decided_at: '2026-09-21T08:30:00', assignee_name: 'Khalid' })],
    })
    const r = recordNextStep(book, ctxOf())
    expect(r.status).toEqual({ key: 'approved', vars: { name: 'Khalid', date: '2026-09-21' } })
    expect(r.primary).toBe('downloadSigned')
    expect(r.secondary).toEqual([])
    expect(r.overflow).toEqual([
      'email',
      'print',
      'adjustSignature',
      'replaceSigned',
      'removeSigned',
      'changeState',
    ])
  })

  it('approved without the admin override capability omits Change state', () => {
    const caps = ADMIN_CAPS.filter((c) => c !== 'books.override_state')
    const r = recordNextStep(bookOf('approved', { signedPdfUrl: '/s.pdf' }), ctxOf({}, caps))
    expect(r.overflow).not.toContain('changeState')
  })

  it('Continue editing is never offered for a Word-authored book or an inmate\'s own report', () => {
    const word = recordNextStep(bookOf('none', { is_word_book: true }), ctxOf())
    expect(word.primary).toBe('sendForApproval')
    expect(word.secondary).toEqual([])
    const noSubmit = ADMIN_CAPS.filter((c) => c !== 'books.submit')
    expect(recordNextStep(bookOf('none', { is_word_book: true }), ctxOf({}, noSubmit)).primary).toBeUndefined()
    const report = recordNextStep(
      bookOf('none', { ref_number: 'REPORT-1' }),
      ctxOf({ isInmateReporter: true, inmateAction: 'edit-submit' }, []),
    )
    expect(report.primary).toBe('sendForApproval')
    expect(report.secondary).toEqual([])
  })

  it('Continue editing carries the revise reason when the draft has no form template', () => {
    const book = bookOf('none', {
      versions: [{ id: 10, version_no: 1, status: 'none', template_id: null, has_fields: false }],
    })
    const r = recordNextStep(book, ctxOf())
    expect(r.secondary).toEqual(['continueEditing'])
    expect(r.disabled).toEqual({ continueEditing: 'books.reason.reviseNoTemplate' })
  })

  it('returned: revise & resubmit with the returner and the quoted note', () => {
    const book = bookOf('returned', {
      steps: [stepOf({ state: 'returned', note: 'Fix the dates.', assignee_name: 'Khalid' })],
    })
    const r = recordNextStep(book, ctxOf())
    expect(r.status).toEqual({ key: 'returned', vars: { name: 'Khalid' } })
    expect(r.quote).toBe('Fix the dates.')
    expect(r.primary).toBe('revise')
    expect(r.secondary).toEqual([])
    expect(r.overflow).toEqual(['print', 'deleteRecord'])
    expect(r.disabled).toBeUndefined()
  })

  it('rejected: same shape, rejected status', () => {
    const book = bookOf('rejected', {
      steps: [stepOf({ state: 'rejected', note: 'Frozen until Q1.' })],
    })
    const r = recordNextStep(book, ctxOf())
    expect(r.status.key).toBe('rejected')
    expect(r.quote).toBe('Frozen until Q1.')
    expect(r.primary).toBe('revise')
  })

  it('returned: Revise stays visible but disabled with the reason', () => {
    const book = bookOf('returned', {
      versions: [{ id: 10, version_no: 1, status: 'returned', template_id: null, has_fields: false }],
    })
    const r = recordNextStep(book, ctxOf())
    expect(r.primary).toBe('revise')
    expect(r.disabled).toEqual({ revise: 'books.reason.reviseNoTemplate' })
  })

  it('returned + active Word session: Finish / Discard are reachable (no stuck row)', () => {
    const book = bookOf('returned', { edit_session: { state: 'active', user_id: 3, user_name: 'Mariam' } })
    const r = recordNextStep(book, ctxOf())
    expect(r.status).toEqual({ key: 'wordActive', vars: { name: 'Mariam' } })
    expect(r.primary).toBe('finishEditing')
    expect(r.secondary).toEqual(['discardDraft'])
  })

  it('approved + active Word session (Edit in Word re-open): Finish / Discard are reachable', () => {
    const book = bookOf('approved', {
      signedPdfUrl: '/s.pdf',
      edit_session: { state: 'active', user_id: 3, user_name: 'Mariam' },
    })
    const r = recordNextStep(book, ctxOf())
    expect(r.status.key).toBe('wordActive')
    expect(r.primary).toBe('finishEditing')
    expect(r.secondary).toEqual(['discardDraft'])
  })

  it('an active Word session the user cannot mutate keeps the row for its state', () => {
    const book = bookOf('returned', { edit_session: { state: 'active', user_id: 3, user_name: 'Mariam' } })
    const r = recordNextStep(book, ctxOf({ canMutateCurrent: false }))
    expect(r.status.key).toBe('returnedNoName')
    expect(r.primary).not.toBe('finishEditing')
  })

  it('status sentences never dangle: no signing date / no editor name use their own variants', () => {
    const approved = bookOf('approved', {
      steps: [stepOf({ state: 'approved', decided_at: null, assignee_name: 'Khalid' })],
    })
    expect(recordNextStep(approved, ctxOf()).status).toEqual({
      key: 'approvedNoDate',
      vars: { name: 'Khalid', date: '' },
    })
    const anonymous = bookOf('approved', {
      doc_manager_name: null,
      steps: [stepOf({ state: 'approved', decided_at: null, assignee_name: null })],
    })
    expect(recordNextStep(anonymous, ctxOf()).status.key).toBe('approvedNoNameNoDate')
    const word = bookOf('none', { edit_session: { state: 'active', user_id: 3, user_name: null } })
    expect(recordNextStep(word, ctxOf()).status.key).toBe('wordActiveNoName')
  })

  it('Delete is hidden without books.delete', () => {
    const caps = ADMIN_CAPS.filter((c) => c !== 'books.delete')
    expect(recordNextStep(bookOf('none'), ctxOf({}, caps)).overflow).not.toContain('deleteDraft')
  })

  it('email without a document is disabled with its reason', () => {
    const r = recordNextStep(bookOf('awaiting_scan'), ctxOf({ hasDocument: false }))
    expect(r.overflow).toContain('email')
    expect(r.disabled).toEqual({ email: 'books.reason.emailNoDoc' })
  })

  it('inmate reporter drafting their own report: send primary, no staff tools', () => {
    const book = bookOf('none', { ref_number: 'REPORT-1' })
    const r = recordNextStep(
      book,
      ctxOf({ isInmateReporter: true, inmateAction: 'edit-submit', canManageIncludedPapers: false }, []),
    )
    expect(r.primary).toBe('sendForApproval')
    expect(r.overflow).toEqual(['print'])
  })

  it('voided records are read-only', () => {
    const r = recordNextStep(bookOf('none', { voided_at: '2026-10-01T00:00:00' }), ctxOf())
    expect(r.status.key).toBe('voided')
    expect(r.primary).toBeUndefined()
    expect(r.overflow).toEqual(['print'])
  })
})

describe('recordNextStep invariants', () => {
  it('has at most one primary and never repeats it as secondary or overflow', () => {
    const states = ['none', 'pending', 'awaiting_scan', 'approved', 'returned', 'rejected']
    const variants: Array<Partial<NextStepContext>> = [
      {},
      { isAssignee: true },
      { isReviewer: true },
      { hasDocument: false },
      { canMutateCurrent: false },
      { isInmateReporter: true, inmateAction: 'correct-resubmit' },
    ]
    for (const state of states) {
      for (const variant of variants) {
        const r = recordNextStep(bookOf(state, { signedPdfUrl: '/s.pdf' }), ctxOf(variant))
        expect(typeof r.primary === 'string' || r.primary === undefined).toBe(true)
        if (r.primary) {
          expect(r.secondary).not.toContain(r.primary)
          expect(r.overflow).not.toContain(r.primary)
        }
        const all = [...r.secondary, ...r.overflow]
        expect(new Set(all).size).toBe(all.length)
      }
    }
  })
})

describe('reviseBlockReason', () => {
  const ok = ctxOf()
  const book = bookOf('returned')

  it('is null when nothing blocks', () => {
    expect(reviseBlockReason(book, ok)).toBeNull()
  })

  it('noTemplate without a template or fields', () => {
    const b = bookOf('returned', {
      versions: [{ id: 1, version_no: 1, status: 'returned', template_id: null, has_fields: false }],
    })
    expect(reviseBlockReason(b, ok)).toBe('noTemplate')
    const noFields = bookOf('returned', {
      versions: [{ id: 1, version_no: 1, status: 'returned', template_id: 't', has_fields: false }],
    })
    expect(reviseBlockReason(noFields, ok)).toBe('noTemplate')
  })

  it('noPermission without documents.generate', () => {
    expect(reviseBlockReason(book, ctxOf({ canGenerate: false }))).toBe('noPermission')
  })

  it('notCurrent when the live revision is not being viewed', () => {
    expect(reviseBlockReason(book, ctxOf({ canMutateCurrent: false }))).toBe('notCurrent')
  })

  it('reporterLocked for an inmate reporter until the record is returned to them', () => {
    expect(
      reviseBlockReason(book, ctxOf({ isInmateReporter: true, inmateAction: 'read-only' })),
    ).toBe('reporterLocked')
    expect(
      reviseBlockReason(book, ctxOf({ isInmateReporter: true, inmateAction: 'correct-resubmit' })),
    ).toBeNull()
  })

  it('reads the selected revision, not blindly the last one', () => {
    const b = bookOf('returned', {
      selected_version_id: 1,
      versions: [
        { id: 1, version_no: 1, status: 'returned', template_id: null, has_fields: false },
        { id: 2, version_no: 2, status: 'returned', template_id: 't', has_fields: true },
      ],
    })
    expect(reviseBlockReason(b, ok)).toBe('noTemplate')
  })

  it('maps to books.reason keys', () => {
    expect(reviseReasonKey('noTemplate')).toBe('books.reason.reviseNoTemplate')
    expect(reviseReasonKey('noPermission')).toBe('books.reason.reviseNoPermission')
    expect(reviseReasonKey('notCurrent')).toBe('books.reason.reviseNotCurrent')
    expect(reviseReasonKey('reporterLocked')).toBe('books.reason.reviseReporterLocked')
    expect(reviseReasonKey(null)).toBeNull()
  })
})

describe('relativeAgo', () => {
  it('formats days, hours and empty input', () => {
    expect(relativeAgo('2026-10-03T12:00:00', NOW, 'en')).toBe('2 days ago')
    expect(relativeAgo('2026-10-05T09:00:00Z', NOW, 'en')).toBe('3 hours ago')
    expect(relativeAgo(null, NOW, 'en')).toBe('')
  })
})
