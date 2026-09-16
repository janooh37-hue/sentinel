import { describe, expect, it } from 'vitest'

import { NAV_ITEMS } from './navItems'
import {
  isApprovalsSignalAvailable,
  isNavEntryAllowed,
  SECTION_ENTRIES,
  SIGNAL_ENTRIES,
} from './navCustomization'

const expectedPrimaryCaps: Record<string, string | undefined> = {
  '/': undefined,
  '/employees': 'employees.view',
  '/vehicles': 'vehicles.view',
  '/ledger': 'ledger.view',
  '/leaves': 'leaves.view',
  '/application': 'documents.generate',
  '/books': 'books.view',
  '/permits': 'permits.view',
}

describe('permission-aware navigation', () => {
  it('assigns every primary destination its route capability while Dashboard stays public', () => {
    expect(Object.fromEntries(NAV_ITEMS.map((item) => [item.to, item.cap]))).toEqual(
      expectedPrimaryCaps,
    )
    expect(NAV_ITEMS.map((item) => item.to)).toEqual(Object.keys(expectedPrimaryCaps))
  })

  it('gates settings and waiting signals with every destination capability', () => {
    const sections = Object.fromEntries(SECTION_ENTRIES.map((entry) => [entry.to, entry.cap]))
    expect(sections['/settings']).toBe('settings.view')

    const signals = Object.fromEntries(
      SIGNAL_ENTRIES.map((entry) => [
        entry.id,
        { cap: entry.cap, caps: entry.caps, to: entry.to },
      ]),
    )
    expect(signals).toMatchObject({
      // No static capability gate: assignment-aware, resolved at render time
      // via `isApprovalsSignalAvailable` from the caller's approvals
      // summary — never merely `books.approve` (a review-only user with no
      // signing capability still needs this entry for their own work).
      'sig:approvals': {
        cap: undefined,
        caps: undefined,
        to: '/books/approvals',
      },
      'sig:scanback': { caps: ['books.view', 'books.edit'], to: '/scan-back' },
      'sig:ledgerUnread': { cap: 'ledger.view' },
    })
  })

  it('allows an entry only when its single cap and every multi-cap are granted', () => {
    const entry = { cap: 'ledger.view', caps: ['books.view', 'books.approve'] }
    expect(
      isNavEntryAllowed(entry, (capability) =>
        ['ledger.view', 'books.view', 'books.approve'].includes(capability),
      ),
    ).toBe(true)
    expect(
      isNavEntryAllowed(entry, (capability) =>
        ['ledger.view', 'books.view'].includes(capability),
      ),
    ).toBe(false)
  })

  it('makes the approvals signal available for review-only work, not merely books.approve', () => {
    expect(
      isApprovalsSignalAvailable({ can_view_sent: false, available_received_kinds: ['reviewer'] }),
    ).toBe(true)
    expect(isApprovalsSignalAvailable({ can_view_sent: true, available_received_kinds: [] })).toBe(
      true,
    )
    expect(
      isApprovalsSignalAvailable({ can_view_sent: false, available_received_kinds: [] }),
    ).toBe(false)
    expect(isApprovalsSignalAvailable(undefined)).toBe(false)
  })
})
