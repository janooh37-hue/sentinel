import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, render, renderHook, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { isValidElement } from 'react'
import type { ReactNode } from 'react'
import i18n from 'i18next'
import { toast } from '@/lib/toast'

import { api } from '@/lib/api'
import type { BookInboxRead, BookRead, BookRecipientRead } from '@/lib/api'
import type * as ApiModule from '@/lib/api'
import { pickEmployeeName } from '@/lib/employeeName'
import ar from '@/locales/ar.json'
import { parseUtcMs } from '@/lib/time'
import { RecordInboxStrip, RecordRecipientsPanel } from './RecordRecipientsPanel'
import { SendRecordDialog } from './SendRecordDialog'
import { useInboxActions } from './useInboxActions'

vi.mock('@/lib/api', async (original) => {
  const actual = await original<typeof ApiModule>()
  return {
    ...actual,
    api: {
      ...actual.api,
      markBookInboxDone: vi.fn(),
      undoBookInboxDone: vi.fn(),
      archiveBookInbox: vi.fn(),
      unarchiveBookInbox: vi.fn(),
    },
  }
})
vi.mock('./useReplyActions', () => ({ useReplyActions: () => ({ actions: [], dialog: null }) }))
vi.mock('@/lib/toast', () => ({
  toast: { success: vi.fn(), info: vi.fn(), error: vi.fn(), loading: vi.fn(() => 'toast-1'), dismiss: vi.fn() },
}))

const INBOX: BookInboxRead = {
  id: 9, purpose: 'circulate', sent_by_user_id: 2,
  sent_by_name: 'Khalid Sender', sent_by_name_ar: 'خالد المرسل',
  sent_at: '2026-10-12T09:00:00Z', read_at: null, done_at: null, archived_at: null,
}
const BOOK = { id: 7, ref_number: 'GS-7', confidentiality: 'general', my_inbox: INBOX } as BookRead

function setup() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
  const wrapper = ({ children }: { children: ReactNode }): React.JSX.Element => (
    <QueryClientProvider client={qc}>{children}</QueryClientProvider>
  )
  return { qc, wrapper }
}

beforeEach(async () => {
  vi.restoreAllMocks()
  vi.clearAllMocks()
  for (const method of [api.markBookInboxDone, api.undoBookInboxDone, api.archiveBookInbox, api.unarchiveBookInbox]) {
    vi.mocked(method).mockReset().mockResolvedValue(INBOX)
  }
  await i18n.changeLanguage('en')
})
afterEach(async () => {
  cleanup()
  await i18n.changeLanguage('en')
})

describe('shared inbox action descriptor', () => {
  it('has no tools for non-recipients', () => {
    const { wrapper } = setup()
    const { result } = renderHook(() => useInboxActions({ ...BOOK, my_inbox: null }), { wrapper })
    expect(result.current).toEqual([])
  })

  it.each([
    ['done', 'markBookInboxDone', null, null],
    ['undoDone', 'undoBookInboxDone', '2026-10-12T10:00:00Z', null],
    ['archive', 'archiveBookInbox', null, null],
    ['unarchive', 'unarchiveBookInbox', null, '2026-10-12T10:00:00Z'],
  ] as const)('%s targets the record and refreshes records plus bell counts', async (key, method, done_at, archived_at) => {
    const { qc, wrapper } = setup()
    const invalidate = vi.spyOn(qc, 'invalidateQueries')
    const book = { ...BOOK, my_inbox: { ...INBOX, done_at, archived_at } }
    const { result } = renderHook(() => useInboxActions(book), { wrapper })
    const action = result.current.find((item) => item.key === key)!
    expect(isValidElement(action.icon)).toBe(true)
    expect(action.pending).toBe(false)
    act(action.onSelect)
    await waitFor(() => expect(api[method]).toHaveBeenCalledWith(7))
    await waitFor(() => expect(invalidate).toHaveBeenCalledWith({ queryKey: ['notifications', 'counts'] }))
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['books'] })
  })

  it('disables all recipient tools during a request and reports a failure without success invalidation', async () => {
    let reject!: (error: Error) => void
    const promise = new Promise<BookInboxRead>((_resolve, rejectPromise) => {
      reject = rejectPromise
    })
    vi.mocked(api.markBookInboxDone).mockReturnValue(promise)
    const { qc, wrapper } = setup()
    const invalidate = vi.spyOn(qc, 'invalidateQueries')
    render(<RecordInboxStrip book={BOOK} />, { wrapper })
    await userEvent.click(screen.getByRole('button', { name: 'Mark as done' }))
    await waitFor(() => expect(screen.getByRole('button', { name: 'Mark as done' })).toBeDisabled())
    expect(screen.getByRole('button', { name: 'Archive' })).toBeDisabled()
    await userEvent.click(screen.getByRole('button', { name: 'Archive' }))
    expect(api.archiveBookInbox).not.toHaveBeenCalled()
    act(() => reject(new Error('network failure')))
    await waitFor(() => expect(toast.error).toHaveBeenCalled())
    await waitFor(() => expect(screen.getByRole('button', { name: 'Mark as done' })).toBeEnabled())
    expect(invalidate).not.toHaveBeenCalled()
    expect(toast.success).not.toHaveBeenCalled()
  })
})

describe('Arabic recipient surfaces and circulation', () => {
  beforeEach(async () => {
    i18n.addResourceBundle('ar', 'translation', ar, true, true)
    await i18n.changeLanguage('ar-AE')
  })

  it('uses Arabic sender names and exposes undo tools on done archived records', () => {
    const { wrapper } = setup()
    render(<RecordInboxStrip book={{ ...BOOK, my_inbox: {
      ...INBOX, done_at: '2026-10-12T10:00:00Z', archived_at: '2026-10-12T11:00:00Z',
    } }} />, { wrapper })
    expect(screen.getByTestId('record-inbox-strip')).toHaveTextContent('خالد المرسل')
    expect(screen.getByTestId('record-inbox-strip')).not.toHaveTextContent('Khalid Sender')
    expect(screen.getByTestId('record-inbox-strip')).toHaveTextContent('للتعميم')
    expect(screen.getByTestId('record-inbox-strip')).toHaveTextContent(ar.books.inbox.archivedState)
    expect(screen.getByTestId('record-inbox-strip')).not.toHaveTextContent(ar.books.inbox.archived)
    expect(screen.getByRole('button', { name: ar.books.inbox.undoDone }).querySelector('svg')).toHaveClass('rtl:-scale-x-100')
    expect(screen.getByRole('button', { name: ar.books.inbox.undoDone })).toBeEnabled()
    expect(screen.getByRole('button', { name: ar.books.inbox.unarchive })).toBeEnabled()
  })

  it('shows Arabic recipients, sender and done time in the sender panel', async () => {
    const recipient: BookRecipientRead = {
      id: 9, user_id: 3, user_name: 'Mariam Recipient', user_name_ar: 'مريم المستلمة',
      sent_by_user_id: 2, sent_by_name: INBOX.sent_by_name, sent_by_name_ar: INBOX.sent_by_name_ar,
      purpose: 'circulate', created_at: INBOX.sent_at, read_at: '2026-10-12T10:00:00Z',
      done_at: '2026-10-12T22:30:00', can_recall: false,
    }
    vi.spyOn(api, 'listBookRecipients').mockResolvedValue([recipient])
    const { wrapper } = setup()
    render(<RecordRecipientsPanel bookId={7} bookRef={BOOK.ref_number} />, { wrapper })
    const panel = await screen.findByTestId('record-recipients')
    expect(panel).toHaveTextContent('مريم المستلمة')
    expect(panel).toHaveTextContent('خالد المرسل')
    expect(panel).not.toHaveTextContent('Mariam Recipient')
    expect(panel).not.toHaveTextContent('Khalid Sender')
    expect(panel).toHaveTextContent('أُنجز في')
    const localDoneAt = new Intl.DateTimeFormat(i18n.language, {
      year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit',
    }).format(parseUtcMs(recipient.done_at!))
    expect(panel).toHaveTextContent(localDoneAt)
  })

  it('selects Arabic candidate names and sends circulate rather than the removed sign purpose', async () => {
    vi.spyOn(api, 'getBookThread').mockResolvedValue([])
    vi.spyOn(api, 'listRecipientCandidates').mockResolvedValue([
      { id: 3, name: 'Mariam Recipient', name_ar: 'مريم المستلمة', role: 'operator', has_secret_clearance: false },
      { id: 4, name: 'English Fallback', name_ar: '  ', role: 'operator', has_secret_clearance: false },
    ])
    const send = vi.spyOn(api, 'sendBook').mockResolvedValue({ sent: [], skipped: [] })
    const { wrapper } = setup()
    render(<SendRecordDialog book={BOOK} open onOpenChange={vi.fn()} />, { wrapper })
    await userEvent.click(await screen.findByRole('checkbox', { name: 'مريم المستلمة' }))
    expect(screen.getByRole('checkbox', { name: 'English Fallback' })).toBeInTheDocument()
    expect(screen.queryByText('Mariam Recipient')).not.toBeInTheDocument()
    expect(screen.getAllByRole('radio').map((radio) => radio.getAttribute('value'))).toEqual(['info', 'action', 'reply', 'circulate'])
    await userEvent.click(screen.getByRole('radio', { name: 'للتعميم' }))
    await userEvent.click(screen.getByRole('button', { name: ar.books.send.send }))
    await waitFor(() => expect(send).toHaveBeenCalledWith(7, expect.objectContaining({ user_ids: [3], purpose: 'circulate' })))
  })

  it('falls back to English only when Arabic is absent or blank', () => {
    expect(pickEmployeeName({ name_en: 'English', name_ar: 'العربية' }, 'ar-AE')).toBe('العربية')
    expect(pickEmployeeName({ name_en: 'English', name_ar: 'العربية' }, 'en')).toBe('English')
    expect(pickEmployeeName({ name_en: 'English', name_ar: '  ' }, 'ar')).toBe('English')
    expect(pickEmployeeName({ name_en: 'English', name_ar: null }, 'ar')).toBe('English')
  })
})
