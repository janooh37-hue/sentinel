/**
 * RecordStateOverrideDialog — the admin "set this record to any state" control.
 *
 * Asserted under lng=ar (the app's default) so an English leak can't pass, and
 * against the real `bookStateLabel` vocabulary so the picker and the register
 * chips can't drift apart.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { createElement, type ReactNode } from 'react'
import i18n from 'i18next'
import { initReactI18next } from 'react-i18next'

import ar from '@/locales/ar.json'
import { RecordStateOverrideDialog } from './RecordStateOverrideDialog'
import { RECORD_STATES, recordStateOf } from '@/pages/books/bookStateLabel'
import * as apiMod from '@/lib/api'
import type { BookRead } from '@/lib/api'

void i18n.use(initReactI18next).init({
  lng: 'ar',
  resources: { ar: { translation: ar } },
  interpolation: { escapeValue: false },
})

vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }))

const BOOK: BookRead = {
  id: 7,
  ref_number: '1/1/196',
  category_id: 'general',
  category: {
    id: 'general',
    name_ar: 'عام',
    name_en: 'General',
    requires_approval: false,
    prefix: 'G',
  },
  subject: 'الغيابات دون عذر رسمي',
  direction: null,
  stamp_style: null,
  approval_state: 'pending',
  created_at: '2026-07-01T00:00:00Z',
  deleted_at: null,
  priority: 'Normal',
  is_draft: false,
  voided_at: null,
  edit_session: null,
  classification_code: '1/1',
  is_word_book: false,
  service_id: 'General Book',
  versions: [],
  doc_manager_has_signature: false,
  current_template_id: null,
  included_papers_revision: 0,
  included_papers_fixed_page_count: 0,
  included_papers_total_page_count: 0,
}

function wrapper(qc: QueryClient) {
  return ({ children }: { children: ReactNode }) =>
    createElement(QueryClientProvider, { client: qc }, children)
}

function makeQc(): QueryClient {
  return new QueryClient({ defaultOptions: { queries: { retry: false } } })
}

function open(book: BookRead = BOOK, onClose = vi.fn()) {
  const qc = makeQc()
  render(createElement(RecordStateOverrideDialog, { book, onClose }), {
    wrapper: wrapper(qc),
  })
  return { qc, onClose }
}

beforeEach(() => {
  vi.restoreAllMocks()
})

describe('RecordStateOverrideDialog', () => {
  it('offers every overridable state, so no state is unreachable', () => {
    open()
    for (const state of RECORD_STATES) {
      expect(screen.getByTestId(`state-option-${state}`)).toBeInTheDocument()
    }
    // Guard against the list silently shrinking to the approval states only.
    expect(RECORD_STATES).toContain('voided')
  })

  it('marks the current state and blocks re-picking it', () => {
    open()
    const current = screen.getByTestId('state-option-pending')
    expect(current.querySelector('input')).toBeDisabled()
    expect(current).toHaveTextContent('الحالية')
    expect(screen.getByTestId('state-override-confirm')).toBeDisabled()
  })

  it('treats a voided record as being in the voided state, not draft', () => {
    open({ ...BOOK, approval_state: 'none', voided_at: '2026-07-01T12:00:00Z' })
    expect(screen.getByTestId('state-option-voided').querySelector('input')).toBeDisabled()
    // The draft row stays pickable — that is the un-void path.
    expect(screen.getByTestId('state-option-none').querySelector('input')).toBeEnabled()
  })

  it('sends the picked state and closes on success', async () => {
    const user = userEvent.setup()
    const spy = vi
      .spyOn(apiMod.api, 'overrideBookState')
      .mockResolvedValue({ ...BOOK, approval_state: 'approved' })
    const { onClose } = open()

    await user.click(screen.getByTestId('state-option-approved').querySelector('input')!)
    await user.click(screen.getByTestId('state-override-confirm'))

    await waitFor(() => expect(spy).toHaveBeenCalledWith(7, 'approved', null))
    await waitFor(() => expect(onClose).toHaveBeenCalled())
  })

  it('passes the typed reason through', async () => {
    const user = userEvent.setup()
    const spy = vi
      .spyOn(apiMod.api, 'overrideBookState')
      .mockResolvedValue({ ...BOOK, approval_state: 'none' })
    open()

    await user.click(screen.getByTestId('state-option-none').querySelector('input')!)
    await user.type(screen.getByLabelText(/السبب/), 'خطأ في السجل')
    await user.click(screen.getByTestId('state-override-confirm'))

    await waitFor(() => expect(spy).toHaveBeenCalledWith(7, 'none', 'خطأ في السجل'))
  })

  it('requires a reason before returning or rejecting (mirrors the backend)', async () => {
    const user = userEvent.setup()
    const spy = vi.spyOn(apiMod.api, 'overrideBookState')
    open()

    await user.click(screen.getByTestId('state-option-rejected').querySelector('input')!)
    expect(screen.getByTestId('state-override-confirm')).toBeDisabled()

    await user.type(screen.getByLabelText(/السبب/), 'مرفوض إدارياً')
    expect(screen.getByTestId('state-override-confirm')).toBeEnabled()
    expect(spy).not.toHaveBeenCalled()
  })

  it('spells out that forcing approved adds no signature', async () => {
    const user = userEvent.setup()
    open()
    await user.click(screen.getByTestId('state-option-approved').querySelector('input')!)
    expect(screen.getByTestId('state-override-consequence')).toHaveTextContent('دون توقيع')
  })

  it('warns that a signed copy survives but stops being served', async () => {
    const user = userEvent.setup()
    open({ ...BOOK, approval_state: 'approved' })
    await user.click(screen.getByTestId('state-option-none').querySelector('input')!)
    expect(screen.getByText(/تبقى النسخة الموقّعة محفوظة/)).toBeInTheDocument()
  })

  it('renders Arabic state labels, not raw state keys', () => {
    open()
    expect(screen.getByTestId('state-option-approved')).toHaveTextContent('تمت الموافقة')
    expect(screen.getByTestId('state-option-voided')).toHaveTextContent('ملغي')
    expect(screen.getByTestId('state-option-none')).toHaveTextContent('مسودة')
  })
})

describe('recordStateOf', () => {
  it('mirrors the backend: voided_at wins over approval_state', () => {
    expect(recordStateOf({ approval_state: 'none', voided_at: '2026-01-01T00:00:00Z' })).toBe(
      'voided',
    )
    expect(recordStateOf({ approval_state: 'approved', voided_at: null })).toBe('approved')
    expect(recordStateOf({})).toBe('none')
  })
})
