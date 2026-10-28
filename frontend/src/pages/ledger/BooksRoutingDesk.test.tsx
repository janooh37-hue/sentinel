import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import i18n from 'i18next'
import { MemoryRouter, useLocation, useNavigate } from 'react-router-dom'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import ar from '@/locales/ar.json'
import en from '@/locales/en.json'
import type { BookFolderRead, BookRead } from '@/lib/api'
import type * as ApiModule from '@/lib/api'
import { useIsMobile } from '@/lib/useIsMobile'

vi.mock('@/lib/authContext', () => ({ useAuth: () => ({ user: { id: 1, role: 'employee' } }) }))
vi.mock('@/lib/useCapabilities', () => ({ useCapabilities: () => ({ has: () => false }) }))
vi.mock('@/lib/useIsMobile', () => ({ useIsMobile: vi.fn(() => false) }))
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
  deleted_at: null, urgency: 'Normal', approval_state: 'none', access_scope: 'full',
  grade: 'unclassified', distribution: 'named', metadata_only: false, can_write: false, can_send: false,
  can_change_grade: false, can_sign: false, can_review: false, is_draft: false,
  doc_manager_has_signature: false, is_word_book: false,
  included_papers_revision: 0, included_papers_fixed_page_count: 0,
  included_papers_total_page_count: 0, current_template_id: null, service_id: 'General Book',
  my_inbox: { id: 9, purpose: 'action', sent_by_user_id: 2, sent_by_name: 'Khalid', sent_at: '2026-10-12T09:00:00Z', read_at: null },
}

const FOLDER: BookFolderRead = {
  id: 3, name: 'Personnel', team: false, count: 2, can_manage: true,
  created_by_name: 'Khalid', created_by_name_ar: 'خالد',
  everyone: false, shared_users: [], shared_departments: [],
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
  vi.mocked(useIsMobile).mockReturnValue(false)
  vi.spyOn(api, 'listBooks').mockResolvedValue({ items: [], total: 0, limit: 50, offset: 0 })
  vi.spyOn(api, 'listBookFolders').mockResolvedValue([])
  vi.spyOn(api, 'getInboxSummary').mockResolvedValue({ unread: 0, received: 0, sent: 0, archived: 0, by_purpose: { info: 0, action: 0, reply: 0, circulate: 0 } })
  vi.spyOn(api, 'listBookRecipients').mockResolvedValue([])
  vi.spyOn(api, 'getBookThread').mockResolvedValue([])
})
afterEach(() => { cleanup(); vi.restoreAllMocks() })

describe('Books routing desk', () => {
  it.each(['grade', '-grade'])('passes the %s grade sort to the server', async (sort) => {
    mount(`/ledger?tab=books&sort=${sort}`)
    await waitFor(() => expect(api.listBooks).toHaveBeenCalledWith(expect.objectContaining({ sort })))
  })

  it.each([false, true])('keeps metadata-only rows nonopenable and nondraggable (mobile=%s)', async (mobile) => {
    vi.mocked(useIsMobile).mockReturnValue(mobile)
    const getBook = vi.spyOn(api, 'getBook')
    vi.mocked(api.listBooks).mockResolvedValue({ items: [{
      ...BOOK, metadata_only: true, grade: 'top_secret', classification_code: '7/2',
      subject: 'Hidden subject', created_by_name: 'Hidden creator',
      can_send: true, can_change_grade: true,
    }], total: 1, limit: 50, offset: 0 })
    mount()
    const ref = await screen.findByText('GS-7')
    const row = ref.closest('[data-book-id]') as HTMLElement
    expect(within(row).getByText('7/2')).toBeInTheDocument()
    expect(within(row).getByTestId('grade-mark')).toHaveTextContent('Top Secret')
    expect(row).not.toHaveTextContent(/Hidden|Khalid|For action/)
    expect(row.querySelector('a,button,input,[draggable="true"]')).toBeNull()
    expect(row.tagName).not.toBe('BUTTON')
    await userEvent.click(row)
    fireEvent.keyDown(row, { key: 'Enter' })
    fireEvent.doubleClick(row)
    expect(getBook).not.toHaveBeenCalled()
    expect(screen.getByLabelText('URL')).not.toHaveTextContent('book=')
  })

  const LEDGER = { ...BOOK, current_template_id: 'Ledger Book' }
  const before = (a: Element, b: Element): boolean => Boolean(a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING)

  // T-R2 (D7: a Ledger Book shows its own importance)
  it.each([
    ['high', 'Importance: High', 'text-destructive'],
    ['medium', 'Importance: Medium', 'text-caution'],
  ] as const)('marks a Ledger Book row by its own %s importance, whatever its urgency', async (importance, name, tone) => {
    vi.mocked(api.listBooks).mockResolvedValue({ items: [{ ...LEDGER, urgency: 'Normal', importance }], total: 1, limit: 50, offset: 0 })
    mount()
    const row = await screen.findByRole('button', { name: /GS-7/ })
    expect(within(row).getByRole('img', { name })).toHaveClass(tone)
    expect(row).toHaveAccessibleName(expect.stringContaining(name))
  })

  // T-R2
  it('leaves a Ledger Book row without importance unmarked, even when very urgent', async () => {
    vi.mocked(api.listBooks).mockResolvedValue({ items: [{ ...LEDGER, urgency: 'Very High', importance: null }], total: 1, limit: 50, offset: 0 })
    mount()
    const row = await screen.findByRole('button', { name: /GS-7/ })
    expect(row.querySelector('[data-importance]')).toBeNull()
  })

  // T-R2 (D7: any other record maps urgency)
  it.each([
    ['Normal', 'Importance: Medium'], ['High', 'Importance: Medium'], ['Very High', 'Importance: High'], [null, null],
  ] as const)('maps another record\'s %s urgency to its importance mark, without the old urgency flag', async (urgency, name) => {
    vi.mocked(api.listBooks).mockResolvedValue({ items: [{ ...BOOK, urgency, importance: 'high' }], total: 1, limit: 50, offset: 0 })
    mount()
    const row = await screen.findByRole('button', { name: /GS-7/ })
    if (name) expect(within(row).getByRole('img', { name })).toBeInTheDocument()
    else expect(row.querySelector('[data-importance]')).toBeNull()
    expect(row).not.toHaveTextContent(/Urgent/)
  })

  // T-R1
  it.each([false, true])('orders Purpose · Grade · Importance in the row and the record header (mobile=%s)', async (mobile) => {
    vi.mocked(useIsMobile).mockReturnValue(mobile)
    const book = { ...LEDGER, grade: 'secret' as const, importance: 'high' as const }
    vi.mocked(api.listBooks).mockResolvedValue({ items: [book], total: 1, limit: 50, offset: 0 })
    vi.spyOn(api, 'getBook').mockResolvedValue(book)
    mount()
    const row = await screen.findByRole('button', { name: /GS-7/ })
    const [purpose, grade, importance] = [within(row).getByRole('img', { name: 'For action' }), within(row).getByTestId('grade-mark'), within(row).getByRole('img', { name: 'Importance: High' })]
    expect(before(purpose, grade) && before(grade, importance)).toBe(true)
    await userEvent.click(row)
    const header = (await screen.findByRole('heading', { name: 'Staff instruction' })).closest('header')!
    const mark = within(header).getByRole('button', { name: 'Importance: High' })
    expect(before(within(header).getByText('For action'), within(header).getByTestId('grade-mark'))).toBe(true)
    expect(before(within(header).getByTestId('grade-mark'), mark)).toBe(true)
    mark.focus()
    expect(await screen.findByRole('tooltip')).toHaveTextContent('Importance: High')
  })

  it.each([
    ['incoming', 'received'], ['done', 'done'], ['outgoing', 'sent'], ['archived', 'archived'],
  ])('maps the %s URL scope to inbox=%s', async (scope, inbox) => {
    mount(`/ledger?tab=books&scope=${scope}`)
    await waitFor(() => expect(api.listBooks).toHaveBeenCalledWith(expect.objectContaining({ inbox })))
  })


  it('sorts by Reference on the server and flips the active direction', async () => {
    vi.mocked(api.listBooks).mockResolvedValue({ items: [BOOK], total: 1, limit: 50, offset: 0 })
    mount()
    await userEvent.click(await screen.findByRole('button', { name: 'Sort by Reference, ascending' }))
    await waitFor(() => expect(api.listBooks).toHaveBeenLastCalledWith(expect.objectContaining({ sort: 'ref' })))
    expect(screen.getByLabelText('URL')).toHaveTextContent('sort=ref')
    // Labels name what the click will do: the active ascending column now offers descending.
    await userEvent.click(screen.getByRole('button', { name: 'Sort by Reference, descending' }))
    await waitFor(() => expect(api.listBooks).toHaveBeenLastCalledWith(expect.objectContaining({ sort: '-ref' })))
    expect(screen.getByLabelText('URL')).toHaveTextContent('sort=-ref')
  })

  it('selects a folder without retaining the scope filter', async () => {
    vi.mocked(api.listBookFolders).mockResolvedValue([FOLDER])
    mount('/ledger?tab=books&scope=done')
    await userEvent.click(await screen.findByRole('button', { name: /^Personnel/ }))
    await waitFor(() => expect(api.listBooks).toHaveBeenLastCalledWith(expect.objectContaining({ folder_id: 3, sort: '-date' })))
    expect(screen.getByLabelText('URL')).toHaveTextContent('folder=3')
    expect(screen.getByLabelText('URL')).not.toHaveTextContent('scope=')
    expect(vi.mocked(api.listBooks).mock.lastCall?.[0]).not.toHaveProperty('inbox')
  })

  it.each([false, true])('shows the restricted folder audience above its books (mobile=%s)', async (mobile) => {
    vi.mocked(useIsMobile).mockReturnValue(mobile)
    vi.mocked(api.listBookFolders).mockResolvedValue([{
      ...FOLDER, team: true, shared_departments: ['Operations'],
      shared_users: [{ id: 2, name: 'Aisha', name_ar: 'عائشة', title: 'HR officer', title_ar: 'مسؤولة الموارد البشرية' }],
    }])
    mount('/ledger?tab=books&folder=3')
    const header = (await screen.findByRole('heading', { name: 'Personnel' })).closest('header')!
    expect(header).toHaveTextContent('Team')
    expect(header).toHaveTextContent('Books: 2')
    expect(header).toHaveTextContent(/Shared with:.*Aisha.*Operations.*department/)
    expect(header).toHaveTextContent('Each person sees only the books they are allowed to open.')
    expect(header).toHaveTextContent(/Created by.*Khalid/)
    expect(within(header).getByRole('button', { name: 'Share' })).toBeInTheDocument()
  })

  it('saves chosen people and departments and refreshes folders and books', async () => {
    vi.mocked(api.listBookFolders).mockResolvedValue([{ ...FOLDER, team: true, everyone: true }])
    vi.spyOn(api, 'getBookFolderShareOptions').mockResolvedValue({
      departments: ['Operations'],
      users: [{ id: 2, name: 'Aisha', name_ar: 'عائشة', title: 'HR officer', title_ar: null, department: 'Operations' }],
    })
    vi.spyOn(api, 'updateBookFolderShares').mockResolvedValue({ ...FOLDER, team: true })
    const qc = mount('/ledger?tab=books&folder=3')
    const invalidate = vi.spyOn(qc, 'invalidateQueries')
    await userEvent.click(await screen.findByRole('button', { name: 'Share' }))
    const dialog = await screen.findByRole('dialog', { name: 'Share team folder' })
    expect(dialog).toHaveAttribute('dir', 'ltr')
    await userEvent.click(within(dialog).getByRole('radio', { name: 'Only chosen people and departments' }))
    expect(within(dialog).getByRole('button', { name: 'Save' })).toBeDisabled()
    await userEvent.click(await within(dialog).findByRole('checkbox', { name: 'Operations' }))
    await userEvent.type(within(dialog).getByRole('searchbox', { name: 'Search people' }), 'Aisha')
    await userEvent.click(within(dialog).getByRole('checkbox', { name: 'Aisha HR officer' }))
    expect(within(dialog).getByText('People selected: 1')).toBeInTheDocument()
    await userEvent.click(within(dialog).getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(api.updateBookFolderShares).toHaveBeenCalledWith(3, { everyone: false, user_ids: [2], departments: ['Operations'] }))
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['books', 'folders'] })
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['books', 'routing'] })
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
  })

  it('prefills restricted sharing and clears it when everyone is selected', async () => {
    vi.mocked(api.listBookFolders).mockResolvedValue([{
      ...FOLDER, team: true, shared_departments: ['Operations'],
      shared_users: [{ id: 2, name: 'Aisha', name_ar: null, title: null, title_ar: null }],
    }])
    vi.spyOn(api, 'getBookFolderShareOptions').mockResolvedValue({
      departments: ['Operations'],
      users: [{ id: 2, name: 'Aisha', name_ar: null, title: null, title_ar: null, department: 'Operations' }],
    })
    vi.spyOn(api, 'updateBookFolderShares').mockResolvedValue({ ...FOLDER, team: true, everyone: true })
    mount('/ledger?tab=books&folder=3')
    await userEvent.click(await screen.findByRole('button', { name: 'Share' }))
    const dialog = await screen.findByRole('dialog')
    expect(await within(dialog).findByRole('checkbox', { name: 'Operations' })).toBeChecked()
    expect(within(dialog).getByRole('checkbox', { name: 'Aisha' })).toBeChecked()
    await userEvent.click(within(dialog).getByRole('radio', { name: 'Everyone' }))
    await userEvent.click(within(dialog).getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(api.updateBookFolderShares).toHaveBeenCalledWith(3, { everyone: true, user_ids: [], departments: [] }))
  })

  it('shows who filed a folder book and when, beneath its subject', async () => {
    vi.mocked(api.listBookFolders).mockResolvedValue([FOLDER])
    vi.mocked(api.listBooks).mockResolvedValue({ items: [{ ...BOOK, filed_by_name: 'Aisha', filed_by_name_ar: 'عائشة', filed_at: '2026-10-15T08:30:00Z' }], total: 1, limit: 50, offset: 0 })
    mount('/ledger?tab=books&folder=3')
    const row = await screen.findByRole('button', { name: /GS-7/ })
    expect(row).toHaveTextContent('Filed by \u2068Aisha\u2069 · 15/10/2026')
    const subject = within(row).getByText('Staff instruction').parentElement!.parentElement!
    expect(subject).toHaveTextContent('Filed by \u2068Aisha\u2069')
  })

  it('shows the sender designation with the name below it', async () => {
    vi.mocked(api.listBooks).mockResolvedValue({ items: [{ ...BOOK, my_inbox: { ...BOOK.my_inbox!, sent_by_title: 'Operations manager', sent_by_title_ar: 'مدير العمليات' } }], total: 1, limit: 50, offset: 0 })
    mount()
    const row = await screen.findByRole('button', { name: /GS-7/ })
    const cell = within(row).getByTitle('Operations manager (Khalid)')
    expect(within(cell).getByText('Operations manager')).toBeInTheDocument()
    expect(within(cell).getByText('Khalid')).toBeInTheDocument()
  })

  it('creates a personal folder inline with Enter', async () => {
    vi.spyOn(api, 'createBookFolder').mockResolvedValue({ ...FOLDER, id: 4, name: 'Planning', count: 0 })
    mount()
    await userEvent.click(screen.getByRole('button', { name: 'New personal folder' }))
    const input = screen.getByRole('textbox', { name: 'Folder name' })
    await userEvent.type(input, 'Planning{Enter}')
    await waitFor(() => expect(api.createBookFolder).toHaveBeenCalledWith({ name: 'Planning', team: false }))
  })

  it('files and unfiles an opened book without changing its inbox state', async () => {
    let filed = false
    vi.mocked(api.listBooks).mockResolvedValue({ items: [BOOK], total: 1, limit: 50, offset: 0 })
    vi.mocked(api.listBookFolders).mockImplementation(async (bookId) => [{ ...FOLDER, count: filed ? 1 : 0, has_book: bookId ? filed : null }])
    vi.spyOn(api, 'getBook').mockResolvedValue(BOOK)
    vi.spyOn(api, 'addBookToFolder').mockImplementation(async () => { filed = true })
    vi.spyOn(api, 'removeBookFromFolder').mockImplementation(async () => { filed = false })
    const qc = mount()
    const invalidate = vi.spyOn(qc, 'invalidateQueries')
    await userEvent.click(await screen.findByRole('button', { name: /GS-7/ }))
    await userEvent.click(await screen.findByRole('button', { name: 'Folder' }))
    const item = await screen.findByRole('menuitemcheckbox', { name: 'Personnel' })
    expect(item).toHaveAttribute('aria-checked', 'false')
    await userEvent.click(item)
    await waitFor(() => expect(api.addBookToFolder).toHaveBeenCalledWith(7, 3))
    await waitFor(() => expect(item).toHaveAttribute('aria-checked', 'true'))
    await userEvent.click(item)
    await waitFor(() => expect(api.removeBookFromFolder).toHaveBeenCalledWith(7, 3))
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['books', 'folders'] })
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['books', 'routing'] })
    expect(api.markBookInboxDone).not.toHaveBeenCalled()
  })
  it('files a book dragged from the list onto a rail folder, leaving its inbox state alone', async () => {
    vi.mocked(api.listBooks).mockResolvedValue({ items: [BOOK], total: 1, limit: 50, offset: 0 })
    vi.mocked(api.listBookFolders).mockResolvedValue([{ ...FOLDER, count: 0 }])
    vi.spyOn(api, 'addBookToFolder').mockResolvedValue(undefined)
    const qc = mount()
    const invalidate = vi.spyOn(qc, 'invalidateQueries')
    const data = new Map<string, string>()
    const dataTransfer = {
      setData: (type: string, value: string) => data.set(type, value),
      getData: (type: string) => data.get(type) ?? '',
      get types() { return [...data.keys()] },
      setDragImage: vi.fn(),
      effectAllowed: 'all',
      dropEffect: 'none',
    }
    fireEvent.dragStart(await screen.findByRole('button', { name: /GS-7/ }), { dataTransfer })
    const folder = (await screen.findByRole('button', { name: /^Personnel/ })).closest('[data-folder-id] > div')!
    fireEvent.dragOver(folder, { dataTransfer })
    fireEvent.drop(folder, { dataTransfer })
    await waitFor(() => expect(api.addBookToFolder).toHaveBeenCalledWith(7, 3))
    await waitFor(() => expect(invalidate).toHaveBeenCalledWith({ queryKey: ['books', 'folders'] }))
    expect(api.markBookInboxDone).not.toHaveBeenCalled()
  })
  it('switches scope without mixing recipient inbox with record direction', async () => {
    mount()
    await waitFor(() => expect(api.listBooks).toHaveBeenCalledWith(expect.objectContaining({ inbox: 'received' })))
    await userEvent.click(screen.getByRole('button', { name: 'Outgoing' }))
    await waitFor(() => expect(api.listBooks).toHaveBeenLastCalledWith(expect.objectContaining({ inbox: 'sent' })))
    await userEvent.click(screen.getByRole('button', { name: 'Archived' }))
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
    expect(screen.getByRole('link', { name: 'Open in Records' })).toHaveAttribute('href', '/books/7')
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['books', 'inbox-summary'] })
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['notifications', 'counts'] })
    expect(api.listBooks).toHaveBeenCalledTimes(1)
    expect(qc.getQueryData<{ items: BookRead[] }>(['books', 'routing', 'incoming', '', '-date', 0, null])?.items[0].my_inbox?.read_at).toBeTruthy()
  })

  it.each(['toolbar', 'browser'])('opens a book over the list and %s Back restores scope, search, scroll and focus', async (back) => {
    vi.mocked(api.listBooks).mockResolvedValue({ items: [BOOK], total: 1, limit: 50, offset: 0 })
    vi.spyOn(api, 'getBook').mockResolvedValue(BOOK)
    mount('/ledger?tab=books&scope=incoming')
    await userEvent.type(screen.getByRole('searchbox'), 'Staff')
    await waitFor(() => expect(api.listBooks).toHaveBeenLastCalledWith(expect.objectContaining({ q: 'Staff' })))
    const row = await screen.findByRole('button', { name: /GS-7/ })
    const scroller = row.closest('ul')!.parentElement!
    fireEvent.scroll(scroller, { target: { scrollTop: 180 } })
    await userEvent.click(row)
    expect(screen.getByLabelText('URL').textContent).toContain('book=7')
    expect(screen.queryByRole('searchbox')).not.toBeInTheDocument()
    // Expand only widens the document; it is not a history step.
    await userEvent.click(await screen.findByRole('button', { name: 'Expand' }))
    expect(screen.getByLabelText('URL').textContent).toContain('view=reader')
    expect(screen.queryByRole('complementary', { name: 'Details' })).not.toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: back === 'toolbar' ? 'Back to books' : 'Browser Back' }))
    expect(screen.getByLabelText('URL').textContent).toBe('?tab=books&scope=incoming')
    expect(screen.getByRole('searchbox')).toHaveValue('Staff')
    const restored = screen.getByRole('button', { name: /GS-7/ })
    expect(restored).toHaveAttribute('aria-current', 'true')
    expect(restored).toHaveFocus()
    expect(scroller.scrollTop).toBe(180)
  })

  it.each([false, true])('moves done out of Incoming and opens the next book before refresh completes (expanded=%s)', async (expanded) => {
    const nextBook = { ...BOOK, id: 8, ref_number: 'GS-8', subject: 'Next instruction' }
    vi.mocked(api.listBooks).mockResolvedValueOnce({ items: [BOOK, nextBook], total: 2, limit: 50, offset: 0 })
    // Keep the invalidation fetch pending to prove the queue updates locally.
    vi.mocked(api.listBooks).mockImplementation(() => new Promise(() => {}))
    vi.spyOn(api, 'getBook').mockImplementation(async (id) => id === BOOK.id ? BOOK : nextBook)
    vi.mocked(api.markBookInboxDone).mockResolvedValue({ ...BOOK.my_inbox!, done_at: '2026-10-15T10:00:00Z', read_at: '2026-10-15T09:00:00Z' })
    mount()
    await userEvent.click(await screen.findByRole('button', { name: /GS-7/ }))
    if (expanded) await userEvent.click(await screen.findByRole('button', { name: 'Expand' }))
    await userEvent.click(await screen.findByRole('button', { name: 'Mark as done' }))
    await waitFor(() => expect(api.markBookInboxDone).toHaveBeenCalledWith(7))
    await waitFor(() => expect(screen.getByRole('heading', { name: 'Next instruction' })).toBeInTheDocument())
    expect(screen.getByLabelText('URL').textContent).toContain('book=8')
    expect(screen.getByRole('button', { name: expanded ? 'Collapse' : 'Expand' })).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Back to books' }))
    expect(screen.queryByRole('button', { name: /GS-7/ })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: /GS-8/ })).toHaveAttribute('aria-current', 'true')
  })

  it('refreshes a cached destination scope after marking read on the next queue book', async () => {
    const nextBook = { ...BOOK, id: 8, ref_number: 'GS-8', subject: 'Next instruction', my_inbox: { ...BOOK.my_inbox!, read_at: '2026-10-15T09:00:00Z' } }
    let done = false
    vi.mocked(api.listBooks).mockImplementation(async ({ inbox } = {}) => {
      const items = inbox === 'done' ? (done ? [BOOK] : []) : done ? [nextBook] : [BOOK, nextBook]
      return { items, total: items.length, limit: 50, offset: 0 }
    })
    vi.spyOn(api, 'getBook').mockImplementation(async (id) => id === BOOK.id ? BOOK : nextBook)
    vi.mocked(api.markBookInboxDone).mockImplementation(async () => {
      done = true
      return { ...BOOK.my_inbox!, done_at: '2026-10-15T10:00:00Z' }
    })
    mount('/ledger?tab=books&scope=done')
    await screen.findByText('No books marked done')
    await userEvent.click(screen.getByRole('button', { name: 'Incoming' }))
    await userEvent.click(await screen.findByRole('button', { name: /GS-7/ }))
    await userEvent.click(await screen.findByRole('button', { name: 'Mark as done' }))
    await screen.findByRole('heading', { name: 'Next instruction' })
    await waitFor(() => expect(api.getBook).toHaveBeenCalledWith(8))
    await userEvent.click(screen.getByRole('button', { name: 'Back to books' }))
    await userEvent.click(screen.getByRole('button', { name: 'Done' }))
    expect(await screen.findByRole('button', { name: /GS-7/ })).toBeInTheDocument()
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
    // The last book left the scope, so the view falls back to the list and focus to the scope tab.
    await waitFor(() => expect(screen.getByLabelText('URL').textContent).not.toContain('book='))
    expect(screen.queryByRole('button', { name: /GS-7/ })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Done' })).toHaveFocus()
    await userEvent.click(screen.getByRole('button', { name: 'Incoming' }))
    expect(await screen.findByRole('button', { name: /GS-7/ })).toBeInTheDocument()
  })

  it('marks each purpose with its own glyph and label, apart from the grade mark', async () => {
    const purposes = ['info', 'action', 'reply', 'circulate'] as const
    vi.mocked(api.listBooks).mockResolvedValue({
      items: purposes.map((purpose, index) => ({ ...BOOK, id: index + 1, ref_number: `GS-${index + 1}`, grade: 'secret', my_inbox: { ...BOOK.my_inbox!, purpose } })),
      total: 4, limit: 50, offset: 0,
    })
    mount()
    for (const [index, label] of ['For information', 'For action', 'For reply', 'For circulation'].entries()) {
      const row = await screen.findByRole('button', { name: new RegExp(`GS-${index + 1}`) })
      // Icon only in the row: no visible label, but the purpose names the mark and joins the row's name.
      expect(row).not.toHaveTextContent(label)
      expect(row).toHaveAccessibleName(expect.stringContaining(label))
      const mark = within(row).getByRole('img', { name: label })
      expect(mark).toHaveAttribute('data-purpose', purposes[index])
      expect(mark).not.toHaveAttribute('tabindex')
      expect(mark.querySelector('svg')?.getAttribute('class')).toMatch(/lucide-/)
      expect(mark.closest('[data-testid="grade-mark"]')).toBeNull()
      expect(within(row).getByTestId('grade-mark')).toHaveTextContent('Secret')
    }
    const glyphs = purposes.map((purpose) => document.querySelector(`[data-purpose="${purpose}"] svg`)!.getAttribute('class'))
    expect(new Set(glyphs).size).toBe(4)
  })

  it('searches every place at once, tags each hit with its place, and Esc clears back to the scope', async () => {
    const done = { ...BOOK, id: 8, ref_number: 'GS-8', my_inbox: { ...BOOK.my_inbox!, read_at: '2026-10-13T09:00:00Z', done_at: '2026-10-14T09:00:00Z' } }
    const sent = { ...BOOK, id: 9, ref_number: 'GS-9', my_inbox: null }
    vi.mocked(api.listBooks).mockImplementation(async ({ inbox } = {}) => {
      const items = inbox === 'any' ? [done, sent] : [BOOK]
      return { items, total: items.length, limit: 50, offset: 0 }
    })
    mount()
    const box = await screen.findByRole('searchbox', { name: 'Search books' })
    await userEvent.type(box, 'Staff')
    await waitFor(() => expect(api.listBooks).toHaveBeenLastCalledWith(expect.objectContaining({ inbox: 'any', q: 'Staff', sort: '-date' })))
    expect(await screen.findByText('2 results across all books')).toHaveAttribute('role', 'status')
    // Place tag plus my own state: both read "Done".
    expect(within(screen.getByRole('button', { name: /GS-8/ })).getAllByText('Done')).toHaveLength(2)
    expect(within(screen.getByRole('button', { name: /GS-9/ })).getByText('Outgoing')).toBeInTheDocument()
    expect(document.querySelector('nav [aria-current="page"]')).not.toBeInTheDocument()
    await userEvent.keyboard('{Escape}')
    expect(box).toHaveValue('')
    await waitFor(() => expect(screen.getByRole('button', { name: 'Incoming' })).toHaveAttribute('aria-current', 'page'))
    expect(await screen.findByRole('button', { name: /GS-7/ })).toBeInTheDocument()
  })

  it('shows an outgoing book with its recipients, my note and their read/done progress', async () => {
    const recipient = (id: number, name: string, extra: object = {}) => ({
      id, user_id: id, user_name: name, sent_by_user_id: 1, purpose: 'action' as const, note: 'Count by Thursday',
      created_at: '2026-10-12T09:00:00Z', can_recall: true, ...extra,
    })
    vi.mocked(api.listBooks).mockResolvedValue({
      // I also received this book (my_inbox set): the Outgoing tab still shows my send.
      items: [{ ...BOOK, urgency: 'High', signer_name: 'Juma Saadi', recipients: [
        recipient(2, 'Khalid', { read_at: '2026-10-12T10:00:00Z', done_at: '2026-10-12T11:00:00Z' }),
        recipient(3, 'Salim', { read_at: '2026-10-12T10:00:00Z' }),
        recipient(4, 'Aisha'),
        { ...recipient(5, 'Forwarded'), sent_by_user_id: 2 },
      ] }],
      total: 1, limit: 50, offset: 0,
    })
    mount('/ledger?tab=books&scope=outgoing')
    const row = await screen.findByRole('button', { name: /GS-7/ })
    expect(row).toHaveTextContent('Khalid +2')
    expect(row).not.toHaveTextContent('Forwarded')
    expect(row).toHaveTextContent('Count by Thursday')
    expect(row).toHaveTextContent('Juma Saadi')
    expect(within(row).getByRole('img', { name: 'Importance: Medium' })).toBeInTheDocument()
    expect(within(row).getByText('Opened by 2 of 3')).toBeInTheDocument()
    expect(within(row).getByText('Done by 1 of 3')).toBeInTheDocument()
  })
})

describe('Books routing desk (Arabic)', () => {
  beforeAll(async () => {
    i18n.addResourceBundle('ar', 'translation', ar, true, true)
    await i18n.changeLanguage('ar')
  })
  afterAll(async () => {
    await i18n.changeLanguage('en')
  })

  /** Visible text plus every accessible name, title and placeholder, with Latin refs and key caps removed. */
  function rendered(root: HTMLElement): string {
    const attributes = Array.from(root.querySelectorAll('[aria-label], [title], [placeholder]'))
      .flatMap((node) => ['aria-label', 'title', 'placeholder'].map((name) => node.getAttribute(name) ?? ''))
    const keys = Array.from(root.querySelectorAll('kbd'), (node) => node.textContent ?? '')
    return keys.reduce((text, key) => text.replace(key, ''), [root.textContent, ...attributes].join(' ')).replace(/GS-\d+/g, '')
  }

  it('uses Arabic folder details, filing metadata and a right-to-left share dialog', async () => {
    vi.mocked(api.listBookFolders).mockResolvedValue([{
      ...FOLDER, name: 'شؤون الموظفين', team: true, shared_departments: ['العمليات'],
      shared_users: [{ id: 2, name: 'Aisha', name_ar: 'عائشة', title: 'HR officer', title_ar: 'مسؤولة الموارد البشرية' }],
    }])
    vi.mocked(api.listBooks).mockResolvedValue({ items: [{
      ...BOOK, subject: 'تعليمات الموظفين', filed_by_name: 'Aisha', filed_by_name_ar: 'عائشة', filed_at: '2026-10-15T08:30:00Z',
      my_inbox: { ...BOOK.my_inbox!, sent_by_name_ar: 'خالد' },
    }], total: 1, limit: 50, offset: 0 })
    vi.spyOn(api, 'getBookFolderShareOptions').mockResolvedValue({
      departments: ['العمليات'],
      users: [{ id: 2, name: 'Aisha', name_ar: 'عائشة', title: 'HR officer', title_ar: 'مسؤولة الموارد البشرية', department: 'العمليات' }],
    })
    mount('/ledger?tab=books&folder=3')
    const header = (await screen.findByRole('heading', { name: 'شؤون الموظفين' })).closest('header')!
    expect(header).toHaveTextContent(/تمت المشاركة مع:.*عائشة.*قسم.*العمليات/)
    expect(await screen.findByRole('button', { name: /GS-7/ })).toHaveTextContent('أضافه \u2068عائشة\u2069 · 15/10/2026')
    await userEvent.click(screen.getByRole('button', { name: 'مشاركة' }))
    const dialog = await screen.findByRole('dialog', { name: 'مشاركة مجلد الفريق' })
    expect(dialog).toHaveAttribute('dir', 'rtl')
    expect(await within(dialog).findByRole('checkbox', { name: 'عائشة مسؤولة الموارد البشرية' })).toBeChecked()
    expect(rendered(dialog)).not.toMatch(/[A-Za-z]/)
  })

  it('renders the list and the open book without any English', async () => {
    const arabic = { ...BOOK, subject: 'تعليمات الموظفين', grade: 'secret' as const, versions: [{ id: 1, version_no: 1, document_id: 73, status: 'none', trigger: 'create', has_fields: false, created_at: BOOK.created_at, manager_sig_embedded: false }] }
    const purposes = ['info', 'action', 'reply', 'circulate'] as const
    const items = purposes.map((purpose, index) => ({
      ...arabic, id: index + 1, ref_number: `GS-${index + 1}`,
      my_inbox: { ...BOOK.my_inbox!, purpose, sent_by_name_ar: 'خالد', note: 'يرجى التنفيذ', read_at: index ? '2026-10-13T09:00:00Z' : null, done_at: index === 2 ? '2026-10-14T09:00:00Z' : null },
    }))
    vi.mocked(api.listBooks).mockResolvedValue({ items, total: 4, limit: 50, offset: 0 })
    vi.spyOn(api, 'getBook').mockImplementation(async (id) => items[id - 1])
    mount()
    const desk = screen.getByRole('region', { name: 'الكتب' })
    await screen.findByRole('button', { name: /GS-1/ })
    for (const label of ['للاطلاع', 'للتنفيذ', 'للإفادة', 'للتعميم']) expect(within(desk).getByRole('img', { name: label })).toBeInTheDocument()
    expect(within(desk).getAllByRole('img', { name: 'الأهمية: متوسطة' })).toHaveLength(4)
    expect(rendered(desk)).not.toMatch(/[A-Za-z]/)
    await userEvent.click(screen.getByRole('button', { name: /GS-2/ }))
    await screen.findByRole('button', { name: 'العودة إلى الكتب' })
    await screen.findByRole('complementary', { name: 'التفاصيل' })
    expect(rendered(desk)).not.toMatch(/[A-Za-z]/)
  })

  // T-R3
  it('names every importance level in Arabic on rows and the header, with the same keys as English', async () => {
    expect(Object.keys(ar.books.importance).sort()).toEqual(Object.keys(en.books.importance).sort())
    expect(Object.values(ar.books.importance).every((value) => value && !/[A-Za-z]/.test(value))).toBe(true)
    const ledger = { ...BOOK, current_template_id: 'Ledger Book' }
    const items = [
      { ...ledger, importance: 'high' as const },
      { ...ledger, id: 8, ref_number: 'GS-8', importance: 'medium' as const },
      { ...BOOK, id: 9, ref_number: 'GS-9', urgency: 'Very High' },
    ]
    vi.mocked(api.listBooks).mockResolvedValue({ items, total: 3, limit: 50, offset: 0 })
    vi.spyOn(api, 'getBook').mockResolvedValue(items[0])
    mount()
    expect(within(await screen.findByRole('button', { name: /GS-7/ })).getByRole('img', { name: 'الأهمية: عالية' })).toBeInTheDocument()
    expect(within(screen.getByRole('button', { name: /GS-8/ })).getByRole('img', { name: 'الأهمية: متوسطة' })).toBeInTheDocument()
    expect(within(screen.getByRole('button', { name: /GS-9/ })).getByRole('img', { name: 'الأهمية: عالية' })).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: /GS-7/ }))
    expect(await screen.findByRole('button', { name: 'الأهمية: عالية' })).toBeInTheDocument()
  })
})
