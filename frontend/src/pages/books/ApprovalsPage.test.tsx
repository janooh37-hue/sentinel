/**
 * ApprovalsPage behaviour (#31):
 *  - default tab rule: reviewers land on "received", everyone else on "sent";
 *  - ?tab= overrides once and is consumed + stripped from the URL;
 *  - status chips filter client-side;
 *  - clicking a row opens BookDetailDrawer for that record.
 */
import { render, screen, waitFor } from '@testing-library/react'
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
      listApprovalLog: vi.fn(),
      getBook: vi.fn(),
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
          </Routes>
          <LocationProbe />
        </MemoryRouter>
      </I18nextProvider>
    </QueryClientProvider>,
  )
}

beforeEach(() => {
  vi.mocked(api.listApprovalLog).mockReset()
  vi.mocked(api.getBook).mockReset()
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

  it('status chips filter rows client-side', async () => {
    renderPage()
    await screen.findByText('HR-0001')
    await userEvent.click(screen.getByTestId('approvals-filter-approved'))
    expect(screen.getByText('HR-0002')).toBeInTheDocument()
    expect(screen.queryByText('HR-0001')).not.toBeInTheDocument()
    await userEvent.click(screen.getByTestId('approvals-filter-all'))
    expect(screen.getByText('HR-0001')).toBeInTheDocument()
  })

  it('clicking a row opens the detail drawer for that record', async () => {
    vi.mocked(api.getBook).mockResolvedValue({ id: 2 } as never)
    renderPage()
    await screen.findByText('HR-0002')
    await userEvent.click(screen.getByText('HR-0002'))
    await waitFor(() => expect(api.getBook).toHaveBeenCalledWith(2))
  })
})
