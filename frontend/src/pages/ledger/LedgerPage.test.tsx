import type { ReactNode } from 'react'
import { cleanup, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import i18n from 'i18next'
import { MemoryRouter, useLocation } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import ar from '@/locales/ar.json'

const state = vi.hoisted(() => ({ caps: new Set<string>(), role: 'employee' }))
vi.mock('@/lib/useCapabilities', () => ({
  useCapabilities: () => ({ has: (cap: string) => state.caps.has(cap), isLoading: false }),
}))
vi.mock('@/lib/authContext', () => ({ useAuth: () => ({ user: { role: state.role } }) }))
vi.mock('./outlook/LedgerOutlookShell', () => ({
  LedgerOutlookShell: ({ switcher }: { switcher?: ReactNode }) => (
    <div data-testid="email-shell">{switcher}<span>email-shell</span></div>
  ),
}))

vi.mock('./BooksRoutingDesk', () => ({
  BooksRoutingDesk: ({ switcher }: { switcher?: ReactNode }) => (
    <div data-testid="books-desk">{switcher}<span>books-desk</span></div>
  ),
}))
import { LedgerPage } from './LedgerPage'

function Location(): React.JSX.Element {
  return <output>{useLocation().search}</output>
}
function mount(url = '/ledger'): void {
  render(<MemoryRouter initialEntries={[url]}><LedgerPage /><Location /></MemoryRouter>)
}

beforeEach(async () => {
  state.caps = new Set()
  state.role = 'employee'
  await i18n.changeLanguage('en')
})
afterEach(async () => {
  cleanup()
  await i18n.changeLanguage('en')
})

describe('Ledger tabs by capability', () => {
  it('opens Books first with its switcher inside the desk', () => {
    state.caps = new Set(['ledger.view', 'books.view'])
    mount()
    expect(screen.getAllByRole('tab').map((tab) => tab.textContent)).toEqual(['Books', 'Email'])
    expect(screen.getAllByRole('tablist')).toHaveLength(1)
    expect(within(screen.getByTestId('books-desk')).getByRole('tablist')).toBeInTheDocument()
    expect(screen.getByRole('tab', { name: 'Books' })).toHaveAttribute('aria-selected', 'true')
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
    expect(screen.getAllByRole('tablist')).toHaveLength(1)
    expect(within(screen.getByTestId('email-shell')).getByRole('tablist')).toBeInTheDocument()
    expect(screen.getByRole('tab', { name: 'Email' })).toHaveAttribute('aria-selected', 'true')
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
    // The pressed tab unmounts with its desk; focus lands on the twin in the new desk.
    expect(screen.getByRole('tab', { name: 'Email' })).toHaveFocus()
    expect(screen.getByRole('status').textContent).toBe('?mail=42&tab=email')
  })

  it.each([
    ['hides', '7', false],
    ['keeps', 'abc', true],
    ['keeps', '0', true],
    ['keeps', '-1', true],
    ['keeps', '7.5', true],
  ])('%s the Ledger tabs for book=%s', (_, book, tabs) => {
    state.caps = new Set(['ledger.view', 'books.view'])
    mount(`/ledger?tab=books&book=${book}`)
    expect(screen.getByText('books-desk')).toBeVisible()
    expect(screen.queryAllByRole('tab').length > 0).toBe(tabs)
  })

  it.each([
    { caps: ['ledger.view'], url: '/ledger?tab=books&scope=incoming&book=7', shell: 'email-shell', search: '?tab=email' },
    { caps: ['books.view'], url: '/ledger?mail=42', shell: 'books-desk', search: '?tab=books' },
  ])('hides the switcher for a single granted desk for $caps and normalizes its URL', ({ caps, url, shell, search }) => {
    state.caps = new Set(caps)
    mount(url)
    expect(screen.getByTestId(shell)).toBeVisible()
    expect(screen.queryByRole('tablist')).not.toBeInTheDocument()
    expect(screen.getByRole('status').textContent).toBe(search)
  })

  it('never offers Books to inmate reporters', () => {
    state.caps = new Set(['ledger.view', 'books.view'])
    state.role = 'inmate_reporter'
    mount('/ledger?tab=books')
    expect(screen.queryByRole('tab', { name: 'Books' })).not.toBeInTheDocument()
    expect(screen.queryByRole('tablist')).not.toBeInTheDocument()
    expect(screen.getByText('email-shell')).toBeVisible()
  })

  it('keeps the switcher available on Email with a preserved book link', () => {
    state.caps.add('ledger.view')
    state.caps.add('books.view')
    mount('/ledger?tab=email&book=7')
    expect(within(screen.getByTestId('email-shell')).getByRole('tablist')).toBeInTheDocument()
  })

  it('renders and operates the Arabic switcher inside the active desk', async () => {
    i18n.addResourceBundle('ar', 'translation', ar, true, true)
    await i18n.changeLanguage('ar')
    state.caps.add('ledger.view')
    state.caps.add('books.view')
    mount()
    const booksLabel = i18n.t('ledger.tabs.books')
    const emailLabel = i18n.t('ledger.tabs.email')
    expect(screen.getAllByRole('tab').map((tab) => tab.textContent)).toEqual([booksLabel, emailLabel])
    await userEvent.click(screen.getByRole('tab', { name: emailLabel }))
    expect(within(screen.getByTestId('email-shell')).getByRole('tab', { name: emailLabel })).toHaveAttribute('aria-selected', 'true')
  })
})
