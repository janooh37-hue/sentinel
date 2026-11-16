import { describe, expect, it } from 'vitest'

import {
  canFileSignedCopy,
  canSendForApproval,
  footerActionFor,
  scopedReporterActionFor,
} from './book-detail-drawer-utils'

/**
 * canFileSignedCopy — admin "file the physically-signed scan back" gate. Both
 * routes (digital + paper) are offered, so a draft can also be closed straight
 * from a signed scan. Distinct from footerActionFor (which only lets the
 * *assigned* approver act): an admin handling requests for others must be able
 * to upload the signed copy regardless of who the approver is.
 */
describe('canFileSignedCopy', () => {
  const admin = { canEdit: true, canScan: true }

  it('opens on a draft — the paper route is a valid first move', () => {
    expect(canFileSignedCopy('none', admin)).toBe(true)
  })

  it('opens while a request is out for in-app signature (pending)', () => {
    expect(canFileSignedCopy('pending', admin)).toBe(true)
  })

  it('opens when the paper is at the printer (awaiting_scan)', () => {
    expect(canFileSignedCopy('awaiting_scan', admin)).toBe(true)
  })

  it('is closed once the record is approved', () => {
    expect(canFileSignedCopy('approved', admin)).toBe(false)
  })

  it('is closed for returned/rejected — revise is the move there', () => {
    expect(canFileSignedCopy('returned', admin)).toBe(false)
    expect(canFileSignedCopy('rejected', admin)).toBe(false)
  })

  it('requires both the edit and scan capabilities', () => {
    expect(canFileSignedCopy('pending', { canEdit: true, canScan: false })).toBe(false)
    expect(canFileSignedCopy('pending', { canEdit: false, canScan: true })).toBe(false)
  })
})

/**
 * footerActionFor — state-driven footer selection. The revise and submit
 * branches key off DIFFERENT capabilities: `books.edit` regenerates a
 * returned/rejected record; `books.submit` sends a draft for approval. A user
 * holding only one must never see the other's action (a submit affordance
 * under edit authority opens an empty SubmitForApprovalDialog).
 */
describe('footerActionFor', () => {
  const base = { canApprove: false, isAssignee: false }

  it('offers submit on a draft only with books.submit — even without edit rights', () => {
    expect(footerActionFor('none', { ...base, canRevise: false, canSubmitBook: true })).toBe('submit')
  })

  it('does NOT offer submit on a draft with books.edit alone (no books.submit)', () => {
    expect(footerActionFor('none', { ...base, canRevise: true, canSubmitBook: false })).toBe('none')
  })

  it('offers revise on returned/rejected only with books.edit — even without submit rights', () => {
    expect(footerActionFor('returned', { ...base, canRevise: true, canSubmitBook: false })).toBe('revise')
    expect(footerActionFor('rejected', { ...base, canRevise: true, canSubmitBook: true })).toBe('revise')
  })

  it('is read-only on returned/rejected without books.edit', () => {
    expect(footerActionFor('returned', { ...base, canRevise: false, canSubmitBook: true })).toBe('none')
  })

  it('lets the assigned approver decide a pending request', () => {
    expect(
      footerActionFor('pending', { ...base, canRevise: false, canSubmitBook: true, canApprove: true, isAssignee: true }),
    ).toBe('decide')
  })

  it('shows the reviewer footer to an advisory reviewer on a pending request', () => {
    expect(footerActionFor('pending', { ...base, canRevise: true, canSubmitBook: true, isReviewer: true })).toBe(
      'review',
    )
  })

  it('keeps a late review actionable after the signer has already approved/returned/rejected', () => {
    for (const state of ['approved', 'returned', 'rejected']) {
      expect(
        footerActionFor(state, { ...base, canRevise: false, canSubmitBook: false, isReviewer: true }),
      ).toBe('review')
    }
  })

  it('a late review outranks the revise action a full-access editor would otherwise see', () => {
    expect(
      footerActionFor('returned', { ...base, canRevise: true, canSubmitBook: false, isReviewer: true }),
    ).toBe('review')
  })

  it('never offers a footer action while awaiting the signed scan', () => {
    expect(footerActionFor('awaiting_scan', { ...base, canRevise: true, canSubmitBook: true })).toBe('none')
  })
})

/**
 * canSendForApproval — the "Send for approval" (digital route) gate. The backend
 * submit_for_approval rebuilds the chain for a draft OR a still-pending request
 * (re-routing it to a different manager), but rejects awaiting_scan ("file the
 * scan instead") and approved. So the button shows on `none` + `pending` only.
 */
describe('canSendForApproval', () => {
  const mgr = { canSubmitBook: true }

  it('opens on a draft (first submission)', () => {
    expect(canSendForApproval('none', mgr)).toBe(true)
  })

  it('opens on a pending request (re-route to another manager)', () => {
    expect(canSendForApproval('pending', mgr)).toBe(true)
  })

  it('is closed on awaiting_scan — the backend blocks re-submitting the paper route', () => {
    expect(canSendForApproval('awaiting_scan', mgr)).toBe(false)
  })

  it('is closed once approved', () => {
    expect(canSendForApproval('approved', mgr)).toBe(false)
  })

  it('requires the submit capability', () => {
    expect(canSendForApproval('none', { canSubmitBook: false })).toBe(false)
    expect(canSendForApproval('pending', { canSubmitBook: false })).toBe(false)
  })
})

describe('scopedReporterActionFor — fleet reporter ownership', () => {
  it.each([
    ['none', 7, 'edit-submit'],
    ['returned', 7, 'correct-resubmit'],
    ['none', 8, 'read-only'],
    ['returned', 8, 'read-only'],
    ['pending', 7, 'read-only'],
    ['approved', 7, 'read-only'],
    ['rejected', 7, 'read-only'],
  ] as const)('%s owned by user %i yields %s', (approval_state, original_creator_user_id, action) => {
    expect(scopedReporterActionFor({ approval_state, original_creator_user_id }, 7)).toBe(action)
  })

  it('never treats a missing identity as ownership', () => {
    expect(scopedReporterActionFor({ approval_state: 'none' }, undefined)).toBe('read-only')
  })

  it.each(['Vehicle Fines', 'Vehicle Accident Report', 'Vehicle Mileage Log'])('requires rebuilding a returned %s before submission', (service_id) => {
    expect(scopedReporterActionFor({ service_id, approval_state: 'returned', original_creator_user_id: 7 }, 7)).toBe('read-only')
    expect(scopedReporterActionFor({ service_id, approval_state: 'none', original_creator_user_id: 7 }, 7)).toBe('edit-submit')
  })
})
