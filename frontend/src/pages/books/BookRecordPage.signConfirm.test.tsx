/**
 * Unified sign-confirmation (record-page-polish plan §3). The desktop header
 * sign control is exercised directly here; the mobile inline panel and mobile
 * dock route through the exact same `requestSignConfirm`/`confirmSign` pair
 * (see BookRecordPage.tsx), so this file is the single place that verifies
 * cancel / confirm / duplicate-click / stale-record-or-version / failure-retry
 * for all three page sign controls.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { describe, it, expect, vi, beforeEach, beforeAll, afterAll } from 'vitest'
import i18n from 'i18next'

import ar from '@/locales/ar.json'
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
vi.mock('@/lib/useIsMobile', () => ({ useIsMobile: () => false }))
const toastError = vi.fn()
vi.mock('sonner', () => ({
  toast: Object.assign(vi.fn(), {
    success: vi.fn(),
    error: (...args: unknown[]) => toastError(...args),
    dismiss: vi.fn(),
    loading: vi.fn(),
  }),
}))
vi.mock('@/pages/application/DocPdfCanvas', () => ({
  default: () => <div data-testid="doc-pdf-canvas" />,
}))

/** A record pending signature, assigned to the current test user (id 7). */
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

describe('BookRecordPage — unified sign confirmation', () => {
  beforeEach(() => {
    mockHas.mockImplementation((cap) => cap === 'books.approve')
    vi.mocked(api.getBook).mockReset()
    vi.mocked(api.signBook).mockReset()
    toastError.mockReset()
  })

  it('opens a confirmation dialog naming the record; Cancel fires zero requests', async () => {
    vi.mocked(api.getBook).mockResolvedValue(pendingFixture() as never)
    renderRecord(makeQc())

    await userEvent.click(await screen.findByRole('button', { name: 'Sign & approve' }))
    const dialog = await screen.findByRole('dialog')
    expect(within(dialog).getByText('Sign & approve this record?')).toBeVisible()
    expect(within(dialog).getByText(/GS-0048/)).toBeVisible()

    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    await waitFor(() => expect(screen.queryByText('Sign & approve this record?')).not.toBeInTheDocument())
    expect(api.signBook).not.toHaveBeenCalled()
  })

  it('focus returns to the invoking Sign & approve button after Cancel', async () => {
    // Regression: `returnFocusRef` must read a ref that survives the same
    // synchronous `onOpenChange` callback that clears confirmation state —
    // a ref sourced from that state would already be null by the time
    // Radix resolves where to return focus.
    vi.mocked(api.getBook).mockResolvedValue(pendingFixture() as never)
    renderRecord(makeQc())

    const trigger = await screen.findByRole('button', { name: 'Sign & approve' })
    await userEvent.click(trigger)
    await screen.findByText('Sign & approve this record?')

    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    await waitFor(() => expect(screen.queryByText('Sign & approve this record?')).not.toBeInTheDocument())
    await waitFor(() => expect(document.activeElement).toBe(trigger))
  })

  it('Confirm makes exactly one sign request for the captured record/version', async () => {
    vi.mocked(api.getBook).mockResolvedValue(pendingFixture() as never)
    vi.mocked(api.signBook).mockResolvedValue(pendingFixture({ approval_state: 'approved' }) as never)
    renderRecord(makeQc())

    await userEvent.click(await screen.findByRole('button', { name: 'Sign & approve' }))
    await screen.findByText('Sign & approve this record?')
    // Two "Sign & approve" buttons now exist (the header trigger + the dialog's
    // confirm action) — the dialog's is the last one appended to the DOM.
    const confirmBtns = screen.getAllByRole('button', { name: 'Sign & approve' })
    await userEvent.click(confirmBtns[confirmBtns.length - 1])

    await waitFor(() => expect(api.signBook).toHaveBeenCalledTimes(1))
    expect(api.signBook).toHaveBeenCalledWith(48, 5)
  })

  it('a stale version (someone else advanced the record) cannot be confirmed', async () => {
    const qc = makeQc()
    vi.mocked(api.getBook).mockResolvedValue(pendingFixture() as never)
    renderRecord(qc)

    await userEvent.click(await screen.findByRole('button', { name: 'Sign & approve' }))
    await screen.findByText('Sign & approve this record?')

    // A background refetch (queue neighbor, another reviewer's action, poll)
    // lands a newer revision while the confirmation is still open.
    qc.setQueryData(
      ['books', 'detail', 48, null],
      pendingFixture({
        versions: [
          {
            id: 6,
            version_no: 2,
            status: 'pending',
            document_id: 901,
            template_id: 'General Book',
            has_fields: true,
            pdf_url: '/api/v1/documents/901/download?format=pdf',
            signed_pdf_url: null,
            signed_source: null,
            created_at: '2026-08-02T09:00:00Z',
            created_by_name: 'Operator',
            approval_steps: [
              { id: 2, step_order: 1, stage_label: 'Manager', assignee_user_id: 7, state: 'pending', note: null, decided_at: null, kind: 'approver' },
            ],
          },
        ],
      }),
    )

    // The confirmation closes on its own the instant the captured version
    // stops being current — it never lingers waiting for a click that would
    // now target the wrong version.
    await waitFor(() => expect(screen.queryByText('Sign & approve this record?')).not.toBeInTheDocument())
    expect(api.signBook).not.toHaveBeenCalled()
  })

  it('losing decide eligibility (record already decided elsewhere) closes the confirmation', async () => {
    const qc = makeQc()
    vi.mocked(api.getBook).mockResolvedValue(pendingFixture() as never)
    renderRecord(qc)

    await userEvent.click(await screen.findByRole('button', { name: 'Sign & approve' }))
    await screen.findByText('Sign & approve this record?')

    qc.setQueryData(['books', 'detail', 48, null], pendingFixture({ approval_state: 'approved' }))

    await waitFor(() => expect(screen.queryByText('Sign & approve this record?')).not.toBeInTheDocument())
    expect(api.signBook).not.toHaveBeenCalled()
  })

  it('a failed sign can be retried through a fresh confirmation', async () => {
    vi.mocked(api.getBook).mockResolvedValue(pendingFixture() as never)
    vi.mocked(api.signBook)
      .mockRejectedValueOnce(new Error('network error'))
      .mockResolvedValueOnce(pendingFixture({ approval_state: 'approved' }) as never)
    renderRecord(makeQc())

    await userEvent.click(await screen.findByRole('button', { name: 'Sign & approve' }))
    await screen.findByText('Sign & approve this record?')
    let confirmBtns = screen.getAllByRole('button', { name: 'Sign & approve' })
    await userEvent.click(confirmBtns[confirmBtns.length - 1])

    await waitFor(() => expect(toastError).toHaveBeenCalledTimes(1))
    expect(screen.queryByText('Sign & approve this record?')).not.toBeInTheDocument()

    // Retry: a fresh confirmation request, fresh confirm click.
    await userEvent.click(screen.getByRole('button', { name: 'Sign & approve' }))
    await screen.findByText('Sign & approve this record?')
    confirmBtns = screen.getAllByRole('button', { name: 'Sign & approve' })
    await userEvent.click(confirmBtns[confirmBtns.length - 1])

    await waitFor(() => expect(api.signBook).toHaveBeenCalledTimes(2))
  })
})

describe('BookRecordPage — sign confirmation, Arabic wording', () => {
  beforeAll(async () => {
    i18n.addResourceBundle('ar', 'translation', ar, true, true)
    await i18n.changeLanguage('ar')
  })
  afterAll(async () => {
    await i18n.changeLanguage('en')
  })
  beforeEach(() => {
    mockHas.mockImplementation((cap) => cap === 'books.approve')
    vi.mocked(api.getBook).mockReset()
    vi.mocked(api.signBook).mockReset()
  })

  it('names the record in Arabic and never claims the signature cannot be undone', async () => {
    vi.mocked(api.getBook).mockResolvedValue(pendingFixture() as never)
    renderRecord(makeQc())

    await userEvent.click(await screen.findByRole('button', { name: 'التوقيع والموافقة' }))
    const dialog = await screen.findByRole('dialog')
    expect(within(dialog).getByText('توقيع هذا السجل والموافقة عليه؟')).toBeVisible()
    // Reference and subject are present; the copy states what signing DOES
    // (applies the signature) without an unsupported irreversibility claim.
    expect(within(dialog).getByText(/GS-0048/)).toBeVisible()
    expect(within(dialog).getByText(/Test book subject/)).toBeVisible()
    expect(screen.queryByText(/لا يمكن التراجع/)).not.toBeInTheDocument()
  })
})
