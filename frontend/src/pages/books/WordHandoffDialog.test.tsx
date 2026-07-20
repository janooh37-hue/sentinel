/**
 * WordHandoffDialog — TDD (RED → GREEN)
 * Assert Arabic under lng=ar (per i18n-tests-must-assert-arabic memory).
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createElement, type ReactNode } from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { toast } from 'sonner'

import { WordHandoffDialog } from './WordHandoffDialog'
import * as apiMod from '@/lib/api'
import type { WordSessionRead, BookRead } from '@/lib/api'

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (k: string, opts?: Record<string, unknown>) => {
      // Minimal Arabic key map for the keys we assert.
      const ar: Record<string, string> = {
        'books.word.reserved': 'تم إنشاء الكتاب وحجز الرقم',
        'books.word.finish': 'إنهاء التحرير',
        'books.word.openAgain': 'فتح Word مجدداً',
        'books.word.discard': 'تجاهل',
        'books.word.noSavesYet': 'لم يصل أي حفظ من Word بعد',
        'books.word.discardConfirm': 'سيصبح الكتاب ملغياً ويبقى رقمه محفوظاً في السجل. متابعة؟',
        'books.word.finished': opts?.ref ? `تم اعتماد الإصدار — ${String(opts.ref)}` : 'تم اعتماد الإصدار',
        'books.word.finishedPdfTitle': opts?.ref ? `تم حفظ الكتاب — ${String(opts.ref)}` : 'تم حفظ الكتاب',
        'books.word.pdfPending': 'جارٍ تجهيز ملف PDF — يمكنك تنزيل ملف DOCX الآن',
        'books.word.close': 'إغلاق',
        'books.word.step1': 'اضغط «فتح في Word» ثم وافق على تأكيد المتصفح',
        'books.word.step2': 'احفظ من داخل Word (Ctrl+S)',
        'books.word.step3': 'ارجع هنا واضغط «إنهاء التحرير»',
        'books.word.preparedBy': 'المُعِدّ',
        'books.word.openInWord': 'فتح في Word',
        'books.word.protocolHint':
          'إذا لم يُفتح Word فالمتصفح يطلب الإذن — وافق مرة واحدة واختر السماح دائماً.',
        'books.word.lastSavedAt': opts?.time
          ? `تم الحفظ من Word ✓ ${String(opts.time)}`
          : 'تم الحفظ من Word ✓',
        'books.word.saveAsTemplate': 'حفظ كقالب',
        'books.word.saveAsTemplateName': 'اسم القالب',
        'books.word.saveAsTemplateHint':
          'سيصبح محتوى الكتاب قالباً مشتركاً متاحاً لجميع مديري الكتب.',
        'books.word.savedAsTemplate': opts?.name
          ? `حُفظ في مكتبة القوالب: ${String(opts.name)}`
          : 'حُفظ في مكتبة القوالب',
        'common.confirm': 'تأكيد',
        'common.cancel': 'إلغاء',
        'common.save': 'حفظ',
      }
      return ar[k] ?? k
    },
    i18n: { language: 'ar' },
  }),
}))

vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }))

// Mock the heavy pdf.js canvas — a sentinel div carrying the pdfUrl.
vi.mock('@/pages/application/DocPdfCanvas', () => ({
  default: ({ pdfUrl }: { pdfUrl: string }) =>
    createElement('div', { 'data-testid': 'doc-pdf-canvas', 'data-pdf-url': pdfUrl }),
}))

const FAKE_SESSION: WordSessionRead = {
  book_id: 42,
  ref_number: '1/5/GSSG/141',
  token: 'tok',
  filename: 'file.docx',
  word_url: 'ms-word:ofe|u|https://gssg.lan/dav/file.docx',
  dav_url: 'https://gssg.lan/dav/file.docx',
}

function bookWith(last_put_at: string | null): BookRead {
  return {
    id: 42,
    ref_number: '1/5/GSSG/141',
    category_id: '1/5',
    subject: 'التصاريح الأمنية',
    direction: null,
    stamp_style: null,
    created_at: '2026-07-17T10:00:00Z',
    deleted_at: null,
    priority: 'normal',
    approval_state: 'none',
    is_draft: true,
    doc_manager_has_signature: false,
    edit_session: last_put_at !== undefined ? {
      user_id: 1,
      user_name: 'سعيد',
      state: 'active',
      last_put_at,
      created_at: '2026-07-17T10:00:00Z',
    } : null,
  } as BookRead
}

function makeWrapper(qc: QueryClient) {
  return ({ children }: { children: ReactNode }) =>
    createElement(QueryClientProvider, { client: qc }, children)
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('WordHandoffDialog', () => {
  it('renders the ref inside bdi[dir=ltr] and Arabic eyebrow', () => {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    vi.spyOn(apiMod.api, 'getBook').mockResolvedValue(bookWith(null))

    render(
      createElement(WordHandoffDialog, {
        session: FAKE_SESSION,
        open: true,
        onClose: vi.fn(),
      }),
      { wrapper: makeWrapper(qc) },
    )

    // Arabic eyebrow — appears in visible div + sr-only DialogTitle; at least one present
    expect(screen.getAllByText('تم إنشاء الكتاب وحجز الرقم').length).toBeGreaterThan(0)

    // ref inside a bdi[dir=ltr]
    const bdi = document.querySelector('bdi[dir="ltr"]')
    expect(bdi).toBeTruthy()
    expect(bdi?.textContent).toBe('1/5/GSSG/141')
  })

  it('Finish button DISABLED with hint when last_put_at is null', async () => {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    vi.spyOn(apiMod.api, 'getBook').mockResolvedValue(bookWith(null))

    render(
      createElement(WordHandoffDialog, {
        session: FAKE_SESSION,
        open: true,
        onClose: vi.fn(),
      }),
      { wrapper: makeWrapper(qc) },
    )

    // Wait for query
    await waitFor(() =>
      expect(screen.getByText('لم يصل أي حفظ من Word بعد')).toBeTruthy(),
    )

    const finishBtn = screen.getByText('إنهاء التحرير').closest('button')
    expect(finishBtn).toBeTruthy()
    expect(finishBtn?.disabled).toBe(true)
  })

  it('Finish button ENABLED when last_put_at is set', async () => {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    vi.spyOn(apiMod.api, 'getBook').mockResolvedValue(bookWith('2026-07-17T10:05:00Z'))

    render(
      createElement(WordHandoffDialog, {
        session: FAKE_SESSION,
        open: true,
        onClose: vi.fn(),
      }),
      { wrapper: makeWrapper(qc) },
    )

    await waitFor(() => {
      const btn = screen.getByText('إنهاء التحرير').closest('button')
      expect(btn?.disabled).toBe(false)
    })
  })

  it('Discard fires discardWordSession on confirm', async () => {
    const user = userEvent.setup()
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    vi.spyOn(apiMod.api, 'getBook').mockResolvedValue(bookWith(null))
    const discardSpy = vi.spyOn(apiMod.api, 'discardWordSession').mockResolvedValue({} as BookRead)
    const onClose = vi.fn()

    render(
      createElement(WordHandoffDialog, {
        session: FAKE_SESSION,
        open: true,
        onClose,
      }),
      { wrapper: makeWrapper(qc) },
    )

    await user.click(screen.getByText('تجاهل'))
    // ConfirmDialog shows the confirm text in description
    await waitFor(() =>
      expect(screen.getByText('سيصبح الكتاب ملغياً ويبقى رقمه محفوظاً في السجل. متابعة؟')).toBeTruthy(),
    )
    // Click the confirm button
    await user.click(screen.getByText('تأكيد'))
    await waitFor(() => expect(discardSpy).toHaveBeenCalledWith(42))
    await waitFor(() => expect(onClose).toHaveBeenCalled())
  })

  it('Finish shows the finished version PDF (same viewer as generate preview)', async () => {
    const user = userEvent.setup()
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    vi.spyOn(apiMod.api, 'getBook').mockResolvedValue(bookWith('2026-07-17T10:05:00Z'))
    const finished = {
      ...bookWith(null),
      versions: [
        {
          id: 1,
          version_no: 1,
          pdf_url: '/api/v1/documents/9/download?format=pdf',
          docx_url: '/api/v1/documents/9/download?format=docx',
        },
      ],
    } as unknown as BookRead
    const finishSpy = vi.spyOn(apiMod.api, 'finishWordSession').mockResolvedValue(finished)
    const onClose = vi.fn()

    render(
      createElement(WordHandoffDialog, {
        session: FAKE_SESSION,
        open: true,
        onClose,
      }),
      { wrapper: makeWrapper(qc) },
    )

    await waitFor(() => {
      const btn = screen.getByText('إنهاء التحرير').closest('button')
      expect(btn?.disabled).toBe(false)
    })

    await user.click(screen.getByText('إنهاء التحرير'))
    await waitFor(() => expect(finishSpy).toHaveBeenCalledWith(42))
    await waitFor(() => expect(toast.success).toHaveBeenCalled())
    // Dialog stays open showing the PDF — onClose NOT called automatically.
    expect(onClose).not.toHaveBeenCalled()
    const canvas = await screen.findByTestId('doc-pdf-canvas')
    expect(canvas.getAttribute('data-pdf-url')).toBe('/api/v1/documents/9/download?format=pdf')
    // Arabic finished title with the ref (bidi() wraps the ref in isolate
    // control chars, so match loosely)
    expect(screen.getByText(/تم حفظ الكتاب/)).toBeTruthy()
    expect(screen.getByText(/1\/5\/GSSG\/141/)).toBeTruthy()
    // Close button hands control back
    await user.click(screen.getByText('إغلاق'))
    expect(onClose).toHaveBeenCalled()
  })

  it('Open in Word is a real anchor with the ms-word url (no auto-navigation)', async () => {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    vi.spyOn(apiMod.api, 'getBook').mockResolvedValue(bookWith(null))

    render(
      createElement(WordHandoffDialog, {
        session: FAKE_SESSION,
        open: true,
        onClose: vi.fn(),
      }),
      { wrapper: makeWrapper(qc) },
    )

    const link = screen.getByText('فتح في Word').closest('a')
    expect(link).toBeTruthy()
    expect(link?.getAttribute('href')).toMatch(/^ms-word:/)
    // The browser-permission hint accompanies it.
    expect(screen.getByText(/المتصفح يطلب الإذن/)).toBeTruthy()
  })

  it('shows a positive saved state once a Word save exists', async () => {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    vi.spyOn(apiMod.api, 'getBook').mockResolvedValue(bookWith('2026-07-17T10:05:00Z'))

    render(
      createElement(WordHandoffDialog, {
        session: FAKE_SESSION,
        open: true,
        onClose: vi.fn(),
      }),
      { wrapper: makeWrapper(qc) },
    )

    await waitFor(() => expect(screen.getByText(/تم الحفظ من Word ✓/)).toBeTruthy())
    expect(screen.queryByText('لم يصل أي حفظ من Word بعد')).toBeNull()
  })

  it('shows the live preview canvas once a Word save exists', async () => {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    vi.spyOn(apiMod.api, 'getBook').mockResolvedValue(bookWith('2026-07-17T10:05:00Z'))

    render(
      createElement(WordHandoffDialog, {
        session: FAKE_SESSION,
        open: true,
        onClose: vi.fn(),
      }),
      { wrapper: makeWrapper(qc) },
    )

    const pane = await screen.findByTestId('word-live-preview')
    const canvas = pane.querySelector('[data-testid="doc-pdf-canvas"]')
    expect(canvas?.getAttribute('data-pdf-url')).toContain('/word-sessions/preview')
  })

  it('finished view offers Save as template', async () => {
    const user = userEvent.setup()
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    vi.spyOn(apiMod.api, 'getBook').mockResolvedValue(bookWith('2026-07-17T10:05:00Z'))
    const finished = {
      ...bookWith(null),
      versions: [
        {
          id: 1,
          version_no: 1,
          pdf_url: '/api/v1/documents/9/download?format=pdf',
          docx_url: '/api/v1/documents/9/download?format=docx',
        },
      ],
    } as unknown as BookRead
    vi.spyOn(apiMod.api, 'finishWordSession').mockResolvedValue(finished)
    const saveSpy = vi
      .spyOn(apiMod.api, 'saveBookAsTemplate')
      .mockResolvedValue({ name: 'قالبي.docx', modified_at: '2026-07-19T10:00:00', kind: 'custom' })

    render(
      createElement(WordHandoffDialog, {
        session: FAKE_SESSION,
        open: true,
        onClose: vi.fn(),
      }),
      { wrapper: makeWrapper(qc) },
    )

    await waitFor(() => {
      const btn = screen.getByText('إنهاء التحرير').closest('button')
      expect(btn?.disabled).toBe(false)
    })
    await user.click(screen.getByText('إنهاء التحرير'))
    await screen.findByTestId('doc-pdf-canvas')

    await user.click(screen.getByText('حفظ كقالب'))
    const input = await screen.findByRole('textbox')
    await user.clear(input)
    await user.type(input, 'قالبي')
    await user.click(screen.getByText('حفظ'))
    await waitFor(() => expect(saveSpy).toHaveBeenCalledWith(42, 'قالبي'))
  })

  it('Finish with no PDF yet shows the pending hint instead of the canvas', async () => {
    const user = userEvent.setup()
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    vi.spyOn(apiMod.api, 'getBook').mockResolvedValue(bookWith('2026-07-17T10:05:00Z'))
    const finished = {
      ...bookWith(null),
      versions: [
        {
          id: 1,
          version_no: 1,
          pdf_url: null,
          docx_url: '/api/v1/documents/9/download?format=docx',
        },
      ],
    } as unknown as BookRead
    vi.spyOn(apiMod.api, 'finishWordSession').mockResolvedValue(finished)

    render(
      createElement(WordHandoffDialog, {
        session: FAKE_SESSION,
        open: true,
        onClose: vi.fn(),
      }),
      { wrapper: makeWrapper(qc) },
    )

    await waitFor(() => {
      const btn = screen.getByText('إنهاء التحرير').closest('button')
      expect(btn?.disabled).toBe(false)
    })
    await user.click(screen.getByText('إنهاء التحرير'))

    await waitFor(() =>
      expect(screen.getByText(/جارٍ تجهيز ملف PDF/)).toBeTruthy(),
    )
    expect(screen.queryByTestId('doc-pdf-canvas')).toBeNull()
  })
})
