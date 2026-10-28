import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, useLocation } from 'react-router-dom'
import { beforeEach, expect, it, vi } from 'vitest'

import { api, type DecisionNotice } from '@/lib/api'
import i18n from '@/lib/i18n'
import { NavBellPopover } from './NavBellPopover'

const auth = vi.hoisted(() => ({ role: 'staff' }))
vi.mock('@/lib/authContext', () => ({
  useAuth: () => ({ status: 'authed', user: { id: 7, role: auth.role } }),
}))
vi.mock('@/lib/api', () => ({
  api: {
    getDecisionNotices: vi.fn(),
    getLedgerUnreadRecent: vi.fn(),
    markBookSeen: vi.fn().mockResolvedValue(undefined),
    markDecisionsSeen: vi.fn().mockResolvedValue(undefined),
    markAllLedgerRead: vi.fn().mockResolvedValue(undefined),
  },
  apiErrorMessage: (error: unknown) => String(error),
}))
vi.mock('@/lib/useCapabilities', () => ({
  useCapabilities: () => ({ has: (cap: string) => cap === 'ledger.view' }),
}))
vi.mock('@/lib/useIdentity', () => ({ useIdentity: () => ({ isAdmin: false }) }))
vi.mock('@/lib/useApprovalSummary', () => ({ useApprovalSummary: () => ({ data: undefined }) }))
vi.mock('@/pages/leaves/useAwaitingReturnCount', () => ({ useAwaitingReturnCount: () => 0 }))
vi.mock('@/pages/ledger/outlook/useFlagCount', () => ({ useFlagCount: () => 0 }))
vi.mock('@/pages/scanBack/useScanBack', () => ({ useScanBack: () => ({ count: 0 }) }))
vi.mock('@/pages/scanInbox/useScanInboxCount', () => ({ useScanInboxCount: () => 0 }))
vi.mock('@/pages/books/useInboxCount', () => ({ useInboxCount: () => 0 }))
vi.mock('@/pages/application/statistics/useInmateRegister', () => ({ useInmateAwaitingClose: () => ({ data: { count: 0, months: [] } }) }))

function notice(overrides: Partial<DecisionNotice> = {}): DecisionNotice {
  return {
    book_id: 48,
    version_id: 5,
    ref_number: 'GS-0048',
    subject: 'Leave request',
    verdict: 'approved',
    is_report: false,
    decided_at: '2026-10-27T09:00:00Z',
    decider_name: 'Manager Khalid',
    decider_name_ar: 'خالد',
    note: null,
    ...overrides,
  }
}

function LocationProbe() {
  const location = useLocation()
  return <span data-testid="location">{location.pathname}{location.search}</span>
}

function renderBell(phone = false) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(
    <QueryClientProvider client={qc}>
      <MemoryRouter><NavBellPopover phone={phone} /><LocationProbe /></MemoryRouter>
    </QueryClientProvider>,
  )
  return qc
}

beforeEach(async () => {
  vi.clearAllMocks()
  auth.role = 'staff'
  await i18n.changeLanguage('en')
  vi.mocked(api.getLedgerUnreadRecent).mockResolvedValue({ items: [], total_unread: 0 })
  vi.mocked(api.getDecisionNotices).mockResolvedValue({ items: [notice()], total: 1 })
})

it.each([false, true])('shows verdict and reference, counts the decision and marks its pinned record seen on click (phone=%s)', async (phone) => {
  const qc = renderBell(phone)
  await userEvent.click(await screen.findByRole('button', { name: 'Notifications, 1 unread' }))
  const row = screen.getByRole('button', { name: /Approved · GS-0048/ })
  expect(row).toHaveTextContent('Leave request')
  expect(row).toHaveTextContent('By Manager Khalid')
  expect(screen.queryByText('No unread notifications')).not.toBeInTheDocument()
  const invalidation = vi.spyOn(qc, 'invalidateQueries')
  await userEvent.click(row)
  await waitFor(() => expect(api.markBookSeen).toHaveBeenCalledWith(48))
  expect(invalidation).toHaveBeenCalledWith({ queryKey: ['notifications', 'decisions'] })
  expect(screen.getByTestId('location')).toHaveTextContent('/books/48?version_id=5&tab=sent&status=all&sort=newest&page=1')
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
})

it.each(['returned', 'rejected'] as const)('shows a %s verdict and the manager note', async (verdict) => {
  vi.mocked(api.getDecisionNotices).mockResolvedValue({ items: [notice({ verdict, note: 'Correct the dates' })], total: 1 })
  renderBell()
  await userEvent.click(await screen.findByRole('button', { name: 'Notifications, 1 unread' }))
  expect(screen.getByRole('button', { name: new RegExp(`${verdict} · GS-0048`, 'i') })).toHaveTextContent('Correct the dates')
})

it('labels approved reports Reviewed and uses Arabic manager names with English fallback', async () => {
  await i18n.changeLanguage('ar')
  vi.mocked(api.getDecisionNotices).mockResolvedValue({ items: [notice({ is_report: true }), notice({ book_id: 49, ref_number: 'GS-0049', decider_name_ar: null })], total: 2 })
  renderBell()
  await userEvent.click(await screen.findByRole('button', { name: /الإشعارات، 2/ }))
  expect(screen.getByRole('button', { name: /تمت المراجعة · GS-0048/ })).toHaveTextContent('بواسطة خالد')
  expect(screen.getByRole('button', { name: /تمت الموافقة · GS-0049/ })).toHaveTextContent('Manager Khalid')
})

it('links remaining decisions to Sent without showing more than five rows', async () => {
  const items = Array.from({ length: 5 }, (_, index) => notice({ book_id: index + 1, ref_number: `GS-${index + 1}` }))
  vi.mocked(api.getDecisionNotices).mockResolvedValue({ items, total: 8 })
  renderBell()
  await userEvent.click(await screen.findByRole('button', { name: 'Notifications, 8 unread' }))
  expect(screen.getAllByRole('button', { name: /Approved · GS-/ })).toHaveLength(5)
  const more = screen.getByRole('link', { name: '+3 more decisions' })
  expect(more).toHaveAttribute('href', '/books/approvals?tab=sent')
  await userEvent.click(more)
  expect(screen.getByTestId('location')).toHaveTextContent('/books/approvals?tab=sent')
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
})

it('marks emails and decisions read and refreshes their unread queries', async () => {
  vi.mocked(api.getLedgerUnreadRecent).mockResolvedValue({ items: [], total_unread: 2 })
  renderBell()
  await userEvent.click(await screen.findByRole('button', { name: 'Notifications, 3 unread' }))
  vi.mocked(api.getLedgerUnreadRecent).mockResolvedValue({ items: [], total_unread: 0 })
  vi.mocked(api.getDecisionNotices).mockResolvedValue({ items: [], total: 0 })
  await userEvent.click(screen.getByRole('button', { name: 'Mark all read' }))
  await waitFor(() => {
    expect(api.markAllLedgerRead).toHaveBeenCalledOnce()
    expect(api.markDecisionsSeen).toHaveBeenCalledOnce()
    expect(screen.getByText('No unread notifications')).toBeVisible()
  })
  expect(screen.queryByRole('button', { name: 'Mark all read' })).not.toBeInTheDocument()
})

it('hides the entire panel and makes no decision request for inmate reporters', () => {
  auth.role = 'inmate_reporter'
  renderBell()
  expect(screen.queryByRole('button')).not.toBeInTheDocument()
  expect(api.getDecisionNotices).not.toHaveBeenCalled()
})
