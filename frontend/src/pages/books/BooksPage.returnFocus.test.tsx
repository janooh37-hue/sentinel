/**
 * Back from a record: the list mounts with `state.focusBookId`; the page
 * restores the scroll, scrolls the row into view and selects it (inline tier) —
 * it neither bounces back into the record nor lets auto-select pick row one.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { BooksPage } from './BooksPage'
import { RecordDeleteProvider } from './RecordDeleteProvider'

const rows = vi.hoisted(() => [3, 2, 1].map((id) => ({
  id,
  ref_number: `GS-000${id}`,
  subject: `Subject ${id}`,
  approval_state: 'pending',
  category_id: 'GS',
  direction: 'incoming',
  created_at: `2026-01-0${id}T10:00:00`,
  service_id: 'General Book',
  is_draft: false,
  voided_at: null,
  classification_code: null,
  edit_session: null,
  signing_path: null,
  versions: [],
  attachment_paths: [],
  imported_doc: null,
  created_by_name: 'Sara',
})))

vi.mock('@/lib/api', () => ({
  api: {
    getBookFacets: vi.fn().mockResolvedValue({ total: 3, services: [] }),
    listBooks: vi.fn().mockResolvedValue({ items: rows }),
    listBookCategories: vi.fn().mockResolvedValue([]),
    listTemplates: vi.fn().mockResolvedValue({ items: [] }),
  },
  apiErrorMessage: (error: unknown) => String(error),
  ApiError: class ApiError extends Error {},
}))
vi.mock('@/lib/useCapabilities', () => ({ useCapabilities: () => ({ has: () => true }) }))
vi.mock('@/lib/authContext', () => ({ useAuth: () => ({ user: { role: 'admin' } }) }))
vi.mock('@/lib/useIsMobile', () => ({ useIsMobile: () => false }))
vi.mock('./StatusSpine', () => ({ StatusSpine: () => null }))
vi.mock('./FormRail', () => ({ FormRail: () => null, MineChip: () => null }))
vi.mock('./RecordPane', () => ({
  RecordPane: ({ book }: { book: { id: number } | null }) => (
    <div data-testid="record-pane">{book?.id ?? 'none'}</div>
  ),
}))
vi.mock('@/pages/scanBack/ScanBackEntry', () => ({ ScanBackEntry: () => null }))
vi.mock('@/components/refresh/RefreshButton', () => ({ RefreshButton: () => null }))

function Probe(): React.JSX.Element {
  const location = useLocation()
  return (
    <output data-testid="loc">
      {location.pathname}
      {location.search}|{JSON.stringify(location.state)}
    </output>
  )
}

afterEach(() => vi.restoreAllMocks())

describe('Records list return focus', () => {
  it('selects and scrolls to the row the reader came back from, staying on the list', async () => {
    const scrollIntoView = vi.spyOn(Element.prototype, 'scrollIntoView')
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    render(
      <QueryClientProvider client={client}>
        <MemoryRouter
          initialEntries={[
            { pathname: '/books', search: '?status=pending', state: { focusBookId: 1, scrollY: 120 } },
          ]}
        >
          <Probe />
          <RecordDeleteProvider>
            <Routes>
              <Route path="/books" element={<BooksPage />} />
              <Route path="/books/:id" element={<div data-testid="record-page" />} />
            </Routes>
          </RecordDeleteProvider>
        </MemoryRouter>
      </QueryClientProvider>,
    )

    // Row 1 is the OLDEST: auto-select would have picked row 3 (newest first).
    await waitFor(() => expect(screen.getByTestId('record-pane')).toHaveTextContent('1'))
    expect(screen.queryByTestId('record-page')).not.toBeInTheDocument()

    const row = document.querySelector('[data-book-id="1"]')
    expect(scrollIntoView.mock.contexts).toContain(row)
    expect(document.querySelector<HTMLElement>('[data-records-scroller]')?.scrollTop).toBe(120)

    // The restore state is consumed, and the selection is a plain `open` param.
    await waitFor(() => expect(screen.getByTestId('loc').textContent).toMatch(/\|null$/))
    const [url] = screen.getByTestId('loc').textContent!.split('|')
    expect(url.startsWith('/books?')).toBe(true)
    expect(new URLSearchParams(url.split('?')[1]).get('open')).toBe('1')
    expect(new URLSearchParams(url.split('?')[1]).get('status')).toBe('pending')
  })

  it('lists the newest record first', async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    render(
      <QueryClientProvider client={client}>
        <MemoryRouter initialEntries={['/books']}>
          <RecordDeleteProvider>
            <Routes>
              <Route path="/books" element={<BooksPage />} />
            </Routes>
          </RecordDeleteProvider>
        </MemoryRouter>
      </QueryClientProvider>,
    )
    await waitFor(() => expect(document.querySelectorAll('[data-book-id]')).toHaveLength(3))
    const order = Array.from(document.querySelectorAll('[data-book-id]'), (el) =>
      el.getAttribute('data-book-id'),
    )
    expect(order).toEqual(['3', '2', '1'])
    // …and with nothing in the URL, the first row is the one auto-selected.
    await waitFor(() => expect(screen.getByTestId('record-pane')).toHaveTextContent('3'))
  })
})
