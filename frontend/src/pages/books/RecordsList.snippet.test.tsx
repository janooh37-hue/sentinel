/**
 * RecordsList — snippet rendering (Task 16, TDD RED → GREEN)
 *
 * Tests:
 * - Row with search_snippet renders snippet text + Arabic "تطابق في نص الكتاب" label (lng=ar).
 * - `[token]` delimiters become <mark> highlights.
 * - Row without search_snippet renders no snippet label.
 */

import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { createElement } from 'react'

import { RecordsList } from './RecordsList'
import type { BookRead } from '@/lib/api'

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (k: string) => {
      const ar: Record<string, string> = {
        'books.search.bodyMatch': 'تطابق في نص الكتاب',
        'books.empty': 'لا توجد إدخالات',
        'books.formKind.general': 'كتاب عام',
        'books.pane.papers': 'الأوراق',
      }
      return ar[k] ?? k
    },
    i18n: { language: 'ar' },
  }),
}))

// Minimal BookRead with search_snippet extension.
function makeBook(overrides: Partial<BookRead> & { search_snippet?: string | null }): BookRead & { search_snippet?: string | null } {
  return {
    id: 1,
    ref_number: 'GS-0001',
    category_id: 'GS',
    category: { id: 'GS', name_en: 'General', name_ar: 'عام', prefix: 'GS', requires_approval: false },
    subject: 'موضوع عام',
    direction: 'outgoing',
    stamp_style: null,
    doc_id: null,
    imported_doc: null,
    created_at: '2026-07-17T10:00:00',
    deleted_at: null,
    priority: 'Normal',
    approval_state: 'none',
    classification_code: null,
    voided_at: null,
    is_draft: false,
    edit_session: null,
    signing_path: null,
    submitted_by_user_id: null,
    submitted_by_name: null,
    submitted_by_g: null,
    doc_manager_user_id: null,
    doc_manager_name: null,
    doc_manager_has_signature: false,
    is_word_book: false,
    your_step_kind: null,
    approval_steps: [],
    attachment_paths: [],
    versions: [],
    sms: [],
    employee_id: null,
    employee_name_snapshot: null,
    current_template_id: null,
    ...overrides,
  }
}

describe('RecordsList snippet rendering (lng=ar)', () => {
  it('renders Arabic bodyMatch label + highlighted snippet on a body-hit row', () => {
    const book = makeBook({ search_snippet: 'نص الكتاب يحتوي على [تصريح] أمني' })

    render(
      createElement(RecordsList, {
        rows: [book as BookRead],
        selectedId: null,
        onSelect: () => undefined,
      }),
    )

    // Arabic label
    expect(screen.getByText('تطابق في نص الكتاب')).toBeTruthy()

    // Plain text parts of snippet
    expect(screen.getByText(/نص الكتاب يحتوي على/)).toBeTruthy()

    // Highlighted token rendered as <mark> (brackets stripped)
    const marks = document.querySelectorAll('mark')
    expect(marks.length).toBeGreaterThan(0)
    expect(marks[0].textContent).toBe('تصريح')
  })

  it('does not render bodyMatch label when search_snippet is absent', () => {
    const book = makeBook({ search_snippet: null })

    render(
      createElement(RecordsList, {
        rows: [book as BookRead],
        selectedId: null,
        onSelect: () => undefined,
      }),
    )

    expect(screen.queryByText('تطابق في نص الكتاب')).toBeNull()
  })

  it('< 2 chars search: bodyMatch label not shown (no snippet on row)', () => {
    // A row without snippet (server search not triggered for short queries)
    const book = makeBook({ search_snippet: undefined })

    render(
      createElement(RecordsList, {
        rows: [book as BookRead],
        selectedId: null,
        onSelect: () => undefined,
      }),
    )

    expect(screen.queryByText('تطابق في نص الكتاب')).toBeNull()
  })
})
