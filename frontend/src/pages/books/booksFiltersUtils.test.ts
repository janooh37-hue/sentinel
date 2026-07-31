/**
 * Regression guard for the "service X + drafts" ordering bug (Task 8, fix
 * round 1): the service filter must gate BEFORE the drafts early-return in
 * both the mobile predicate and desktop's search-branch predicate, or
 * selecting a service and turning drafts on would leak every other
 * service's drafts through — disagreeing with desktop's main branch, whose
 * `allRows` is already server-scoped to the selected service.
 */
import { describe, it, expect } from 'vitest'

import type { BookRead } from '@/lib/api'
import { DEFAULT_BOOKS_FILTERS, matchesBookFilters, matchesDesktopSearchRow } from './booksFiltersUtils'

function makeBook(overrides: Partial<BookRead>): BookRead {
  return {
    id: 1,
    ref_number: 'GS-0001',
    category_id: 'GS',
    category: null,
    subject: 'subject',
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
    service_id: 'Report',
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

describe('matchesBookFilters (mobile)', () => {
  it('service + drafts: only the selected service survives, not every service', () => {
    const filters = { ...DEFAULT_BOOKS_FILTERS, serviceId: 'Report', drafts: true }
    const reportDraft = makeBook({ service_id: 'Report', is_draft: true })
    const otherDraft = makeBook({ service_id: 'Leave', is_draft: true })
    expect(matchesBookFilters(reportDraft, filters)).toBe(true)
    expect(matchesBookFilters(otherDraft, filters)).toBe(false)
  })

  it('drafts alone (service = all) still shows every service, unchanged', () => {
    const filters = { ...DEFAULT_BOOKS_FILTERS, serviceId: 'all', drafts: true }
    const otherDraft = makeBook({ service_id: 'Leave', is_draft: true })
    expect(matchesBookFilters(otherDraft, filters)).toBe(true)
  })

  it('a non-draft row of the selected service is excluded when drafts is on', () => {
    const filters = { ...DEFAULT_BOOKS_FILTERS, serviceId: 'Report', drafts: true }
    const reportNonDraft = makeBook({ service_id: 'Report', is_draft: false })
    expect(matchesBookFilters(reportNonDraft, filters)).toBe(false)
  })
})

describe('matchesDesktopSearchRow (desktop, active server search)', () => {
  it('service + drafts: only the selected service survives, not every service', () => {
    const scope = { railService: 'Report', showDrafts: true, spineState: 'all' }
    const reportDraft = makeBook({ service_id: 'Report', is_draft: true })
    const otherDraft = makeBook({ service_id: 'Leave', is_draft: true })
    expect(matchesDesktopSearchRow(reportDraft, scope)).toBe(true)
    expect(matchesDesktopSearchRow(otherDraft, scope)).toBe(false)
  })

  it('drafts alone (railService = all) still shows every service, unchanged', () => {
    const scope = { railService: 'all', showDrafts: true, spineState: 'all' }
    const otherDraft = makeBook({ service_id: 'Leave', is_draft: true })
    expect(matchesDesktopSearchRow(otherDraft, scope)).toBe(true)
  })
})
