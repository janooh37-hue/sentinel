/**
 * Records page preview + row menu: the preview starts collapsed on every visit
 * (the normal/wide width is still remembered), a row click opens it, a double-click
 * opens the record, and the row menu only exists while the preview is collapsed.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes, useLocation, useNavigate } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { KeyboardShortcutsProvider } from '@/lib/keyboardShortcuts'

import { BooksPage } from './BooksPage'
import { RecordDeleteProvider } from './RecordDeleteProvider'

const rows = vi.hoisted(() =>
  [3, 2, 1].map((id) => ({
    id,
    ref_number: `GS-000${id}`,
    subject: `Subject ${id}`,
    approval_state: 'pending',
    direction: 'incoming',
    created_at: `2026-01-0${id}T10:00:00`,
    service_id: 'General Book',
    is_draft: false,
    voided_at: null,
    classification_code: null,
    grade: 'unclassified',
    distribution: 'named',
    metadata_only: false,
    urgency: 'Normal',
    edit_session: null,
    signing_path: null,
    versions: [],
    attachment_paths: [],
    imported_doc: null,
    created_by_name: 'Sara',
    my_inbox: null,
    can_send: id !== 1,
    can_change_grade: false,
  })),
)

vi.mock('@/lib/api', () => ({
  api: {
    getBookFacets: vi.fn().mockResolvedValue({ total: 3, services: [] }),
    getInboxSummary: vi.fn().mockResolvedValue({ unread: 0, received: 0, sent: 0, by_purpose: {} }),
    listBooks: vi.fn().mockResolvedValue({ items: rows }),
    getBook: vi.fn((id: number) => Promise.resolve(rows.find((book) => book.id === id))),
    getBookThread: vi.fn().mockResolvedValue([]),
    markBookInboxDone: vi.fn(),
    undoBookInboxDone: vi.fn(),
    archiveBookInbox: vi.fn(),
    unarchiveBookInbox: vi.fn(),
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
    size,
    onSizeChange,
    onClose,
  }: {
    book: { id: number } | null
    mode: string
    size: string
    onSizeChange: (size: string) => void
    onClose?: () => void
  }) => (
    <aside data-testid="pane" data-size={size} data-mode={mode}>
      {book?.id ?? 'none'}
      {size === 'collapsed' ? (
        <button type="button" onClick={() => onSizeChange('normal')}>expand</button>
      ) : (
        <>
          <div data-testid="preview-content">Preview {book?.id}</div>
          <button type="button" onClick={() => onSizeChange('collapsed')}>collapse</button>
          <button type="button" onClick={() => onSizeChange(size === 'wide' ? 'normal' : 'wide')}>
            {size === 'wide' ? 'normal width' : 'wide width'}
          </button>
        </>
      )}
      {onClose && <button type="button" aria-label="Close" onClick={onClose}>close drawer</button>}
    </aside>
  ),
}))
vi.mock('@/pages/scanBack/ScanBackEntry', () => ({ ScanBackEntry: () => null }))
vi.mock('@/components/refresh/RefreshButton', () => ({ RefreshButton: () => null }))

function Probe(): React.JSX.Element {
  const location = useLocation()
  return (
    <>
      <output data-testid="loc">{location.pathname}{location.search}</output>
      <output data-testid="nav-state">{JSON.stringify(location.state)}</output>
    </>
  )
}

function FullRecordPage(): React.JSX.Element {
  const navigate = useNavigate()
  return (
    <div data-testid="record-page">
      <button type="button" onClick={() => navigate(-1)}>Back to records</button>
    </div>
  )
}

function renderPage(initialEntry: string | { pathname: string; state: unknown } = '/books'): void {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[initialEntry]}>
        <KeyboardShortcutsProvider>
          <Probe />
          <RecordDeleteProvider>
            <Routes>
              <Route path="/books" element={<BooksPage />} />
              <Route path="/books/:id" element={<FullRecordPage />} />
            </Routes>
          </RecordDeleteProvider>
        </KeyboardShortcutsProvider>
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

const row = (id: number): HTMLElement => document.querySelector<HTMLElement>(`[data-book-id="${id}"]`)!
const selectButton = (id: number): HTMLElement => row(id).querySelector('button')!
const menuButton = (id: number): HTMLElement | null =>
  within(row(id)).queryByRole('button', { name: new RegExp(`GS-000${id}`) })

const observers = new Set<() => void>()
let pageWidth = 1400

function resizeTo(width: number): void {
  pageWidth = width
  act(() => observers.forEach((callback) => callback()))
}

beforeEach(() => {
  window.localStorage.clear()
  pageWidth = 1400
  vi.spyOn(Element.prototype, 'clientWidth', 'get').mockImplementation(() => pageWidth)
  vi.stubGlobal('ResizeObserver', class {
    private readonly callback: () => void
    constructor(callback: () => void) { this.callback = callback }
    observe(): void { observers.add(this.callback) }
    unobserve(): void {}
    disconnect(): void { observers.delete(this.callback) }
  })
})

afterEach(() => {
  vi.useRealTimers()
  observers.clear()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe('Records page preview', () => {
  it.each(['normal', 'wide'])('starts collapsed with remembered %s width; selection and collapse preserve it', async (width) => {
    window.localStorage.setItem('gssg.books.pane.size', JSON.stringify(width))
    renderPage()
    // The first row is auto-selected but the preview stays collapsed.
    await waitFor(() => expect(screen.getByTestId('pane')).toHaveTextContent('3'), { timeout: 5000 })
    expect(screen.getByTestId('pane')).toHaveAttribute('data-size', 'collapsed')
    expect(screen.queryByTestId('preview-content')).toBeNull()

    // Clicking the already auto-selected row must also expand it.
    await userEvent.click(selectButton(3))
    expect(screen.getByTestId('pane')).toHaveAttribute('data-size', width)
    expect(screen.getByTestId('preview-content')).toHaveTextContent('Preview 3')
    await userEvent.click(selectButton(2))
    expect(screen.getByTestId('pane')).toHaveTextContent('2')

    await userEvent.click(screen.getByRole('button', { name: 'collapse' }))
    expect(screen.getByTestId('pane')).toHaveAttribute('data-size', 'collapsed')
    expect(screen.queryByTestId('preview-content')).toBeNull()
    expect(window.localStorage.getItem('gssg.books.pane.size')).toBe(JSON.stringify(width))
    // Re-expanding from the strip keeps the remembered width.
    await userEvent.click(screen.getByRole('button', { name: 'expand' }))
    expect(screen.getByTestId('pane')).toHaveAttribute('data-size', width)
  })

  it('remembers width changes but not whether the preview was open on the next visit', async () => {
    renderPage()
    await waitFor(() => expect(screen.getByTestId('pane')).toHaveTextContent('3'))
    await userEvent.click(selectButton(2))
    expect(screen.getByTestId('pane')).toHaveAttribute('data-size', 'normal')
    await userEvent.click(screen.getByRole('button', { name: 'wide width' }))
    expect(window.localStorage.getItem('gssg.books.pane.size')).toBe(JSON.stringify('wide'))

    await userEvent.dblClick(selectButton(2))
    await screen.findByTestId('record-page')
    await userEvent.click(screen.getByRole('button', { name: 'Back to records' }))
    await waitFor(() => expect(screen.getByTestId('pane')).toHaveTextContent('2'))
    expect(screen.getByTestId('pane')).toHaveAttribute('data-size', 'collapsed')
    await userEvent.click(selectButton(2))
    expect(screen.getByTestId('pane')).toHaveAttribute('data-size', 'wide')
    await userEvent.click(screen.getByRole('button', { name: 'normal width' }))
    expect(window.localStorage.getItem('gssg.books.pane.size')).toBe(JSON.stringify('normal'))
    await userEvent.click(screen.getByRole('button', { name: 'collapse' }))
    await userEvent.click(selectButton(1))
    expect(screen.getByTestId('pane')).toHaveAttribute('data-size', 'normal')
  })

  it('restores a record-page return selection without expanding the preview', async () => {
    renderPage({ pathname: '/books', state: { focusBookId: 2, scrollY: 150 } })
    await waitFor(() => expect(screen.getByTestId('pane')).toHaveTextContent('2'))
    expect(screen.getByTestId('pane')).toHaveAttribute('data-size', 'collapsed')
    expect(document.querySelector('[data-records-scroller]')).toHaveProperty('scrollTop', 150)
  })

  it('opens the full record on a double-click with filters, queue and current scroll', async () => {
    renderPage('/books?status=pending')
    await waitFor(() => expect(row(2)).toBeInTheDocument())
    document.querySelector<HTMLElement>('[data-records-scroller]')!.scrollTop = 175
    await userEvent.dblClick(selectButton(2))
    await screen.findByTestId('record-page')
    expect(screen.getByTestId('loc')).toHaveTextContent('/books/2')
    expect(JSON.parse(screen.getByTestId('nav-state').textContent!)).toEqual({
      from: '/books?status=pending',
      queue: [3, 2, 1],
      scrollY: 175,
    })
  })
})

describe('Records page drawer preview', () => {
  it('does not auto-select or open until a row is clicked, and collapse hides the drawer', async () => {
    pageWidth = 800
    window.localStorage.setItem('gssg.books.pane.size', JSON.stringify('wide'))
    renderPage()
    await waitFor(() => expect(row(2)).toBeInTheDocument())
    expect(screen.getByTestId('loc')).toHaveTextContent('/books')
    expect(screen.getByTestId('loc').textContent).not.toContain('open=')
    expect(screen.queryByTestId('pane')).toBeNull()
    expect(menuButton(2)).toBeInTheDocument()

    fireEvent.click(selectButton(2))
    expect(selectButton(2)).toHaveAttribute('aria-current', 'true')
    expect(screen.queryByTestId('pane')).toBeNull()
    expect(await screen.findByRole('dialog', { name: 'GS-0002' })).toHaveAttribute('aria-modal', 'true')
    expect(screen.getByTestId('pane')).toHaveAttribute('data-mode', 'drawer')
    expect(menuButton(1)).toBeNull()
    await userEvent.click(screen.getByRole('button', { name: 'collapse' }))
    expect(screen.queryByTestId('pane')).toBeNull()
    expect(menuButton(2)).toBeInTheDocument()
    expect(window.localStorage.getItem('gssg.books.pane.size')).toBe(JSON.stringify('wide'))
    await userEvent.click(selectButton(2))
    expect(await screen.findByRole('dialog', { name: 'GS-0002' })).toBeInTheDocument()
  })

  it('leaves the row uncovered for the second click and navigates without opening the drawer', async () => {
    pageWidth = 800
    renderPage('/books?status=pending')
    await waitFor(() => expect(row(2)).toBeInTheDocument())
    vi.useFakeTimers()
    const button = selectButton(2)
    fireEvent.click(button, { detail: 1 })
    expect(button).toHaveAttribute('aria-current', 'true')
    expect(screen.queryByTestId('pane')).toBeNull()
    act(() => vi.advanceTimersByTime(200))
    expect(screen.queryByRole('dialog')).toBeNull()
    fireEvent.click(button, { detail: 2 })
    fireEvent.doubleClick(button)
    expect(screen.getByTestId('record-page')).toBeInTheDocument()
    expect(JSON.parse(screen.getByTestId('nav-state').textContent!)).toEqual({
      from: '/books?status=pending',
      queue: [3, 2, 1],
      scrollY: 0,
    })
    await act(async () => { await vi.advanceTimersByTimeAsync(600) })
    expect(screen.queryByTestId('pane')).toBeNull()
  })

  it('cancels pending drawer expansion when the row menu opens', async () => {
    pageWidth = 800
    renderPage()
    await waitFor(() => expect(row(2)).toBeInTheDocument())
    vi.useFakeTimers()
    fireEvent.click(selectButton(2))
    expect(screen.queryByTestId('pane')).toBeNull()
    fireEvent.contextMenu(selectButton(2))
    expect(screen.getByRole('menu')).toBeInTheDocument()
    await act(async () => { await vi.advanceTimersByTimeAsync(600) })
    expect(screen.queryByTestId('pane')).toBeNull()
    expect(screen.getByRole('menu')).toBeInTheDocument()
  })

  it('cancels pending drawer expansion on Escape', async () => {
    pageWidth = 800
    renderPage()
    await waitFor(() => expect(row(2)).toBeInTheDocument())
    vi.useFakeTimers()
    fireEvent.click(selectButton(2))
    fireEvent.keyDown(window, { key: 'Escape' })
    await act(async () => { await vi.advanceTimersByTimeAsync(600) })
    expect(screen.queryByTestId('pane')).toBeNull()
    expect(screen.getByTestId('loc').textContent).not.toContain('open=')
  })

  it('keeps a deep-linked row collapsed until explicitly selected', async () => {
    pageWidth = 800
    renderPage('/books?open=2')
    await waitFor(() => expect(row(2)).toBeInTheDocument())
    expect(selectButton(2)).toHaveAttribute('aria-current', 'true')
    expect(screen.queryByTestId('pane')).toBeNull()
    expect(menuButton(2)).toBeInTheDocument()
    await userEvent.click(selectButton(2))
    expect(await screen.findByRole('dialog', { name: 'GS-0002' })).toBeInTheDocument()
  })

  it('restores a record-page return without opening a drawer', async () => {
    pageWidth = 800
    renderPage({ pathname: '/books', state: { focusBookId: 2, scrollY: 150 } })
    await waitFor(() => expect(row(2)).toBeInTheDocument())
    expect(document.querySelector('[data-records-scroller]')).toHaveProperty('scrollTop', 150)
    expect(screen.queryByTestId('pane')).toBeNull()
    expect(menuButton(2)).toBeInTheDocument()
  })

  it('never opens a drawer for an auto-selected or subsequently collapsed row on resize', async () => {
    renderPage()
    await waitFor(() => expect(screen.getByTestId('pane')).toHaveTextContent('3'))
    resizeTo(800)
    await waitFor(() => expect(screen.queryByTestId('pane')).toBeNull())
    expect(menuButton(3)).toBeInTheDocument()

    resizeTo(1400)
    await waitFor(() => expect(screen.getByTestId('pane')).toHaveAttribute('data-size', 'collapsed'))
    await userEvent.click(selectButton(2))
    await userEvent.click(screen.getByRole('button', { name: 'collapse' }))
    resizeTo(800)
    expect(screen.queryByTestId('pane')).toBeNull()
    expect(menuButton(2)).toBeInTheDocument()
  })

  it('keeps the preview explicitly expanded from the strip when entering the drawer tier', async () => {
    renderPage()
    await waitFor(() => expect(screen.getByTestId('pane')).toHaveTextContent('3'))
    await userEvent.click(screen.getByRole('button', { name: 'expand' }))
    resizeTo(800)
    expect(await screen.findByRole('dialog', { name: 'GS-0003' })).toBeInTheDocument()
    expect(screen.getByTestId('pane')).toHaveTextContent('3')
  })

  it.each(['close drawer', 'Escape'])('keeps an explicitly opened preview on resize, but %s closes it across tiers', async (action) => {
    window.localStorage.setItem('gssg.books.pane.size', JSON.stringify('wide'))
    renderPage()
    await waitFor(() => expect(screen.getByTestId('pane')).toHaveTextContent('3'))
    await userEvent.click(selectButton(2))
    resizeTo(800)
    expect(await screen.findByRole('dialog', { name: 'GS-0002' })).toBeInTheDocument()
    if (action === 'Escape') await userEvent.keyboard('{Escape}')
    else await userEvent.click(screen.getByRole('button', { name: 'Close' }))
    await waitFor(() => expect(screen.queryByTestId('pane')).toBeNull())
    expect(menuButton(2)).toBeInTheDocument()

    resizeTo(1400)
    await waitFor(() => expect(screen.getByTestId('pane')).toHaveTextContent('3'))
    expect(screen.getByTestId('pane')).toHaveAttribute('data-size', 'collapsed')
    await userEvent.click(selectButton(2))
    expect(screen.getByTestId('pane')).toHaveAttribute('data-size', 'wide')
  })
})

describe('Records page row menu', () => {
  it('returns the row menu when the preview is collapsed again', async () => {
    renderPage()
    await waitFor(() => expect(menuButton(2)).toBeInTheDocument())
    await userEvent.click(selectButton(2))
    expect(menuButton(2)).toBeNull()
    await userEvent.click(screen.getByRole('button', { name: 'collapse' }))
    expect(menuButton(2)).toBeInTheDocument()
  })

  it('exists only while the preview is collapsed', async () => {
    renderPage()
    await waitFor(() => expect(menuButton(2)).toBeInTheDocument())
    await userEvent.click(selectButton(2))
    expect(menuButton(2)).toBeNull()
    fireEvent.contextMenu(selectButton(1))
    expect(screen.queryByRole('menu')).toBeNull()
  })

  it('offers Send only on records the user can send, and opens from right-click', async () => {
    renderPage()
    await waitFor(() => expect(menuButton(2)).toBeInTheDocument())

    await userEvent.click(menuButton(2)!)
    const menu = await screen.findByRole('menu')
    expect(await within(menu).findByRole('menuitem', { name: /Send to/ })).toBeInTheDocument()
    expect(within(menu).queryByRole('menuitem', { name: /Change level/ })).toBeNull()
    await userEvent.keyboard('{Escape}')
    await waitFor(() => expect(screen.queryByRole('menu')).toBeNull())

    fireEvent.contextMenu(selectButton(1))
    const menu1 = await screen.findByRole('menu')
    expect(await within(menu1).findByRole('menuitem', { name: 'Open full record' })).toBeInTheDocument()
    await waitFor(() => expect(within(menu1).queryByRole('menuitem', { name: /Send to/ })).toBeNull())
  })
})
