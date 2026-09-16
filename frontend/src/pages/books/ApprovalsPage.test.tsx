/**
 * ApprovalsPage behaviour (#31, revision-scoped worklist):
 *  - the generic landing rule resolves a context from the caller's summary,
 *    with no query params or an unauthorized/invalid one;
 *  - the URL canonicalizes to that resolved context;
 *  - To sign / To review sub-tabs appear only when both are available;
 *  - status/sort/page controls re-query with the right server params;
 *  - rows navigate to the record carrying the originating context;
 *  - a late advisory review shows its badge and the record's real outcome;
 *  - document thumbnails open a preview without navigating.
 */
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { I18nextProvider } from 'react-i18next'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import i18n from '@/lib/i18n'
import type { ApprovalLogItem, ApprovalSummaryResponse } from '@/lib/api'
import type { Paper } from './recordPapers'
import { ApprovalsPage } from './ApprovalsPage'

vi.mock('@/lib/authContext', () => ({
  useAuth: () => ({ status: 'authed', user: { id: 7 } }),
}))

vi.mock('@/pages/books/RecordPaperViewer', () => ({
  default: ({
    papers,
    paperIndex,
    isOverlay,
  }: {
    papers: Paper[]
    paperIndex: number
    isOverlay?: boolean
  }) => (
    <div
      data-testid="record-paper-viewer"
      data-paper-kind={papers[paperIndex]?.kind}
      data-paper-url={papers[paperIndex]?.url}
      data-overlay={isOverlay ? 'true' : 'false'}
    />
  ),
}))

vi.mock('@/pages/scanInbox/ScanPdfCanvas', () => ({
  default: () => <div data-testid="approval-thumb-canvas" />,
}))

vi.mock('@/lib/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/api')>()
  return {
    ...actual,
    api: {
      ...actual.api,
      listApprovalLog: vi.fn(),
      getApprovalSummary: vi.fn(),
    },
  }
})

const { api } = await import('@/lib/api')

function summary(overrides: Partial<ApprovalSummaryResponse> = {}): ApprovalSummaryResponse {
  return {
    can_view_sent: false,
    available_received_kinds: ['approver'],
    signature: { count: 1, oldest: null },
    review: { count: 0, oldest: null },
    sent: { count: 0, oldest: null },
    returned_count: 0,
    actionable_count: 1,
    ...overrides,
  }
}

function row(overrides: Partial<ApprovalLogItem>): ApprovalLogItem {
  return {
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
    ...overrides,
  }
}

function LocationProbe(): React.JSX.Element {
  const loc = useLocation()
  return <span data-testid="location">{`${loc.pathname}${loc.search}`}</span>
}

function renderPage(initialEntry = '/books/approvals') {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={qc}>
      <I18nextProvider i18n={i18n}>
        <MemoryRouter initialEntries={[initialEntry]}>
          <Routes>
            <Route path="/books/approvals" element={<ApprovalsPage />} />
            <Route path="/books/:id" element={<div data-testid="record-page" />} />
          </Routes>
          <LocationProbe />
        </MemoryRouter>
      </I18nextProvider>
    </QueryClientProvider>,
  )
}

const emptyLog = { items: [], total: 0, limit: 100, offset: 0 }

beforeEach(() => {
  vi.mocked(api.listApprovalLog).mockReset()
  vi.mocked(api.getApprovalSummary).mockReset()
  vi.mocked(api.listApprovalLog).mockResolvedValue(emptyLog)
})

describe('ApprovalsPage generic landing + URL canonicalization', () => {
  it('lands on received/sign/pending when the caller has signature work', async () => {
    vi.mocked(api.getApprovalSummary).mockResolvedValue(summary())
    renderPage()
    await waitFor(() =>
      expect(api.listApprovalLog).toHaveBeenCalledWith({
        scope: 'received',
        kind: 'approver',
        status: 'pending',
        sort: 'oldest',
        limit: 100,
        offset: 0,
      }),
    )
    await waitFor(() =>
      expect(screen.getByTestId('location')).toHaveTextContent(
        '/books/approvals?tab=received&kind=sign&status=pending&sort=oldest&page=1',
      ),
    )
  })

  it('lands on received/review/pending when only review work is available', async () => {
    vi.mocked(api.getApprovalSummary).mockResolvedValue(
      summary({
        available_received_kinds: ['reviewer'],
        signature: { count: 0, oldest: null },
        review: { count: 2, oldest: null },
      }),
    )
    renderPage()
    await waitFor(() =>
      expect(api.listApprovalLog).toHaveBeenCalledWith({
        scope: 'received',
        kind: 'reviewer',
        status: 'pending',
        sort: 'oldest',
        limit: 100,
        offset: 0,
      }),
    )
  })

  it('lands on sent when there is no assigned work but the caller can view sent', async () => {
    vi.mocked(api.getApprovalSummary).mockResolvedValue(
      summary({
        available_received_kinds: [],
        signature: { count: 0, oldest: null },
        can_view_sent: true,
      }),
    )
    renderPage()
    await waitFor(() =>
      expect(api.listApprovalLog).toHaveBeenCalledWith({
        scope: 'sent',
        kind: undefined,
        status: 'pending',
        sort: 'oldest',
        limit: 100,
        offset: 0,
      }),
    )
  })

  it('shows the neutral no-assigned-work state when nothing is authorized', async () => {
    vi.mocked(api.getApprovalSummary).mockResolvedValue(
      summary({ available_received_kinds: [], signature: { count: 0, oldest: null } }),
    )
    renderPage()
    expect(await screen.findByText('No approvals assigned to you.')).toBeInTheDocument()
    expect(api.listApprovalLog).not.toHaveBeenCalled()
  })

  it('an unauthorized explicit tab falls back to the landing rule instead of granting access', async () => {
    vi.mocked(api.getApprovalSummary).mockResolvedValue(summary({ can_view_sent: false }))
    renderPage('/books/approvals?tab=sent')
    await waitFor(() =>
      expect(api.listApprovalLog).toHaveBeenCalledWith(
        expect.objectContaining({ scope: 'received', kind: 'approver' }),
      ),
    )
    expect(api.listApprovalLog).not.toHaveBeenCalledWith(
      expect.objectContaining({ scope: 'sent' }),
    )
  })

  it('falls back from an unauthorized signing kind to the reviewer default status', async () => {
    vi.mocked(api.getApprovalSummary).mockResolvedValue(
      summary({
        available_received_kinds: ['reviewer'],
        signature: { count: 0, oldest: null },
        review: { count: 0, oldest: null },
      }),
    )
    renderPage('/books/approvals?tab=received&kind=sign')
    await waitFor(() =>
      expect(api.listApprovalLog).toHaveBeenCalledWith(
        expect.objectContaining({ scope: 'received', kind: 'reviewer', status: 'all' }),
      ),
    )
    await waitFor(() =>
      expect(screen.getByTestId('location')).toHaveTextContent(
        '/books/approvals?tab=received&kind=review&status=all&sort=oldest&page=1',
      ),
    )
  })

  it('an invalid status value resets to the field default rather than erroring', async () => {
    vi.mocked(api.getApprovalSummary).mockResolvedValue(summary())
    renderPage('/books/approvals?tab=received&kind=sign&status=bogus')
    await waitFor(() =>
      expect(api.listApprovalLog).toHaveBeenCalledWith(
        expect.objectContaining({ scope: 'received', status: 'pending' }),
      ),
    )
  })
})

describe('ApprovalsPage sub-tabs and filters', () => {
  it('shows To sign / To review sub-tabs only when both kinds are available', async () => {
    vi.mocked(api.getApprovalSummary).mockResolvedValue(
      summary({ available_received_kinds: ['approver', 'reviewer'], review: { count: 1, oldest: null } }),
    )
    renderPage()
    await screen.findByTestId('approvals-subtab-sign')
    expect(screen.getByTestId('approvals-subtab-review')).toBeInTheDocument()
  })

  it('hides sub-tabs with only one available kind', async () => {
    vi.mocked(api.getApprovalSummary).mockResolvedValue(summary())
    renderPage()
    await waitFor(() => expect(api.listApprovalLog).toHaveBeenCalled())
    expect(screen.queryByTestId('approvals-subtab-sign')).not.toBeInTheDocument()
  })

  it('a status chip click re-queries with the new status and resets to page 1', async () => {
    vi.mocked(api.getApprovalSummary).mockResolvedValue(summary())
    renderPage()
    await screen.findByTestId('approvals-filter-approved')
    await userEvent.click(screen.getByTestId('approvals-filter-approved'))
    await waitFor(() =>
      expect(api.listApprovalLog).toHaveBeenLastCalledWith(
        expect.objectContaining({ scope: 'received', status: 'approved', offset: 0 }),
      ),
    )
  })

  it('the review sub-tab only offers pending/all statuses', async () => {
    vi.mocked(api.getApprovalSummary).mockResolvedValue(
      summary({ available_received_kinds: ['approver', 'reviewer'], review: { count: 1, oldest: null } }),
    )
    renderPage()
    await userEvent.click(await screen.findByTestId('approvals-subtab-review'))
    await waitFor(() => expect(screen.queryByTestId('approvals-filter-approved')).not.toBeInTheDocument())
    expect(screen.getByTestId('approvals-filter-pending')).toBeInTheDocument()
    expect(screen.getByTestId('approvals-filter-all')).toBeInTheDocument()
  })

  it('sort toggle flips oldest/newest and resets to page 1', async () => {
    vi.mocked(api.getApprovalSummary).mockResolvedValue(summary())
    renderPage()
    await screen.findByTestId('approvals-sort-toggle')
    await userEvent.click(screen.getByTestId('approvals-sort-toggle'))
    await waitFor(() =>
      expect(api.listApprovalLog).toHaveBeenLastCalledWith(
        expect.objectContaining({ scope: 'received', sort: 'newest' }),
      ),
    )
  })
})

describe('ApprovalsPage pagination', () => {
  it('Next advances the page and requeries with the new offset', async () => {
    vi.mocked(api.getApprovalSummary).mockResolvedValue(summary())
    vi.mocked(api.listApprovalLog).mockResolvedValue({
      items: [row({})],
      total: 150,
      limit: 100,
      offset: 0,
    })
    renderPage()
    await screen.findByText('HR-0001')
    await userEvent.click(screen.getByLabelText('Next page'))
    await waitFor(() =>
      expect(api.listApprovalLog).toHaveBeenLastCalledWith(
        expect.objectContaining({ scope: 'received', offset: 100 }),
      ),
    )
  })
})

describe('ApprovalsPage rows', () => {
  beforeEach(() => {
    vi.mocked(api.getApprovalSummary).mockResolvedValue(summary())
  })

  it('renders ref chips, subjects, and the submitter line', async () => {
    vi.mocked(api.listApprovalLog).mockResolvedValue({
      items: [row({ book_id: 1, ref_number: 'HR-0001', subject: 'Pending one' })],
      total: 1,
      limit: 100,
      offset: 0,
    })
    renderPage()
    expect(await screen.findByText('HR-0001')).toBeInTheDocument()
    expect(screen.getByText('Pending one')).toBeInTheDocument()
    expect(screen.getByText('Submitter')).toBeInTheDocument()
  })

  it('shows a late-advisory badge and the record outcome for a decided book with a still-pending review', async () => {
    vi.mocked(api.getApprovalSummary).mockResolvedValue(
      summary({
        available_received_kinds: ['reviewer'],
        signature: { count: 0, oldest: null },
        review: { count: 1, oldest: null },
      }),
    )
    vi.mocked(api.listApprovalLog).mockResolvedValue({
      items: [row({ status: 'pending', record_status: 'approved' })],
      total: 1,
      limit: 100,
      offset: 0,
    })
    renderPage()
    expect(await screen.findByText('Late advisory feedback')).toBeInTheDocument()
    expect(screen.getByText('Approved')).toBeInTheDocument()
  })

  it('shows the assigned-revision badge for a restricted historical row', async () => {
    vi.mocked(api.listApprovalLog).mockResolvedValue({
      items: [row({ access_scope: 'assigned_revision' })],
      total: 1,
      limit: 100,
      offset: 0,
    })
    renderPage()
    expect(await screen.findByText('Assigned revision')).toBeInTheDocument()
  })

  it('clicking a row navigates to the record carrying the originating context', async () => {
    vi.mocked(api.listApprovalLog).mockResolvedValue({
      items: [row({ book_id: 2, ref_number: 'HR-0002', version_id: 5 })],
      total: 1,
      limit: 100,
      offset: 0,
    })
    renderPage()
    await userEvent.click(await screen.findByText('HR-0002'))
    await waitFor(() =>
      expect(screen.getByTestId('location')).toHaveTextContent(
        '/books/2?version_id=5&tab=received&kind=sign&status=pending&sort=oldest&page=1',
      ),
    )
    expect(screen.getByTestId('record-page')).toBeInTheDocument()
  })

  it('opens a document preview from the thumbnail without navigating, then opens the full record', async () => {
    vi.mocked(api.listApprovalLog).mockResolvedValue({
      items: [row({ document_id: 7 })],
      total: 1,
      limit: 100,
      offset: 0,
    })
    renderPage()

    await userEvent.click(await screen.findByRole('button', { name: /preview document/i }))

    expect(await screen.findByRole('dialog')).toBeInTheDocument()
    expect(await screen.findByTestId('record-paper-viewer')).toHaveAttribute(
      'data-paper-url',
      '/api/v1/documents/7/download?format=pdf&version_id=1',
    )
    expect(screen.getByTestId('record-paper-viewer')).toHaveAttribute('data-paper-kind', 'generated')
    expect(screen.getByTestId('record-paper-viewer')).toHaveAttribute('data-overlay', 'true')
    expect(screen.getByTestId('location')).toHaveTextContent('/books/approvals')

    await userEvent.click(screen.getByRole('button', { name: /open full record/i }))
    await waitFor(() => expect(screen.getByTestId('location')).toHaveTextContent('/books/1'))
  })

  it.each(['click', 'keyboard'])(
    'restores focus to the same thumbnail after an Escape close from a %s opening',
    async (opening) => {
      vi.mocked(api.listApprovalLog).mockResolvedValue({
        items: [row({ document_id: 7 })],
        total: 1,
        limit: 100,
        offset: 0,
      })
      const user = userEvent.setup()
      renderPage()
      const thumbnail = await screen.findByRole('button', { name: /preview document/i })

      if (opening === 'click') {
        await user.click(thumbnail)
      } else {
        thumbnail.focus()
        await user.keyboard('{Enter}')
      }
      expect(await screen.findByRole('dialog')).toBeInTheDocument()

      await user.keyboard('{Escape}')

      await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
      expect(thumbnail).toHaveFocus()
    },
  )
})
