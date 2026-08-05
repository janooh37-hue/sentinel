import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import i18n from '@/lib/i18n'

import { ScanBackGate } from './ScanBackGate'
import { dismissKeyFor } from './useScanBack'

// Local calendar date, matching ScanBackGate's own `today()` (see that file's
// comment) — NOT `toISOString().slice(0, 10)`, which is the UTC date and, at
// this app's UTC+4 offset, is still "yesterday" between 00:00 and 04:00 local.
const localToday = (): string => new Date().toLocaleDateString('en-CA')

const state = {
  count: 4,
  books: [
    { id: 1, ref_number: 'GS-0410', subject: 'Ack', created_at: '2026-06-25 12:00:00' },
    { id: 2, ref_number: 'GS-0411', subject: 'Ack', created_at: '2026-06-25 12:00:00' },
    { id: 3, ref_number: 'NAT-0424', subject: 'Warning', created_at: '2026-06-29 12:00:00' },
    { id: 4, ref_number: 'NAT-0642', subject: 'Warning', created_at: '2026-07-28 12:00:00' },
  ],
}
vi.mock('./useScanBack', async (orig) => ({
  ...(await orig<Record<string, unknown>>()),
  useScanBack: () => ({ ...state, isLoading: false, enabled: true }),
  useFileSignedCopy: () => ({ file: vi.fn(), busy: false }),
}))
vi.mock('@/lib/authContext', () => ({ useAuth: () => ({ user: { id: 42 }, status: 'authed' }) }))

const renderGate = (): void => {
  render(<MemoryRouter><ScanBackGate /></MemoryRouter>)
}

describe('ScanBackGate', () => {
  beforeEach(async () => { localStorage.clear(); await i18n.changeLanguage('en') })

  it('shows the count and only the three oldest rows', () => {
    renderGate()
    expect(screen.getByText(/4 records are waiting/i)).toBeInTheDocument()
    expect(screen.getByText('GS-0410')).toBeInTheDocument()
    expect(screen.getByText('NAT-0424')).toBeInTheDocument()
    expect(screen.queryByText('NAT-0642')).not.toBeInTheDocument()
  })

  it('dismissal writes a per-user per-day key and hides it', async () => {
    renderGate()
    await userEvent.click(screen.getByRole('button', { name: /not now/i }))
    expect(localStorage.getItem(dismissKeyFor(42))).toBe(localToday())
    expect(screen.queryByText(/records are waiting/i)).not.toBeInTheDocument()
  })

  // `localToday()` above evaluates the SAME expression the implementation uses
  // (`toLocaleDateString('en-CA')`), at the same instant, in the same zone —
  // so it can never disagree with a correct implementation, and can't catch a
  // regression back to `toISOString().slice(0, 10)` either (the two only ever
  // differ inside the local midnight/UTC-midnight gap). This test pins the
  // clock to exactly that gap so the two formulas diverge, deriving which
  // side of UTC midnight to land on from the runner's OWN offset so it's
  // deterministic on any machine, not just this UTC+4 box.
  it('stores the LOCAL calendar date even when it differs from the UTC one', () => {
    const offsetMin = new Date().getTimezoneOffset() // >0 behind UTC, <0 ahead, 0 at UTC
    if (offsetMin === 0) {
      // Runner's zone IS UTC: local and UTC calendar dates can never differ,
      // so no instant exists that would discriminate the two formulas here.
      return
    }
    const now = new Date()
    const utcMidnightMs = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())
    // Behind-UTC zones (offset > 0) still read yesterday just after UTC
    // midnight; ahead-of-UTC zones (offset < 0) already read tomorrow just
    // before it — either way, one minute off UTC midnight straddles the gap.
    const pinnedMs = offsetMin > 0 ? utcMidnightMs + 60_000 : utcMidnightMs - 60_000
    const expectedLocal = new Date(pinnedMs).toLocaleDateString('en-CA')
    const expectedUtc = new Date(pinnedMs).toISOString().slice(0, 10)
    expect(expectedLocal).not.toBe(expectedUtc) // sanity: the pin actually straddles the boundary

    vi.useFakeTimers()
    vi.setSystemTime(pinnedMs)
    try {
      renderGate()
      fireEvent.click(screen.getByRole('button', { name: /not now/i }))
      expect(localStorage.getItem(dismissKeyFor(42))).toBe(expectedLocal)
    } finally {
      vi.useRealTimers()
    }
  })

  it('View all closes the gate without silencing tomorrow', async () => {
    renderGate()
    await userEvent.click(screen.getByRole('button', { name: /view all/i }))
    expect(screen.queryByText(/records are waiting/i)).not.toBeInTheDocument()
    expect(localStorage.getItem(dismissKeyFor(42))).toBeNull()
  })

  it('stays hidden when already dismissed today', () => {
    localStorage.setItem(dismissKeyFor(42), localToday())
    renderGate()
    expect(screen.queryByText(/records are waiting/i)).not.toBeInTheDocument()
  })

  it('returns the next day', () => {
    localStorage.setItem(dismissKeyFor(42), '2020-01-01')
    renderGate()
    expect(screen.getByText(/records are waiting/i)).toBeInTheDocument()
  })

  it("does not silence a different user's gate", () => {
    localStorage.setItem(dismissKeyFor(99), localToday())
    renderGate()
    expect(screen.getByText(/records are waiting/i)).toBeInTheDocument()
  })

  it('renders Arabic under lng=ar', async () => {
    await i18n.changeLanguage('ar')
    renderGate()
    expect(screen.getByText(/بانتظار نسختها الموقّعة/)).toBeInTheDocument()
  })
})
