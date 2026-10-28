import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import i18n from 'i18next'
import { MemoryRouter, useLocation, useNavigate } from 'react-router-dom'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import ar from '@/locales/ar.json'
import en from '@/locales/en.json'
import type { BookFolderRead, BookRead, LedgerBookRead, LedgerDraftRead } from '@/lib/api'
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
  id: 3, name: 'Personnel', box: 'incoming', team: false, count: 2, can_manage: true,
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
  vi.spyOn(api, 'listLedgerDrafts').mockResolvedValue([])
})
afterEach(() => { cleanup(); vi.restoreAllMocks() })

describe('Books routing desk: Ledger Books', () => {
  const DRAFT = {
    id: 12, draft_number: '000012', grade: 'unclassified', importance: null, tab: null, subjects: ['Leave plan'], body_html: '',
    created_at: '2026-10-28T08:00:00Z', updated_at: '2026-10-28T08:00:00Z',
  } as unknown as LedgerDraftRead
  const LEDGER_BOOK = {
    id: 7, ref_number: '1/2/7', grade: 'unclassified', importance: null, tab: 2, classification_code: '2/1',
    paper_date: '28-10-2026', approval_state: 'none', created_by_user_id: 1, voided: false,
    revisions: [
      { version_id: 71, version_no: 1, trigger: 'initial', created_at: '2026-10-28T08:00:00Z', signed_at: null, superseded: false, locked: false },
      { version_id: 72, version_no: 2, trigger: 'correction', created_at: '2026-10-28T09:00:00Z', signed_at: null, superseded: false, locked: false },
    ],
    selected_version_id: 72, subjects: ['Leave plan'], body_html: '<p>x</p>', content_sha256: 'abc',
  } as unknown as LedgerBookRead

  // W2
  it('shows my drafts in the list pane for ?scope=drafts, without the column header or folders', async () => {
    vi.mocked(api.listLedgerDrafts).mockResolvedValue([DRAFT])
    vi.mocked(api.listBookFolders).mockResolvedValue([FOLDER])
    mount('/ledger?tab=books&scope=drafts')
    const list = await screen.findByRole('region', { name: 'My drafts' })
    expect(within(list).getByRole('link', { name: /Leave plan/ })).toHaveAttribute('href', '/ledger/compose/12')
    expect(document.querySelector('[data-desk-header]')).toBeNull()
    expect(screen.getByRole('button', { name: 'Drafts 1' })).toHaveAttribute('aria-current', 'page')
    expect(api.listBooks).not.toHaveBeenCalled()
    expect(screen.queryByRole('group', { name: /Folders in/ })).toBeNull()
  })

  it('selecting Drafts in the rail puts scope=drafts in the URL', async () => {
    mount()
    await userEvent.click(await screen.findByRole('button', { name: 'Drafts' }))
    expect(screen.getByLabelText('URL')).toHaveTextContent('scope=drafts')
    expect(await screen.findByText('No drafts.')).toBeInTheDocument()
  })

  // W3
  it.each([false, true])('shows a Ledger Book in the sandboxed paper frame at ?rev with its actions (mobile=%s)', async (mobile) => {
    vi.mocked(useIsMobile).mockReturnValue(mobile)
    vi.spyOn(api, 'getBook').mockResolvedValue({ ...BOOK, current_template_id: 'Ledger Book', can_send: true })
    vi.spyOn(api, 'getLedgerBook').mockResolvedValue(LEDGER_BOOK)
    mount('/ledger?tab=books&book=7&rev=71')
    const frame = await screen.findByTitle('Ledger Book paper')
    expect(frame.tagName).toBe('IFRAME')
    expect(frame).toHaveAttribute('src', '/api/v1/ledger/books/7/paper?revision=71')
    expect(frame.getAttribute('sandbox')).not.toContain('allow-scripts')
    expect(screen.queryByRole('document')).toBeNull()
    const send = screen.getByRole('button', { name: 'Send' })
    const print = await screen.findByRole('button', { name: 'Print' })
    expect(send.parentElement).toBe(print.closest('div')?.parentElement)
    await waitFor(() => expect(api.getLedgerBook).toHaveBeenCalledWith(7, 71))
    const picker = screen.getByRole('combobox', { name: 'Revision' })
    expect(picker).toHaveValue('71')
    await userEvent.selectOptions(picker, '72')
    expect(screen.getByLabelText('URL')).toHaveTextContent('rev=72')
    expect(await screen.findByTitle('Ledger Book paper')).toHaveAttribute('src', '/api/v1/ledger/books/7/paper?revision=72')
  })

  // W3
  it('keeps a Word book in the PDF viewer with no Ledger Book actions', async () => {
    const word = { ...BOOK, versions: [{ id: 1, version_no: 1, document_id: 73, status: 'none', trigger: 'create', has_fields: false, created_at: BOOK.created_at, manager_sig_embedded: false }] }
    vi.spyOn(api, 'getBook').mockResolvedValue(word)
    const getLedgerBook = vi.spyOn(api, 'getLedgerBook')
    mount('/ledger?tab=books&book=7')
    expect(await screen.findByRole('document')).toBeInTheDocument()
    expect(screen.queryByTitle('Ledger Book paper')).toBeNull()
    expect(screen.queryByRole('button', { name: 'Print' })).toBeNull()
    expect(getLedgerBook).not.toHaveBeenCalled()
  })

  // W4
  it('reaches New Ledger Book and Drafts from the mobile rail sheet', async () => {
    vi.mocked(useIsMobile).mockReturnValue(true)
    vi.mocked(api.listLedgerDrafts).mockResolvedValue([DRAFT])
    mount()
    await userEvent.click(await screen.findByRole('button', { name: 'Incoming' }))
    const sheet = await screen.findByRole('dialog')
    expect(within(sheet).getByRole('button', { name: 'New Ledger Book' })).toBeInTheDocument()
    await userEvent.click(await within(sheet).findByRole('button', { name: 'Drafts 1' }))
    expect(screen.getByLabelText('URL')).toHaveTextContent('scope=drafts')
    expect(await screen.findByRole('region', { name: 'My drafts' })).toBeInTheDocument()
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(screen.getByRole('button', { name: 'Drafts' })).toBeInTheDocument()
  })
})

// W4
describe('Books routing desk: Ledger Books (Arabic)', () => {
  beforeAll(async () => {
    i18n.addResourceBundle('ar', 'translation', ar, true, true)
    await i18n.changeLanguage('ar')
  })
  afterAll(async () => { await i18n.changeLanguage('en') })

  it.each([false, true])('names New Ledger Book and Drafts in Arabic (mobile=%s)', async (mobile) => {
    vi.mocked(useIsMobile).mockReturnValue(mobile)
    mount('/ledger?tab=books&scope=drafts')
    if (mobile) await userEvent.click(await screen.findByRole('button', { name: 'المسودات' }))
    const nav = await screen.findByRole('navigation')
    expect(within(nav).getByRole('button', { name: 'كتاب سجل جديد' })).toBeInTheDocument()
    expect(within(nav).getByRole('button', { name: 'المسودات' })).toHaveAttribute('aria-current', 'page')
    expect(await screen.findByText('لا توجد مسودات.')).toBeInTheDocument()
    expect(en.ledgerBook.composer.drafts.place).toBe('Drafts')
  })
})

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

  // T-L2
  it.each([false, true])('draws Purpose, Grade and Importance at one shared size (mobile=%s)', async (mobile) => {
    vi.mocked(useIsMobile).mockReturnValue(mobile)
    vi.mocked(api.listBooks).mockResolvedValue({ items: [{ ...LEDGER, grade: 'secret', importance: 'medium' }], total: 1, limit: 50, offset: 0 })
    mount()
    const row = await screen.findByRole('button', { name: /GS-7/ })
    const glyphs = ['For action', 'Record grade: Secret', 'Importance: Medium'].map((name) => within(row).getByRole('img', { name }).querySelector('svg')!)
    for (const glyph of glyphs) expect(glyph).toHaveClass('h-5', 'w-5')
    expect(new Set(glyphs.map((glyph) => glyph.getAttribute('stroke-width'))).size).toBe(1)
  })

  // T-L7 (O-3)
  it.each(['secret', 'top_secret', 'addressee_only'] as const)('marks the %s grade with an icon only, named by its level', async (grade) => {
    const level = { secret: 'Secret', top_secret: 'Top Secret', addressee_only: 'Addressee Only' }[grade]
    vi.mocked(api.listBooks).mockResolvedValue({ items: [{ ...BOOK, grade }], total: 1, limit: 50, offset: 0 })
    mount()
    const row = await screen.findByRole('button', { name: /GS-7/ })
    const mark = within(row).getByRole('img', { name: `Record grade: ${level}` })
    expect(mark).not.toHaveAttribute('tabindex')
    expect(row).not.toHaveTextContent(level)
    expect(row).toHaveAccessibleName(expect.stringContaining(`Record grade: ${level}`))
    await userEvent.hover(mark)
    expect(await screen.findByRole('tooltip')).toHaveTextContent(`Record grade: ${level}`)
  })

  // T-L7 (O-3)
  it('shows no grade mark for an unclassified record', async () => {
    vi.mocked(api.listBooks).mockResolvedValue({ items: [{ ...BOOK, grade: 'unclassified' }], total: 1, limit: 50, offset: 0 })
    mount()
    const row = await screen.findByRole('button', { name: /GS-7/ })
    expect(within(row).queryByRole('img', { name: /Record grade/ })).toBeNull()
    expect(row).not.toHaveTextContent('Unclassified')
  })

  const columns = (root: Element): (string | null)[] => Array.from(root.querySelectorAll(':scope > [data-column], :scope > * > [data-column]'), (cell) => cell.getAttribute('data-column'))

  // T-L1 (O-5)
  it('gives Purpose, Grade and Importance their own centred columns before Ref, in the header and the row', async () => {
    vi.mocked(api.listBooks).mockResolvedValue({ items: [{ ...LEDGER, grade: 'secret', importance: 'high' }], total: 1, limit: 50, offset: 0 })
    mount()
    const row = await screen.findByRole('button', { name: /GS-7/ })
    const header = screen.getByRole('button', { name: /^Sort by Purpose/ }).closest('[data-desk-header]')!
    const order = ['purpose', 'grade', 'importance', 'ref', 'subject', 'from', 'to', 'signer', 'state', 'date']
    expect(columns(header)).toEqual(order)
    expect(columns(row).slice(0, 5)).toEqual(order.slice(0, 5))
    for (const [column, name] of [['purpose', 'For action'], ['grade', 'Record grade: Secret'], ['importance', 'Importance: High']]) {
      const cell = row.querySelector(`[data-column="${column}"]`) as HTMLElement
      expect(within(cell).getAllByRole('img')).toHaveLength(1)
      expect(within(cell).getByRole('img', { name })).toBeInTheDocument()
      expect(cell).toHaveClass('xl:justify-center')
      expect(header.querySelector(`[data-column="${column}"]`)).toHaveClass('xl:justify-center')
    }
    // The grade left the Subject header for its own column.
    expect(header.querySelector('[data-column="subject"]')).not.toHaveTextContent('Grade')
    expect(header.querySelector('[data-column="importance"]')).toHaveTextContent('Importance')
  })

  // T-L3
  it.each([false, true])('leaves the category out of the row (mobile=%s)', async (mobile) => {
    vi.mocked(useIsMobile).mockReturnValue(mobile)
    const category = { id: 'GC', name_en: 'General correspondence', name_ar: 'المراسلات العامة', prefix: 'GC', requires_approval: false }
    vi.mocked(api.listBooks).mockResolvedValue({ items: [{ ...BOOK, category } as BookRead], total: 1, limit: 50, offset: 0 })
    mount()
    const row = await screen.findByRole('button', { name: /GS-7/ })
    expect(row).not.toHaveTextContent('General correspondence')
  })

  // T-L4
  it.each([
    [{ read_at: null }, 'New'],
    [{ read_at: '2026-10-13T09:00:00Z' }, 'Read'],
    [{ read_at: '2026-10-13T09:00:00Z', done_at: '2026-10-14T09:00:00Z' }, 'Done'],
    [{ read_at: '2026-10-13T09:00:00Z', archived_at: '2026-10-14T09:00:00Z' }, 'Archived'],
  ])('shows only my own state in the state cell (%o)', async (inbox, state) => {
    vi.mocked(api.listBooks).mockResolvedValue({ items: [{ ...BOOK, my_inbox: { ...BOOK.my_inbox!, ...inbox } }], total: 1, limit: 50, offset: 0 })
    mount()
    const row = await screen.findByRole('button', { name: /GS-7/ })
    expect(row.querySelector('[data-column="state"]')).toHaveTextContent(new RegExp(`^${state}$`))
  })

  // T-L4 (O-4)
  it.each([false, true])('shows a simple Sent state for a book I sent, without opened/done counters (mobile=%s)', async (mobile) => {
    vi.mocked(useIsMobile).mockReturnValue(mobile)
    vi.mocked(api.listBooks).mockResolvedValue({ items: [{ ...BOOK, my_inbox: null, recipients: [
      { id: 2, user_id: 2, user_name: 'Khalid', sent_by_user_id: 1, purpose: 'action', created_at: '2026-10-12T09:00:00Z', can_recall: true, read_at: '2026-10-12T10:00:00Z', done_at: '2026-10-12T11:00:00Z' },
      { id: 3, user_id: 3, user_name: 'Salim', sent_by_user_id: 1, purpose: 'action', created_at: '2026-10-12T09:00:00Z', can_recall: true },
    ] }], total: 1, limit: 50, offset: 0 })
    mount('/ledger?tab=books&scope=outgoing')
    const row = await screen.findByRole('button', { name: /GS-7/ })
    expect(row.querySelector('[data-column="state"]')).toHaveTextContent(/^Sent$/)
    expect(row).not.toHaveTextContent(/(^|[^\d/])[0-2]\/2($|[^\d/])/)
    expect(row).not.toHaveAccessibleName(expect.stringMatching(/Opened by|Done by/))
  })

  // T-L6
  it.each([false, true])('shows people by designation, with the name only in the tooltip and accessible name (mobile=%s)', async (mobile) => {
    vi.mocked(useIsMobile).mockReturnValue(mobile)
    vi.mocked(api.listBooks).mockResolvedValue({ items: [{
      ...BOOK, signer_name: 'Juma Saadi', signer_title: 'Director',
      my_inbox: { ...BOOK.my_inbox!, sent_by_title: 'Operations manager', sent_by_title_ar: 'مدير العمليات' },
      recipients: [{ id: 2, user_id: 2, user_name: 'Aisha', user_title: 'HR officer', sent_by_user_id: 2, purpose: 'action', created_at: '2026-10-12T09:00:00Z', can_recall: false }],
    }], total: 1, limit: 50, offset: 0 })
    mount()
    const row = await screen.findByRole('button', { name: /GS-7/ })
    for (const [label, title, name] of [['From', 'Operations manager', 'Khalid'], ['To', 'HR officer', 'Aisha'], ['Signatory', 'Director', 'Juma Saadi']]) {
      expect(row).toHaveTextContent(title)
      expect(row).not.toHaveTextContent(name)
      const person = within(row).getByRole('img', { name: `${label}: ${title} (${name})` })
      expect(person).not.toHaveAttribute('tabindex')
      expect(row).toHaveAccessibleName(expect.stringContaining(name))
    }
    await userEvent.hover(within(row).getByRole('img', { name: /^From:/ }))
    expect(await screen.findByRole('tooltip')).toHaveTextContent('Operations manager (Khalid)')
  })

  // T-L5
  it('lists the category and my recipients\' opened/done progress in the record details', async () => {
    const recipient = (id: number, extra: object = {}) => ({ id, user_id: id, user_name: `R${id}`, sent_by_user_id: 1, purpose: 'action' as const, created_at: '2026-10-12T09:00:00Z', can_recall: true, ...extra })
    const category = { id: 'GC', name_en: 'General correspondence', name_ar: 'المراسلات العامة', prefix: 'GC', requires_approval: false }
    const recipients = [
      recipient(2, { read_at: '2026-10-12T10:00:00Z', done_at: '2026-10-12T11:00:00Z' }),
      recipient(3, { read_at: '2026-10-12T10:00:00Z' }),
      recipient(4),
      { ...recipient(5), sent_by_user_id: 2 },
      recipient(6, { revoked_at: '2026-10-12T12:00:00Z' }),
    ]
    const book = { ...BOOK, my_inbox: null, category } as BookRead
    vi.mocked(api.listBooks).mockResolvedValue({ items: [{ ...book, recipients }], total: 1, limit: 50, offset: 0 })
    // The record itself carries no recipients; the details read them from the record's recipients list.
    vi.spyOn(api, 'getBook').mockResolvedValue(book)
    vi.mocked(api.listBookRecipients).mockResolvedValue(recipients)
    mount('/ledger?tab=books&scope=outgoing')
    await userEvent.click(await screen.findByRole('button', { name: /GS-7/ }))
    const details = await screen.findByRole('complementary', { name: 'Details' })
    expect(details).toHaveTextContent(/Category\s*General correspondence/)
    await waitFor(() => expect(details).toHaveTextContent('Opened by 2 of 3'))
    expect(details).toHaveTextContent('Done by 1 of 3')
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
    vi.mocked(api.listBookFolders).mockResolvedValue([{ ...FOLDER, box: 'done' }])
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
    const subject = row.querySelector('[data-column="subject"]')!
    expect(subject).toHaveTextContent('Filed by \u2068Aisha\u2069')
  })


  it('creates a folder inline with Enter in the box it was started from', async () => {
    vi.spyOn(api, 'createBookFolder').mockResolvedValue({ ...FOLDER, id: 4, name: 'Planning', count: 0 })
    mount()
    await userEvent.click(screen.getByRole('button', { name: 'New folder in Incoming' }))
    const input = screen.getByRole('textbox', { name: 'Folder name' })
    await userEvent.type(input, 'Planning{Enter}')
    await waitFor(() => expect(api.createBookFolder).toHaveBeenCalledWith({ name: 'Planning', box: 'incoming', team: false }))
  })

  // T-FR5
  const SEND = { id: 1, user_id: 4, sent_by_user_id: 1, purpose: 'info' as const, created_at: '2026-10-12T10:00:00Z', revoked_at: null }
  it.each([
    ['a done book', { ...BOOK, my_inbox: { ...BOOK.my_inbox!, done_at: '2026-10-13T09:00:00Z' } }, [], ['Done']],
    ['a book I received and sent on', BOOK, [SEND], ['Incoming', 'Outgoing']],
    ['a book I only sent', { ...BOOK, my_inbox: null }, [SEND], ['Outgoing']],
  ])('offers %s only the folders of its boxes, grouped by box', async (_label, book, sends, boxes) => {
    vi.mocked(api.listBooks).mockResolvedValue({ items: [book], total: 1, limit: 50, offset: 0 })
    vi.spyOn(api, 'getBook').mockResolvedValue(book)
    vi.mocked(api.listBookRecipients).mockResolvedValue(sends as never)
    vi.mocked(api.listBookFolders).mockResolvedValue([
      { ...FOLDER, id: 11, name: 'In tray', has_book: false },
      { ...FOLDER, id: 12, name: 'Sent tray', box: 'outgoing', team: true, everyone: true, has_book: false },
      { ...FOLDER, id: 13, name: 'Done tray', box: 'done', has_book: false },
      { ...FOLDER, id: 14, name: 'Old tray', box: 'archived', has_book: false },
    ])
    mount()
    await userEvent.click(await screen.findByRole('button', { name: /GS-7/ }))
    await waitFor(() => expect(api.listBookRecipients).toHaveBeenCalled())
    await userEvent.click(await screen.findByRole('button', { name: 'Folder' }))
    const menu = await screen.findByRole('menu')
    await waitFor(() => expect(within(menu).getAllByRole('group').map((g) => g.getAttribute('aria-label'))).toEqual(boxes))
    const trays = { Incoming: 'In tray', Outgoing: 'Sent tray', Done: 'Done tray', Archived: 'Old tray' }
    expect(within(menu).getAllByRole('menuitemcheckbox').map((item) => item.textContent)).toEqual(boxes.map((box) => trays[box as keyof typeof trays]))
    expect(within(menu).queryByText('Personal')).toBeNull()
    expect(within(menu).queryByText('Team folders')).toBeNull()
    if (boxes.includes('Outgoing')) expect(within(menu).getByRole('menuitemcheckbox', { name: 'Sent tray, shared folder' }).querySelector('.lucide-folder-users')).not.toBeNull()
  })

  // T-FR8
  it('shows the same box tree in the mobile sheet', async () => {
    vi.mocked(useIsMobile).mockReturnValue(true)
    vi.mocked(api.listBookFolders).mockResolvedValue([FOLDER, { ...FOLDER, id: 5, name: 'Closed', box: 'done' }])
    mount()
    await userEvent.click(await screen.findByRole('button', { name: 'Incoming' }))
    const sheet = await screen.findByRole('dialog')
    const incoming = await within(sheet).findByRole('group', { name: 'Folders in Incoming' })
    expect(within(incoming).getByRole('button', { name: /^Personnel/ })).toBeInTheDocument()
    expect(within(sheet).getByRole('button', { name: 'Folders in Done' })).toHaveAttribute('aria-expanded', 'false')
    expect(within(sheet).getByRole('button', { name: 'New folder in Archived' })).toBeInTheDocument()
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
      expect(within(row).getByTestId('grade-mark')).toHaveAccessibleName('Record grade: Secret')
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

  it('shows an outgoing book with its recipients and my note, leaving their progress to the record', async () => {
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
    // The note keeps the row to one line: an icon whose name carries the text.
    expect(within(row).getByRole('img', { name: 'Note: Count by Thursday' })).toBeInTheDocument()
    expect(row).toHaveTextContent('Juma Saadi')
    expect(within(row).getByRole('img', { name: 'Importance: Medium' })).toBeInTheDocument()
    expect(row).not.toHaveTextContent(/Opened by|Done by|(^|[^\d/])[0-3]\/3($|[^\d/])/)
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

  // T-L8
  it.each([false, true])('lays out the Arabic row right to left with the same columns, Arabic mark names and designations (mobile=%s)', async (mobile) => {
    vi.mocked(useIsMobile).mockReturnValue(mobile)
    const category = { id: 'GC', name_en: 'General correspondence', name_ar: 'المراسلات العامة', prefix: 'GC', requires_approval: false }
    vi.mocked(api.listBooks).mockResolvedValue({ items: [{
      ...BOOK, current_template_id: 'Ledger Book', importance: 'high', grade: 'secret', subject: 'تعليمات الموظفين', category,
      my_inbox: { ...BOOK.my_inbox!, sent_by_name_ar: 'خالد', sent_by_title: 'Operations manager', sent_by_title_ar: 'مدير العمليات', read_at: '2026-10-13T09:00:00Z' },
    } as BookRead], total: 1, limit: 50, offset: 0 })
    mount()
    const row = await screen.findByRole('button', { name: /GS-7/ })
    expect(screen.getByRole('region', { name: 'الكتب' })).toHaveAttribute('dir', 'rtl')
    const order = Array.from(row.querySelectorAll('[data-column]'), (cell) => cell.getAttribute('data-column'))
    expect(order.slice(0, 5)).toEqual(['purpose', 'grade', 'importance', 'ref', 'subject'])
    for (const name of ['للتنفيذ', 'درجة سرية المعاملة: سري', 'الأهمية: عالية', 'من: مدير العمليات (خالد)']) expect(within(row).getByRole('img', { name })).toBeInTheDocument()
    expect(row).toHaveTextContent('مدير العمليات')
    expect(row).not.toHaveTextContent(/خالد|المراسلات العامة|سري/)
    expect(row.querySelector('[data-column="state"]')).toHaveTextContent(/^مقروء$/)
    if (!mobile) expect(document.querySelector('[data-desk-header] [data-column="importance"]')).toHaveTextContent('الأهمية')
  })

  // T-L8
  it('shows an Arabic Sent state in the row and the Arabic category and progress in the record details', async () => {
    const category = { id: 'GC', name_en: 'General correspondence', name_ar: 'المراسلات العامة', prefix: 'GC', requires_approval: false }
    const recipients = [
      { id: 2, user_id: 2, user_name: 'Aisha', user_name_ar: 'عائشة', sent_by_user_id: 1, purpose: 'action' as const, created_at: '2026-10-12T09:00:00Z', can_recall: true, read_at: '2026-10-12T10:00:00Z' },
      { id: 3, user_id: 3, user_name: 'Salim', user_name_ar: 'سالم', sent_by_user_id: 1, purpose: 'action' as const, created_at: '2026-10-12T09:00:00Z', can_recall: true },
    ]
    const book = { ...BOOK, subject: 'تعليمات الموظفين', my_inbox: null, category, created_by_name_ar: 'أحمد' } as BookRead
    vi.mocked(api.listBooks).mockResolvedValue({ items: [{ ...book, recipients }], total: 1, limit: 50, offset: 0 })
    vi.spyOn(api, 'getBook').mockResolvedValue(book)
    vi.mocked(api.listBookRecipients).mockResolvedValue(recipients)
    mount('/ledger?tab=books&scope=outgoing')
    const row = await screen.findByRole('button', { name: /GS-7/ })
    expect(row.querySelector('[data-column="state"]')).toHaveTextContent(/^مرسل$/)
    await userEvent.click(row)
    const details = await screen.findByRole('complementary', { name: 'التفاصيل' })
    expect(details).toHaveTextContent(/الفئة\s*المراسلات العامة/)
    await waitFor(() => expect(details).toHaveTextContent('فتحه 1 من 2'))
    expect(details).toHaveTextContent('أنجزه 0 من 2')
  })
})
