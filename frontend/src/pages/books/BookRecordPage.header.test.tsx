/**
 * Record page header: who created the record (every form type), the submitter
 * only when it differs, the two-row desktop shape, the phone status line and
 * the tab title.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import i18n from 'i18next'
import ar from '@/locales/ar.json'

import type * as ApiModule from '@/lib/api'
import type * as AuthContextModule from '@/lib/authContext'
import { api } from '@/lib/api'
import { BookRecordPage } from './BookRecordPage'
import { RecordDeleteProvider } from './RecordDeleteProvider'
import { BookPreview } from '@/components/books/BookPreview'

const mockHas = vi.fn<(cap: string) => boolean>(() => false)
const viewport = vi.hoisted(() => ({ mobile: false }))

vi.mock('@/lib/api', async (orig) => {
  const real = await orig<typeof ApiModule>()
  return {
    ...real,
    api: {
      ...real.api,
      getBook: vi.fn(),
      getBookThread: vi.fn().mockResolvedValue([]),
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
vi.mock('@/lib/useIsMobile', () => ({ useIsMobile: () => viewport.mobile }))
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
    subject: 'Leave request — SAEED',
    approval_state: 'returned',
    access_scope: 'full',
    can_write: true,
    signing_path: null,
    is_word_book: false,
    is_draft: false,
    voided_at: null,
    edit_session: null,
    created_by_user_id: 7,
    created_by_name: 'Aisha Operator',
    created_by_g: 'G-1234',
    submitted_by_user_id: 7,
    submitted_by_name: 'Aisha Operator',
    created_at: '2026-08-01T09:00:00Z',
    approval_steps: [],
    sms: [],
    imported_doc: null,
    versions: [
      {
        id: 5,
        version_no: 1,
        status: 'returned',
        document_id: 900,
        template_id: 'Leave Form',
        has_fields: true,
        pdf_url: '/api/v1/documents/900/download?format=pdf',
        signed_pdf_url: null,
        signed_source: null,
        created_at: '2026-08-01T09:00:00Z',
        created_by_name: 'Aisha Operator',
        approval_steps: [
          {
            id: 1,
            state: 'returned',
            kind: 'approver',
            note: 'Fix the dates',
            assignee_user_id: 3,
            assignee_name: 'Manager Khalid',
            decided_at: '2026-08-02T09:00:00Z',
          },
        ],
      },
    ],
    ...overrides,
  }
}

function renderRecord(entry = '/books/48'): void {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={[entry]}>
        <RecordDeleteProvider>
          <Routes>
            <Route path="/books/:id" element={<BookRecordPage />} />
          </Routes>
        </RecordDeleteProvider>
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

describe('BookRecordPage — header', () => {
  afterEach(async () => {
    vi.unstubAllGlobals()
    await i18n.changeLanguage('en')
  })
  beforeEach(() => {
    viewport.mobile = false
    mockHas.mockImplementation(() => false)
    vi.mocked(api.getBook).mockReset()
  })

  it.each([
    [false, 'en', 'Department', 'Operations'],
    [true, 'en', 'Department', 'Operations'],
    [false, 'ar', 'القسم', 'العمليات'],
    [true, 'ar', 'القسم', 'العمليات'],
  ] as const)('shows the owning department (mobile=%s, language=%s)', async (mobile, language, label, name) => {
    i18n.addResourceBundle('ar', 'translation', ar)
    await i18n.changeLanguage(language)
    viewport.mobile = mobile
    vi.mocked(api.getBook).mockResolvedValue(fixture({
      department_id: 3, department_name_en: 'Operations', department_name_ar: 'العمليات',
    }) as never)
    renderRecord()
    const meta = await screen.findByTestId('record-meta')
    expect(meta).toHaveTextContent(label)
    expect(meta).toHaveTextContent(name)
  })

  it('omits the department row when no department is present', async () => {
    vi.mocked(api.getBook).mockResolvedValue(fixture() as never)
    renderRecord()
    expect(await screen.findByTestId('record-meta')).not.toHaveTextContent('Department')
  })

  it.each([['en', 'Operations'], ['ar', 'العمليات']] as const)('shows the draft preview department in %s', async (language, name) => {
    i18n.addResourceBundle('ar', 'translation', ar)
    await i18n.changeLanguage(language)
    vi.mocked(api.getBook).mockResolvedValue(fixture({
      department_id: 3, department_name_en: 'Operations', department_name_ar: 'العمليات',
    }) as never)
    render(
      <QueryClientProvider client={new QueryClient()}>
        <MemoryRouter>
          <RecordDeleteProvider>
            <BookPreview bookId={48} onClose={vi.fn()} onSubmitForApproval={vi.fn()} />
          </RecordDeleteProvider>
        </MemoryRouter>
      </QueryClientProvider>,
    )
    expect(await screen.findByText(name)).toBeVisible()
  })

  it.each([false, true])('hides Link from the record tools and denies its URL overlay without books.edit (mobile=%s)', async (mobile) => {
    viewport.mobile = mobile
    mockHas.mockImplementation((cap) => cap === 'books.create' || cap === 'books.view' || cap === 'books.service.General Book')
    vi.mocked(api.getBook).mockResolvedValue(fixture() as never)
    renderRecord('/books/48?action=link')
    await screen.findByTestId('record-meta')
    expect(screen.queryByRole('dialog')).toBeNull()
    await userEvent.click(screen.getByRole('button', { name: mobile ? 'More' : 'Tools' }))
    const menu = await screen.findByRole(mobile ? 'dialog' : 'menu')
    expect(within(menu).queryByText('Link a record')).toBeNull()
    expect(within(menu).getByText('Reply')).toBeVisible()
    expect(within(menu).getByText('Create from')).toBeVisible()
  })

  it('shows who created a non-Word record, with G number and date', async () => {
    vi.mocked(api.getBook).mockResolvedValue(fixture() as never)
    renderRecord()

    const meta = await screen.findByTestId('record-meta')
    expect(meta).toHaveTextContent('Created by')
    expect(within(meta).getByTestId('record-creator')).toHaveTextContent('Aisha Operator')
    expect(meta).toHaveTextContent('G-1234')
    expect(meta).toHaveTextContent('2026-08-01')
  })

  it('adds the submitter only when it differs from the creator', async () => {
    vi.mocked(api.getBook).mockResolvedValue(
      fixture({ submitted_by_user_id: 9, submitted_by_name: 'Omar Clerk' }) as never,
    )
    renderRecord()

    const meta = await screen.findByTestId('record-meta')
    expect(meta).toHaveTextContent('Submitted by')
    expect(within(meta).getByTestId('record-submitter')).toHaveTextContent('Omar Clerk')
  })

  it('omits the submitter when it is the creator', async () => {
    vi.mocked(api.getBook).mockResolvedValue(fixture() as never)
    renderRecord()

    const meta = await screen.findByTestId('record-meta')
    expect(meta).not.toHaveTextContent('Submitted by')
    expect(screen.queryByTestId('record-submitter')).not.toBeInTheDocument()
  })

  it('says "Not recorded" when the creator is unknown', async () => {
    vi.mocked(api.getBook).mockResolvedValue(
      fixture({ created_by_name: null, created_by_user_id: null, created_by_g: null }) as never,
    )
    renderRecord()

    expect(await screen.findByTestId('record-creator')).toHaveTextContent('Not recorded')
  })

  it('keeps the desktop header to two rows: identity + utilities, then the next step', async () => {
    // Wide enough for the docked rail (aria-expanded reflects the docked state).
    vi.stubGlobal('innerWidth', 1440)
    vi.mocked(api.getBook).mockResolvedValue(fixture() as never)
    mockHas.mockImplementation((cap) => cap === 'books.edit' || cap === 'documents.generate')
    renderRecord()

    await screen.findByTestId('record-meta')
    const rows = document.querySelectorAll('[data-header-row]')
    expect(Array.from(rows, (row) => row.getAttribute('data-header-row'))).toEqual(['a', 'b'])
    const rowB = document.querySelector('[data-header-row="b"]') as HTMLElement
    expect(rowB).toHaveTextContent('Returned by')
    expect(rowB).toHaveTextContent('Fix the dates')
    expect(within(rowB).getByRole('button', { name: 'Revise & resubmit' })).toBeVisible()
    // The chips and the state pill live in Row A's identity block, not a third row.
    expect(
      within(document.querySelector('[data-header-row="a"]') as HTMLElement).getByTestId('record-state-pill'),
    ).toBeVisible()
    // Row A's utilities: rail toggle (aria-expanded) and Tools.
    const rowA = document.querySelector('[data-header-row="a"]') as HTMLElement
    expect(within(rowA).getByRole('button', { name: 'Hide progress' })).toHaveAttribute('aria-expanded', 'true')
    expect(within(rowA).getByRole('button', { name: 'Tools' })).toBeVisible()
  })

  it('on a phone, shows the status line with the quote and no Tools or workflow bar', async () => {
    viewport.mobile = true
    vi.mocked(api.getBook).mockResolvedValue(fixture() as never)
    renderRecord()

    const status = await screen.findByTestId('record-status-line')
    expect(status).toHaveTextContent('Returned by')
    expect(status).toHaveTextContent('Manager Khalid')
    expect(within(screen.getByTestId('record-status-line').parentElement!).getByText('Fix the dates')).toBeVisible()
    expect(screen.queryByRole('button', { name: 'Tools' })).not.toBeInTheDocument()
    expect(document.querySelector('[data-header-row]')).toBeNull()
    expect(screen.getByTestId('record-creator')).toHaveTextContent('Aisha Operator')
  })

  it('titles the tab "<ref> · <subject> — GSSG" and restores the title on unmount', async () => {
    document.title = 'GSSG Manager'
    vi.mocked(api.getBook).mockResolvedValue(fixture() as never)
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    const { unmount } = render(
      <QueryClientProvider client={qc}>
        <MemoryRouter initialEntries={['/books/48']}>
          <RecordDeleteProvider>
            <Routes>
              <Route path="/books/:id" element={<BookRecordPage />} />
            </Routes>
          </RecordDeleteProvider>
        </MemoryRouter>
      </QueryClientProvider>,
    )
    await screen.findByTestId('record-meta')
    expect(document.title).toBe('GS-0048 · Leave request — SAEED — GSSG')
    unmount()
    expect(document.title).toBe('GSSG Manager')
  })
})
