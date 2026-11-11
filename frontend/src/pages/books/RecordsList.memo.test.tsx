/**
 * RecordsList — a selection change re-renders only the rows whose own props
 * changed, and closed row menus never build their items.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render } from '@testing-library/react'
import { createElement } from 'react'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, it, vi } from 'vitest'

import type { BookRead } from '@/lib/api'
import { RecordsList } from './RecordsList'
import type { RecordNavState } from './useRecordNavContext'

const rowRenders = vi.hoisted(() => ({ count: 0 }))
vi.mock('./serviceLabels', async (original) => {
  const actual = await original<typeof import('./serviceLabels')>()
  return { ...actual, useServiceLabel: () => { rowRenders.count += 1; return (id: string) => id } }
})
vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (k: string) => k, i18n: { language: 'en', dir: () => 'ltr' } }),
}))

function book(id: number): BookRead {
  return {
    id, ref_number: `GS-${id}`, subject: `Subject ${id}`, category_id: null, direction: 'incoming', stamp_style: null,
    created_at: '2026-07-17T10:00:00', deleted_at: null, urgency: 'Normal', approval_state: 'none', access_scope: 'full',
    grade: 'unclassified', distribution: 'named', metadata_only: false, can_write: false, can_send: false,
    can_change_grade: false, can_sign: false, can_review: false, is_draft: false, is_word_book: false,
    doc_manager_has_signature: false, included_papers_revision: 0, included_papers_fixed_page_count: 0,
    included_papers_total_page_count: 0, current_template_id: null, service_id: 'General Book',
  } as unknown as BookRead
}

const ROWS = [book(1), book(2), book(3), book(4)]

function list(selectedId: number | null, rowMenu: (b: BookRead) => never[]): React.ReactElement {
  const nav = (): RecordNavState => ({ from: '/books', queue: [1, 2, 3, 4], scrollY: 0 })
  return createElement(QueryClientProvider, { client: new QueryClient() }, createElement(MemoryRouter, null,
    createElement(RecordsList, { rows: ROWS, selectedId, nav, onSelect: () => undefined, rowMenu, onRowMenuOpen: () => undefined, isInmateReporter: false })))
}

describe('RecordsList rows', () => {
  it('re-renders only the rows whose selection changed, and builds no menu items while closed', () => {
    const itemsFor = vi.fn((): never[] => [])
    const { rerender } = render(list(1, itemsFor))
    expect(rowRenders.count).toBe(ROWS.length)
    rowRenders.count = 0
    // Fresh callbacks and a fresh nav object, as the page produces on every render.
    rerender(list(2, (): never[] => []))
    expect(rowRenders.count).toBe(2)
    expect(itemsFor).not.toHaveBeenCalled()
  })
})
