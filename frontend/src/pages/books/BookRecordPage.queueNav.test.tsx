/**
 * Header actions of the record page.
 *
 * `QueueNav` (the arrows) is asserted under lng=ar as well as en — an
 * English-only assertion cannot catch an AR leak when the EN label equals the
 * key.
 *
 * The "Email via Outlook" describe renders the whole page: the action lives in
 * the header's permanent-tools row, which is ONE action model that reflows for
 * phone and desktop, so there is nothing to assert twice.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom'
import { describe, it, expect, vi, beforeAll, beforeEach, afterAll } from 'vitest'
import i18n from 'i18next'

import ar from '@/locales/ar.json'
import type * as ApiModule from '@/lib/api'
import type * as AuthContextModule from '@/lib/authContext'
import { api } from '@/lib/api'
import { BookRecordPage } from './BookRecordPage'
import { QueueNav } from './QueueNav'
import { RecordDeleteProvider } from './RecordDeleteProvider'
import { KeyboardShortcutsProvider } from '@/lib/keyboardShortcuts'

const mockHas = vi.fn<(cap: string) => boolean>(() => false)

vi.mock('@/lib/api', async (orig) => {
  const real = await orig<typeof ApiModule>()
  return {
    ...real,
    api: {
      ...real.api,
      listAwaitingBooks: vi.fn().mockResolvedValue([]),
      getBook: vi.fn(),
      getBookVersionFields: vi.fn().mockResolvedValue({ fields: {} }),
      getEmployee: vi.fn().mockResolvedValue({ name_en: 'SAEED ALYAHYAEE', name_ar: 'سعيد' }),
      listBookAnnotations: vi.fn().mockResolvedValue([]),
      listBookClassifications: vi.fn().mockResolvedValue([]),
      markBookSeen: vi.fn().mockResolvedValue(undefined),
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
// The desk canvas is pdf.js — irrelevant to a header action and unrenderable
// in jsdom.
vi.mock('@/pages/application/DocPdfCanvas', () => ({
  default: () => <div data-testid="doc-pdf-canvas" />,
}))

describe('QueueNav (English)', () => {
  it('renders the position and both arrows for a middle book', () => {
    render(<QueueNav position={2} total={3} onPrev={vi.fn()} onNext={vi.fn()} />)
    expect(screen.getByTestId('queue-position')).toHaveTextContent('2 of 3')
    expect(screen.getByTestId('queue-prev')).toBeEnabled()
    expect(screen.getByTestId('queue-next')).toBeEnabled()
  })

  it('renders nothing when the queue holds fewer than two books', () => {
    const { container } = render(
      <QueueNav position={1} total={1} onPrev={vi.fn()} onNext={vi.fn()} />,
    )
    expect(container).toBeEmptyDOMElement()
  })

  it('renders nothing when the book is not in the queue', () => {
    const { container } = render(
      <QueueNav position={null} total={5} onPrev={vi.fn()} onNext={vi.fn()} />,
    )
    expect(container).toBeEmptyDOMElement()
  })

  it('disables the edge arrow at the head and the tail', () => {
    const { rerender } = render(
      <QueueNav position={1} total={3} onPrev={vi.fn()} onNext={vi.fn()} />,
    )
    expect(screen.getByTestId('queue-prev')).toBeDisabled()
    rerender(<QueueNav position={3} total={3} onPrev={vi.fn()} onNext={vi.fn()} />)
    expect(screen.getByTestId('queue-next')).toBeDisabled()
  })

  it('calls the handlers', async () => {
    const user = userEvent.setup()
    const onPrev = vi.fn()
    const onNext = vi.fn()
    render(<QueueNav position={2} total={3} onPrev={onPrev} onNext={onNext} />)
    await user.click(screen.getByTestId('queue-prev'))
    await user.click(screen.getByTestId('queue-next'))
    expect(onPrev).toHaveBeenCalledTimes(1)
    expect(onNext).toHaveBeenCalledTimes(1)
  })
})

describe('QueueNav (Arabic)', () => {
  beforeAll(async () => {
    i18n.addResourceBundle('ar', 'translation', ar, true, true)
    await i18n.changeLanguage('ar')
  })
  afterAll(async () => {
    await i18n.changeLanguage('en')
  })

  it('labels and counter are Arabic, not English', () => {
    render(<QueueNav position={2} total={3} onPrev={vi.fn()} onNext={vi.fn()} />)
    expect(screen.getByLabelText('السجل السابق')).toBeInTheDocument()
    expect(screen.getByLabelText('السجل التالي')).toBeInTheDocument()
    expect(screen.getByTestId('queue-position')).toHaveTextContent('2 من 3')
  })

  it('isolates only the numbers, never the whole sentence (an LTR isolate reverses "n من total")', () => {
    render(<QueueNav position={2} total={3} onPrev={vi.fn()} onNext={vi.fn()} />)
    const counter = screen.getByTestId('queue-position')
    const isolates = Array.from(counter.querySelectorAll('bdi[dir="ltr"]'))
    expect(isolates.map((el) => el.textContent)).toEqual(['2', '3'])
    expect(counter.textContent).toBe('2 من 3')
  })

  it('compact form stays one LTR isolate "n/total"', () => {
    render(<QueueNav position={2} total={3} compact onPrev={vi.fn()} onNext={vi.fn()} />)
    const isolates = Array.from(screen.getByTestId('queue-position').querySelectorAll('bdi[dir="ltr"]'))
    expect(isolates.map((el) => el.textContent)).toEqual(['2/3'])
  })
})


// ---------------------------------------------------------------------------
// "Email via Outlook" — the record's own handoff entry point.
// ---------------------------------------------------------------------------

/** An approved record whose current version has a generated PDF ("has papers"). */
function recordFixture(overrides: Record<string, unknown> = {}): unknown {
  return {
    id: 48,
    ref_number: 'GS-0048',
    subject: 'خطاب تحويل — SAEED ALYAHYAEE',
    employee_id: 'G-1234',
    classification_code: null,
    original_creator_user_id: 99,
    approval_state: 'approved',
    signing_path: null,
    is_word_book: false,
    submitted_by_name: 'Operator',
    submitted_by_g: null,
    created_at: '2026-08-01T09:00:00Z',
    approval_steps: [],
    sms: [],
    imported_doc: null,
    versions: [
      {
        id: 5,
        version_no: 1,
        status: 'approved',
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

function LedgerProbe(): React.JSX.Element {
  const location = useLocation()
  return <output data-testid="ledger-state">{JSON.stringify(location.state)}</output>
}

function renderRecord(): void {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={['/books/48']}>
        <RecordDeleteProvider>
          <Routes>
            <Route path="/books/:id" element={<BookRecordPage />} />
            <Route path="/ledger" element={<LedgerProbe />} />
          </Routes>
        </RecordDeleteProvider>
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

describe('BookRecordPage — Email via Outlook', () => {
  beforeEach(() => {
    mockHas.mockImplementation(() => false)
    vi.mocked(api.getBook).mockReset()
  })

  it('hands a record with papers to the ledger as a one-item basket prefill', async () => {
    vi.mocked(api.getBook).mockResolvedValue(recordFixture() as never)
    renderRecord()

    // The action lives in the Tools dropdown; the trigger only paints once the
    // book query resolves. Open it, then wait for eligibility, not the node.
    await userEvent.click(await screen.findByRole('button', { name: 'Tools' }))
    const action = await screen.findByRole('menuitem', { name: 'Email via Outlook' })
    await waitFor(() => expect(action).not.toHaveAttribute('aria-disabled', 'true'))
    await userEvent.click(action)

    const state = JSON.parse(
      (await screen.findByTestId('ledger-state')).textContent || 'null',
    ) as {
      composePrefill: {
        references: unknown[]
        attachRefPdf: boolean
        subject: string
        basketKey?: string
      }
    }
    // Exactly the basket flow with this record as the single item: the book
    // reference carries the ref token plus the backing document, and the
    // reference PDF rides along (which is what forces draft mode downstream).
    expect(state.composePrefill.references).toEqual([
      {
        kind: 'book',
        id: 48,
        label: 'GS-0048',
        token: 'GS-0048',
        docId: 900,
        fileName: expect.stringContaining('GS-0048'),
      },
    ])
    expect(state.composePrefill.attachRefPdf).toBe(true)
    expect(state.composePrefill.subject).not.toBe('')
    // A record emailed from its own page is NOT a basket send. Naming a basket
    // here would let a successful handoff clear a same-kind basket the operator
    // is still filling, so the synthetic prefill must not carry one.
    expect(state.composePrefill.basketKey).toBeFalsy()
  })

  it('disables the action for a record with no papers to attach', async () => {
    vi.mocked(api.getBook).mockResolvedValue(recordFixture({ versions: [] }) as never)
    renderRecord()
    await userEvent.click(await screen.findByRole('button', { name: 'Tools' }))
    expect(await screen.findByRole('menuitem', { name: /^Email via Outlook/ })).toHaveAttribute(
      'aria-disabled',
      'true',
    )
  })
})

// ---------------------------------------------------------------------------
// J / K and Back — the list-originated navigation state.
// ---------------------------------------------------------------------------

function NavProbe(): React.JSX.Element {
  const location = useLocation()
  return (
    <>
      <output data-testid="loc">{`${location.pathname}${location.search}`}</output>
      <output data-testid="loc-state">{JSON.stringify(location.state)}</output>
    </>
  )
}

const LIST_STATE = { from: '/books?status=pending&open=47', queue: [47, 48, 49], scrollY: 120 }

function renderFromList(initialId = 48): void {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[{ pathname: `/books/${initialId}`, state: LIST_STATE }]}>
        <KeyboardShortcutsProvider>
          <RecordDeleteProvider>
            <Routes>
              <Route path="/books/:id" element={<><NavProbe /><BookRecordPage /></>} />
              <Route path="/books" element={<NavProbe />} />
            </Routes>
          </RecordDeleteProvider>
        </KeyboardShortcutsProvider>
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

describe('BookRecordPage — J / K and Back', () => {
  beforeEach(() => {
    mockHas.mockImplementation(() => false)
    vi.mocked(api.getBook).mockReset()
    vi.mocked(api.getBook).mockImplementation(
      async (id: number) =>
        recordFixture({ id, ref_number: `GS-00${id}`, approval_state: 'pending' }) as never,
    )
  })

  it('J and K step through the list queue, replacing the entry and forwarding the state', async () => {
    renderFromList(48)
    await screen.findByTestId('queue-position')
    expect(screen.getByTestId('queue-position')).toHaveTextContent('2 of 3')

    fireEvent.keyDown(document.body, { key: 'j', code: 'KeyJ' })
    await waitFor(() => expect(screen.getByTestId('loc')).toHaveTextContent('/books/49'))
    // The list state travels with the step unchanged (`open` is only stripped on Back).
    expect(JSON.parse(screen.getByTestId('loc-state').textContent ?? 'null')).toEqual(LIST_STATE)
    await waitFor(() => expect(screen.getByTestId('queue-position')).toHaveTextContent('3 of 3'))

    // J at the tail declines: nothing moves.
    fireEvent.keyDown(document.body, { key: 'j', code: 'KeyJ' })
    expect(screen.getByTestId('loc')).toHaveTextContent('/books/49')

    fireEvent.keyDown(document.body, { key: 'k', code: 'KeyK' })
    await waitFor(() => expect(screen.getByTestId('loc')).toHaveTextContent('/books/48'))
  })

  it('Back returns to the originating list focused on the record the reader ended on', async () => {
    renderFromList(48)
    fireEvent.keyDown(document.body, { key: 'j', code: 'KeyJ' })
    await waitFor(() => expect(screen.getByTestId('loc')).toHaveTextContent('/books/49'))

    await userEvent.click(await screen.findByRole('button', { name: /^Back to records/ }))

    await waitFor(() => expect(screen.getByTestId('loc')).toHaveTextContent(/^\/books\?status=pending$/))
    expect(JSON.parse(screen.getByTestId('loc-state').textContent ?? 'null')).toEqual({
      focusBookId: 49,
      scrollY: 120,
    })
  })

  it('a click on the queue arrows steps the same way', async () => {
    renderFromList(48)
    await userEvent.click(await screen.findByTestId('queue-next'))
    await waitFor(() => expect(screen.getByTestId('loc')).toHaveTextContent('/books/49'))
  })
})
