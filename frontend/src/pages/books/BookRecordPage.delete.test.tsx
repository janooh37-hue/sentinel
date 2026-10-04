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
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type * as ApiModule from '@/lib/api'
import type * as AuthContextModule from '@/lib/authContext'
import { api } from '@/lib/api'
import { BookRecordPage } from './BookRecordPage'
import { RecordDeleteProvider } from './RecordDeleteProvider'

const mockHas = vi.fn<(cap: string) => boolean>(() => false)

vi.mock('@/lib/api', async (orig) => {
  const real = await orig<typeof ApiModule>()
  return {
    ...real,
    api: {
      ...real.api,
      getBook: vi.fn(),
      deleteBook: vi.fn().mockResolvedValue(undefined),
      getBookVersionFields: vi.fn().mockResolvedValue({ fields: {} }),
      getEmployee: vi.fn().mockResolvedValue({ name_en: 'SAEED', name_ar: 'سعيد' }),
      listBookAnnotations: vi.fn().mockResolvedValue([]),
      listBookClassifications: vi.fn().mockResolvedValue({ items: [] }),
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
vi.mock('@/lib/useIsMobile', () => ({ useIsMobile: () => false }))
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

function fixture(overrides: Record<string, unknown> = {}): unknown {
  return {
    id: 48,
    ref_number: 'GS-0048',
    subject: 'Transfer letter',
    approval_state: 'none',
    access_scope: 'full',
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
  return (
    <>
      <output data-testid="loc">{`${location.pathname}${location.search}`}</output>
      <output data-testid="loc-state">{JSON.stringify(location.state)}</output>
    </>
  )
}

const FROM_LIST = { from: '/books?status=draft', queue: [48], scrollY: 30 }

function renderRecord(): void {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={[{ pathname: '/books/48', state: FROM_LIST }]}>
        <RecordDeleteProvider>
          <Routes>
            <Route path="/books/:id" element={<BookRecordPage />} />
            <Route path="/books" element={<LocationProbe />} />
          </Routes>
        </RecordDeleteProvider>
      </MemoryRouter>
    </QueryClientProvider>,
  )
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
})
