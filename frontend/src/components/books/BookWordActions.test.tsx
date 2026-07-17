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
import type { BookRead } from '@/lib/api'

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
  versions: [],
  doc_manager_has_signature: false,
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

  it('shows "قيد التحرير" for a book with active edit_session', () => {
    render(
      createElement(BookStatusChips, { book: ACTIVE_SESSION_BOOK }),
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
