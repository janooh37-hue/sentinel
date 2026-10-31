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
  '/holdings': 'store.view',
  '/ledger': undefined,
  '/leaves': 'leaves.view',
  '/services': 'documents.generate',
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

  it('keeps every destination off the /assets build-file prefix', () => {
    // The backend mounts Vite's hashed files at /assets and the service worker
    // caches /assets/* cache-first forever, so a page there would 404 on reload
    // and could be pinned stale by installed apps.
    for (const { to } of NAV_ITEMS) {
      expect(to === '/assets' || to.startsWith('/assets/')).toBe(false)
    }
  })

  it.each([
    { caps: [], allowed: false },
    { caps: ['ledger.view'], allowed: true },
    { caps: ['books.view'], allowed: true },
  ])('allows Ledger with either capability: $caps', ({ caps, allowed }) => {
    const entry = NAV_ITEMS.find((item) => item.to === '/ledger')!
    expect(isNavEntryAllowed(entry, (cap) => caps.includes(cap))).toBe(allowed)
    const dockEntry = SECTION_ENTRIES.find((item) => item.to === '/ledger')!
    expect(isNavEntryAllowed(dockEntry, (cap) => caps.includes(cap))).toBe(allowed)
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
