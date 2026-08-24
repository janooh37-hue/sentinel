/**
 * Dashboard approval-widget deep-links (#31): both widgets must land on the
 * approvals log with the received tab preselected.
 *
 * - BooksAwaitingWidget carries the "View full log" footer link — asserted by
 *   actually navigating in a MemoryRouter and reading the resulting location.
 * - WaitingApprovalsCard receives its target via `onReview` (wired in
 *   DashboardPage); here we pin the card's click contract and the shared
 *   deep-link constant both call sites use.
 */
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { I18nextProvider } from 'react-i18next'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import i18n from '@/lib/i18n'
import { APPROVALS_RECEIVED_DEEPLINK } from '@/lib/approvals'
import type { BookRead } from '@/lib/api'
import { BooksAwaitingWidget } from './BooksAwaitingWidget'
import { WaitingApprovalsCard } from './WaitingApprovalsCard'

vi.mock('@/lib/useCapabilities', () => ({
  useCapabilities: () => ({ capabilities: new Set(['books.approve']), isLoading: false, has: (cap: string) => cap === 'books.approve' }),
}))

// BookDetailDrawer reads the session user for step ownership.
vi.mock('@/lib/authContext', () => ({
  useAuth: () => ({ user: { id: 42 }, status: 'authed' }),
}))

vi.mock('@/lib/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/api')>()
  return {
    ...actual,
    api: {
      ...actual.api,
      listAwaitingBooks: vi.fn(),
    },
  }
})

const { api } = await import('@/lib/api')

const BOOK: BookRead = {
  id: 7,
  ref_number: 'HR-0007',
  category_id: 'HR',
  subject: 'Awaiting decision',
  created_at: '2026-08-20T09:00:00+00:00',
  priority: 'Normal',
  approval_state: 'pending',
} as BookRead

function LocationProbe(): React.JSX.Element {
  const loc = useLocation()
  return <span data-testid="location">{`${loc.pathname}${loc.search}`}</span>
}

function renderInRouter(ui: React.ReactElement) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={qc}>
      <I18nextProvider i18n={i18n}>
        <MemoryRouter initialEntries={['/']}>
          <Routes>
            <Route path="*" element={ui} />
          </Routes>
          <LocationProbe />
        </MemoryRouter>
      </I18nextProvider>
    </QueryClientProvider>,
  )
}

beforeEach(() => {
  vi.mocked(api.listAwaitingBooks).mockReset()
})

describe('BooksAwaitingWidget deep-link', () => {
  it('the footer link navigates to /books/approvals?tab=received', async () => {
    vi.mocked(api.listAwaitingBooks).mockResolvedValue([BOOK])
    renderInRouter(<BooksAwaitingWidget />)
    const link = await screen.findByTestId('approvals-full-log-link')
    expect(link).toHaveAttribute('href', APPROVALS_RECEIVED_DEEPLINK)
    await userEvent.click(link)
    await waitFor(() =>
      expect(screen.getByTestId('location')).toHaveTextContent('/books/approvals?tab=received'),
    )
  })

  it('the footer link renders even when the queue is empty', async () => {
    vi.mocked(api.listAwaitingBooks).mockResolvedValue([])
    renderInRouter(<BooksAwaitingWidget />)
    expect(await screen.findByTestId('approvals-full-log-link')).toBeInTheDocument()
  })
})

describe('WaitingApprovalsCard deep-link contract', () => {
  it('the shared deep-link target is the received tab of the log', () => {
    // Both this card (via DashboardPage's onReview) and BooksAwaitingWidget's
    // footer route through this one constant — pin it so a path change cannot
    // silently break one of the two entry points.
    expect(APPROVALS_RECEIVED_DEEPLINK).toBe('/books/approvals?tab=received')
  })

  it('clicking the card fires onReview exactly once', async () => {
    vi.mocked(api.listAwaitingBooks).mockResolvedValue([])
    const onReview = vi.fn()
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    render(
      <QueryClientProvider client={qc}>
        <I18nextProvider i18n={i18n}>
          <MemoryRouter>
            <WaitingApprovalsCard onReview={onReview} />
          </MemoryRouter>
        </I18nextProvider>
      </QueryClientProvider>,
    )
    await screen.findByRole('button')
    await userEvent.click(screen.getByRole('button'))
    expect(onReview).toHaveBeenCalledTimes(1)
  })
})
