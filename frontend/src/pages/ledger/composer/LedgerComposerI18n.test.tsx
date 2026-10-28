import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, render, screen } from '@testing-library/react'
import i18n from 'i18next'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

import { LedgerBookActions } from '@/components/books/LedgerBookActions'
import { LedgerDraftsList } from '@/components/books/LedgerDraftsList'
import { NewLedgerBookButton } from '@/components/books/NewLedgerBookButton'
import { api, type LedgerDraftRead } from '@/lib/api'
import ar from '@/locales/ar.json'
import en from '@/locales/en.json'

vi.mock('@/lib/useCapabilities', () => ({ useCapabilities: () => ({ has: () => true }) }))
vi.mock('@/lib/authContext', () => ({ useAuth: () => ({ user: { id: 1, role: 'employee' } }) }))
vi.mock('./LedgerBodyEditor', () => ({
  LedgerBodyEditor: ({ label }: { label: string }) => <textarea aria-label={label} />,
}))

import { LedgerComposerPage } from './LedgerComposerPage'

const DRAFT: LedgerDraftRead = {
  id: 12, draft_number: '000012', tab: null, grade: 'secret', importance: null,
  subjects: ['خطة الإجازات'], body_html: '', created_at: '2026-10-28T08:00:00Z', updated_at: '2026-10-28T08:00:00Z',
}

/** Physical-direction utilities; RTL needs the logical ones (ms/me/ps/pe/start/end). */
const PHYSICAL = /(^|\s)(-?(ml|mr|pl|pr|left|right|border-l|border-r|rounded-l|rounded-r|rounded-tl|rounded-tr|rounded-bl|rounded-br|scroll-ml|scroll-mr)-\S+|text-left|text-right|float-left|float-right)(?=\s|$)/

function leafKeys(node: unknown, prefix = ''): string[] {
  if (typeof node !== 'object' || node === null) return [prefix]
  return Object.entries(node).flatMap(([key, value]) => leafKeys(value, prefix ? `${prefix}.${key}` : key))
}

function mountAll(): HTMLElement {
  const { container } = render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <MemoryRouter initialEntries={['/ledger/compose/12']}>
        <Routes>
          <Route
            path="/ledger/compose/:draftId"
            element={<><NewLedgerBookButton /><LedgerDraftsList /><LedgerBookActions bookId={40} onRevisionChange={() => {}} /><LedgerComposerPage /></>}
          />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  )
  return container
}

beforeEach(() => {
  vi.spyOn(api, 'getLedgerDraft').mockResolvedValue(DRAFT)
  vi.spyOn(api, 'listLedgerDrafts').mockResolvedValue([DRAFT])
  vi.spyOn(api, 'listBookClassifications').mockResolvedValue({ items: [{ code: '1/1', tab: 1, name_ar: 'الغيابات', name_en: 'Absences', unit_ar: '' }] })
  vi.spyOn(api, 'getLedgerBook').mockResolvedValue({
    id: 40, ref_number: '1/2/7', grade: 'unclassified', importance: null, tab: 2, classification_code: '2/1',
    paper_date: '28-10-2026', approval_state: 'none', created_by_user_id: 1, voided: false,
    revisions: [{ version_id: 71, version_no: 1, trigger: 'initial', created_at: '2026-10-28T08:00:00Z', signed_at: '2026-10-28T09:00:00Z', superseded: false, locked: true }],
    selected_version_id: 71, subjects: ['x'], body_html: '<p>x</p>', content_sha256: 'abc',
  })
})
afterEach(() => { cleanup(); vi.restoreAllMocks() })

it('T-C9 English and Arabic carry the same ledgerBook.composer keys, none empty', () => {
  const enKeys = leafKeys(en.ledgerBook.composer).sort()
  expect(leafKeys(ar.ledgerBook.composer).sort()).toEqual(enKeys)
  const arText = (key: string): unknown => key.split('.').reduce<unknown>((node, part) => (node as Record<string, unknown>)[part], ar.ledgerBook.composer)
  expect(enKeys.filter((key) => String(arText(key)).trim() === '')).toEqual([])
})

it('T-C9 English surfaces use only logical direction utilities', async () => {
  const container = mountAll()
  await screen.findByRole('heading', { name: /DRAFT 000012/ })
  await screen.findByRole('button', { name: 'Start correction' })
  const physical = [...container.querySelectorAll('[class]')].map((el) => el.getAttribute('class') ?? '').filter((c) => PHYSICAL.test(c))
  expect(physical).toEqual([])
})

describe('Arabic', () => {
  beforeAll(async () => {
    i18n.addResourceBundle('ar', 'translation', ar, true, true)
    await i18n.changeLanguage('ar')
  })
  afterAll(async () => { await i18n.changeLanguage('en') })

  it('T-C9 renders every composer, drafts and book-action label in Arabic', async () => {
    mountAll()
    expect(await screen.findByRole('heading', { name: /مسودة 000012/ })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'كتاب سجل جديد' })).toBeInTheDocument()
    expect(await screen.findByRole('link', { name: /مسودة 000012.*خطة الإجازات/ })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'حذف مسودة 000012' })).toBeInTheDocument()
    expect(screen.getByLabelText('التبويب')).toHaveDisplayValue('اختر التبويب')
    expect(screen.getByRole('option', { name: '1 — الغيابات' })).toBeInTheDocument()
    expect(screen.getByRole('group', { name: 'الأهمية' })).toBeInTheDocument()
    for (const name of ['بدون', 'متوسطة', 'عالية']) expect(screen.getByRole('radio', { name })).toBeInTheDocument()
    expect(screen.getByText(/درجة السرية: /)).toBeInTheDocument()
    expect(screen.getByRole('group', { name: 'أسطر الموضوع' })).toBeInTheDocument()
    expect(screen.getByLabelText('سطر الموضوع 1')).toHaveAccessibleDescription(/السطر الأول هو الموضوع/)
    for (const name of ['إضافة سطر', 'حذف السطر 1', 'نقل السطر 1 إلى الأعلى', 'نقل السطر 1 إلى الأسفل', 'معاينة', 'حذف المسودة', 'حفظ وإرسال']) {
      expect(screen.getByRole('button', { name })).toBeInTheDocument()
    }
    expect(screen.getByLabelText('نص الكتاب')).toBeInTheDocument()
    expect(await screen.findByRole('button', { name: 'بدء تصحيح' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'طباعة' })).toBeInTheDocument()
    expect(screen.getByRole('option', { name: 'الإصدار 1 (موقّع)' })).toBeInTheDocument()
    expect(document.body.textContent).not.toMatch(/ledgerBook\.composer/)
  })
})
