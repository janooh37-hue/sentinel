/**
 * The list-originated RecordNavState (queue / from / scrollY in
 * `location.state`) must survive every in-record navigation that rewrites the
 * URL: picking a paper, opening an overlay, and "Review next".
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom'
import { describe, it, expect, vi, beforeEach } from 'vitest'

import type * as ApiModule from '@/lib/api'
import type * as AuthContextModule from '@/lib/authContext'
import { api } from '@/lib/api'
import { KeyboardShortcutsProvider } from '@/lib/keyboardShortcuts'
import { BookRecordPage } from './BookRecordPage'
import { RecordDeleteProvider } from './RecordDeleteProvider'

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
      listApprovers: vi.fn().mockResolvedValue([]),
      listReviewerCandidates: vi.fn().mockResolvedValue([]),
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

const STEP = {
  id: 1,
  step_order: 1,
  stage_label: 'Manager',
  assignee_user_id: 7,
  state: 'pending',
  note: null,
  decided_at: null,
  kind: 'approver',
}

function record(id: number, overrides: Record<string, unknown> = {}, signed = false): unknown {
  return {
    id,
    ref_number: `GS-00${id}`,
    subject: 'Test book subject',
    employee_id: 'G-1234',
    classification_code: null,
    original_creator_user_id: 99,
    approval_state: signed ? 'approved' : 'pending',
    signing_path: null,
    is_word_book: false,
    submitted_by_name: 'Operator',
    submitted_by_g: null,
    created_at: '2026-08-01T09:00:00Z',
    access_scope: 'full',
    approval_steps: signed ? [] : [STEP],
    sms: [],
    imported_doc: null,
    versions: [
      {
        id: 5,
        version_no: 1,
        status: signed ? 'approved' : 'pending',
        document_id: 900,
        template_id: 'General Book',
        has_fields: true,
        pdf_url: '/api/v1/documents/900/download?format=pdf',
        signed_pdf_url: signed ? '/api/v1/documents/900/signed.pdf' : null,
        signed_source: signed ? 'generated' : null,
        created_at: '2026-08-01T09:00:00Z',
        created_by_name: 'Operator',
        approval_steps: signed ? [] : [STEP],
      },
    ],
    ...overrides,
  }
}

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

function renderFromList(): void {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[{ pathname: '/books/48', state: LIST_STATE }]}>
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

const stateNow = (): unknown => JSON.parse(screen.getByTestId('loc-state').textContent ?? 'null')

beforeEach(() => {
  mockHas.mockReset()
  mockHas.mockImplementation(() => false)
  vi.mocked(api.getBook).mockReset()
  vi.mocked(api.signBook).mockReset()
  vi.mocked(api.listApprovalLog).mockReset()
  vi.mocked(api.listApprovalLog).mockResolvedValue({ items: [], total: 0 } as never)
})

describe('BookRecordPage — nav state survives in-record navigation', () => {
  it('select paper → J still steps the queue → Back returns to the list', async () => {
    // An approved record with a signed copy has two papers, so the switcher shows.
    vi.mocked(api.getBook).mockImplementation(async (id: number) => record(id, {}, true) as never)
    renderFromList()
    await screen.findByTestId('queue-position')

    await waitFor(() =>
      expect(document.querySelector('[data-paper-switcher]')).not.toBeNull(),
    )
    const switcher = document.querySelector<HTMLElement>('[data-paper-switcher]')!
    await userEvent.click(within(switcher).getByRole('button', { name: 'Original (unsigned)' }))
    await waitFor(() => expect(screen.getByTestId('loc')).toHaveTextContent('paper='))
    expect(stateNow()).toEqual(LIST_STATE)
    expect(screen.getByTestId('queue-position')).toHaveTextContent('2 of 3')

    fireEvent.keyDown(document.body, { key: 'j', code: 'KeyJ' })
    await waitFor(() => expect(screen.getByTestId('loc')).toHaveTextContent('/books/49'))
    await waitFor(() => expect(screen.getByTestId('queue-position')).toHaveTextContent('3 of 3'))

    await userEvent.click(await screen.findByRole('button', { name: /^Back to records/ }))
    await waitFor(() =>
      expect(screen.getByTestId('loc')).toHaveTextContent(/^\/books\?status=pending$/),
    )
    expect(stateNow()).toMatchObject({ focusBookId: 49, scrollY: 120 })
  })

  it('opening a decision overlay keeps the queue context', async () => {
    mockHas.mockImplementation((cap) => cap === 'books.submit')
    vi.mocked(api.getBook).mockImplementation(async (id: number) => record(id) as never)
    renderFromList()
    await screen.findByTestId('queue-position')

    await userEvent.click(await screen.findByRole('button', { name: 'Change approver…' }))
    await waitFor(() => expect(screen.getByTestId('loc')).toHaveTextContent('action=submit'))
    expect(stateNow()).toEqual({ ...LIST_STATE, overlay: true })
    expect(screen.getByTestId('queue-position')).toHaveTextContent('2 of 3')
  })

  it('"Review next" carries the queue context to the next record', async () => {
    mockHas.mockImplementation((cap) => cap === 'books.approve')
    let signed = false
    vi.mocked(api.getBook).mockImplementation(async (id: number) => record(id, {}, signed) as never)
    vi.mocked(api.signBook).mockImplementation(async () => {
      signed = true
      return record(48, {}, true) as never
    })
    vi.mocked(api.listApprovalLog).mockResolvedValue({
      items: [{ book_id: 49, version_id: 5, ref_number: 'GS-0049' }],
      total: 1,
    } as never)
    renderFromList()

    await userEvent.click(await screen.findByRole('button', { name: 'Sign & approve' }))
    await screen.findByText('Sign & approve this record?')
    const confirmBtns = screen.getAllByRole('button', { name: 'Sign & approve' })
    await userEvent.click(confirmBtns[confirmBtns.length - 1])

    await userEvent.click(await screen.findByRole('button', { name: /Review next/ }))
    await waitFor(() => expect(screen.getByTestId('loc')).toHaveTextContent('/books/49'))
    expect(stateNow()).toEqual(LIST_STATE)
  })
})
