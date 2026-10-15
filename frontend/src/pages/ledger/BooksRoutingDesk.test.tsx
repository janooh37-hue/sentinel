import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, useLocation, useNavigate } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { BookRead } from '@/lib/api'
import type * as ApiModule from '@/lib/api'

vi.mock('@/lib/authContext', () => ({ useAuth: () => ({ user: { id: 1, role: 'employee' } }) }))
vi.mock('@/lib/useCapabilities', () => ({ useCapabilities: () => ({ has: () => false }) }))
vi.mock('@/lib/useIsMobile', () => ({ useIsMobile: () => false }))
vi.mock('@/pages/books/RecordPaperViewer', () => ({
  default: ({ papers }: { papers: { url: string }[] }) => <div role="document" data-url={papers[0]?.url} />,
}))
vi.mock('@/lib/api', async (original) => {
  const actual = await original<typeof ApiModule>()
  return { ...actual, api: { ...actual.api, markBookInboxDone: vi.fn(), undoBookInboxDone: vi.fn() } }
})

import { api } from '@/lib/api'
import { BooksRoutingDesk } from './BooksRoutingDesk'

const BOOK: BookRead = {
  id: 7, ref_number: 'GS-7', subject: 'Staff instruction', category_id: null,
  direction: 'incoming', stamp_style: null, created_at: '2026-10-12T09:00:00Z',
  deleted_at: null, priority: null, approval_state: 'none', access_scope: 'full',
  confidentiality: 'general', can_write: false, can_send: false,
  can_change_confidentiality: false, can_sign: false, can_review: false, is_draft: false,
  doc_manager_has_signature: false, is_word_book: false,
  included_papers_revision: 0, included_papers_fixed_page_count: 0,
  included_papers_total_page_count: 0, current_template_id: null, service_id: 'General Book',
  my_inbox: { id: 9, purpose: 'action', sent_by_user_id: 2, sent_by_name: 'Khalid', sent_at: '2026-10-12T09:00:00Z', read_at: null },
}

function RouterControls(): React.JSX.Element {
  const location = useLocation()
  const navigate = useNavigate()
  return <><output aria-label="URL">{location.search}</output><button onClick={() => navigate(-1)}>Browser Back</button></>
}

function mount(url = '/ledger?tab=books'): QueryClient {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(<QueryClientProvider client={qc}><MemoryRouter initialEntries={[url]}><BooksRoutingDesk /><RouterControls /></MemoryRouter></QueryClientProvider>)
  return qc
}
beforeEach(() => {
  vi.spyOn(api, 'listBooks').mockResolvedValue({ items: [], total: 0, limit: 50, offset: 0 })
  vi.spyOn(api, 'getInboxSummary').mockResolvedValue({ unread: 0, received: 0, sent: 0, archived: 0, by_purpose: { info: 0, action: 0, reply: 0, circulate: 0 } })
  vi.spyOn(api, 'listBookRecipients').mockResolvedValue([])
  vi.spyOn(api, 'getBookThread').mockResolvedValue([])
})
afterEach(() => { cleanup(); vi.restoreAllMocks() })

describe('Books routing desk', () => {
  it.each([
    ['incoming', 'received'], ['done', 'done'], ['outgoing', 'sent'], ['archived', 'archived'],
  ])('maps the %s URL scope to inbox=%s', async (scope, inbox) => {
    mount(`/ledger?tab=books&scope=${scope}`)
    await waitFor(() => expect(api.listBooks).toHaveBeenCalledWith(expect.objectContaining({ inbox })))
  })

  it('switches scope without mixing recipient inbox with record direction', async () => {
    mount()
    await waitFor(() => expect(api.listBooks).toHaveBeenCalledWith(expect.objectContaining({ inbox: 'received' })))
    await userEvent.click(screen.getByRole('tab', { name: 'Outgoing' }))
    await waitFor(() => expect(api.listBooks).toHaveBeenLastCalledWith(expect.objectContaining({ inbox: 'sent' })))
    await userEvent.click(screen.getByRole('tab', { name: 'Archived' }))
    await waitFor(() => expect(api.listBooks).toHaveBeenLastCalledWith(expect.objectContaining({ inbox: 'archived' })))
  })

  it('opens and marks read without refetching the list, showing list metadata before detail arrives', async () => {
    vi.mocked(api.listBooks).mockResolvedValue({ items: [BOOK], total: 1, limit: 50, offset: 0 })
    // The app's ES2023 lib does not expose Promise.withResolvers.
    let resolveBook!: (book: BookRead) => void
    vi.spyOn(api, 'getBook').mockImplementation(() => new Promise((resolve) => { resolveBook = resolve }))
    const qc = mount()
    const invalidate = vi.spyOn(qc, 'invalidateQueries')
    await userEvent.click(await screen.findByRole('button', { name: /GS-7/ }))
    expect(screen.getByRole('heading', { name: BOOK.subject! })).toBeInTheDocument()
    await waitFor(() => expect(api.getBook).toHaveBeenCalledWith(7))
    resolveBook({ ...BOOK, versions: [{ id: 1, version_no: 1, document_id: 73, status: 'none', trigger: 'create', has_fields: false, created_at: BOOK.created_at, manager_sig_embedded: false }], my_inbox: { ...BOOK.my_inbox!, read_at: '2026-10-15T09:00:00Z' } })
    expect(await screen.findByRole('document')).toHaveAttribute('data-url', expect.stringContaining('/documents/73/download'))
    await userEvent.click(screen.getByRole('button', { name: 'Details' }))
    expect(screen.getByRole('link', { name: 'Open in Records' })).toHaveAttribute('href', '/books/7')
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['books', 'inbox-summary'] })
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['notifications', 'counts'] })
    expect(api.listBooks).toHaveBeenCalledTimes(1)
    expect(qc.getQueryData<{ items: BookRead[] }>(['books', 'routing', 'incoming', '', 0])?.items[0].my_inbox?.read_at).toBeTruthy()
  })

  it('pushes the reader URL and restores selection, search and list scroll on collapse and browser Back', async () => {
    vi.mocked(api.listBooks).mockResolvedValue({ items: [BOOK], total: 1, limit: 50, offset: 0 })
    vi.spyOn(api, 'getBook').mockResolvedValue(BOOK)
    mount('/ledger?tab=books&scope=incoming')
    const search = screen.getByRole('searchbox')
    await userEvent.type(search, 'Staff')
    await waitFor(() => expect(api.listBooks).toHaveBeenLastCalledWith(expect.objectContaining({ q: 'Staff' })))
    const row = await screen.findByRole('button', { name: /GS-7/ })
    const scroller = row.closest('ul')!.parentElement!
    fireEvent.scroll(scroller, { target: { scrollTop: 180 } })
    await userEvent.click(row)
    await userEvent.click(await screen.findByRole('button', { name: 'Expand' }))
    expect(screen.getByLabelText('URL').textContent).toContain('view=reader')
    expect(screen.queryByRole('searchbox')).not.toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Collapse' }))
    expect(screen.getByLabelText('URL').textContent).not.toContain('view=reader')
    expect(screen.getByRole('searchbox')).toHaveValue('Staff')
    expect(screen.getByRole('button', { name: /GS-7/ })).toHaveAttribute('aria-current', 'true')
    expect(scroller.scrollTop).toBe(180)
    await userEvent.click(screen.getByRole('button', { name: 'Expand' }))
    await userEvent.click(screen.getByRole('button', { name: 'Browser Back' }))
    expect(screen.getByLabelText('URL').textContent).not.toContain('view=reader')
    expect(screen.getByRole('searchbox')).toHaveValue('Staff')
  })

  it.each([false, true])('moves done out of Incoming and advances selection before refresh completes (reader=%s)', async (reader) => {
    const nextBook = { ...BOOK, id: 8, ref_number: 'GS-8', subject: 'Next instruction' }
    vi.mocked(api.listBooks).mockResolvedValueOnce({ items: [BOOK, nextBook], total: 2, limit: 50, offset: 0 })
    // Keep the invalidation fetch pending to prove the queue updates locally.
    vi.mocked(api.listBooks).mockImplementation(() => new Promise(() => {}))
    vi.spyOn(api, 'getBook').mockImplementation(async (id) => id === BOOK.id ? BOOK : nextBook)
    vi.mocked(api.markBookInboxDone).mockResolvedValue({ ...BOOK.my_inbox!, done_at: '2026-10-15T10:00:00Z', read_at: '2026-10-15T09:00:00Z' })
    mount()
    await userEvent.click(await screen.findByRole('button', { name: /GS-7/ }))
    await screen.findByRole('button', { name: 'Mark as done' })
    if (reader) await userEvent.click(screen.getByRole('button', { name: 'Expand' }))
    await userEvent.click(await screen.findByRole('button', { name: 'Mark as done' }))
    await waitFor(() => expect(api.markBookInboxDone).toHaveBeenCalledWith(7))
    await waitFor(() => expect(screen.getByRole('heading', { name: 'Next instruction' })).toBeInTheDocument())
    if (reader) await userEvent.click(screen.getByRole('button', { name: 'Collapse' }))
    expect(screen.queryByRole('button', { name: /GS-7/ })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: /GS-8/ })).toHaveAttribute('aria-current', 'true')
    expect(screen.getByLabelText('URL').textContent).toContain('book=8')
  })

  it('undoes done in Done and returns the book to Incoming', async () => {
    let done = true
    vi.mocked(api.listBooks).mockImplementation(async ({ inbox } = {}) => {
      const items = inbox === 'done' ? (done ? [{ ...BOOK, my_inbox: { ...BOOK.my_inbox!, done_at: '2026-10-15T10:00:00Z' } }] : []) : done ? [] : [BOOK]
      return { items, total: items.length, limit: 50, offset: 0 }
    })
    vi.spyOn(api, 'getBook').mockImplementation(async () => ({ ...BOOK, my_inbox: { ...BOOK.my_inbox!, done_at: done ? '2026-10-15T10:00:00Z' : null } }))
    vi.mocked(api.undoBookInboxDone).mockImplementation(async () => { done = false; return BOOK.my_inbox! })
    mount('/ledger?tab=books&scope=done')
    await userEvent.click(await screen.findByRole('button', { name: /GS-7/ }))
    await userEvent.click(await screen.findByRole('button', { name: 'Undo done' }))
    await waitFor(() => expect(api.undoBookInboxDone).toHaveBeenCalledWith(7))
    await waitFor(() => expect(screen.queryByRole('button', { name: /GS-7/ })).not.toBeInTheDocument())
    await userEvent.click(screen.getByRole('tab', { name: 'Incoming' }))
    expect(await screen.findByRole('button', { name: /GS-7/ })).toBeInTheDocument()
  })
})
