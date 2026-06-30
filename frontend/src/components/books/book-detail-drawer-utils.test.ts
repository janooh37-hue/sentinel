import { describe, expect, it } from 'vitest'

import { canFileSignedCopy } from './book-detail-drawer-utils'

/**
 * canFileSignedCopy — admin "file the physically-signed scan back" gate for the
 * record page. Distinct from footerActionFor (which only lets the *assigned*
 * approver act): an admin handling requests for others must be able to upload
 * the signed copy regardless of who the approver is.
 */
describe('canFileSignedCopy', () => {
  const admin = { canManage: true, canScan: true }

  it('opens while a request is out for in-app signature (pending)', () => {
    expect(canFileSignedCopy('pending', admin)).toBe(true)
  })

  it('opens when the paper is at the printer (awaiting_scan)', () => {
    expect(canFileSignedCopy('awaiting_scan', admin)).toBe(true)
  })

  it('is closed once the record is approved', () => {
    expect(canFileSignedCopy('approved', admin)).toBe(false)
  })

  it('is closed for a draft — submit-for-approval is the move there', () => {
    expect(canFileSignedCopy('none', admin)).toBe(false)
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
