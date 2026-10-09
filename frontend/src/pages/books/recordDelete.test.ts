import { describe, it, expect } from 'vitest'

import { deleteBlockReason, deleteReasonKey, type DeletableBook } from './recordDelete'

const allow = (cap: string): boolean => cap === 'books.delete'
const deny = (): boolean => false

function book(over: Partial<DeletableBook> = {}): DeletableBook {
  return {
    approval_state: 'none',
    access_scope: 'full',
    voided_at: null,
    edit_session: null,
    ...over,
  }
}

const ok = { has: allow, isInmateReporter: false }

describe('deleteBlockReason', () => {
  it.each([
    ['none', null],
    ['returned', null],
    ['rejected', null],
    ['pending', 'inFlight'],
    ['awaiting_scan', 'inFlight'],
    ['approved', 'inFlight'],
    ['unknown_future_state', 'inFlight'],
  ])('state %s with books.delete → %s', (state, expected) => {
    expect(deleteBlockReason(book({ approval_state: state }), ok)).toBe(expected)
  })

  it('a voided record is in-flight whatever its state', () => {
    expect(deleteBlockReason(book({ voided_at: '2026-01-01T00:00:00Z' }), ok)).toBe('inFlight')
    expect(
      deleteBlockReason(book({ approval_state: 'returned', voided_at: '2026-01-01T00:00:00Z' }), ok),
    ).toBe('inFlight')
  })

  it('an active Word edit session blocks; a finished/other session does not', () => {
    const session = (state: string) => ({
      user_id: 1,
      state,
      created_at: '2026-01-01T00:00:00Z',
    }) as DeletableBook['edit_session']
    expect(deleteBlockReason(book({ edit_session: session('active') }), ok)).toBe('wordSession')
    expect(deleteBlockReason(book({ edit_session: session('finished') }), ok)).toBeNull()
    expect(deleteBlockReason(book({ edit_session: session('discarded') }), ok)).toBeNull()
  })

  it('without books.delete → noCapability, whatever the state', () => {
    expect(deleteBlockReason(book(), { has: deny, isInmateReporter: false })).toBe('noCapability')
    expect(
      deleteBlockReason(book({ approval_state: 'approved' }), { has: deny, isInmateReporter: false }),
    ).toBe('noCapability')
  })

  it('assigned_revision access or an inmate reporter → restricted', () => {
    expect(deleteBlockReason(book({ access_scope: 'assigned_revision' }), ok)).toBe('restricted')
    expect(deleteBlockReason(book(), { has: allow, isInmateReporter: true })).toBe('restricted')
  })

  it('precedence: noCapability > restricted > inFlight > wordSession', () => {
    const worst = book({
      access_scope: 'assigned_revision',
      approval_state: 'approved',
      edit_session: { user_id: 1, state: 'active', created_at: '' } as DeletableBook['edit_session'],
    })
    expect(deleteBlockReason(worst, { has: deny, isInmateReporter: true })).toBe('noCapability')
    expect(deleteBlockReason(worst, { has: allow, isInmateReporter: true })).toBe('restricted')
    expect(deleteBlockReason({ ...worst, access_scope: 'full' }, ok)).toBe('inFlight')
    expect(deleteBlockReason({ ...worst, access_scope: 'full', approval_state: 'none' }, ok)).toBe(
      'wordSession',
    )
  })
})

describe('deleteReasonKey', () => {
  it('maps the visible-but-disabled reasons to i18n keys', () => {
    expect(deleteReasonKey('inFlight')).toBe('books.reason.inFlight')
    expect(deleteReasonKey('wordSession')).toBe('books.reason.wordSession')
  })
  it('has no key for the reasons that hide the control', () => {
    expect(deleteReasonKey('noCapability')).toBeNull()
    expect(deleteReasonKey('restricted')).toBeNull()
    expect(deleteReasonKey(null)).toBeNull()
  })
})
