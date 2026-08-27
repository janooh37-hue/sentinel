/**
 * ApprovalsPage behaviour (#31):
 *  - default tab rule: reviewers land on "received", everyone else on "sent";
 *  - ?tab= overrides once and is consumed + stripped from the URL;
 *  - status chips filter priority groups client-side;
 *  - rows navigate to full records while document thumbnails open previews.
 */
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { I18nextProvider } from 'react-i18next'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import i18n from '@/lib/i18n'
import type { ApprovalLogItem } from '@/lib/api'
import { ApprovalsPage } from './ApprovalsPage'

const mockHas = vi.fn<(cap: string) => boolean>(() => true)

vi.mock('@/lib/useCapabilities', () => ({
  useCapabilities: () => ({
    capabilities: new Set<string>(),
    isLoading: false,
    has: (cap: string) => mockHas(cap),
  }),
}))

vi.mock('@/pages/application/DocPdfCanvas', () => ({
  default: ({ pdfUrl }: { pdfUrl: string }) => (
    <div data-testid="doc-pdf-canvas" data-pdf-url={pdfUrl} />
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
    },
  }
})

const { api } = await import('@/lib/api')

function row(overrides: Partial<ApprovalLogItem>): ApprovalLogItem {
  return {
    book_id: 1,
    ref_number: 'HR-0001',
    subject: 'Subject',
    category_name_ar: null,
    category_name_en: null,
    status: 'pending',
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
    your_step_kind: null,
    your_step_state: null,
    your_step_decided_at: null,
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

beforeEach(() => {
  vi.mocked(api.listApprovalLog).mockReset()
  mockHas.mockImplementation(() => true)
})

describe('ApprovalsPage tabs', () => {
  it('defaults to received for a caller holding books.approve', async () => {
    vi.mocked(api.listApprovalLog).mockResolvedValue({
      items: [],
      total: 0,
      limit: 100,
      offset: 0,
    })
    renderPage()
    await waitFor(() =>
      expect(api.listApprovalLog).toHaveBeenCalledWith('received'),
    )
    expect(screen.getByRole('tab', { selected: true })).toHaveAttribute(
      'data-testid',
      'approvals-tab-received',
    )
  })

  it('defaults to sent for a caller without books.approve, and hides the received tab', async () => {
    mockHas.mockImplementation((cap) => cap !== 'books.approve')
    vi.mocked(api.listApprovalLog).mockResolvedValue({
      items: [],
      total: 0,
      limit: 100,
      offset: 0,
    })
    renderPage()
    await waitFor(() => expect(api.listApprovalLog).toHaveBeenCalledWith('sent'))
    expect(screen.queryByTestId('approvals-tab-received')).not.toBeInTheDocument()
  })

  it('?tab=sent overrides the default and is consumed + stripped from the URL', async () => {
    vi.mocked(api.listApprovalLog).mockResolvedValue({
      items: [],
      total: 0,
      limit: 100,
      offset: 0,
    })
    renderPage('/books/approvals?tab=sent')
    await waitFor(() => expect(api.listApprovalLog).toHaveBeenCalledWith('sent'))
    // The param was consumed: the address bar is clean afterwards.
    await waitFor(() =>
      expect(screen.getByTestId('location')).toHaveTextContent('/books/approvals'),
    )
  })
})

describe('ApprovalsPage rows and filters', () => {
  const items = [
    row({ book_id: 1, ref_number: 'HR-0001', subject: 'Pending one', status: 'pending' }),
    row({
      book_id: 2,
      ref_number: 'HR-0002',
      subject: 'Approved one',
      status: 'approved',
      verdict: 'approved',
      decided_at: '2026-08-20T09:00:00+00:00',
    }),
  ]

  beforeEach(() => {
    vi.mocked(api.listApprovalLog).mockResolvedValue({
      items,
      total: items.length,
      limit: 100,
      offset: 0,
    })
  })

  it('renders ref chips, subjects, and the submitter line', async () => {
    renderPage()
    expect(await screen.findByText('HR-0001')).toBeInTheDocument()
    expect(screen.getByText('HR-0002')).toBeInTheDocument()
    expect(screen.getByText('Pending one')).toBeInTheDocument()
    expect(screen.getAllByText('Submitter').length).toBeGreaterThan(0)
  })

  it('status chips filter rows and their priority groups client-side', async () => {
    renderPage()
    await screen.findByText('HR-0001')
    await userEvent.click(screen.getByTestId('approvals-filter-approved'))
    expect(screen.getByText('HR-0002')).toBeInTheDocument()
    expect(screen.queryByText('HR-0001')).not.toBeInTheDocument()
    expect(screen.getByTestId('approvals-group-approved')).toBeInTheDocument()
    expect(screen.queryByTestId('approvals-group-waiting')).not.toBeInTheDocument()
    expect(screen.queryByTestId('approvals-group-returned')).not.toBeInTheDocument()
    expect(screen.queryByTestId('approvals-group-rejected')).not.toBeInTheDocument()
    await userEvent.click(screen.getByTestId('approvals-filter-all'))
    expect(screen.getByText('HR-0001')).toBeInTheDocument()
  })

  it('groups every waiting state in server order and omits empty groups', async () => {
    const groupedItems = [
      row({ book_id: 1, ref_number: 'HR-PENDING', status: 'pending' }),
      row({ book_id: 2, ref_number: 'HR-RETURNED', status: 'returned' }),
      row({ book_id: 3, ref_number: 'HR-SCAN', status: 'awaiting_scan' }),
      row({ book_id: 4, ref_number: 'HR-APPROVED', status: 'approved' }),
      row({ book_id: 5, ref_number: 'HR-NONE', status: 'none' }),
      row({ book_id: 6, ref_number: 'HR-REJECTED', status: 'rejected' }),
      row({
        book_id: 7,
        ref_number: 'HR-FUTURE',
        status: 'future_state' as ApprovalLogItem['status'],
      }),
    ]
    vi.mocked(api.listApprovalLog).mockResolvedValue({
      items: groupedItems,
      total: groupedItems.length,
      limit: 100,
      offset: 0,
    })

    const { container } = renderPage()

    await screen.findByText('HR-PENDING')
    expect(
      Array.from(container.querySelectorAll('section[data-testid^="approvals-group-"]')).map(
        (group) => group.getAttribute('data-testid'),
      ),
    ).toEqual([
      'approvals-group-waiting',
      'approvals-group-returned',
      'approvals-group-approved',
      'approvals-group-rejected',
    ])
    expect(
      Array.from(
        screen.getByTestId('approvals-group-waiting').querySelectorAll('bdi[dir="ltr"]'),
      ).map((ref) => ref.textContent),
    ).toEqual(['HR-PENDING', 'HR-SCAN', 'HR-NONE', 'HR-FUTURE'])

    const withoutRejected = groupedItems.filter((item) => item.status !== 'rejected')
    vi.mocked(api.listApprovalLog).mockResolvedValue({
      items: withoutRejected,
      total: withoutRejected.length,
      limit: 100,
      offset: 0,
    })
    const secondView = renderPage()
    await within(secondView.container).findByText('HR-PENDING')
    expect(
      within(secondView.container).queryByTestId('approvals-group-rejected'),
    ).not.toBeInTheDocument()
  })

  it('clicking a row navigates to the full record', async () => {
    renderPage()
    await screen.findByText('HR-0002')
    await userEvent.click(screen.getByText('HR-0002'))
    await waitFor(() =>
      expect(screen.getByTestId('location')).toHaveTextContent('/books/2'),
    )
    expect(screen.getByTestId('record-page')).toBeInTheDocument()
  })

  it('navigates when a focused row is activated with the keyboard', async () => {
    const user = userEvent.setup()
    renderPage()
    await screen.findByText('HR-0002')
    const approvedRow = screen.getAllByTestId('approval-row')[1]

    approvedRow.focus()
    await user.keyboard('{Enter}')

    await waitFor(() =>
      expect(screen.getByTestId('location')).toHaveTextContent('/books/2'),
    )
  })

  it('opens a document preview from the thumbnail without navigating, then opens the full record', async () => {
    vi.mocked(api.listApprovalLog).mockResolvedValue({
      items: [row({ document_id: 7 })],
      total: 1,
      limit: 100,
      offset: 0,
    })
    renderPage()

    await userEvent.click(
      await screen.findByRole('button', { name: /preview document/i }),
    )

    expect(await screen.findByRole('dialog')).toBeInTheDocument()
    expect(await screen.findByTestId('doc-pdf-canvas')).toHaveAttribute(
      'data-pdf-url',
      api.documentDownloadUrl(7, 'pdf'),
    )
    expect(screen.getByTestId('location')).toHaveTextContent('/books/approvals')

    await userEvent.click(
      screen.getByRole('button', { name: /open full record/i }),
    )
    await waitFor(() =>
      expect(screen.getByTestId('location')).toHaveTextContent('/books/1'),
    )
  })

  it('keeps the interactive thumbnail at least 44px tall and 56px wide', async () => {
    vi.mocked(api.listApprovalLog).mockResolvedValue({
      items: [row({ document_id: 7 })],
      total: 1,
      limit: 100,
      offset: 0,
    })
    renderPage()

    const thumbnail = await screen.findByRole('button', { name: /preview document/i })
    expect(thumbnail).toHaveClass('min-h-11', 'w-14')
  })

  it.each([
    ['Enter', '{Enter}'],
    ['Space', ' '],
  ])(
    'opens the thumbnail preview with %s without activating the row',
    async (_keyName, key) => {
      vi.mocked(api.listApprovalLog).mockResolvedValue({
        items: [row({ document_id: 7 })],
        total: 1,
        limit: 100,
        offset: 0,
      })
      const user = userEvent.setup()
      renderPage()
      const thumbnail = await screen.findByRole('button', {
        name: /preview document/i,
      })

      thumbnail.focus()
      await user.keyboard(key)

      expect(await screen.findByRole('dialog')).toBeInTheDocument()
      expect(screen.getByTestId('location')).toHaveTextContent('/books/approvals')
    },
  )

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
      const thumbnail = await screen.findByRole('button', {
        name: /preview document/i,
      })

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
