/**
 * Records page tiers (measured from the page wrapper, in rem) and the page's
 * list keys: auto-select only where the pane is inline, the drawer below 64rem,
 * J/K move the selection, Enter opens with the list context, Esc closes the drawer.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { api } from '@/lib/api'
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
vi.mock('./FormRail', () => ({
  FormRail: () => null,
  MineChip: ({ onToggle }: { onToggle: () => void }) => (
    <button type="button" onClick={onToggle}>
      mine-chip
    </button>
  ),
}))
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

describe('Records page list keys inside the drawer', () => {
  afterEach(() => vi.restoreAllMocks())

  it('J/K step the open drawer to the neighbouring row and Esc closes it once', async () => {
    setWidth(800)
    renderPage()
    await waitFor(() => expect(document.querySelectorAll('[data-book-id]')).toHaveLength(3))
    await userEvent.click(document.querySelector('[data-book-id="3"] button') as HTMLElement)
    expect(screen.getByRole('dialog', { name: 'GS-0003' })).toBeInTheDocument()

    await userEvent.keyboard('j')
    await waitFor(() => expect(openParam()).toBe('2'))
    expect(await screen.findByRole('dialog', { name: 'GS-0002' })).toBeInTheDocument()
    expect(screen.getByTestId('pane')).toHaveTextContent('2')

    await userEvent.keyboard('{Escape}')
    await waitFor(() => expect(openParam()).toBeNull())
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })
})

describe('Records page list keys with a focused row', () => {
  afterEach(() => vi.restoreAllMocks())

  it('J moves focus with the selection so Enter and Ctrl+Enter open the new row, not the clicked one', async () => {
    setWidth(1400)
    renderPage()
    await waitFor(() => expect(openParam()).toBe('3'))
    await userEvent.click(document.querySelector('[data-book-id="3"] button') as HTMLElement)
    await userEvent.keyboard('j')
    await waitFor(() => expect(openParam()).toBe('2'))
    expect(document.activeElement).toBe(document.querySelector('[data-book-id="2"] button'))

    const open = vi.spyOn(window, 'open').mockReturnValue(null)
    await userEvent.keyboard('{Control>}{Enter}{/Control}')
    expect(open).toHaveBeenCalledWith('/books/2', '_blank', 'noopener')

    await userEvent.keyboard('{Enter}')
    await screen.findByTestId('record-page')
    expect(screen.getByTestId('loc').textContent!.split('|')[0]).toBe('/books/2')
  })
})

describe('Records page selection that outlives its row', () => {
  const resetList = (): void => {
    vi.mocked(api.listBooks).mockResolvedValue({ items: rows } as never)
  }
  afterEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
    resetList()
  })

  it('re-selects the first row when Created-by-me drops the selected one', async () => {
    setWidth(1400)
    vi.mocked(api.listBooks).mockImplementation((async (params?: { created_by_me?: boolean }) => ({
      items: params?.created_by_me ? rows.filter((row) => row.id === 1) : rows,
    })) as never)
    renderPage()
    await waitFor(() => expect(screen.getByTestId('pane')).toHaveTextContent('3'))

    await userEvent.click(screen.getByRole('button', { name: 'mine-chip' }))
    await waitFor(() => expect(screen.getByTestId('pane')).toHaveTextContent('1'))
    expect(openParam()).toBe('1')
  })

  it('counts and deletes only the ticked rows still on screen', async () => {
    setWidth(1400)
    vi.mocked(api.listBooks).mockImplementation((async (params?: { q?: string }) => ({
      items: params?.q ? rows.filter((row) => row.subject.includes(params.q as string)) : rows,
    })) as never)
    renderPage()
    await waitFor(() => expect(document.querySelectorAll('[data-book-id]')).toHaveLength(3))
    const boxes = screen.getAllByRole('checkbox')
    await userEvent.click(boxes[0])
    await userEvent.click(boxes[1])
    expect(screen.getByText('2 selected')).toBeInTheDocument()

    await userEvent.type(screen.getByTestId('records-search'), 'Subject 3')
    await waitFor(() => expect(document.querySelectorAll('[data-book-id]')).toHaveLength(1))
    expect(screen.getByText('1 selected')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Add to email (1)' })).toBeInTheDocument()
  })

  describe('crossing into the drawer tier', () => {
    const observers: Array<() => void> = []
    const resizeTo = (px: number): void => {
      setWidth(px)
      act(() => observers.forEach((cb) => cb()))
    }
    beforeEach(() => {
      observers.length = 0
      vi.stubGlobal(
        'ResizeObserver',
        class {
          constructor(cb: () => void) {
            observers.push(cb)
          }
          observe(): void {}
          unobserve(): void {}
          disconnect(): void {}
        },
      )
    })

    it('clears an auto-selected row instead of popping the drawer', async () => {
      setWidth(1400)
      renderPage()
      await waitFor(() => expect(openParam()).toBe('3'))
      resizeTo(800)
      await waitFor(() => expect(openParam()).toBeNull())
      expect(screen.queryByTestId('pane')).not.toBeInTheDocument()
    })

    it('keeps a row the user chose, as a drawer', async () => {
      setWidth(1400)
      renderPage()
      await waitFor(() => expect(openParam()).toBe('3'))
      await userEvent.click(document.querySelector('[data-book-id="2"] button') as HTMLElement)
      resizeTo(800)
      expect(await screen.findByTestId('pane')).toHaveAttribute('data-mode', 'drawer')
      expect(openParam()).toBe('2')
      expect(screen.getByRole('dialog', { name: 'GS-0002' })).toHaveAttribute('aria-modal', 'true')
    })
  })
})
