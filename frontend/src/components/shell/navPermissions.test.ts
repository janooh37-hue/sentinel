import { describe, expect, it } from 'vitest'

import { NAV_ITEMS } from './navItems'
import { SECTION_ENTRIES, SIGNAL_ENTRIES } from './navCustomization'

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

  it('gates settings and waiting signals with the destination capability', () => {
    const sections = Object.fromEntries(SECTION_ENTRIES.map((entry) => [entry.to, entry.cap]))
    expect(sections['/settings']).toBe('settings.view')

    const signals = Object.fromEntries(SIGNAL_ENTRIES.map((entry) => [entry.id, entry.cap]))
    expect(signals).toMatchObject({
      'sig:approvals': 'books.view',
      'sig:scanback': 'books.view',
      'sig:ledgerUnread': 'ledger.view',
    })
  })
})
