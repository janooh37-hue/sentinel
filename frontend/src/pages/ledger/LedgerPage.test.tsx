import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, useLocation } from 'react-router-dom'
import type { InitialEntry } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const state = vi.hoisted(() => ({ caps: new Set<string>(), role: 'employee' }))
vi.mock('@/lib/useCapabilities', () => ({
  useCapabilities: () => ({ has: (cap: string) => state.caps.has(cap), isLoading: false }),
}))
vi.mock('@/lib/authContext', () => ({ useAuth: () => ({ user: { role: state.role } }) }))
vi.mock('./outlook/LedgerOutlookShell', () => ({ LedgerOutlookShell: () => <div>email-shell</div> }))

vi.mock('./BooksRoutingDesk', () => ({ BooksRoutingDesk: () => <div>books-desk</div> }))
import { LedgerPage } from './LedgerPage'

function Location(): React.JSX.Element {
  return <output>{useLocation().search}</output>
}
function mount(url: InitialEntry = '/ledger'): void {
  render(<MemoryRouter initialEntries={[url]}><LedgerPage /><Location /></MemoryRouter>)
}

beforeEach(() => { state.caps = new Set(); state.role = 'employee' })
afterEach(cleanup)

describe('Ledger tabs by capability', () => {
  it('opens Books first, listing it before Email', () => {
    state.caps = new Set(['ledger.view', 'books.view'])
    mount()
    expect(screen.getAllByRole('tab').map((tab) => tab.textContent)).toEqual(['Books', 'Email'])
    expect(screen.getByText('books-desk')).toBeVisible()
    expect(screen.getByRole('status').textContent).toBe('?tab=books')
  })

  it.each([
    ['a mail link', '/ledger?mail=42', '?mail=42&tab=email'],
    ['a compose action', '/ledger?action=compose', '?action=compose&tab=email'],
    ['the Email tab', '/ledger?tab=email', '?tab=email'],
  ])('opens Email for %s', (_, url, search) => {
    state.caps = new Set(['ledger.view', 'books.view'])
    mount(url)
    expect(screen.getByText('email-shell')).toBeVisible()
    expect(screen.getByRole('status').textContent).toBe(search)
  })

  it('opens Email for a compose hand-off carried in navigation state', () => {
    state.caps = new Set(['ledger.view', 'books.view'])
    mount({ pathname: '/ledger', state: { composePrefill: { subject: 'x' } } })
    expect(screen.getByText('email-shell')).toBeVisible()
  })

  it('keeps an email deep link while switching tabs and hides the tabs over an open book', async () => {
    state.caps = new Set(['ledger.view', 'books.view'])
    mount('/ledger?mail=42')
    await userEvent.click(screen.getByRole('tab', { name: 'Books' }))
    expect(screen.queryByText('email-shell')).not.toBeInTheDocument()
    await userEvent.click(screen.getByRole('tab', { name: 'Email' }))
    expect(screen.getByText('email-shell')).toBeVisible()
    expect(screen.getByRole('status').textContent).toBe('?mail=42&tab=email')
    cleanup()
    mount('/ledger?tab=books&book=7')
    expect(screen.getByText('books-desk')).toBeVisible()
    expect(screen.queryByRole('tab', { name: 'Books' })).not.toBeInTheDocument()
  })

  it.each([
    { caps: ['ledger.view'], url: '/ledger?tab=books&scope=incoming&book=7', visible: 'Email', hidden: 'Books', search: '?tab=email' },
    { caps: ['books.view'], url: '/ledger?mail=42', visible: 'Books', hidden: 'Email', search: '?tab=books' },
  ])('shows only the granted tab for $caps and normalizes its URL', ({ caps, url, visible, hidden, search }) => {
    state.caps = new Set(caps)
    mount(url)
    expect(screen.getByRole('tab', { name: visible })).toHaveAttribute('aria-selected', 'true')
    expect(screen.queryByRole('tab', { name: hidden })).not.toBeInTheDocument()
    expect(screen.getByRole('status').textContent).toBe(search)
  })

  it('never offers Books to inmate reporters', () => {
    state.caps = new Set(['ledger.view', 'books.view'])
    state.role = 'inmate_reporter'
    mount('/ledger?tab=books')
    expect(screen.queryByRole('tab', { name: 'Books' })).not.toBeInTheDocument()
    expect(screen.getByText('email-shell')).toBeVisible()
  })
})
