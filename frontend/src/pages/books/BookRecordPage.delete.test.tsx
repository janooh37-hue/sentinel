/**
 * Delete record / Delete draft on the record page (Tools menu, last item).
 *
 * Contract (plan §2, S1): visible for a draft and a returned record, disabled
 * with its reason line for an approved one, hidden without `books.delete`;
 * confirming returns to the originating list at once and sends NO request
 * until the 6 s undo window has passed.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes, useLocation, useNavigate } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type * as ApiModule from '@/lib/api'
import type * as AuthContextModule from '@/lib/authContext'
import { api } from '@/lib/api'
import { toast } from '@/lib/toast'
import { BookRecordPage } from './BookRecordPage'
import { RecordDeleteProvider } from './RecordDeleteProvider'

const mockHas = vi.fn<(cap: string) => boolean>(() => false)
const { mobile } = vi.hoisted(() => ({ mobile: { value: false } }))

vi.mock('@/lib/api', async (orig) => {
  const real = await orig<typeof ApiModule>()
  return {
    ...real,
    api: {
      ...real.api,
      getBook: vi.fn(),
      getBookThread: vi.fn().mockResolvedValue([]),
      deleteBook: vi.fn().mockResolvedValue(undefined),
      getBookVersionFields: vi.fn().mockResolvedValue({ fields: {} }),
      getEmployee: vi.fn().mockResolvedValue({ name_en: 'SAEED', name_ar: 'سعيد' }),
      listBookAnnotations: vi.fn().mockResolvedValue([]),
      listBookClassifications: vi.fn().mockResolvedValue({ items: [] }),
      listBookRecipients: vi.fn().mockResolvedValue([]),
      markBookSeen: vi.fn().mockResolvedValue(undefined),
      listAwaitingBooks: vi.fn().mockResolvedValue([]),
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
vi.mock('@/lib/useIsMobile', () => ({ useIsMobile: () => mobile.value }))
vi.mock('@/lib/toast', () => ({
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

function fixture(overrides: Record<string, unknown> = {}): unknown {
  return {
    id: 48,
    ref_number: 'GS-0048',
    subject: 'Transfer letter',
    approval_state: 'none',
    access_scope: 'full',
    grade: 'unclassified',
    distribution: 'named',
    metadata_only: false,
    urgency: 'Normal',
    can_change_grade: false,
    can_write: true,
    signing_path: null,
    is_word_book: false,
    is_draft: true,
    voided_at: null,
    edit_session: null,
    submitted_by_name: null,
    created_by_name: 'Operator',
    created_at: '2026-08-01T09:00:00Z',
    approval_steps: [],
    sms: [],
    imported_doc: null,
    versions: [
      {
        id: 5,
        version_no: 1,
        status: 'draft',
        document_id: 900,
        template_id: 'General Book',
        has_fields: true,
        pdf_url: '/api/v1/documents/900/download?format=pdf',
        signed_pdf_url: null,
        signed_source: null,
        created_at: '2026-08-01T09:00:00Z',
        created_by_name: 'Operator',
        approval_steps: [],
      },
    ],
    ...overrides,
  }
}

function LocationProbe(): React.JSX.Element {
  const location = useLocation()
  const navigate = useNavigate()
  return (
    <>
      <output data-testid="loc">{`${location.pathname}${location.search}`}</output>
      <output data-testid="loc-state">{JSON.stringify(location.state)}</output>
      <button type="button" onClick={() => navigate(-1)}>history-back</button>
    </>
  )
}

const FROM_LIST = { from: '/books?status=draft', queue: [48], scrollY: 30 }

function renderRecord() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const tree = () => (
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={[{ pathname: '/books/48', state: FROM_LIST }]}>
        <RecordDeleteProvider>
          <Routes>
            <Route path="/books/:id" element={<BookRecordPage />} />
            <Route path="/books" element={<LocationProbe />} />
            <Route path="/ledger" element={<LocationProbe />} />
          </Routes>
        </RecordDeleteProvider>
      </MemoryRouter>
    </QueryClientProvider>
  )
  const view = render(tree())
  return () => view.rerender(tree())
}

async function openTools(): Promise<void> {
  await userEvent.click(await screen.findByRole('button', { name: 'Tools' }))
}

describe('BookRecordPage — Delete', () => {
  beforeEach(() => {
    mockHas.mockImplementation((cap) => cap === 'books.delete')
    vi.mocked(api.getBook).mockReset()
    vi.mocked(api.deleteBook).mockClear()
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it('offers Delete draft for a draft', async () => {
    vi.mocked(api.getBook).mockResolvedValue(fixture() as never)
    renderRecord()
    await openTools()
    const item = await screen.findByRole('menuitem', { name: /^Delete draft/ })
    expect(item).not.toHaveAttribute('aria-disabled')
  })

  it('offers Delete record for a returned record', async () => {
    vi.mocked(api.getBook).mockResolvedValue(
      fixture({ approval_state: 'returned', is_draft: false }) as never,
    )
    renderRecord()
    await openTools()
    const item = await screen.findByRole('menuitem', { name: /^Delete record/ })
    expect(item).not.toHaveAttribute('aria-disabled')
  })

  it('shows Delete disabled with its reason for an approved record', async () => {
    vi.mocked(api.getBook).mockResolvedValue(
      fixture({ approval_state: 'approved', is_draft: false }) as never,
    )
    renderRecord()
    await openTools()
    const item = await screen.findByRole('menuitem', { name: /^Delete record/ })
    expect(item).toHaveAttribute('aria-disabled', 'true')
    expect(item).toHaveTextContent('In-flight or signed records can’t be deleted.')
  })

  it('hides Delete without books.delete', async () => {
    mockHas.mockImplementation(() => false)
    vi.mocked(api.getBook).mockResolvedValue(fixture() as never)
    renderRecord()
    await openTools()
    await screen.findByRole('menuitem', { name: 'Print' })
    expect(screen.queryByRole('menuitem', { name: /^Delete/ })).not.toBeInTheDocument()
  })

  it('confirm returns to the originating list and sends no request before 6 s', async () => {
    vi.mocked(api.getBook).mockResolvedValue(fixture() as never)
    renderRecord()

    await userEvent.click(await screen.findByRole('button', { name: 'Tools' }))
    await userEvent.click(await screen.findByRole('menuitem', { name: /^Delete draft/ }))
    const dialog = await screen.findByRole('dialog')
    expect(within(dialog).getByText(/Delete record .*GS-0048.*\?/)).toBeVisible()
    // The 6 s undo timer starts at the confirm click: fake time only from here.
    vi.useFakeTimers({ shouldAdvanceTime: true })
    await userEvent
      .setup({ advanceTimers: vi.advanceTimersByTime })
      .click(within(dialog).getByRole('button', { name: 'Delete draft' }))

    // Back through the nav context: the list URL, focused on this record.
    await waitFor(() => expect(screen.getByTestId('loc')).toHaveTextContent('/books?status=draft'))
    expect(JSON.parse(screen.getByTestId('loc-state').textContent ?? 'null')).toEqual({
      focusBookId: 48,
      scrollY: 30,
    })
    expect(api.deleteBook).not.toHaveBeenCalled()

    await act(async () => {
      await vi.advanceTimersByTimeAsync(5_000)
    })
    expect(api.deleteBook).not.toHaveBeenCalled()
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1_500)
    })
    expect(api.deleteBook).toHaveBeenCalledTimes(1)
    expect(api.deleteBook).toHaveBeenCalledWith(48)
  })

  it('renders the record inert while its delete is pending, and live again after Undo', async () => {
    vi.mocked(api.getBook).mockResolvedValue(fixture() as never)
    renderRecord()

    await userEvent.click(await screen.findByRole('button', { name: 'Tools' }))
    await userEvent.click(await screen.findByRole('menuitem', { name: /^Delete draft/ }))
    const dialog = await screen.findByRole('dialog')
    await userEvent.click(within(dialog).getByRole('button', { name: 'Delete draft' }))
    await waitFor(() => expect(screen.getByTestId('loc')).toHaveTextContent('/books?status=draft'))

    // Browser Back during the undo window lands on the doomed record again.
    await userEvent.click(screen.getByRole('button', { name: 'history-back' }))
    expect(await screen.findByTestId('record-pending-delete')).toBeVisible()
    expect(screen.queryByRole('button', { name: 'Tools' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /^Delete/ })).not.toBeInTheDocument()
    expect(api.deleteBook).not.toHaveBeenCalled()

    // Undo (the toast action) clears the pending id: the record is interactive again.
    const undoOptions = vi.mocked(toast).mock.calls.at(-1)?.[1] as unknown as { action: { onClick: () => void } }
    act(() => undoOptions.action.onClick())
    expect(await screen.findByRole('button', { name: 'Tools' })).toBeInTheDocument()
    expect(screen.queryByTestId('record-pending-delete')).not.toBeInTheDocument()
    expect(api.deleteBook).not.toHaveBeenCalled()
  })
})

describe('BookRecordPage — external email', () => {
  beforeEach(() => {
    mockHas.mockImplementation((cap) => cap === 'books.view' || cap === 'ledger.create')
    vi.mocked(api.getBook).mockResolvedValue(fixture() as never)
  })
  afterEach(() => {
    mobile.value = false
  })

  it.each([false, true])('hides Outlook without send, then opens the real record prefill on grant (mobile=%s)', async (isMobile) => {
    mobile.value = isMobile
    const refresh = renderRecord()
    await userEvent.click(await screen.findByRole('button', { name: isMobile ? 'More' : 'Tools' }))
    expect(screen.queryByRole(isMobile ? 'button' : 'menuitem', { name: /Email via Outlook/ })).not.toBeInTheDocument()
    expect(screen.getByRole(isMobile ? 'button' : 'menuitem', { name: /^Print/ })).toBeInTheDocument()
    mockHas.mockImplementation((cap) => cap === 'books.view' || cap === 'ledger.send')
    refresh()
    await userEvent.click(await screen.findByRole(isMobile ? 'button' : 'menuitem', { name: /Email via Outlook/ }))
    await waitFor(() => expect(screen.getByTestId('loc')).toHaveTextContent('/ledger?tab=email'))
    const state = JSON.parse(screen.getByTestId('loc-state').textContent ?? 'null')
    expect(state.composePrefill.references).toEqual([
      expect.objectContaining({ kind: 'book', id: 48, docId: 900, label: 'GS-0048' }),
    ])
    expect(state.composePrefill).not.toHaveProperty('basketKey')
  })

  it.each([false, true])('does not act on an already-rendered email action after revoke (mobile=%s)', async (isMobile) => {
    mobile.value = isMobile
    mockHas.mockImplementation((cap) => cap === 'books.view' || cap === 'ledger.send')
    renderRecord()
    await userEvent.click(await screen.findByRole('button', { name: isMobile ? 'More' : 'Tools' }))
    const email = await screen.findByRole(isMobile ? 'button' : 'menuitem', { name: /Email via Outlook/ })
    const fieldsCalls = vi.mocked(api.getBookVersionFields).mock.calls.length
    mockHas.mockImplementation((cap) => cap === 'books.view')
    await userEvent.click(email)
    expect(screen.queryByTestId('loc')).not.toBeInTheDocument()
    expect(api.getBookVersionFields).toHaveBeenCalledTimes(fieldsCalls)
  })
})
