import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import i18n from 'i18next'
import { initReactI18next } from 'react-i18next'
import ar from '@/locales/ar.json'
import { api, ApiError } from '@/lib/api'
import { toast } from '@/lib/toast'
import type { BookRead, WordSessionDetailRead } from '@/lib/api'
import { WordSessionPage } from './WordSessionPage'

void i18n.use(initReactI18next).init({ lng: 'ar', resources: { ar: { translation: ar } }, interpolation: { escapeValue: false } })
const capabilities = vi.hoisted(() => ({ templates: true }))
vi.mock('@/lib/useCapabilities', () => ({ useCapabilities: () => ({ has: (cap: string) => cap !== 'books.templates' || capabilities.templates }) }))
vi.mock('@/lib/toast', () => ({ toast: { success: vi.fn(), error: vi.fn(), loading: vi.fn(() => 'loading-toast'), dismiss: vi.fn() } }))
vi.mock('@/pages/application/DocPdfCanvas', () => ({ default: ({ pdfUrl }: { pdfUrl: string }) => <div data-testid="paper" data-url={pdfUrl} /> }))
vi.mock('@/components/books/SavedRecordActions', () => ({ SavedRecordActions: ({ bookId }: { bookId: number }) => <div>saved:{bookId}</div> }))

const session: WordSessionDetailRead = {
  book_id: 42, ref_number: '1/5/GSSG/141', token: 'tok', filename: 'book.docx',
  word_url: 'ms-word:ofe|u|https://gssg.lan/dav/tok/book.docx', dav_url: 'https://gssg.lan/dav/tok/book.docx',
  created_at: '2026-10-12T10:00:00Z', last_put_at: null, template_name: 'نموذج.docx',
  subject: 'التصاريح الأمنية', recipient_name: 'مدير الموارد البشرية', cc: ['الإدارة'],
}
const book = {
  id: 42, ref_number: session.ref_number, subject: session.subject, service_id: 'General Book',
  created_at: session.created_at, submitted_by_name: 'SAEED ALHARBI', submitted_by_g: 'G1234', classification_code: '1/5', versions: [],
} as BookRead

function setup() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
  render(<QueryClientProvider client={qc}><MemoryRouter initialEntries={['/books/42/word']}><Routes><Route path="/books/:id/word" element={<WordSessionPage />} /><Route path="/books/word-templates/:sessionId" element={<div>template-session</div>} /></Routes></MemoryRouter></QueryClientProvider>)
  return qc
}

beforeEach(() => {
  vi.restoreAllMocks()
  vi.clearAllMocks()
  capabilities.templates = true
  vi.spyOn(api, 'getBook').mockResolvedValue(book)
  vi.spyOn(api, 'getWordSession').mockResolvedValue(session)
  vi.spyOn(api, 'getWordSaveStatus').mockResolvedValue({ last_put_at: null })
  vi.spyOn(api, 'listBookClassifications').mockResolvedValue({ items: [{ code: '1/5', tab: 5, name_ar: 'الإدارة', name_en: 'Administration', unit_ar: 'الموارد البشرية' }] })
  vi.spyOn(api, 'getEmployeeLookup').mockResolvedValue({ id: 'G1234', name_en: 'SAEED ALHARBI', name_ar: 'سعيد الحربي', position: 'Clerk', position_ar: 'كاتب', nationality: '', passport_no: '', has_photo: false })
})

describe('WordSessionPage in Arabic', () => {
  it('isolates the ref, preserves the Word anchor and disables Finish and draft template before the first save', async () => {
    setup()
    const ref = await screen.findByText(session.ref_number)
    expect(ref.tagName).toBe('BDI')
    expect(ref).toHaveAttribute('dir', 'ltr')
    expect(await screen.findByText('سعيد الحربي')).toHaveAttribute('dir', 'auto')
    expect(screen.getByText('G1234')).toHaveAttribute('dir', 'ltr')
    expect(screen.getByText('كاتب')).toBeVisible()
    expect(screen.getByRole('link', { name: 'فتح في Word' })).toHaveAttribute('href', session.word_url)
    expect(screen.getByRole('button', { name: 'حفظ الكتاب' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'حفظ كقالب' })).toBeDisabled()
    expect(screen.getByText('الموارد البشرية')).toBeVisible()
    expect(screen.queryByText('Administration')).not.toBeInTheDocument()
    expect(screen.queryByText('SAEED ALHARBI')).not.toBeInTheDocument()
    expect(screen.getByText('نموذج')).toBeVisible()
  })

  it('hides draft template controls without books.templates', async () => {
    capabilities.templates = false
    setup()
    await screen.findByText(session.ref_number)
    expect(screen.queryByRole('button', { name: 'حفظ كقالب' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'إنشاء قالب جديد' })).not.toBeInTheDocument()
  })

  it('saves the current draft as a template with the book id and subject-prefilled name', async () => {
    const user = userEvent.setup()
    vi.mocked(api.getWordSession).mockResolvedValue({ ...session, last_put_at: '2026-10-12T10:05:00Z' })
    vi.spyOn(api, 'saveBookAsTemplate').mockResolvedValue({ name: 'التصاريح الأمنية.docx', modified_at: session.created_at, kind: 'custom' })
    const qc = setup()
    const invalidate = vi.spyOn(qc, 'invalidateQueries')
    const save = await screen.findByRole('button', { name: 'حفظ كقالب' })
    await waitFor(() => expect(save).toBeEnabled())
    await user.click(save)
    expect(screen.getByRole('textbox', { name: 'اسم القالب' })).toHaveValue(session.subject)
    await user.click(screen.getByRole('button', { name: 'حفظ' }))
    await waitFor(() => expect(api.saveBookAsTemplate).toHaveBeenCalledWith(42, session.subject))
    await waitFor(() => expect(invalidate).toHaveBeenCalledWith({ queryKey: ['word-templates'] }))
  })

  it('updates working-document details and save history when a Word save arrives', async () => {
    const qc = setup()
    await screen.findByText(session.subject!)
    vi.mocked(api.getWordSession).mockResolvedValue({ ...session, subject: 'موضوع مُعدّل', last_put_at: '2026-10-12T10:05:00Z' })
    qc.setQueryData(['word-save-status', session.token], { last_put_at: '2026-10-12T10:05:00Z' })
    expect(await screen.findByText('موضوع مُعدّل')).toBeVisible()
    expect(screen.getByRole('button', { name: 'حفظ الكتاب' })).toBeEnabled()
    expect(screen.getByText('اضغط «حفظ الكتاب» هنا').closest('li')).toHaveAttribute('aria-current', 'step')
    expect(await screen.findByTestId('paper')).toHaveAttribute('data-url', api.wordSessionPreviewUrl(42, '2026-10-12T10:05:00Z'))
  })

  it('shows the finished record after refresh with no active session', async () => {
    vi.mocked(api.getWordSession).mockRejectedValue(new ApiError(409, 'NO_ACTIVE_SESSION', 'No active session'))
    vi.mocked(api.getBook).mockResolvedValue({ ...book, versions: [{ template_id: 'General Book', pdf_url: '/final.pdf', docx_url: '/final.docx' }] } as BookRead)
    setup()
    expect(await screen.findByText('saved:42')).toBeVisible()
    expect(await screen.findByTestId('paper')).toHaveAttribute('data-url', '/final.pdf')
    expect(screen.getByRole('button', { name: 'حفظ كقالب' })).toBeVisible()
    expect(api.getWordSaveStatus).not.toHaveBeenCalled()
  })

  it('stays on the page with final PDF and template save after Finish', async () => {
    const user = userEvent.setup()
    vi.mocked(api.getWordSession).mockResolvedValue({ ...session, last_put_at: '2026-10-12T10:05:00Z' })
    vi.spyOn(api, 'finishWordSession').mockResolvedValue({ ...book, versions: [{ template_id: 'General Book', pdf_url: '/final.pdf', docx_url: '/final.docx' }] } as BookRead)
    setup()
    const finish = await screen.findByRole('button', { name: 'حفظ الكتاب' })
    await waitFor(() => expect(finish).toBeEnabled())
    await user.click(finish)
    expect(await screen.findByText('saved:42')).toBeVisible()
    await waitFor(() => expect(screen.getByTestId('paper')).toHaveAttribute('data-url', '/final.pdf'))
    expect(screen.getByRole('button', { name: 'حفظ كقالب' })).toBeVisible()
    expect(toast.loading).toHaveBeenCalledWith(ar.books.word.finishing)
    expect(toast.success).toHaveBeenCalledWith(ar.books.word.finished, { id: 'loading-toast', reference: session.ref_number })
  })

  it('morphs finish loading into an error when saving fails', async () => {
    vi.mocked(api.getWordSession).mockResolvedValue({ ...session, last_put_at: '2026-10-12T10:05:00Z' })
    vi.spyOn(api, 'finishWordSession').mockRejectedValue(new Error('failed'))
    setup()
    const finish = await screen.findByRole('button', { name: 'حفظ الكتاب' })
    await waitFor(() => expect(finish).toBeEnabled())
    await userEvent.click(finish)
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith(expect.any(String), { id: 'loading-toast', reference: session.ref_number }))
    expect(toast.loading).toHaveBeenCalledWith(ar.books.word.finishing)
  })

  it('creates a new template Word session and navigates to it', async () => {
    const user = userEvent.setup()
    vi.spyOn(api, 'createTemplateSession').mockResolvedValue({ id: 9, name: 'قالب.docx', token: 'tpl', filename: 'قالب.docx', word_url: 'ms-word:ofe|u|https://gssg.lan/dav/tpl/template.docx', dav_url: 'https://gssg.lan/dav/tpl/template.docx', created_at: session.created_at, last_put_at: null })
    setup()
    await user.click(await screen.findByRole('button', { name: 'إنشاء قالب جديد' }))
    await user.type(screen.getByRole('textbox', { name: 'اسم القالب' }), 'قالب')
    await user.click(screen.getByRole('button', { name: 'إنشاء القالب' }))
    expect(await screen.findByText('template-session')).toBeVisible()
    expect(api.createTemplateSession).toHaveBeenCalledWith('قالب')
  })
})
