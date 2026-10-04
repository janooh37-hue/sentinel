/**
 * Records page tiers (measured from the page wrapper, in rem) and the page's
 * list keys: auto-select only where the pane is inline, the drawer below 64rem,
 * J/K move the selection, Enter opens with the list context, Esc closes the drawer.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { KeyboardShortcutsProvider } from '@/lib/keyboardShortcuts'

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
  RecordPane: ({
    book,
    mode,
    onClose,
  }: {
    book: { id: number } | null
    mode: string
    onClose?: () => void
  }) => (
    <aside data-testid="pane" data-mode={mode}>
      {book?.id ?? 'none'}
      {onClose && (
        <button type="button" onClick={onClose}>
          close-pane
        </button>
      )}
    </aside>
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

function renderPage(): void {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={['/books?status=pending']}>
        <KeyboardShortcutsProvider>
          <Probe />
          <RecordDeleteProvider>
            <Routes>
              <Route path="/books" element={<BooksPage />} />
              <Route path="/books/:id" element={<div data-testid="record-page" />} />
            </Routes>
          </RecordDeleteProvider>
        </KeyboardShortcutsProvider>
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

const openParam = (): string | null =>
  new URLSearchParams(screen.getByTestId('loc').textContent!.split('|')[0].split('?')[1]).get('open')

/** The wrapper's content width in px; 16px = 1rem, so 1280 is 80rem. */
function setWidth(px: number): void {
  vi.spyOn(Element.prototype, 'clientWidth', 'get').mockReturnValue(px)
}

describe('Records page tiers', () => {
  beforeEach(() => window.localStorage.clear())
  afterEach(() => vi.restoreAllMocks())

  it('full (≥ 80rem): inline pane, first row auto-selected', async () => {
    setWidth(1400)
    renderPage()
    await waitFor(() => expect(screen.getByTestId('pane')).toHaveTextContent('3'))
    expect(screen.getByTestId('pane')).toHaveAttribute('data-mode', 'inline')
    expect(document.querySelector('[data-records-page]')).toHaveAttribute('data-tier', 'full')
    expect(openParam()).toBe('3')
  })

  it('icons (64–80rem): still an inline pane with auto-select', async () => {
    setWidth(1100)
    renderPage()
    await waitFor(() => expect(screen.getByTestId('pane')).toHaveAttribute('data-mode', 'inline'))
    expect(document.querySelector('[data-records-page]')).toHaveAttribute('data-tier', 'icons')
    await waitFor(() => expect(openParam()).toBe('3'))
  })

  it('drawer (< 64rem): no auto-select, full-width list, the row opens a drawer that × and Esc close', async () => {
    setWidth(800)
    renderPage()
    await waitFor(() => expect(document.querySelectorAll('[data-book-id]')).toHaveLength(3))
    expect(document.querySelector('[data-records-page]')).toHaveAttribute('data-tier', 'drawer')
    expect(openParam()).toBeNull()
    expect(screen.queryByTestId('pane')).not.toBeInTheDocument()

    const rowButton = document.querySelector('[data-book-id="2"] button') as HTMLElement
    await userEvent.click(rowButton)
    expect(openParam()).toBe('2')
    expect(await screen.findByTestId('pane')).toHaveAttribute('data-mode', 'drawer')

    await userEvent.click(screen.getByRole('button', { name: 'close-pane' }))
    expect(openParam()).toBeNull()
    expect(screen.queryByTestId('pane')).not.toBeInTheDocument()

    await userEvent.click(rowButton)
    expect(await screen.findByTestId('pane')).toBeInTheDocument()
    await userEvent.keyboard('{Escape}')
    await waitFor(() => expect(screen.queryByTestId('pane')).not.toBeInTheDocument())
    expect(openParam()).toBeNull()
  })
})

describe('Records page list keys', () => {
  afterEach(() => vi.restoreAllMocks())

  it('J/K move the selection, Enter opens the record with the list context', async () => {
    setWidth(1400)
    renderPage()
    await waitFor(() => expect(openParam()).toBe('3'))

    await userEvent.keyboard('j')
    await waitFor(() => expect(openParam()).toBe('2'))
    await userEvent.keyboard('j')
    await waitFor(() => expect(openParam()).toBe('1'))
    await userEvent.keyboard('j') // end of the list: stays
    expect(openParam()).toBe('1')
    await userEvent.keyboard('k')
    await waitFor(() => expect(openParam()).toBe('2'))

    await userEvent.keyboard('{Enter}')
    await screen.findByTestId('record-page')
    const [path, state] = screen.getByTestId('loc').textContent!.split('|')
    expect(path).toBe('/books/2')
    // `open` is stripped; the queue is the displayed (newest-first) order.
    expect(JSON.parse(state)).toEqual({ from: '/books?status=pending', queue: [3, 2, 1], scrollY: 0 })
  })
})
