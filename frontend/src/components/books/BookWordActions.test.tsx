/**
 * TDD tests for BookWordActions + BookStatusChips.
 * All i18n assertions use lng=ar so English leaks are caught.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { createElement, type ReactNode } from 'react'
import i18n from 'i18next'
import { initReactI18next } from 'react-i18next'

import { BookWordActions } from './BookWordActions'
import { BookStatusChips } from './BookStatusChips'
import * as apiMod from '@/lib/api'
import type { BookRead, WordSessionRead } from '@/lib/api'

// ── i18n setup (Arabic only; catches EN leaks) ────────────────────────────────
void i18n.use(initReactI18next).init({
  lng: 'ar',
  resources: {
    ar: {
      translation: {
        'books.word.finish': 'إنهاء التحرير',
        'books.word.discard': 'تجاهل',
        'books.word.discardConfirm': 'سيصبح الكتاب ملغياً ويبقى رقمه محفوظاً في السجل. متابعة؟',
        'books.word.draft': 'مسودة — رقم محجوز',
        'books.word.editing': 'قيد التحرير',
        'books.word.editingBy': 'قيد التحرير في Word بواسطة {{name}}',
        'books.word.voided': 'ملغي',
        'books.word.needsPc': 'التحرير في Word يتطلب جهاز كمبيوتر مثبّت عليه Word',
        'books.word.openInWord': 'فتح في Word',
        'books.word.editNewVersion': 'تعديل في Word (ينشئ إصداراً جديداً)',
        'books.word.saveAsTemplate': 'حفظ كقالب',
        'common.cancel': 'إلغاء',
        'common.confirm': 'تأكيد',
      },
    },
  },
  interpolation: { escapeValue: false },
})

vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }))

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
  priority: 'Normal',
  is_draft: true,
  voided_at: null,
  edit_session: null,
  classification_code: null,
  is_word_book: false,
  versions: [],
  doc_manager_has_signature: false,
  current_template_id: null,
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
    createElement(QueryClientProvider, { client: qc }, children)
}

function makeQc() {
  return new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
}

// ── BookWordActions ──────────────────────────────────────────────────────────
describe('BookWordActions', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
  })

  it('(a) renders Finish and Discard in Arabic for a book with active edit_session', () => {
    render(
      createElement(BookWordActions, { book: ACTIVE_SESSION_BOOK }),
      { wrapper: wrapper(makeQc()) },
    )
    expect(screen.getByRole('button', { name: /إنهاء التحرير/ })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /تجاهل/ })).toBeInTheDocument()
  })

  it('(b) on mobile: shows disabled "فتح في Word" with the PC hint', () => {
    render(
      createElement(BookWordActions, { book: ACTIVE_SESSION_BOOK, isMobile: true }),
      { wrapper: wrapper(makeQc()) },
    )
    const wordBtn = screen.getByRole('button', { name: /فتح في Word/ })
    expect(wordBtn).toBeDisabled()
    expect(screen.getByText(/التحرير في Word يتطلب/)).toBeInTheDocument()
  })

  it('(c) a voided book renders no action buttons', () => {
    const { container } = render(
      createElement(BookWordActions, { book: VOIDED_BOOK }),
      { wrapper: wrapper(makeQc()) },
    )
    expect(container.querySelectorAll('button')).toHaveLength(0)
  })

  it('(d) finish button calls api.finishWordSession and invalidates [books]', async () => {
    const qc = makeQc()
    const spy = vi.spyOn(qc, 'invalidateQueries')
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    vi.spyOn(apiMod.api, 'finishWordSession').mockResolvedValue({} as any)

    render(
      createElement(BookWordActions, { book: ACTIVE_SESSION_BOOK }),
      { wrapper: wrapper(qc) },
    )
    await userEvent.click(screen.getByRole('button', { name: /إنهاء التحرير/ }))
    await waitFor(() => expect(apiMod.api.finishWordSession).toHaveBeenCalledWith(1))
    await waitFor(() => {
      const keys = spy.mock.calls.map((c) => JSON.stringify(c[0]?.queryKey))
      expect(keys.some((k) => k.includes('books'))).toBe(true)
    })
  })

  it('(e) discard: click تجاهل → confirm → calls api.discardWordSession and invalidates [books]', async () => {
    const qc = makeQc()
    const spy = vi.spyOn(qc, 'invalidateQueries')
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    vi.spyOn(apiMod.api, 'discardWordSession').mockResolvedValue({} as any)

    render(
      createElement(BookWordActions, { book: ACTIVE_SESSION_BOOK }),
      { wrapper: wrapper(qc) },
    )
    // Open the discard confirm dialog
    await userEvent.click(screen.getByRole('button', { name: /تجاهل/ }))
    // Wait for dialog to open, then get all buttons with the label (trigger + dialog confirm)
    await screen.findByRole('button', { name: /تجاهل/ })
    const confirmBtns = screen.getAllByRole('button', { name: /تجاهل/ })
    // The dialog confirm button is the last one (dialog is appended to body)
    await userEvent.click(confirmBtns[confirmBtns.length - 1])
    await waitFor(() => expect(apiMod.api.discardWordSession).toHaveBeenCalledWith(1))
    await waitFor(() => {
      const keys = spy.mock.calls.map((c) => JSON.stringify(c[0]?.queryKey))
      expect(keys.some((k) => k.includes('books'))).toBe(true)
    })
  })

  it('(f) finished book renders Arabic "تعديل في Word (ينشئ إصداراً جديداً)" button', () => {
    render(
      createElement(BookWordActions, { book: FINISHED_BOOK }),
      { wrapper: wrapper(makeQc()) },
    )
    expect(screen.getByRole('button', { name: /تعديل في Word/ })).toBeInTheDocument()
    // No Finish/Discard buttons — those are for active sessions only
    expect(screen.queryByRole('button', { name: /إنهاء التحرير/ })).not.toBeInTheDocument()
  })

  it('(g) clicking editNewVersion calls api.reopenWordSession', async () => {
    const locationSpy = vi.spyOn(window, 'location', 'get')
    const mockLocation = { href: '' } as Location
    locationSpy.mockReturnValue(mockLocation)
    vi.spyOn(apiMod.api, 'reopenWordSession').mockResolvedValue(MOCK_SESSION)

    render(
      createElement(BookWordActions, { book: FINISHED_BOOK }),
      { wrapper: wrapper(makeQc()) },
    )
    await userEvent.click(screen.getByRole('button', { name: /تعديل في Word/ }))
    await waitFor(() => expect(apiMod.api.reopenWordSession).toHaveBeenCalledWith(1))
  })

  it('(h) on mobile, editNewVersion button is disabled with needsPc hint', () => {
    render(
      createElement(BookWordActions, { book: FINISHED_BOOK, isMobile: true }),
      { wrapper: wrapper(makeQc()) },
    )
    const btn = screen.getByRole('button', { name: /تعديل في Word/ })
    expect(btn).toBeDisabled()
    expect(screen.getByText(/التحرير في Word يتطلب/)).toBeInTheDocument()
  })

  it('(i) save-as-template is GONE from Records — it lives in the Word flow now', () => {
    // Moved to WordHandoffDialog's finished view (the General Book side, per
    // the 2026-07-19 template-ops relocation). Records only re-opens in Word.
    render(
      createElement(BookWordActions, { book: FINISHED_BOOK_WITH_SUBJECT }),
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

  it('shows editingBy with holder name for a book with active edit_session and user_name', () => {
    render(
      createElement(BookStatusChips, { book: ACTIVE_SESSION_BOOK }),
      { wrapper: wrapper(makeQc()) },
    )
    // Bidi-isolate chars wrap the name; strip them before comparing visible text
    const chip = screen.getByText((content) =>
      content.replace(/[⁨⁩]/g, '').includes('قيد التحرير في Word بواسطة أحمد العلي'),
    )
    expect(chip).toBeInTheDocument()
    // Confirm the bidi isolate is present (fix 6)
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
