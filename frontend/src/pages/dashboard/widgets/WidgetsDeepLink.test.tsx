/**
 * Dashboard approval-widget navigation (#31, revision-scoped): both widgets
 * must land on the approvals log via the typed URL builders, not a shared
 * deep-link constant (removed — see `lib/approvals.ts`).
 *
 * - BooksAwaitingWidget's "View full log" footer link targets the caller's
 *   primary bucket (signature work first, else review work).
 * - BooksAwaitingWidget self-hides only when the caller has no assigned
 *   received kind at all; a valid zero-work scope still renders.
 * - WaitingApprovalsCard's click contract (`onReview`) is composed by
 *   DashboardPage from the generic landing rule — pinned here at the card
 *   level, independent of that composition.
 */
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { I18nextProvider } from 'react-i18next'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import i18n from '@/lib/i18n'
import { approvalQueueUrl } from '@/lib/approvals'
import type { ApprovalLogItem, ApprovalSummaryResponse } from '@/lib/api'
import { BooksAwaitingWidget } from './BooksAwaitingWidget'
import { WaitingApprovalsCard } from './WaitingApprovalsCard'

// BookDetailDrawer reads the session user for step ownership; useApprovalSummary
// reads it for the query key/enabled gate.
vi.mock('@/lib/authContext', () => ({
  useAuth: () => ({ user: { id: 42 }, status: 'authed' }),
}))

vi.mock('@/lib/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/api')>()
  return {
    ...actual,
    api: {
      ...actual.api,
      getApprovalSummary: vi.fn(),
      listApprovalLog: vi.fn(),
    },
  }
})

const { api } = await import('@/lib/api')

const SIGNER_SUMMARY: ApprovalSummaryResponse = {
  can_view_sent: false,
  available_received_kinds: ['approver'],
  signature: { count: 1, oldest: null },
  review: { count: 0, oldest: null },
  sent: { count: 0, oldest: null },
  returned_count: 0,
  actionable_count: 1,
}

const REVIEWER_SUMMARY: ApprovalSummaryResponse = {
  ...SIGNER_SUMMARY,
  available_received_kinds: ['reviewer'],
  signature: { count: 0, oldest: null },
  review: { count: 1, oldest: null },
}

const IDLE_REVIEWER_SUMMARY: ApprovalSummaryResponse = {
  ...REVIEWER_SUMMARY,
  review: { count: 0, oldest: null },
  actionable_count: 0,
}

const PREVIEW_ROW: ApprovalLogItem = {
  book_id: 1,
  ref_number: 'HR-0001',
  subject: 'Subject',
  category_name_ar: null,
  category_name_en: null,
  status: 'pending',
  record_status: 'pending',
  priority: 'Normal',
  submitted_by_user_id: 9,
  submitted_by_name: 'Submitter',
  doc_manager_user_id: null,
  doc_manager_name: null,
  approver_name: null,
  reviewer_names: [],
  submitted_at: '2026-08-01T09:00:00+00:00',
  decided_at: null,
  verdict: null,
  document_id: null,
  version_id: 1,
  version_no: 1,
  assignment_version_no: 1,
  assigned_signer_user_id: null,
  access_scope: 'full',
}

const NO_WORK_SUMMARY: ApprovalSummaryResponse = {
  can_view_sent: false,
  available_received_kinds: [],
  signature: { count: 0, oldest: null },
  review: { count: 0, oldest: null },
  sent: { count: 0, oldest: null },
  returned_count: 0,
  actionable_count: 0,
}

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
  vi.mocked(api.getApprovalSummary).mockReset()
  vi.mocked(api.listApprovalLog).mockReset()
  vi.mocked(api.listApprovalLog).mockResolvedValue({ items: [], total: 0, limit: 5, offset: 0 })
})

describe('BooksAwaitingWidget navigation', () => {
  it('the footer link targets the primary (signature) bucket via the typed builder', async () => {
    vi.mocked(api.getApprovalSummary).mockResolvedValue(SIGNER_SUMMARY)
    renderInRouter(<BooksAwaitingWidget />)
    const link = await screen.findByTestId('approvals-full-log-link')
    const expected = approvalQueueUrl({ tab: 'received', kind: 'sign', status: 'pending', sort: 'oldest', page: 1 })
    expect(link).toHaveAttribute('href', expected)
    await userEvent.click(link)
    await waitFor(() =>
      expect(screen.getByTestId('location')).toHaveTextContent(expected),
    )
  })

  it('the footer link renders even when the primary bucket is empty', async () => {
    vi.mocked(api.getApprovalSummary).mockResolvedValue(SIGNER_SUMMARY)
    renderInRouter(<BooksAwaitingWidget />)
    expect(await screen.findByTestId('approvals-full-log-link')).toBeInTheDocument()
  })

  it('uses review copy and the object API contract for an idle review-only bucket', async () => {
    vi.mocked(api.getApprovalSummary).mockResolvedValue(IDLE_REVIEWER_SUMMARY)
    renderInRouter(<BooksAwaitingWidget />)

    expect(await screen.findByRole('heading', { name: 'To review' })).toBeInTheDocument()
    expect(await screen.findByText('Nothing to review')).toBeInTheDocument()
    expect(api.listApprovalLog).toHaveBeenCalledWith({
      scope: 'received',
      kind: 'reviewer',
      status: 'pending',
      sort: 'oldest',
      limit: 5,
    })
  })

  it('isolates the record reference direction', async () => {
    vi.mocked(api.getApprovalSummary).mockResolvedValue(SIGNER_SUMMARY)
    vi.mocked(api.listApprovalLog).mockResolvedValue({ items: [PREVIEW_ROW], total: 1, limit: 5, offset: 0 })
    renderInRouter(<BooksAwaitingWidget />)

    const ref = await screen.findByText('HR-0001')
    expect(ref.tagName).toBe('BDI')
    expect(ref).toHaveAttribute('dir', 'ltr')
  })

  it('self-hides only when the caller has no assigned received kind at all', async () => {
    vi.mocked(api.getApprovalSummary).mockResolvedValue(NO_WORK_SUMMARY)
    renderInRouter(<BooksAwaitingWidget />)
    await waitFor(() => {
      expect(screen.queryByTestId('approvals-full-log-link')).not.toBeInTheDocument()
      expect(screen.queryByRole('heading')).not.toBeInTheDocument()
    })
  })
})

describe('WaitingApprovalsCard click contract', () => {
  it('clicking the card fires onReview exactly once', async () => {
    vi.mocked(api.getApprovalSummary).mockResolvedValue(SIGNER_SUMMARY)
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

  it('uses signature and review-specific card copy', async () => {
    vi.mocked(api.getApprovalSummary).mockResolvedValue(SIGNER_SUMMARY)
    const signer = renderInRouter(<WaitingApprovalsCard onReview={vi.fn()} />)
    expect(await screen.findByText('Needs my signature')).toBeInTheDocument()
    signer.unmount()

    vi.mocked(api.getApprovalSummary).mockResolvedValue(REVIEWER_SUMMARY)
    renderInRouter(<WaitingApprovalsCard onReview={vi.fn()} />)
    expect(await screen.findByRole('button', { name: 'To review: 1. Open.' })).toBeInTheDocument()
    expect(screen.getAllByText('To review')).toHaveLength(2)
  })

  it('self-hides only when the caller has no assigned received kind at all', async () => {
    vi.mocked(api.getApprovalSummary).mockResolvedValue(NO_WORK_SUMMARY)
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    const { container } = render(
      <QueryClientProvider client={qc}>
        <I18nextProvider i18n={i18n}>
          <MemoryRouter>
            <WaitingApprovalsCard onReview={vi.fn()} />
          </MemoryRouter>
        </I18nextProvider>
      </QueryClientProvider>,
    )
    await waitFor(() => expect(container).toBeEmptyDOMElement())
  })
})
