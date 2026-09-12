import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen } from '@testing-library/react'
import { I18nextProvider } from 'react-i18next'
import { MemoryRouter, useLocation } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { api } from '@/lib/api'
import i18n from '@/lib/i18n'
import { NavBellPopover } from '@/components/shell/NavBellPopover'
import { ViolationMonthsWidget } from './ViolationMonthsWidget'

vi.mock('@/lib/api', async (original) => {
  const actual = await original<typeof import('@/lib/api')>()
  return { ...actual, api: { ...actual.api, getInmateRegisterTasks: vi.fn(), listAuthUsers: vi.fn().mockResolvedValue([]) } }
})
vi.mock('@/lib/useIdentity', () => ({ useIdentity: () => ({ isAdmin: false }) }))
vi.mock('@/lib/useCapabilities', () => ({ useCapabilities: () => ({ has: () => false }) }))
vi.mock('@/pages/leaves/useAwaitingReturnCount', () => ({ useAwaitingReturnCount: () => 0 }))
vi.mock('@/pages/ledger/outlook/useFlagCount', () => ({ useFlagCount: () => 0 }))
vi.mock('@/pages/scanBack/useScanBack', () => ({ useScanBack: () => ({ count: 0 }) }))
vi.mock('@/pages/scanInbox/useScanInboxCount', () => ({ useScanInboxCount: () => 0 }))

function Probe() { const location = useLocation(); return <output>{location.pathname}{location.search}{location.hash}</output> }
function renderBoth() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(<QueryClientProvider client={client}><I18nextProvider i18n={i18n}><MemoryRouter>
    <ViolationMonthsWidget /><NavBellPopover /><Probe />
  </MemoryRouter></I18nextProvider></QueryClientProvider>)
}

beforeEach(() => { vi.clearAllMocks(); void i18n.changeLanguage('en') })
describe('monthly workflow discovery', () => {
  it('gives a non-admin assignee the same exact-submission link in the widget and bell', async () => {
    vi.mocked(api.getInmateRegisterTasks).mockResolvedValue({ count: 1, items: [{ year: 2026, month: 8, kind: 'review', submission_id: 42, code: null, row_count: 6 }] })
    renderBoth()
    const link = await screen.findByRole('link', { name: /August 2026/ })
    const href = '/application?form=inmate_conduct_violations&mode=stats&stats_month=2026-08&stats_submission=42'
    expect(link).toHaveAttribute('href', href)
    fireEvent.click(await screen.findByRole('button', { name: 'Notifications, 1 unread' }))
    fireEvent.click(screen.getByRole('button', { name: /August 2026/ }))
    expect(screen.getByRole('status')).toHaveTextContent(href)
  })

  it('shows no monthly tasks or approval badge to an unrelated user', async () => {
    vi.mocked(api.getInmateRegisterTasks).mockResolvedValue({ count: 0, items: [] })
    renderBoth()
    expect(await screen.findByRole('button', { name: 'Notifications' })).toBeInTheDocument()
    expect(screen.queryByRole('link', { name: /2026/ })).not.toBeInTheDocument()
  })

  it('labels review and manager tasks separately without offering a close shortcut', async () => {
    vi.mocked(api.getInmateRegisterTasks).mockResolvedValue({ count: 2, items: [
      { year: 2026, month: 7, kind: 'review', submission_id: 31, code: null, row_count: 5 },
      { year: 2026, month: 8, kind: 'approve', submission_id: 42, code: null, row_count: 6 },
    ] })
    renderBoth()
    expect(await screen.findByRole('link', { name: (name) => name.includes('July 2026') && name.includes(i18n.t('inmateStats.workflow.tasks.review')) })).toBeInTheDocument()
    expect(await screen.findByRole('link', { name: (name) => name.includes('August 2026') && name.includes(i18n.t('inmateStats.workflow.tasks.approve')) })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /close/i })).not.toBeInTheDocument()
  })
})
