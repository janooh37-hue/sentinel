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

const renderDock = (path = '/books'): void => {
  render(<MemoryRouter initialEntries={[path]}><ScanBackDock /></MemoryRouter>)
}

describe('ScanBackDock', () => {
  beforeEach(async () => { localStorage.clear(); await i18n.changeLanguage('en') })

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
    state.count = 2
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
})
