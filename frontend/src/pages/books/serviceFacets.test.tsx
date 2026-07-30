/**
 * Rail + spine derivation from the /books/facets payload.
 *
 * These are the numbers that used to be computed over a 500-row page window and
 * therefore disagreed with the page's own total.
 */
import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

import { railItemsFrom, spineCountsFrom } from './serviceLabels'
import { FormRail } from './FormRail'
import type { BookFacetsResponse } from '@/lib/api'

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (k: string) => k, i18n: { language: 'en' } }),
}))

const FACETS: BookFacetsResponse = {
  total: 629,
  states: { none: 100, pending: 20, approved: 509 },
  services: [
    { id: 'Leave Application Form', count: 275, states: { approved: 275 } },
    { id: 'Report', count: 6, states: { none: 6 } },
    { id: 'other', count: 1, states: { none: 1 } },
  ],
}

const label = (id: string): string => `L:${id}`

describe('railItemsFrom', () => {
  it('puts All first with the true total and Other last', () => {
    const items = railItemsFrom(FACETS, 'All forms', label)
    expect(items).toHaveLength(4)
    expect(items[0]).toMatchObject({ serviceId: 'all', label: 'All forms', count: 629 })
    expect(items[items.length - 1].serviceId).toBe('other')
  })

  it('preserves the payload order and omits empty services', () => {
    const items = railItemsFrom(FACETS, 'All forms', label).map((i) => i.serviceId)
    expect(items).toEqual(['all', 'Leave Application Form', 'Report', 'other'])
    expect(items).not.toContain('Warning Form')
  })

  it('labels and glyphs each service', () => {
    const items = railItemsFrom(FACETS, 'All forms', label)
    const report = items.find((i) => i.serviceId === 'Report')
    expect(report).toMatchObject({ label: 'L:Report', glyph: '📊', count: 6 })
    expect(items.find((i) => i.serviceId === 'other')?.glyph).toBe('📄')
  })

  it('mini-dots list the non-draft states present, excluding none and zeros', () => {
    const items = railItemsFrom(
      { ...FACETS, services: [{ id: 'Report', count: 3, states: { none: 1, pending: 2, approved: 0 } }] },
      'All forms',
      label,
    )
    expect(items[1].states).toEqual(['pending'])
  })

  it('renders nothing before the payload arrives', () => {
    expect(railItemsFrom(undefined, 'All forms', label)).toEqual([])
  })
})

describe('spineCountsFrom', () => {
  it('is global when All is selected', () => {
    expect(spineCountsFrom(FACETS, 'all')).toEqual({
      all: 629, none: 100, pending: 20, awaiting_scan: 0,
      returned: 0, approved: 509, rejected: 0,
    })
  })

  it('scopes to the selected service', () => {
    expect(spineCountsFrom(FACETS, 'Leave Application Form')).toEqual({
      all: 275, none: 0, pending: 0, awaiting_scan: 0,
      returned: 0, approved: 275, rejected: 0,
    })
  })

  it('is all zeros for an unknown service or a missing payload', () => {
    const zeros = {
      all: 0, none: 0, pending: 0, awaiting_scan: 0,
      returned: 0, approved: 0, rejected: 0,
    }
    expect(spineCountsFrom(FACETS, 'Ghost Form')).toEqual(zeros)
    expect(spineCountsFrom(undefined, 'all')).toEqual(zeros)
  })
})

describe('FormRail', () => {
  it('shows the resolved label, not a locale key, and reports the service id', async () => {
    const onChange = vi.fn()
    render(
      <FormRail
        items={railItemsFrom(FACETS, 'All forms', label)}
        active="all"
        onChange={onChange}
      />,
    )
    expect(screen.getByText('L:Report')).toBeTruthy()
    await userEvent.click(screen.getByText('L:Report'))
    expect(onChange).toHaveBeenCalledWith('Report')
  })
})

describe('facets query failure', () => {
  // `railItemsFrom`/`spineCountsFrom` receive `facets: undefined` for BOTH
  // "still loading" and "the request failed" — the derivations themselves
  // cannot tell those apart, and must not pretend to. It is BooksPage's job
  // (via facetsQuery.isError) to swap in a retry affordance instead of
  // rendering these derivations at all; that render-level gate has no test
  // harness in this repo (no BooksPage render test — see the file banner),
  // so what's pinned here is the contract the gate depends on: an absent
  // payload must never resolve to a fabricated "All: 0" that a user could
  // mistake for "there are zero records".
  it('produces no rail items at all for a missing payload — never a lone "All: 0"', () => {
    expect(railItemsFrom(undefined, 'All forms', label)).toEqual([])
  })

  it('produces all-zero counts for a missing payload, not a real reading', () => {
    expect(spineCountsFrom(undefined, 'all')).toEqual({
      all: 0, none: 0, pending: 0, awaiting_scan: 0,
      returned: 0, approved: 0, rejected: 0,
    })
  })

  it('FormRail renders no buttons (not a fake "All" entry) when handed no items', () => {
    render(<FormRail items={[]} active="all" onChange={vi.fn()} />)
    expect(screen.queryAllByRole('button')).toHaveLength(0)
  })
})
