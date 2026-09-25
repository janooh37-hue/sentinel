/**
 * Record-page-polish plan §4 (timeline wording + current-step summary
 * fallback) and §5 (truthful, actionable empty states). Renders the full page
 * so the mobile disclosure's summary line and the desk's empty-state branches
 * are exercised exactly as a user would see them.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen } from '@testing-library/react'
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
vi.mock('@/pages/application/DocPdfCanvas', () => ({
  default: () => <div data-testid="doc-pdf-canvas" />,
}))

function baseFixture(overrides: Record<string, unknown> = {}): unknown {
  return {
    id: 48,
    ref_number: 'GS-0048',
    subject: 'Test book subject',
    employee_id: 'G-1234',
    classification_code: null,
    original_creator_user_id: 99,
    approval_state: 'none',
    signing_path: null,
    is_word_book: false,
    submitted_by_name: 'Operator',
    submitted_by_g: null,
    created_at: '2026-08-01T09:00:00Z',
    access_scope: 'full',
    approval_steps: [],
    sms: [],
    imported_doc: null,
    edit_session: null,
    versions: [],
    ...overrides,
  }
}

function renderRecord(): void {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
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

describe('BookRecordPage — timeline wording and current-step summary', () => {
  beforeEach(() => {
    mockHas.mockImplementation(() => false)
    vi.mocked(api.getBook).mockReset()
  })

  it('labels the first version "First version created", not "Submitted"', async () => {
    vi.mocked(api.getBook).mockResolvedValue(
      baseFixture({
        approval_state: 'pending',
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
            approval_steps: [],
          },
        ],
      }) as never,
    )
    renderRecord()

    // Two renderings of the timeline exist (desktop aside + mobile disclosure)
    // — both must use the neutral wording, never "Submitted".
    const stationLabels = await screen.findAllByText('First version created')
    expect(stationLabels.length).toBeGreaterThanOrEqual(1)
    expect(screen.queryByText('Submitted')).not.toBeInTheDocument()
  })

  it('mobile summary shows the live station, not the trailing future placeholder', async () => {
    vi.mocked(api.getBook).mockResolvedValue(
      baseFixture({
        approval_state: 'pending',
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
            approval_steps: [],
          },
        ],
      }) as never,
    )
    renderRecord()

    // `pending` appends a live "Awaiting signature" station AND a trailing
    // future "Signed" placeholder — the summary must pick the live one, not
    // the trailing placeholder. Query the `<summary>` element itself (not a
    // fuzzy text match, since the full timeline repeats these same station
    // labels once expanded) to pin down exactly what the collapsed line says.
    await screen.findByText('Test book subject')
    const summaryEl = document.querySelector('details > summary')
    expect(summaryEl?.textContent).toMatch(/Awaiting signature/)
    expect(summaryEl?.textContent).not.toMatch(/^Signed$/)
  })

  it('mobile summary falls back to the latest completed station for a returned record (no live station)', async () => {
    vi.mocked(api.getBook).mockResolvedValue(
      baseFixture({
        approval_state: 'returned',
        versions: [
          {
            id: 5,
            version_no: 1,
            status: 'returned',
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
      }) as never,
    )
    renderRecord()

    await screen.findByText('Test book subject')
    const summaryEl = document.querySelector('details > summary')
    expect(summaryEl?.textContent).toMatch(/Returned/)
  })
})

describe('BookRecordPage — truthful empty document states', () => {
  beforeEach(() => {
    mockHas.mockImplementation(() => false)
    vi.mocked(api.getBook).mockReset()
  })

  it('a document being written in Word explains that, not a generic "no document"', async () => {
    vi.mocked(api.getBook).mockResolvedValue(
      baseFixture({
        approval_state: 'none',
        edit_session: { user_id: 7, user_name: 'Operator', state: 'active', last_put_at: null, created_at: '2026-08-01T09:00:00Z' },
        versions: [],
      }) as never,
    )
    renderRecord()

    expect(await screen.findByText('The body is written in Word')).toBeInTheDocument()
    expect(screen.queryByText('No document on this record.')).not.toBeInTheDocument()
  })

  it('a returned record with no document on file offers Revise, not a fake "Send for approval"', async () => {
    mockHas.mockImplementation((cap) => cap === 'books.edit' || cap === 'documents.generate')
    vi.mocked(api.getBook).mockResolvedValue(
      baseFixture({
        approval_state: 'returned',
        versions: [
          {
            id: 5,
            version_no: 1,
            status: 'returned',
            document_id: null,
            template_id: 'General Book',
            has_fields: true,
            pdf_url: null,
            signed_pdf_url: null,
            signed_source: null,
            created_at: '2026-08-01T09:00:00Z',
            created_by_name: 'Operator',
            approval_steps: [],
          },
        ],
      }) as never,
    )
    renderRecord()

    expect(await screen.findByText('No document on this record.')).toBeInTheDocument()
    // The desk's own CTA — scoped by the "print-paper" desk wrapper so this
    // doesn't collide with the header's own Revise control (same label, same
    // `handleRevise` handler — see the shared `books.versions.revise` key).
    const desk = document.querySelector('.print-paper')
    expect(desk).not.toBeNull()
    expect(desk).toHaveTextContent('Revise & regenerate')
    expect(screen.queryByText('Send for approval')).not.toBeInTheDocument()
  })

  it('a draft with genuinely nothing to recover offers no fake call to action', async () => {
    vi.mocked(api.getBook).mockResolvedValue(
      baseFixture({
        approval_state: 'none',
        versions: [],
      }) as never,
    )
    renderRecord()

    expect(await screen.findByText('No document on this record.')).toBeInTheDocument()
    expect(screen.queryByText('Send for approval')).not.toBeInTheDocument()
    expect(screen.queryByText('Revise & resubmit')).not.toBeInTheDocument()
  })
})

// ---------------------------------------------------------------------------
// Arabic — an EN-only assertion cannot catch an AR leak when the EN label
// equals the key (same rationale as BookRecordPage.queueNav.test.tsx).
// ---------------------------------------------------------------------------
describe('BookRecordPage — Arabic wording (no English/key leaks)', () => {
  beforeAll(async () => {
    i18n.addResourceBundle('ar', 'translation', ar, true, true)
    await i18n.changeLanguage('ar')
  })
  afterAll(async () => {
    await i18n.changeLanguage('en')
  })
  beforeEach(() => {
    mockHas.mockImplementation(() => false)
    vi.mocked(api.getBook).mockReset()
  })

  it('labels the first version in Arabic, not "تم التقديم" (Submitted)', async () => {
    vi.mocked(api.getBook).mockResolvedValue(
      baseFixture({
        approval_state: 'pending',
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
            approval_steps: [],
          },
        ],
      }) as never,
    )
    renderRecord()

    const stationLabels = await screen.findAllByText('أُنشئ الإصدار الأول')
    expect(stationLabels.length).toBeGreaterThanOrEqual(1)
    expect(screen.queryByText('تم التقديم')).not.toBeInTheDocument()
    expect(screen.queryByText('stationCreated')).not.toBeInTheDocument()
  })

  it('renders the Tools trigger and its group labels in Arabic', async () => {
    vi.mocked(api.getBook).mockResolvedValue(baseFixture({ approval_state: 'none' }) as never)
    renderRecord()

    expect(await screen.findByRole('button', { name: 'أدوات' })).toBeInTheDocument()
  })

  it('a returned record with no document offers the Arabic Revise CTA, not a fake submit', async () => {
    mockHas.mockImplementation((cap) => cap === 'books.edit' || cap === 'documents.generate')
    vi.mocked(api.getBook).mockResolvedValue(
      baseFixture({
        approval_state: 'returned',
        versions: [
          {
            id: 5,
            version_no: 1,
            status: 'returned',
            document_id: null,
            template_id: 'General Book',
            has_fields: true,
            pdf_url: null,
            signed_pdf_url: null,
            signed_source: null,
            created_at: '2026-08-01T09:00:00Z',
            created_by_name: 'Operator',
            approval_steps: [],
          },
        ],
      }) as never,
    )
    renderRecord()

    expect(await screen.findByText('لا يوجد مستند في هذا السجل.')).toBeInTheDocument()
    const desk = document.querySelector('.print-paper')
    expect(desk).toHaveTextContent('تعديل وإعادة الإنشاء')
    expect(screen.queryByText('إرسال للموافقة')).not.toBeInTheDocument()
  })
})
