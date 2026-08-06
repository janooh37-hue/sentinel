import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import i18n from '@/lib/i18n'

import { ScanBackDock } from './ScanBackDock'

const state = { count: 2, books: [
  { id: 1, ref_number: 'GS-0410', subject: 'Ack', created_at: '2026-06-25 12:00:00' },
  { id: 2, ref_number: 'NAT-0642', subject: 'Warning', created_at: '2026-07-28 12:00:00' },
] }
vi.mock('./useScanBack', async (orig) => ({
  ...(await orig<Record<string, unknown>>()),
  useScanBack: () => ({ ...state, isLoading: false, enabled: true }),
  useFileSignedCopy: () => ({ file: vi.fn(), busy: false }),
}))
vi.mock('@/lib/authContext', () => ({ useAuth: () => ({ user: { id: 42 }, status: 'authed' }) }))

const renderDock = (path = '/books'): void => {
  render(<MemoryRouter initialEntries={[path]}><ScanBackDock /></MemoryRouter>)
}

describe('ScanBackDock', () => {
  // Reset here, not at the end of the test body that mutates it: if an
  // assertion above a manual reset throws, `count: 0` would otherwise leak
  // into every later test in this file.
  beforeEach(async () => {
    localStorage.clear()
    state.count = 2
    await i18n.changeLanguage('en')
  })

  it('starts collapsed and expands on click', async () => {
    renderDock()
    expect(screen.queryByText('GS-0410')).not.toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: /to scan back/i }))
    expect(screen.getByText('GS-0410')).toBeInTheDocument()
  })

  it('remembers the expanded state', async () => {
    renderDock()
    await userEvent.click(screen.getByRole('button', { name: /to scan back/i }))
    expect(localStorage.getItem('scanback-dock-open')).toBe('1')
  })

  it('renders nothing at zero', () => {
    state.count = 0
    renderDock()
    expect(screen.queryByRole('button', { name: /to scan back/i })).not.toBeInTheDocument()
  })

  it('renders nothing on the scan-back page itself', () => {
    renderDock('/scan-back')
    expect(screen.queryByRole('button', { name: /to scan back/i })).not.toBeInTheDocument()
  })

  it('labels the pill in Arabic under lng=ar', async () => {
    await i18n.changeLanguage('ar')
    renderDock()
    expect(screen.getByRole('button', { name: /بانتظار المسح/ })).toBeInTheDocument()
  })

  // The dock floats over whatever is in that corner (the record pane's own
  // buttons included), so it has to be silenceable — for today, not forever.
  it('dismisses for the day and stays gone on the next mount', async () => {
    renderDock()
    await userEvent.click(screen.getByRole('button', { name: /dismiss until tomorrow/i }))
    expect(screen.queryByRole('button', { name: /to scan back/i })).not.toBeInTheDocument()
    expect(localStorage.getItem('scanback-dock-dismissed:42')).toBe(
      new Date().toLocaleDateString('en-CA'),
    )

    renderDock()
    expect(screen.queryByRole('button', { name: /to scan back/i })).not.toBeInTheDocument()
  })

  // Per-day, not forever: yesterday's dismissal must not silence today.
  it('comes back the next day', () => {
    localStorage.setItem('scanback-dock-dismissed:42', '2020-01-01')
    renderDock()
    expect(screen.getByRole('button', { name: /to scan back/i })).toBeInTheDocument()
  })
})
