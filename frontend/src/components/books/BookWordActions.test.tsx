/**
 * TDD tests for BookWordActions + BookStatusChips.
 * All i18n assertions use lng=ar so English leaks are caught.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { createElement, type ReactNode } from 'react'
import i18n from 'i18next'
import { initReactI18next } from 'react-i18next'
import { MemoryRouter } from 'react-router-dom'

import { toast } from '@/lib/toast'
import { WordReopenButton, WordSessionActions } from './BookWordActions'
import { BookStatusChips } from './BookStatusChips'
import * as apiMod from '@/lib/api'
import type { BookRead, WordSessionRead } from '@/lib/api'
import type * as AuthModule from '@/lib/authContext'

// ── i18n setup (Arabic only; catches EN leaks) ────────────────────────────────
void i18n.use(initReactI18next).init({
  lng: 'ar',
  resources: {
    ar: {
      translation: {
        'books.word.finish': 'إنهاء التحرير',
        'books.word.finishing': 'جارٍ حفظ الإصدار في Word…',
        'books.word.opening': 'جارٍ الفتح في Word…',
        'books.word.finished': 'تم حفظ الإصدار',
        'books.word.discard': 'تجاهل المسودة…',
        'books.toast.wordSessionDiscarded': 'أُلغيت جلسة التحرير في Word',
        'books.word.discardConfirmLabel': 'تجاهل المسودة',
        'books.word.discardConfirm': 'سيصبح الكتاب ملغياً ويبقى رقمه محفوظاً في السجل. متابعة؟',
        'books.toast.voided': 'أُلغيت المسودة — السجل ملغى',
        'books.word.draft': 'مسودة — رقم محجوز',
        'books.word.editing': 'قيد التحرير',
        'books.word.editingBy': 'قيد التحرير في Word — {{name}}',
        'books.word.voided': 'ملغي',
        'books.word.needsPc': 'التحرير في Word يتطلب جهاز كمبيوتر مثبّت عليه Word',
        'books.word.openInWord': 'فتح في Word',
        'books.word.editNewVersion': 'تعديل في Word (ينشئ إصداراً جديداً)',
        'books.word.reserved': 'تم إنشاء الكتاب وحجز الرقم',
        'books.word.saveAsTemplate': 'حفظ كقالب',
        'common.cancel': 'إلغاء',
        'common.confirm': 'تأكيد',
      },
    },
  },
  interpolation: { escapeValue: false },
})

vi.mock('@/lib/toast', () => ({ toast: { success: vi.fn(), error: vi.fn(), loading: vi.fn(() => 'loading-toast'), dismiss: vi.fn() } }))
const navigate = vi.fn()
vi.mock('react-router-dom', async () => ({
  ...await vi.importActual('react-router-dom'),
  useNavigate: () => navigate,
}))

// The inmate-reporter reopen path keeps its handoff and template gate.
vi.mock('@/lib/useCapabilities', () => ({
  useCapabilities: () => ({
    capabilities: new Set(['books.templates']),
    isLoading: false,
    has: () => true,
  }),
}))
vi.mock('@/pages/application/DocPdfCanvas', () => ({ default: () => null }))
vi.mock('@/lib/authContext', async (original) => ({
  ...await original<typeof AuthModule>(),
  useAuth: () => ({ user: { id: 1 } }),
}))


// Base book fixture
const BASE_BOOK: BookRead = {
  id: 1,
  ref_number: 'G-2026-001',
  category_id: 'general',
  category: { id: 'general', name_ar: 'عام', name_en: 'General', requires_approval: false, prefix: 'G' },
  subject: null,
  direction: null,
  stamp_style: null,
  approval_state: 'none',
  created_at: '2026-07-01T00:00:00Z',
  deleted_at: null,
  urgency: 'Normal',
  is_draft: true,
  voided_at: null,
  edit_session: null,
  classification_code: null,
  is_word_book: false,
  service_id: 'General Book',
  versions: [],
  doc_manager_has_signature: false,
  current_template_id: null,
  included_papers_revision: 0,
  included_papers_fixed_page_count: 0,
  included_papers_total_page_count: 0,
  access_scope: 'full',
  can_write: true,
  can_sign: false,
  can_review: false,
  grade: 'unclassified',
  distribution: 'named',
  metadata_only: false,
  can_send: false,
  can_change_grade: false,
}

const ACTIVE_SESSION_BOOK: BookRead = {
  ...BASE_BOOK,
  edit_session: {
    user_id: 42,
    user_name: 'أحمد العلي',
    state: 'active',
    last_put_at: null,
    created_at: '2026-07-01T00:00:00Z',
  },
}

const VOIDED_BOOK: BookRead = {
  ...BASE_BOOK,
  voided_at: '2026-07-01T12:00:00Z',
  is_draft: false,
}

// Finished book: has versions, no active session
const FINISHED_BOOK: BookRead = {
  ...BASE_BOOK,
  is_draft: false,
  edit_session: null,
  versions: [
    {
      id: 10,
      version_no: 1,
      trigger: 'initial',
      status: 'none',
      template_id: 'General Book',
      document_id: 5,
      has_fields: false,
      created_at: '2026-07-01T00:00:00Z',
      created_by_name: null,
      docx_url: '/api/v1/documents/5/download?format=docx',
      pdf_url: '/api/v1/documents/5/download?format=pdf',
      manager_sig_embedded: false,
      signed_pdf_url: null,
      signed_source: null,
      approval_steps: [],
    },
  ],
}

const FINISHED_BOOK_WITH_SUBJECT: BookRead = {
  ...FINISHED_BOOK,
  subject: 'تقرير الإجازات السنوية',
}

const MOCK_SESSION: WordSessionRead = {
  book_id: 1,
  ref_number: 'G-2026-001',
  token: 'tok123',
  filename: 'G-2026-001.docx',
  word_url: 'ms-word:ofe|u|https://gssg.lan/dav/tok123/G-2026-001.docx',
  dav_url: 'https://gssg.lan/dav/tok123/G-2026-001.docx',
}

function wrapper(qc: QueryClient) {
  return ({ children }: { children: ReactNode }) =>
    createElement(MemoryRouter, null, createElement(QueryClientProvider, { client: qc }, children))
}

function makeQc() {
  return new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
}

// ── Word action components ──────────────────────────────────────────────────
describe('Word action components', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
    vi.clearAllMocks()
    navigate.mockClear()
  })

  it('(a) renders labelled Finish (solid) and Discard (red outline) buttons with visible text in Arabic', () => {
    render(
      createElement(WordSessionActions, { book: ACTIVE_SESSION_BOOK }),
      { wrapper: wrapper(makeQc()) },
    )
    const finish = screen.getByRole('button', { name: 'إنهاء التحرير' })
    const discard = screen.getByRole('button', { name: 'تجاهل المسودة…' })
    expect(finish).toHaveTextContent('إنهاء التحرير')
    expect(discard).toHaveTextContent('تجاهل المسودة…')
    expect(finish).not.toHaveAttribute('title')
    expect(discard).not.toHaveAttribute('title')
    expect(finish.className).toContain('bg-primary')
    expect(discard.className).toContain('border-destructive')
  })

  it('(b) on mobile: shows disabled "فتح في Word" with the PC hint', () => {
    render(
      createElement(WordSessionActions, { book: ACTIVE_SESSION_BOOK, isMobile: true }),
      { wrapper: wrapper(makeQc()) },
    )
    const wordBtn = screen.getByRole('button', { name: /فتح في Word/ })
    expect(wordBtn).toBeDisabled()
    expect(screen.getByText(/التحرير في Word يتطلب/)).toBeInTheDocument()
  })

  it('(c) a voided book renders no action buttons', () => {
    const { container } = render(
      createElement(WordSessionActions, { book: VOIDED_BOOK }),
      { wrapper: wrapper(makeQc()) },
    )
    expect(container.querySelectorAll('button')).toHaveLength(0)
  })

  it('(d) finish button calls api.finishWordSession and invalidates [books]', async () => {
    const qc = makeQc()
    const spy = vi.spyOn(qc, 'invalidateQueries')
    vi.spyOn(apiMod.api, 'finishWordSession').mockResolvedValue(BASE_BOOK)

    render(
      createElement(WordSessionActions, { book: ACTIVE_SESSION_BOOK }),
      { wrapper: wrapper(qc) },
    )
    await userEvent.click(screen.getByRole('button', { name: /إنهاء التحرير/ }))
    await waitFor(() => expect(apiMod.api.finishWordSession).toHaveBeenCalledWith(1))
    await waitFor(() => {
      const keys = spy.mock.calls.map((c) => JSON.stringify(c[0]?.queryKey))
      expect(keys.some((k) => k.includes('books'))).toBe(true)
    })
    expect(toast.loading).toHaveBeenCalledWith('جارٍ حفظ الإصدار في Word…')
    expect(toast.success).toHaveBeenCalledWith('تم حفظ الإصدار', { id: 'loading-toast', reference: BASE_BOOK.ref_number })
  })

  it('morphs finish loading into an error when saving fails', async () => {
    vi.spyOn(apiMod.api, 'finishWordSession').mockRejectedValue(new Error('failed'))
    render(createElement(WordSessionActions, { book: ACTIVE_SESSION_BOOK }), { wrapper: wrapper(makeQc()) })
    await userEvent.click(screen.getByRole('button', { name: /إنهاء التحرير/ }))
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith(expect.any(String), { id: 'loading-toast', reference: BASE_BOOK.ref_number }))
    expect(toast.loading).toHaveBeenCalledWith('جارٍ حفظ الإصدار في Word…')
  })

  it('(e) discard: click تجاهل → confirm → calls api.discardWordSession, toasts voided, invalidates [books]', async () => {
    const qc = makeQc()
    const spy = vi.spyOn(qc, 'invalidateQueries')
    vi.spyOn(apiMod.api, 'discardWordSession').mockResolvedValue({
      ...ACTIVE_SESSION_BOOK,
      voided_at: '2026-10-05T00:00:00',
    })

    render(
      createElement(WordSessionActions, { book: ACTIVE_SESSION_BOOK }),
      { wrapper: wrapper(qc) },
    )
    // Nothing is sent until the confirm dialog is accepted.
    await userEvent.click(screen.getByRole('button', { name: 'تجاهل المسودة…' }))
    expect(apiMod.api.discardWordSession).not.toHaveBeenCalled()
    expect(await screen.findByRole('dialog')).toHaveTextContent(/سيصبح الكتاب ملغياً/)
    // The final confirm carries the verb without the opener's ellipsis.
    const dialog = screen.getByRole('dialog')
    expect(dialog).toHaveTextContent('تجاهل المسودة')
    expect(dialog).not.toHaveTextContent('…')
    await userEvent.click(within(dialog).getByRole('button', { name: 'تجاهل المسودة' }))
    await waitFor(() => expect(apiMod.api.discardWordSession).toHaveBeenCalledWith(1))
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith('أُلغيت المسودة — السجل ملغى', { reference: BASE_BOOK.ref_number }))
    await waitFor(() => {
      const keys = spy.mock.calls.map((c) => JSON.stringify(c[0]?.queryKey))
      expect(keys.some((k) => k.includes('books'))).toBe(true)
    })
  })

  it('(e3) discarding a re-opened session leaves the book intact: toasts "session discarded", not "voided"', async () => {
    vi.mocked(toast.success).mockClear()
    vi.spyOn(apiMod.api, 'discardWordSession').mockResolvedValue({ ...ACTIVE_SESSION_BOOK, voided_at: null })
    render(
      createElement(WordSessionActions, { book: ACTIVE_SESSION_BOOK }),
      { wrapper: wrapper(makeQc()) },
    )
    await userEvent.click(screen.getByRole('button', { name: 'تجاهل المسودة…' }))
    const confirmBtns = await screen.findAllByRole('button', { name: /تجاهل المسودة/ })
    await userEvent.click(confirmBtns[confirmBtns.length - 1])
    await waitFor(() =>
      expect(toast.success).toHaveBeenCalledWith('أُلغيت جلسة التحرير في Word', { reference: BASE_BOOK.ref_number }),
    )
    expect(toast.success).not.toHaveBeenCalledWith('أُلغيت المسودة — السجل ملغى', expect.anything())
  })

  it('(e2) cancelling the discard confirm sends nothing', async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    vi.spyOn(apiMod.api, 'discardWordSession').mockResolvedValue({} as any)
    render(
      createElement(WordSessionActions, { book: ACTIVE_SESSION_BOOK }),
      { wrapper: wrapper(makeQc()) },
    )
    await userEvent.click(screen.getByRole('button', { name: 'تجاهل المسودة…' }))
    await userEvent.click(await screen.findByRole('button', { name: 'إلغاء' }))
    expect(apiMod.api.discardWordSession).not.toHaveBeenCalled()
  })

  it('(f) finished book renders Arabic "تعديل في Word (ينشئ إصداراً جديداً)" button', () => {
    render(
      createElement(WordReopenButton, { book: FINISHED_BOOK }),
      { wrapper: wrapper(makeQc()) },
    )
    expect(screen.getByRole('button', { name: /تعديل في Word/ })).toBeInTheDocument()
    // No Finish/Discard buttons — those are for active sessions only
    expect(screen.queryByRole('button', { name: /إنهاء التحرير/ })).not.toBeInTheDocument()
  })

  it('(g) clicking editNewVersion calls api.reopenWordSession', async () => {
    vi.spyOn(apiMod.api, 'reopenWordSession').mockResolvedValue(MOCK_SESSION)

    render(
      createElement(WordReopenButton, { book: FINISHED_BOOK }),
      { wrapper: wrapper(makeQc()) },
    )
    await userEvent.click(screen.getByRole('button', { name: /تعديل في Word/ }))
    await waitFor(() => expect(apiMod.api.reopenWordSession).toHaveBeenCalledWith(1))
    await waitFor(() => expect(navigate).toHaveBeenCalledWith('/books/1/word'))
    expect(toast.loading).toHaveBeenCalledWith('جارٍ الفتح في Word…')
    expect(toast.dismiss).toHaveBeenCalledWith('loading-toast')
  })

  it('morphs reopen loading into an error without navigating when opening fails', async () => {
    vi.spyOn(apiMod.api, 'reopenWordSession').mockRejectedValue(new Error('failed'))
    render(createElement(WordReopenButton, { book: FINISHED_BOOK }), { wrapper: wrapper(makeQc()) })
    await userEvent.click(screen.getByRole('button', { name: /تعديل في Word/ }))
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith(expect.any(String), { id: 'loading-toast', reference: BASE_BOOK.ref_number }))
    expect(toast.dismiss).not.toHaveBeenCalled()
    expect(navigate).not.toHaveBeenCalled()
  })


  it('(j) keeps the inmate-reporter handoff mounted after edit_session flips active and auto-submits on Finish', async () => {
    const onFinished = vi.fn()
    vi.spyOn(apiMod.api, 'reopenWordSession').mockResolvedValue(MOCK_SESSION)
    vi.spyOn(apiMod.api, 'getBook').mockResolvedValue(FINISHED_BOOK)
    vi.spyOn(apiMod.api, 'getWordSaveStatus').mockResolvedValue({ last_put_at: '2026-07-01T10:05:00Z' })
    vi.spyOn(apiMod.api, 'finishWordSession').mockResolvedValue(FINISHED_BOOK)
    const qc = makeQc()
    const view = render(createElement(WordReopenButton, { book: FINISHED_BOOK, onFinished }), { wrapper: wrapper(qc) })
    await userEvent.click(screen.getByRole('button', { name: /تعديل في Word/ }))
    const dialog = await screen.findByRole('dialog', { name: 'تم إنشاء الكتاب وحجز الرقم' })

    view.rerender(
      createElement(WordReopenButton, {
        book: { ...FINISHED_BOOK, edit_session: { user_id: 1, user_name: 'x', state: 'active', last_put_at: null, created_at: '2026-07-01T00:00:00Z' } },
        onFinished,
      }),
    )
    expect(screen.getByRole('dialog', { name: 'تم إنشاء الكتاب وحجز الرقم' })).toBe(dialog)
    expect(screen.queryByRole('button', { name: /تعديل في Word/ })).toBeNull()
    expect(navigate).not.toHaveBeenCalled()
    const finish = screen.getByRole('button', { name: 'إنهاء التحرير' })
    await waitFor(() => expect(finish).toBeEnabled())
    await userEvent.click(finish)
    await waitFor(() => expect(onFinished).toHaveBeenCalledWith(FINISHED_BOOK))
  })

  it('(k) drops the retained inmate-reporter handoff when the record changes', async () => {
    const onFinished = vi.fn()
    vi.spyOn(apiMod.api, 'reopenWordSession').mockResolvedValue(MOCK_SESSION)
    vi.spyOn(apiMod.api, 'getBook').mockResolvedValue(FINISHED_BOOK)
    vi.spyOn(apiMod.api, 'getWordSaveStatus').mockResolvedValue({ last_put_at: null })
    const qc = makeQc()
    const view = render(createElement(WordReopenButton, { book: FINISHED_BOOK, onFinished }), { wrapper: wrapper(qc) })
    await userEvent.click(screen.getByRole('button', { name: /تعديل في Word/ }))
    await screen.findByRole('dialog', { name: 'تم إنشاء الكتاب وحجز الرقم' })

    view.rerender(createElement(WordReopenButton, { book: { ...BASE_BOOK, id: 2 }, onFinished }))
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(navigate).not.toHaveBeenCalled()
  })

  it('(l) clears a lifted onTriggerChange trigger when eligibility is lost (queue navigation)', () => {
    // Regression: the Tools-dropdown trigger must not survive a record swap
    // that makes this action ineligible, or a stale menu item can act on
    // the wrong record. The effect must clean up on unmount/re-eval, not
    // just push a new value while eligible.
    const onTriggerChange = vi.fn()
    const view = render(
      createElement(WordReopenButton, { book: FINISHED_BOOK, hideTrigger: true, onTriggerChange }),
      { wrapper: wrapper(makeQc()) },
    )
    expect(onTriggerChange).toHaveBeenLastCalledWith(expect.objectContaining({ label: expect.any(String) }))

    // Navigate to a record where this action is not eligible (no versions).
    view.rerender(
      createElement(WordReopenButton, { book: { ...BASE_BOOK, id: 2, versions: [] }, hideTrigger: true, onTriggerChange }),
    )
    expect(onTriggerChange).toHaveBeenLastCalledWith(null)
  })

  it('(h) on mobile, editNewVersion button is disabled with needsPc hint', () => {
    render(
      createElement(WordReopenButton, { book: FINISHED_BOOK, isMobile: true }),
      { wrapper: wrapper(makeQc()) },
    )
    const btn = screen.getByRole('button', { name: /تعديل في Word/ })
    expect(btn).toBeDisabled()
    expect(screen.getByText(/التحرير في Word يتطلب/)).toBeInTheDocument()
  })

  it('renders the finished-book action as a labelled icon button', () => {
    render(
      createElement(WordReopenButton, { book: FINISHED_BOOK, iconOnly: true }),
      { wrapper: wrapper(makeQc()) },
    )
    const button = screen.getByRole('button', { name: 'تعديل في Word (ينشئ إصداراً جديداً)' })
    expect(button).toHaveAttribute('title', 'تعديل في Word (ينشئ إصداراً جديداً)')
    expect(button).not.toHaveTextContent('تعديل في Word')
  })

  it('(i) save-as-template is GONE from Records — it lives in the Word flow now', () => {
    // Save-as-template lives on the Word session page, not in Records.
    render(
      createElement(WordReopenButton, { book: FINISHED_BOOK_WITH_SUBJECT }),
      { wrapper: wrapper(makeQc()) },
    )
    expect(screen.queryByRole('button', { name: 'حفظ كقالب' })).toBeNull()
  })
})

// ── BookStatusChips ───────────────────────────────────────────────────────────
describe('BookStatusChips', () => {
  it('shows "مسودة — رقم محجوز" for a draft book under lng=ar', () => {
    render(
      createElement(BookStatusChips, { book: BASE_BOOK }),
      { wrapper: wrapper(makeQc()) },
    )
    expect(screen.getByText('مسودة — رقم محجوز')).toBeInTheDocument()
  })

  it('shows editingBy with the holder first name and full name tooltip', () => {
    render(
      createElement(BookStatusChips, { book: ACTIVE_SESSION_BOOK }),
      { wrapper: wrapper(makeQc()) },
    )
    // Bidi-isolate chars wrap the name; strip them before comparing visible text
    const chip = screen.getByText((content) =>
      content.replace(/[⁨⁩]/g, '').includes('قيد التحرير في Word — أحمد'),
    )
    expect(chip).toHaveAttribute('title', 'أحمد العلي')
    expect(chip).toHaveAccessibleName('قيد التحرير في Word — ⁨أحمد العلي⁩')
    expect(chip.textContent?.replace(/[⁨⁩]/g, '')).not.toContain('أحمد العلي')
    expect(chip.textContent).toContain('⁨')
  })

  it('shows "قيد التحرير" (no name) for a book with active edit_session and no user_name', () => {
    const noNameSession: BookRead = {
      ...ACTIVE_SESSION_BOOK,
      edit_session: { ...ACTIVE_SESSION_BOOK.edit_session!, user_name: null },
    }
    render(
      createElement(BookStatusChips, { book: noNameSession }),
      { wrapper: wrapper(makeQc()) },
    )
    expect(screen.getByText('قيد التحرير')).toBeInTheDocument()
  })

  it('shows "ملغي" for a voided book', () => {
    render(
      createElement(BookStatusChips, { book: VOIDED_BOOK }),
      { wrapper: wrapper(makeQc()) },
    )
    expect(screen.getByText('ملغي')).toBeInTheDocument()
  })
})
