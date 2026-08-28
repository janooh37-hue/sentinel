import { describe, expect, it } from 'vitest'

import { NAV_ITEMS } from './navItems'
import { isNavEntryAllowed, SECTION_ENTRIES, SIGNAL_ENTRIES } from './navCustomization'

const expectedPrimaryCaps: Record<string, string | undefined> = {
  '/': undefined,
  '/employees': 'employees.view',
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
      'sig:approvals': {
        cap: 'books.approve',
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
})
