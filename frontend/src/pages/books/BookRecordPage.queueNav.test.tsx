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
import { render, screen, waitFor } from '@testing-library/react'
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
import { nextAfterDecision } from './useAwaitingQueue'

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
    expect(screen.getByLabelText('السجل السابق بانتظار الاعتماد')).toBeInTheDocument()
    expect(screen.getByLabelText('السجل التالي بانتظار الاعتماد')).toBeInTheDocument()
    expect(screen.getByTestId('queue-position')).toHaveTextContent('2 من 3')
  })
})

describe('nextAfterDecision', () => {
  it('advances to the next awaiting book', () => {
    expect(nextAfterDecision(42)).toBe('/books/42')
  })

  it('falls back to the list when the queue is empty', () => {
    expect(nextAfterDecision(null)).toBe('/books')
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
        <Routes>
          <Route path="/books/:id" element={<BookRecordPage />} />
          <Route path="/ledger" element={<LedgerProbe />} />
        </Routes>
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

    // The header paints before the book query resolves, so the action exists
    // (disabled) from the first frame. Wait for eligibility, not for the node.
    const action = await screen.findByRole('button', { name: 'Email via Outlook' })
    await waitFor(() => expect(action).toBeEnabled())
    await userEvent.click(action)

    const state = JSON.parse(
      (await screen.findByTestId('ledger-state')).textContent || 'null',
    ) as { composePrefill: { references: unknown[]; attachRefPdf: boolean; subject: string } }
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
  })

  it('disables the action for a record with no papers to attach', async () => {
    vi.mocked(api.getBook).mockResolvedValue(recordFixture({ versions: [] }) as never)
    renderRecord()
    expect(await screen.findByRole('button', { name: 'Email via Outlook' })).toBeDisabled()
  })
})
