/**
 * Record page keys and optimistic feedback:
 *  - the single `escape` resolver (focus mode → exit focus and STAY on the
 *    record; the next Esc goes Back);
 *  - C copies the ref, S opens the sign confirm (decide only, never signs);
 *  - an annotation create shows at once, rolls back when the request fails.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type * as ApiModule from '@/lib/api'
import type * as AuthContextModule from '@/lib/authContext'
import { api } from '@/lib/api'
import { KeyboardShortcutsProvider } from '@/lib/keyboardShortcuts'
import { BookRecordPage } from './BookRecordPage'
import { RecordDeleteProvider } from './RecordDeleteProvider'
import { FOCUS_STORAGE_KEY } from './record/RecordChrome'

const mockHas = vi.fn<(cap: string) => boolean>(() => false)
const { copyToClipboard, toastError, toastSuccess } = vi.hoisted(() => ({
  copyToClipboard: vi.fn().mockResolvedValue(true),
  toastError: vi.fn(),
  toastSuccess: vi.fn(),
}))

vi.mock('@/lib/api', async (orig) => {
  const real = await orig<typeof ApiModule>()
  return {
    ...real,
    api: {
      ...real.api,
      getBook: vi.fn(),
      signBook: vi.fn(),
      createBookAnnotation: vi.fn(),
      listBookAnnotations: vi.fn(),
      getBookVersionFields: vi.fn().mockResolvedValue({ fields: {} }),
      getEmployee: vi.fn().mockResolvedValue({ name_en: 'SAEED', name_ar: 'سعيد' }),
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
vi.mock('@/lib/clipboard', () => ({ copyToClipboard }))
vi.mock('sonner', () => ({
  toast: Object.assign(vi.fn(), {
    success: toastSuccess,
    error: toastError,
    dismiss: vi.fn(),
    loading: vi.fn(),
  }),
}))
// The desk is S3's piece: a stand-in that creates a mark and lists the cached ones
// is enough to exercise the page's optimistic mutation.
vi.mock('./record/RecordDesk', () => ({
  RecordDesk: ({
    view,
    actions,
  }: {
    view: { annotations: Array<{ id: number; comment: string | null }> }
    actions: { createMark: (m: unknown) => void }
  }) => (
    <div>
      <button
        type="button"
        onClick={() =>
          actions.createMark({ page: 1, kind: 'pin', geometry: { x: 0.1, y: 0.2 }, comment: 'Fix the date' })
        }
      >
        add mark
      </button>
      <ul data-testid="marks">
        {view.annotations.map((a) => (
          <li key={a.id}>{a.comment}</li>
        ))}
      </ul>
    </div>
  ),
  DecisionReasonForm: () => null,
}))

function fixture(overrides: Record<string, unknown> = {}): unknown {
  return {
    id: 48,
    ref_number: 'GS-0048',
    subject: 'Leave request',
    approval_state: 'pending',
    access_scope: 'full',
    signing_path: null,
    is_word_book: false,
    is_draft: false,
    voided_at: null,
    edit_session: null,
    created_by_user_id: 3,
    created_by_name: 'Aisha Operator',
    submitted_by_user_id: 3,
    submitted_by_name: 'Aisha Operator',
    created_at: '2026-08-01T09:00:00Z',
    approval_steps: [],
    sms: [],
    imported_doc: null,
    versions: [
      {
        id: 5,
        version_no: 1,
        status: 'pending',
        document_id: 900,
        template_id: 'Leave Form',
        has_fields: true,
        pdf_url: '/api/v1/documents/900/download?format=pdf',
        signed_pdf_url: null,
        signed_source: null,
        created_at: '2026-08-01T09:00:00Z',
        created_by_name: 'Aisha Operator',
        approval_steps: [
          { id: 1, state: 'pending', kind: 'approver', assignee_user_id: 7, assignee_name: 'Me' },
        ],
      },
    ],
    ...overrides,
  }
}

function LocationProbe(): React.JSX.Element {
  const location = useLocation()
  return <output data-testid="loc">{`${location.pathname}${location.search}`}</output>
}

function renderRecord(): void {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={['/books/48']}>
        <KeyboardShortcutsProvider>
          <RecordDeleteProvider>
            <Routes>
              <Route
                path="/books/:id"
                element={
                  <>
                    <LocationProbe />
                    <BookRecordPage />
                  </>
                }
              />
              <Route path="/books" element={<LocationProbe />} />
            </Routes>
          </RecordDeleteProvider>
        </KeyboardShortcutsProvider>
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

const press = (key: string, code: string): void => {
  fireEvent.keyDown(document.body, { key, code })
}

describe('BookRecordPage — keys', () => {
  beforeEach(() => {
    mockHas.mockImplementation((cap) => cap === 'books.approve')
    vi.mocked(api.getBook).mockReset()
    vi.mocked(api.getBook).mockResolvedValue(fixture() as never)
    vi.mocked(api.signBook).mockReset()
    vi.mocked(api.listBookAnnotations).mockResolvedValue([])
    copyToClipboard.mockClear()
    toastSuccess.mockClear()
    window.sessionStorage.clear()
  })
  afterEach(() => {
    window.sessionStorage.clear()
  })

  it('Esc exits focus mode and stays on the record; a second Esc goes Back', async () => {
    window.sessionStorage.setItem(FOCUS_STORAGE_KEY, '1')
    renderRecord()

    await waitFor(() =>
      expect(document.querySelector('[data-record-header="focus"]')).not.toBeNull(),
    )
    // Focus bar: the sign primary is never hidden.
    expect(await screen.findByRole('button', { name: 'Sign & approve' })).toBeVisible()

    press('Escape', 'Escape')
    await waitFor(() => expect(document.querySelector('[data-record-header="focus"]')).toBeNull())
    expect(screen.getByTestId('loc')).toHaveTextContent(/^\/books\/48$/)
    expect(window.sessionStorage.getItem(FOCUS_STORAGE_KEY)).toBeNull()

    press('Escape', 'Escape')
    await waitFor(() => expect(screen.getByTestId('loc')).toHaveTextContent(/^\/books$/))
  })

  it('C copies the reference number and confirms with a toast', async () => {
    renderRecord()
    await screen.findByTestId('record-meta')

    press('c', 'KeyC')
    await waitFor(() => expect(copyToClipboard).toHaveBeenCalledWith('GS-0048'))
    await waitFor(() => expect(toastSuccess).toHaveBeenCalled())
    expect(String(toastSuccess.mock.calls[0][0])).toContain('GS-0048')
  })

  it('S opens the sign confirmation for the decider and never signs', async () => {
    renderRecord()
    await screen.findByRole('button', { name: 'Sign & approve' })

    press('s', 'KeyS')
    const dialog = await screen.findByRole('dialog')
    expect(within(dialog).getByText(/GS-0048/)).toBeVisible()
    expect(api.signBook).not.toHaveBeenCalled()
  })

  it('S does nothing when the viewer cannot decide', async () => {
    mockHas.mockImplementation(() => false)
    renderRecord()
    await screen.findByTestId('record-meta')

    press('s', 'KeyS')
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })
})

describe('BookRecordPage — optimistic marks', () => {
  beforeEach(() => {
    mockHas.mockImplementation(() => false)
    vi.mocked(api.getBook).mockReset()
    vi.mocked(api.getBook).mockResolvedValue(fixture({ approval_state: 'returned' }) as never)
    vi.mocked(api.createBookAnnotation).mockReset()
    vi.mocked(api.listBookAnnotations).mockReset()
    toastError.mockClear()
  })

  it('shows the mark before the request resolves and keeps it once saved', async () => {
    let resolveCreate: (value: unknown) => void = () => {}
    vi.mocked(api.createBookAnnotation).mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveCreate = resolve
        }) as never,
    )
    vi.mocked(api.listBookAnnotations).mockResolvedValue([])
    renderRecord()

    await userEvent.click(await screen.findByRole('button', { name: 'add mark' }))
    // The request is still in flight, yet the mark is already listed.
    expect(await within(screen.getByTestId('marks')).findByText('Fix the date')).toBeVisible()
    expect(api.createBookAnnotation).toHaveBeenCalledTimes(1)

    vi.mocked(api.listBookAnnotations).mockResolvedValue([
      {
        id: 91,
        version_id: 5,
        page: 1,
        kind: 'pin',
        geometry: { x: 0.1, y: 0.2 },
        comment: 'Fix the date',
        author_user_id: 7,
        author_name: 'Me',
        created_at: '2026-08-03T09:00:00Z',
      },
    ])
    resolveCreate({ id: 91 })
    await waitFor(() => expect(api.listBookAnnotations).toHaveBeenCalledTimes(2))
    expect(await within(screen.getByTestId('marks')).findByText('Fix the date')).toBeVisible()
    expect(within(screen.getByTestId('marks')).getAllByRole('listitem')).toHaveLength(1)
  })

  it('rolls the mark back and reports the error when the request fails', async () => {
    let rejectCreate: (reason: unknown) => void = () => {}
    vi.mocked(api.createBookAnnotation).mockImplementation(
      () =>
        new Promise((_resolve, reject) => {
          rejectCreate = reject
        }) as never,
    )
    vi.mocked(api.listBookAnnotations).mockResolvedValue([])
    renderRecord()

    await userEvent.click(await screen.findByRole('button', { name: 'add mark' }))
    expect(await within(screen.getByTestId('marks')).findByText('Fix the date')).toBeVisible()

    rejectCreate(new Error('boom'))
    await waitFor(() =>
      expect(within(screen.getByTestId('marks')).queryByText('Fix the date')).not.toBeInTheDocument(),
    )
    expect(toastError).toHaveBeenCalled()
  })
})
