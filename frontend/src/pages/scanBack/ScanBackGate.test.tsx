import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import i18n from '@/lib/i18n'

import { ScanBackGate, dismissKeyFor } from './ScanBackGate'

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
