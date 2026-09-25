/**
 * Unified sign-confirmation (record-page-polish plan §3) — mobile surfaces.
 * The desktop header control's full cancel/confirm/stale/failure-retry matrix
 * lives in BookRecordPage.signConfirm.test.tsx; this file confirms the mobile
 * inline panel and the mobile dock route through the exact same
 * `requestSignConfirm`/`confirmSign` pair rather than mutating directly.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { describe, it, expect, vi, beforeEach } from 'vitest'

import type * as ApiModule from '@/lib/api'
import type * as AuthContextModule from '@/lib/authContext'
import { api } from '@/lib/api'
import { BookRecordPage } from './BookRecordPage'

const mockHas = vi.fn<(cap: string) => boolean>(() => false)

vi.mock('@/lib/api', async (orig) => {
  const real = await orig<typeof ApiModule>()
  return {
    ...real,
    api: {
      ...real.api,
      listAwaitingBooks: vi.fn().mockResolvedValue([]),
      getBook: vi.fn(),
      signBook: vi.fn(),
      getBookVersionFields: vi.fn().mockResolvedValue({ fields: {} }),
      getEmployee: vi.fn().mockResolvedValue({ name_en: 'SAEED ALYAHYAEE', name_ar: 'سعيد' }),
      listBookAnnotations: vi.fn().mockResolvedValue([]),
      listBookClassifications: vi.fn().mockResolvedValue([]),
      markBookSeen: vi.fn().mockResolvedValue(undefined),
      listApprovalLog: vi.fn().mockResolvedValue({ items: [], total: 0 }),
    },
  }
})
vi.mock('@/lib/authContext', async (orig) => ({
  ...(await orig<typeof AuthContextModule>()),
  useAuth: () => ({ user: { id: 7 } }),
}))
vi.mock('@/lib/useCapabilities', () => ({
  useCapabilities: () => ({
    capabilities: new Set<string>(),
    isLoading: false,
    has: (cap: string) => mockHas(cap),
  }),
}))
// The one deliberate difference from the desktop test file: mobile viewport,
// which switches the decide surface from the header bar to the inline panel
// + fixed dock.
vi.mock('@/lib/useIsMobile', () => ({ useIsMobile: () => true }))
vi.mock('sonner', () => ({
  toast: Object.assign(vi.fn(), {
    success: vi.fn(),
    error: vi.fn(),
    dismiss: vi.fn(),
    loading: vi.fn(),
  }),
}))
vi.mock('@/pages/application/DocPdfCanvas', () => ({
  default: () => <div data-testid="doc-pdf-canvas" />,
}))

function pendingFixture(overrides: Record<string, unknown> = {}): unknown {
  return {
    id: 48,
    ref_number: 'GS-0048',
    subject: 'Test book subject',
    employee_id: 'G-1234',
    classification_code: null,
    original_creator_user_id: 99,
    approval_state: 'pending',
    signing_path: null,
    is_word_book: false,
    submitted_by_name: 'Operator',
    submitted_by_g: null,
    created_at: '2026-08-01T09:00:00Z',
    access_scope: 'full',
    approval_steps: [
      { id: 1, step_order: 1, stage_label: 'Manager', assignee_user_id: 7, state: 'pending', note: null, decided_at: null, kind: 'approver' },
    ],
    sms: [],
    imported_doc: null,
    versions: [
      {
        id: 5,
        version_no: 1,
        status: 'pending',
        document_id: 900,
        template_id: 'General Book',
        has_fields: true,
        pdf_url: '/api/v1/documents/900/download?format=pdf',
        signed_pdf_url: null,
        signed_source: null,
        created_at: '2026-08-01T09:00:00Z',
        created_by_name: 'Operator',
        approval_steps: [
          { id: 1, step_order: 1, stage_label: 'Manager', assignee_user_id: 7, state: 'pending', note: null, decided_at: null, kind: 'approver' },
        ],
      },
    ],
    ...overrides,
  }
}

function renderRecord(qc: QueryClient): void {
  render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={['/books/48']}>
        <Routes>
          <Route path="/books/:id" element={<BookRecordPage />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

function makeQc(): QueryClient {
  return new QueryClient({ defaultOptions: { queries: { retry: false } } })
}

describe('BookRecordPage — unified sign confirmation (mobile)', () => {
  beforeEach(() => {
    mockHas.mockImplementation((cap) => cap === 'books.approve')
    vi.mocked(api.getBook).mockReset()
    vi.mocked(api.signBook).mockReset()
  })

  it('the mobile inline panel sign control opens confirmation and confirms once', async () => {
    vi.mocked(api.getBook).mockResolvedValue(pendingFixture() as never)
    vi.mocked(api.signBook).mockResolvedValue(pendingFixture({ approval_state: 'approved' }) as never)
    renderRecord(makeQc())

    // Both the inline panel and the fixed dock render "Sign & approve" on
    // mobile; take the first (inline, under the desk).
    const signButtons = await screen.findAllByRole('button', { name: 'Sign & approve' })
    expect(signButtons.length).toBeGreaterThanOrEqual(2)
    await userEvent.click(signButtons[0])

    const dialog = await screen.findByRole('dialog')
    expect(within(dialog).getByText('Sign & approve this record?')).toBeVisible()
    const confirmBtns = screen.getAllByRole('button', { name: 'Sign & approve' })
    await userEvent.click(confirmBtns[confirmBtns.length - 1])

    await waitFor(() => expect(api.signBook).toHaveBeenCalledTimes(1))
    expect(api.signBook).toHaveBeenCalledWith(48, 5)
  })

  it('the mobile dock sign control opens confirmation and confirms once', async () => {
    vi.mocked(api.getBook).mockResolvedValue(pendingFixture() as never)
    vi.mocked(api.signBook).mockResolvedValue(pendingFixture({ approval_state: 'approved' }) as never)
    renderRecord(makeQc())

    const signButtons = await screen.findAllByRole('button', { name: 'Sign & approve' })
    // The dock is portalled last — take the last "Sign & approve" trigger.
    await userEvent.click(signButtons[signButtons.length - 1])

    const dialog = await screen.findByRole('dialog')
    expect(within(dialog).getByText('Sign & approve this record?')).toBeVisible()
    const confirmBtns = screen.getAllByRole('button', { name: 'Sign & approve' })
    await userEvent.click(confirmBtns[confirmBtns.length - 1])

    await waitFor(() => expect(api.signBook).toHaveBeenCalledTimes(1))
    expect(api.signBook).toHaveBeenCalledWith(48, 5)
  })
})
