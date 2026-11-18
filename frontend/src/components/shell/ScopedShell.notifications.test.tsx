import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { api, type DecisionNotice } from '@/lib/api'
import i18n from '@/lib/i18n'
import { BottomTabBar } from './BottomTabBar'
import { MobileTopBar } from './MobileTopBar'
import { TopNav } from './TopNav'

const session = vi.hoisted(() => ({
  status: 'authed',
  user: { id: 7, role: 'operator', scoped_role: 'fleet_reporter' as 'fleet_reporter' | 'inmate_reporter' },
}))
vi.mock('@/lib/authContext', async () => {
  // Vitest hoists this factory before React's static import can initialize.
  const { createContext } = await import('react')
  return { AuthContext: createContext(session), useAuth: () => session }
})
vi.mock('@/lib/useCapabilities', () => ({
  useCapabilities: () => ({ isLoading: false, has: () => true }),
}))
vi.mock('@/lib/useIdentity', () => ({ useIdentity: () => ({ isAdmin: false }) }))
vi.mock('@/lib/api', () => ({
  api: {
    getDecisionNotices: vi.fn(), markDecisionsSeen: vi.fn().mockResolvedValue(undefined),
    getNotificationCounts: vi.fn(), getApprovalSummary: vi.fn(), getDashboardSummary: vi.fn(),
    getDashboardLayout: vi.fn(), getSettings: vi.fn(), updateSettings: vi.fn(),
    getLedgerUnreadRecent: vi.fn(), getInmateRegisterAwaitingClose: vi.fn(), getInboxSummary: vi.fn(),
    listAwaitingScanBooks: vi.fn(), getExpirySummary: vi.fn(), markBookSeen: vi.fn(),
  },
  apiErrorMessage: (error: unknown) => String(error),
}))
vi.mock('@/components/intake/IntakeLauncher', () => ({ IntakeLauncher: () => null }))
vi.mock('./EmailBasketTray', () => ({ EmailBasketTray: () => null }))
vi.mock('./GatewayIndicator', () => ({ GatewayIndicator: () => null }))
vi.mock('./AccountMenu', () => ({ AccountMenu: () => null }))

const DECISION: DecisionNotice = {
  book_id: 48, version_id: 5, ref_number: 'GS-0048', subject: 'Fleet paper',
  verdict: 'returned', is_report: false, decided_at: '2026-10-27T09:00:00Z',
  decider_name: 'Line manager', decider_name_ar: 'المدير المباشر', note: 'Correct the dates',
}

beforeEach(() => {
  vi.clearAllMocks()
  session.user.scoped_role = 'fleet_reporter'
  vi.mocked(api.getDecisionNotices).mockResolvedValue({ items: [DECISION], total: 1 })
})
afterEach(async () => {
  cleanup()
  await i18n.changeLanguage('en')
})

function mount(phone: boolean) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        {phone ? <><MobileTopBar onBurger={vi.fn()} onLock={vi.fn()} /><BottomTabBar /></> : <TopNav onLock={vi.fn()} onOpenSettings={vi.fn()} />}
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

function expectNoClosedQueries() {
  for (const method of [
    api.getNotificationCounts, api.getApprovalSummary, api.getDashboardSummary,
    api.getDashboardLayout, api.getSettings, api.getLedgerUnreadRecent,
    api.getInmateRegisterAwaitingClose, api.getInboxSummary, api.listAwaitingScanBooks,
    api.getExpirySummary,
  ]) expect(method).not.toHaveBeenCalled()
}

describe.each(['en', 'ar'])('scoped shell notifications (%s)', (language) => {
  it.each([false, true])('renders fleet decisions without closed shell queries (phone=%s)', async (phone) => {
    await i18n.changeLanguage(language)
    mount(phone)
    const bell = await screen.findByRole('button', { name: language === 'ar' ? /الإشعارات، 1/ : 'Notifications, 1 unread' })
    expect(bell).toBeVisible()
    await userEvent.click(bell)
    expect(screen.getByRole('button', { name: /GS-0048/ })).toHaveTextContent('Fleet paper')
    expect(api.getDecisionNotices).toHaveBeenCalledOnce()
    expectNoClosedQueries()
  })

  it.each([false, true])('preserves the absent inmate bell and decision query (phone=%s)', async (phone) => {
    await i18n.changeLanguage(language)
    session.user.scoped_role = 'inmate_reporter'
    mount(phone)
    expect(screen.queryByRole('button', { name: /Notifications|الإشعارات/ })).not.toBeInTheDocument()
    expect(api.getDecisionNotices).not.toHaveBeenCalled()
    expectNoClosedQueries()
  })
})
