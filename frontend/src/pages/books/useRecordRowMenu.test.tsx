import { useState } from 'react'
import { QueryClient, QueryClientProvider, useQuery } from '@tanstack/react-query'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, useLocation } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { api } from '@/lib/api'
import type { BookRead } from '@/lib/api'
import type * as ApiModule from '@/lib/api'
import { useRecordRowMenu } from './useRecordRowMenu'
import { RecordRowMenu } from './RecordRowMenu'

const { hasCapability } = vi.hoisted(() => ({ hasCapability: vi.fn() }))

vi.mock('@/lib/authContext', () => ({ useAuth: () => ({ user: { role: 'admin' } }) }))
vi.mock('@/lib/useCapabilities', () => ({ useCapabilities: () => ({ has: hasCapability }) }))
vi.mock('@/components/books/DeriveRecordDialog', () => ({
  DeriveRecordDialog: ({ book, kind }: { book: BookRead; kind: string }) => <output>{kind}:{book.id}</output>,
}))
vi.mock('@/components/books/SendRecordDialog', () => ({ SendRecordDialog: () => null }))
vi.mock('@/components/books/ChangeConfidentialityDialog', () => ({ ChangeConfidentialityDialog: () => null }))
vi.mock('@/lib/api', async (original) => {
  const actual = await original<typeof ApiModule>()
  return {
    ...actual,
    api: {
      ...actual.api,
      getBook: vi.fn(),
      markBookInboxDone: vi.fn().mockResolvedValue({}),
      undoBookInboxDone: vi.fn().mockResolvedValue({}),
      archiveBookInbox: vi.fn().mockResolvedValue({}),
      unarchiveBookInbox: vi.fn().mockResolvedValue({}),
    },
  }
})

function book(id: number, overrides: Partial<BookRead> = {}): BookRead {
  return {
    id, ref_number: `GS-000${id}`, subject: `Record ${id}`, confidentiality: 'general',
    service_id: 'General Book', approval_state: 'pending', versions: [], attachment_paths: [],
    imported_doc: null, can_send: false, can_change_confidentiality: false, my_inbox: null,
    access_scope: 'full',
    ...overrides,
  } as BookRead
}

function Harness({ row, detailKey }: { row: BookRead; detailKey: readonly unknown[] }): React.JSX.Element {
  const [open, setOpen] = useState(false)
  const [reading, setReading] = useState(false)
  const actualDetail = useQuery({
    queryKey: detailKey,
    queryFn: () => api.getBook(row.id),
    enabled: reading,
  })
  const menu = useRecordRowMenu({ open: vi.fn(), isInmateReporter: false })
  const location = useLocation()
  return <>
    <RecordRowMenu book={row} itemsFor={menu.itemsFor} open={open} onOpenChange={(next) => {
      if (next) menu.onMenuOpen(row)
      setOpen(next)
    }} />
    {menu.dialogs}
    <button onClick={() => setReading(true)}>Read record</button>
    <output data-testid="actual-detail">{actualDetail.data?.subject}</output>
    <output data-testid="location">{location.pathname}{location.search}</output>
  </>
}

function setup(
  row: BookRead,
  detailKey: readonly unknown[] = ['books', 'detail', row.id],
  client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } }),
): QueryClient {
  render(<QueryClientProvider client={client}><MemoryRouter initialEntries={['/books']}>
    <Harness row={row} detailKey={detailKey} />
  </MemoryRouter></QueryClientProvider>)
  return client
}

async function openMenu(): Promise<void> {
  await userEvent.click(screen.getByRole('button', { name: /Actions for/ }))
  await screen.findByRole('menu')
}

beforeEach(() => {
  vi.clearAllMocks()
  hasCapability.mockReturnValue(true)
  vi.mocked(api.getBook).mockResolvedValue(book(2))
})

describe('Record row actions', () => {
  it('does not reuse fresh preview or record detail data for a menu peek', async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } })
    const cached = book(2, { subject: 'Already read', can_send: true })
    client.setQueryData(['books', 'detail', 2], cached)
    client.setQueryData(['books', 'detail', 2, null], cached)
    const peek = book(2, { subject: 'Unread peek', can_change_confidentiality: true })
    vi.mocked(api.getBook).mockResolvedValue(peek)
    setup(book(2), ['books', 'detail', 2], client)

    await openMenu()

    await screen.findByRole('menuitem', { name: /Change level/ })
    expect(api.getBook).toHaveBeenCalledExactlyOnceWith(2, undefined, { markRead: false })
    expect(screen.queryByRole('menuitem', { name: /Send to/ })).toBeNull()
    expect(client.getQueryData(['books', 'detail-peek', 2])).toEqual(peek)
    expect(client.getQueryData(['books', 'detail', 2])).toEqual(cached)
    expect(client.getQueryData(['books', 'detail', 2, null])).toEqual(cached)
  })

  it.each([
    { surface: 'preview', detailKey: ['books', 'detail', 2] },
    { surface: 'record', detailKey: ['books', 'detail', 2, null] },
  ])('cannot seed the $surface detail cache or bypass its read request', async ({ detailKey }) => {
    const peek = book(2, { subject: 'Unread peek' })
    const read = book(2, { subject: 'Actually read' })
    vi.mocked(api.getBook).mockResolvedValueOnce(peek).mockResolvedValueOnce(read)
    const client = setup(book(2), detailKey)

    await openMenu()
    await waitFor(() => expect(client.getQueryData(['books', 'detail-peek', 2])).toEqual(peek))
    expect(client.getQueryData(['books', 'detail', 2])).toBeUndefined()
    expect(client.getQueryData(['books', 'detail', 2, null])).toBeUndefined()
    expect(api.getBook).toHaveBeenCalledExactlyOnceWith(2, undefined, { markRead: false })

    await userEvent.keyboard('{Escape}')
    await userEvent.click(screen.getByRole('button', { name: 'Read record' }))

    await waitFor(() => expect(screen.getByTestId('actual-detail')).toHaveTextContent('Actually read'))
    expect(api.getBook).toHaveBeenNthCalledWith(2, 2)
    expect(client.getQueryData(detailKey)).toEqual(read)
    expect(client.getQueryData(['books', 'detail-peek', 2])).toEqual(peek)
  })

  it('does not offer Link when the record is writable but books.edit is absent', async () => {
    hasCapability.mockImplementation((capability: string) => capability !== 'books.edit')
    const writable = book(2, { can_write: true })
    vi.mocked(api.getBook).mockResolvedValue(writable)
    const client = setup(writable)

    await openMenu()
    await waitFor(() => expect(client.getQueryData(['books', 'detail-peek', 2])).toEqual(writable))

    expect(screen.queryByRole('menuitem', { name: /Link/i })).toBeNull()
    expect(screen.queryByRole('dialog', { name: /Link/i })).toBeNull()
    expect(screen.getByRole('menuitem', { name: 'Reply' })).toBeInTheDocument()
  })

  it('fetches a read-free peek only on menu entry, then offers its relevant tools and reply descriptors', async () => {
    vi.mocked(api.getBook).mockResolvedValue(book(2, { can_send: true, can_change_confidentiality: true }))
    const client = setup(book(2))
    expect(api.getBook).not.toHaveBeenCalled()
    await openMenu()
    await screen.findByRole('menuitem', { name: /Send to/ })
    expect(api.getBook).toHaveBeenCalledWith(2, undefined, { markRead: false })
    expect(client.getQueryData(['books', 'detail-peek', 2])).toEqual(book(2, { can_send: true, can_change_confidentiality: true }))
    expect(client.getQueryData(['books', 'detail', 2])).toBeUndefined()
    expect(screen.getByRole('menuitem', { name: /Change level/ })).toBeInTheDocument()
    expect(screen.queryByRole('menuitem', { name: 'Download PDF' })).toBeNull()
    expect(screen.queryByRole('menuitem', { name: 'Print' })).toBeNull()
    expect(screen.queryByRole('menuitem', { name: 'Mark as done' })).toBeNull()
    await userEvent.click(screen.getByRole('menuitem', { name: 'Reply' }))
    expect(screen.getByText('reply:2')).toBeInTheDocument()
  })

  it('runs recipient descriptors against the menu record rather than the preview selection', async () => {
    vi.mocked(api.getBook).mockResolvedValue(book(7, { my_inbox: {
      id: 1, purpose: 'action', sent_by_user_id: 3, sent_by_name: 'Sara', sent_at: '2026-01-01',
      note: null, read_at: null, done_at: null, archived_at: null,
    } }))
    setup(book(7))
    await openMenu()
    await userEvent.click(await screen.findByRole('menuitem', { name: 'Mark as done' }))
    await waitFor(() => expect(api.markBookInboxDone).toHaveBeenCalledWith(7))
  })

  it('prints the available PDF using record print mode even when the default paper is an image', async () => {
    vi.mocked(api.getBook).mockResolvedValue(book(2, { attachment_paths: ['first.png', 'second.pdf'] }))
    const opened = { opener: window }
    const open = vi.spyOn(window, 'open').mockReturnValue(opened as Window)
    setup(book(2))
    await openMenu()
    expect(await screen.findByRole('menuitem', { name: 'Download PDF' })).toBeInTheDocument()
    await userEvent.click(screen.getByRole('menuitem', { name: 'Print' }))
    expect(open).toHaveBeenCalledWith('/books/2?print=1&paper=scan-1', '_blank')
    expect(opened.opener).toBeNull()
    open.mockRestore()
  })
})
