import { describe, expect, it } from 'vitest'

import { canFileSignedCopy, canSendForApproval } from './book-detail-drawer-utils'

/**
 * canFileSignedCopy — admin "file the physically-signed scan back" gate. Both
 * routes (digital + paper) are offered, so a draft can also be closed straight
 * from a signed scan. Distinct from footerActionFor (which only lets the
 * *assigned* approver act): an admin handling requests for others must be able
 * to upload the signed copy regardless of who the approver is.
 */
describe('canFileSignedCopy', () => {
  const admin = { canManage: true, canScan: true }

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

  it('requires both the manage and scan capabilities', () => {
    expect(canFileSignedCopy('pending', { canManage: true, canScan: false })).toBe(false)
    expect(canFileSignedCopy('pending', { canManage: false, canScan: true })).toBe(false)
  })
})

/**
 * canSendForApproval — the "Send for approval" (digital route) gate. The backend
 * submit_for_approval rebuilds the chain for a draft OR a still-pending request
 * (re-routing it to a different manager), but rejects awaiting_scan ("file the
 * scan instead") and approved. So the button shows on `none` + `pending` only.
 */
describe('canSendForApproval', () => {
  const mgr = { canManage: true }

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

  it('requires the manage capability', () => {
    expect(canSendForApproval('none', { canManage: false })).toBe(false)
    expect(canSendForApproval('pending', { canManage: false })).toBe(false)
  })
})
