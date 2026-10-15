import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, useLocation } from 'react-router-dom'
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
function mount(url = '/ledger'): void {
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

  it('leaves an Email hand-off URL and its navigation state for the email shell', () => {
    state.caps = new Set(['ledger.view', 'books.view'])
    function StateProbe(): React.JSX.Element {
      return <pre data-testid="state">{JSON.stringify(useLocation().state)}</pre>
    }
    render(<MemoryRouter initialEntries={[{ pathname: '/ledger', search: '?tab=email', state: { composePrefill: { subject: 'x' } } }]}><LedgerPage /><Location /><StateProbe /></MemoryRouter>)
    expect(screen.getByText('email-shell')).toBeVisible()
    expect(screen.getByRole('status').textContent).toBe('?tab=email')
    expect(screen.getByTestId('state').textContent).toBe('{"composePrefill":{"subject":"x"}}')
  })

  it('keeps an email deep link while switching tabs', async () => {
    state.caps = new Set(['ledger.view', 'books.view'])
    mount('/ledger?mail=42')
    await userEvent.click(screen.getByRole('tab', { name: 'Books' }))
    expect(screen.queryByText('email-shell')).not.toBeInTheDocument()
    await userEvent.click(screen.getByRole('tab', { name: 'Email' }))
    expect(screen.getByText('email-shell')).toBeVisible()
    expect(screen.getByRole('status').textContent).toBe('?mail=42&tab=email')
  })

  it.each([
    ['hides', '7', false],
    ['keeps', 'abc', true],
  ])('%s the Ledger tabs for book=%s', (_, book, tabs) => {
    state.caps = new Set(['ledger.view', 'books.view'])
    mount(`/ledger?tab=books&book=${book}`)
    expect(screen.getByText('books-desk')).toBeVisible()
    expect(screen.queryAllByRole('tab').length > 0).toBe(tabs)
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
