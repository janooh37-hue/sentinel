/**
 * Phone Records list: cards are real links carrying the nav context, creator
 * meta, Select mode + bulk bar (Add to email · Delete), pending-delete rows
 * hidden, empty state action, and Back-from-record return focus that flashes
 * the card without redirecting back into the record.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { BookRead } from '@/lib/api'
import { BooksMobileList, type BooksMobileListProps } from './BooksMobileList'

const mocks = vi.hoisted(() => ({
  scheduleDelete: vi.fn(),
  pending: new Set<number>(),
  toast: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn() }),
  addToBasket: vi.fn(() => ({ added: true, key: 'k' })),
  buildItem: vi.fn(async (book: { id: number }) => ({ bookId: book.id })),
}))

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (k: string, o?: { count?: number; ref?: string }) =>
      o?.count !== undefined ? `${k}:${o.count}` : o?.ref ? `${k}:${o.ref}` : k,
    i18n: { language: 'ar' },
  }),
}))
vi.mock('sonner', () => ({ toast: mocks.toast }))
vi.mock('@/lib/useCapabilities', () => ({
  useCapabilities: () => ({ capabilities: new Set(), isLoading: false, has: () => true }),
}))
vi.mock('./RecordDeleteProvider', () => ({
  useRecordDelete: () => ({ scheduleDelete: mocks.scheduleDelete, pendingIds: mocks.pending }),
}))
vi.mock('@/lib/emailBasket', () => ({ addToBasket: mocks.addToBasket }))
vi.mock('./recordsBasket', () => ({ buildRecordBasketItem: mocks.buildItem }))

/** Select checkbox for a ref (the ref is bidi-isolated inside the label). */
const box = (ref: string): HTMLElement =>
  screen.getByRole('checkbox', { name: new RegExp(`books\\.list\\.selectRef:.*${ref}`) })

function book(id: number, over: Partial<BookRead> = {}): BookRead {
  return {
    id,
    ref_number: `G-2026-00${id}`,
    category_id: 'general',
    category: { id: 'general', name_ar: 'عام', name_en: 'General', requires_approval: false, prefix: 'G' },
    subject: `موضوع ${id}`,
    direction: null,
    stamp_style: null,
    approval_state: 'none',
    created_at: '2026-07-01T00:00:00Z',
    deleted_at: null,
    priority: 'Normal',
    is_draft: false,
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
    can_sign: false,
    can_review: false,
    created_by_name: 'سالم الكعبي',
    ...over,
  } as BookRead
}

function Probe(): React.JSX.Element {
  const loc = useLocation()
  return (
    <>
      <output data-testid="loc">{loc.pathname + loc.search}</output>
      <output data-testid="state">{JSON.stringify(loc.state)}</output>
    </>
  )
}

function renderList(
  props: Partial<BooksMobileListProps> = {},
  entry: string | { pathname: string; search?: string; state?: unknown } = '/books?mine=1',
) {
  const all: BooksMobileListProps = {
    isPending: false,
    isError: false,
    onRetry: vi.fn(),
    rows: [book(1), book(2), book(3, { approval_state: 'approved' })],
    hasFilters: false,
    isAr: true,
    isInmateReporter: false,
    canSubmit: false,
    userId: 1,
    highlightedId: null,
    onSubmit: vi.fn(),
    onClearFilters: vi.fn(),
    ...props,
  }
  const client = new QueryClient()
  const tree = (p: BooksMobileListProps): React.JSX.Element => (
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[entry]}>
        <Routes>
          <Route
            path="/books"
            element={
              <>
                <BooksMobileList {...p} />
                <Probe />
              </>
            }
          />
          <Route path="/books/:id" element={<Probe />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>
  )
  const { rerender } = render(tree(all))
  return { ...all, setRows: (rows: BookRead[]) => rerender(tree({ ...all, rows })) }
}

beforeEach(() => {
  mocks.pending = new Set()
  mocks.scheduleDelete.mockClear()
  mocks.toast.mockClear()
  mocks.toast.success.mockClear()
  mocks.toast.error.mockClear()
  mocks.addToBasket.mockClear()
  mocks.buildItem.mockClear()
  Element.prototype.scrollIntoView = vi.fn()
})

describe('BooksMobileList cards', () => {
  it('opens a record through a real link carrying { from, queue }', async () => {
    renderList({ rows: [book(1), book(3)] })
    const link = screen.getByRole('link', { name: 'G-2026-003' })
    expect(link).toHaveAttribute('href', '/books/3')
    await userEvent.click(link)
    expect(screen.getByTestId('loc')).toHaveTextContent('/books/3')
    const state = JSON.parse(screen.getByTestId('state').textContent ?? 'null') as {
      from: string
      queue: number[]
      scrollY: number
    }
    expect(state.from).toBe('/books?mine=1')
    expect(state.queue).toEqual([1, 3])
    expect(state.scrollY).toBe(0)
  })

  it('shows the creator (or the unknown fallback) and a papers count only above one paper', () => {
    renderList({
      rows: [
        book(1, { created_by_name: 'سالم الكعبي', attachment_paths: ['a.pdf', 'b.pdf'] }),
        book(2, { created_by_name: null }),
      ],
    })
    const first = document.querySelector('[data-book-id="1"]') as HTMLElement
    const second = document.querySelector('[data-book-id="2"]') as HTMLElement
    expect(within(first).getByText('سالم الكعبي').tagName).toBe('BDI')
    expect(first).toHaveTextContent('books.pane.papers:2')
    expect(second).toHaveTextContent('books.record.creatorUnknown')
    expect(second).not.toHaveTextContent('books.pane.papers')
  })

  it('empty + filtered offers Clear filters', async () => {
    const props = renderList({ rows: [], hasFilters: true })
    expect(screen.getByText('books.list.noMatch')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'books.filters.clear' }))
    expect(props.onClearFilters).toHaveBeenCalledTimes(1)
  })
})

describe('BooksMobileList select mode', () => {
  it('bulk Delete schedules only deletable rows and says how many were skipped', async () => {
    renderList()
    await userEvent.click(screen.getByRole('button', { name: 'books.list.select' }))
    expect(screen.queryByRole('link')).not.toBeInTheDocument()
    await userEvent.click(box('G-2026-001'))
    await userEvent.click(box('G-2026-003'))
    expect(screen.getByText('books.list.selected:2')).toBeInTheDocument()
    expect(screen.getAllByText('books.list.skippedMany:1').length).toBeGreaterThan(0)
    await userEvent.click(screen.getByRole('button', { name: 'books.list.deleteMany:1' }))
    // Confirm step first: nothing is scheduled until the dialog is confirmed.
    expect(mocks.scheduleDelete).not.toHaveBeenCalled()
    const dialog = await screen.findByRole('dialog')
    expect(within(dialog).getByText('books.record.deleteBody')).toBeInTheDocument()
    expect(within(dialog).getByText('books.list.skippedMany:1')).toBeInTheDocument()
    await userEvent.click(within(dialog).getByRole('button', { name: 'books.bulk.delete' }))
    expect(mocks.scheduleDelete).toHaveBeenCalledWith([{ id: 1, ref: 'G-2026-001' }])
    expect(mocks.toast).toHaveBeenCalledWith('books.list.skippedMany:1')
  })

  it('cancelling the confirm schedules nothing', async () => {
    renderList()
    await userEvent.click(screen.getByRole('button', { name: 'books.list.select' }))
    await userEvent.click(box('G-2026-001'))
    await userEvent.click(screen.getByRole('button', { name: 'books.list.deleteMany:1' }))
    await userEvent.click(await screen.findByRole('button', { name: 'common.cancel' }))
    expect(mocks.scheduleDelete).not.toHaveBeenCalled()
  })

  it('Delete is disabled when every pick is blocked, with the skipped reason shown', async () => {
    renderList()
    await userEvent.click(screen.getByRole('button', { name: 'books.list.select' }))
    await userEvent.click(box('G-2026-003'))
    const del = screen.getByRole('button', { name: 'books.list.deleteMany:0' })
    expect(del).toBeDisabled()
    expect(del).toHaveAccessibleDescription('books.list.skippedMany:1')
  })

  it('prunes picks for rows that left the list so they do not reappear', async () => {
    const view = renderList()
    await userEvent.click(screen.getByRole('button', { name: 'books.list.select' }))
    await userEvent.click(box('G-2026-001'))
    expect(screen.getByText('books.list.selected:1')).toBeInTheDocument()
    act(() => view.setRows([book(2), book(3, { approval_state: 'approved' })]))
    expect(screen.queryByText(/books\.list\.selected/)).not.toBeInTheDocument()
    act(() => view.setRows([book(1), book(2), book(3, { approval_state: 'approved' })]))
    expect(screen.queryByText(/books\.list\.selected/)).not.toBeInTheDocument()
    expect(box('G-2026-001')).not.toBeChecked()
  })

  it('bulk Add to email adds every picked record to the basket', async () => {
    renderList()
    await userEvent.click(screen.getByRole('button', { name: 'books.list.select' }))
    await userEvent.click(box('G-2026-001'))
    await userEvent.click(box('G-2026-002'))
    await userEvent.click(screen.getByRole('button', { name: 'basket.add' }))
    await waitFor(() => expect(mocks.addToBasket).toHaveBeenCalledTimes(2))
    expect(mocks.toast.success).toHaveBeenCalled()
  })

  it('Done leaves select mode and drops the picks', async () => {
    renderList()
    await userEvent.click(screen.getByRole('button', { name: 'books.list.select' }))
    await userEvent.click(box('G-2026-001'))
    await userEvent.click(screen.getByRole('button', { name: 'common.done' }))
    expect(screen.queryByRole('checkbox')).not.toBeInTheDocument()
    expect(screen.queryByText(/books.list.selected/)).not.toBeInTheDocument()
  })

  it('is unavailable to inmate reporters', () => {
    renderList({ isInmateReporter: true })
    expect(screen.queryByRole('button', { name: 'books.list.select' })).not.toBeInTheDocument()
  })
})

describe('BooksMobileList return focus', () => {
  it('flashes and reveals the card on Back, clears the state and never navigates into the record', async () => {
    renderList({}, { pathname: '/books', search: '?mine=1', state: { focusBookId: 2, scrollY: 0 } })
    const card = document.querySelector('[data-book-id="2"]') as HTMLElement
    await waitFor(() => expect(Element.prototype.scrollIntoView).toHaveBeenCalled())
    expect(card.className).toContain('bg-accent-soft')
    await waitFor(() => expect(screen.getByTestId('state')).toHaveTextContent('null'))
    expect(screen.getByTestId('loc')).toHaveTextContent('/books?mine=1')
  })
})
