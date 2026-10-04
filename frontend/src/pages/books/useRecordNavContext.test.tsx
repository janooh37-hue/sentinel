import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useRef } from 'react'
import { MemoryRouter, Route, Routes, useLocation, useNavigate, useParams } from 'react-router-dom'
import { describe, expect, it, vi } from 'vitest'

import type { ApprovalContext } from '@/lib/approvals'
import {
  describeListFrom,
  openRecord,
  recordLinkProps,
  stripOpenParam,
  useListReturnFocus,
  useRecordNavContext,
} from './useRecordNavContext'
import type { ListReturnState, RecordNavState } from './useRecordNavContext'

vi.mock('@/lib/api', () => ({
  api: {
    approvalLogNeighbors: vi.fn().mockResolvedValue({
      position: 2,
      total: 3,
      previous: { book_id: 11, version_id: 111 },
      next: { book_id: 13, version_id: 133 },
    }),
  },
}))

const FROM_WITH_OPEN = '/books?status=pending&open=1'
const FROM = '/books?status=pending'
const NAV: RecordNavState = { from: FROM_WITH_OPEN, queue: [1, 2, 3], scrollY: 240 }

function Probe({ approvalContext = null }: { approvalContext?: ApprovalContext | null }): React.JSX.Element {
  const { id } = useParams()
  const location = useLocation()
  const navigate = useNavigate()
  const nav = useRecordNavContext({ bookId: Number(id), versionId: 5, approvalContext })
  return (
    <div>
      <output data-testid="at">{location.pathname}{location.search}</output>
      <output data-testid="state">{JSON.stringify(location.state)}</output>
      <output data-testid="queue">{JSON.stringify(nav.queue)}</output>
      <output data-testid="index">{String(nav.index)}</output>
      <output data-testid="from">{String(nav.from)}</output>
      <button onClick={() => nav.queue.nextId != null && nav.step(nav.queue.nextId, nav.queue.nextVersionId)}>next</button>
      <button onClick={() => nav.back()}>back</button>
      <button onClick={() => navigate(-1)}>history-back</button>
    </div>
  )
}

function List(): React.JSX.Element {
  const navigate = useNavigate()
  const location = useLocation()
  return (
    <div>
      <output data-testid="list-at">{location.pathname}{location.search}</output>
      <output data-testid="list-state">{JSON.stringify(location.state)}</output>
      <button onClick={() => openRecord(navigate, 1, NAV)}>open-1</button>
    </div>
  )
}

function setup(approvalContext: ApprovalContext | null = null, initial: string[] = [FROM_WITH_OPEN]) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={initial} initialIndex={initial.length - 1}>
        <Routes>
          <Route path="/books" element={<List />} />
          <Route path="/books/:id" element={<Probe approvalContext={approvalContext} />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

describe('openRecord / recordLinkProps', () => {
  it('stores `from` without `open`, keeps queue and scrollY', async () => {
    setup()
    await userEvent.click(screen.getByText('open-1'))
    expect(screen.getByTestId('at')).toHaveTextContent('/books/1')
    expect(JSON.parse(screen.getByTestId('state').textContent ?? '')).toEqual({
      from: FROM,
      queue: [1, 2, 3],
      scrollY: 240,
    })
  })

  it('recordLinkProps builds the same target for a real <Link>', () => {
    expect(recordLinkProps(7, NAV)).toEqual({
      to: '/books/7',
      state: { from: FROM, queue: [1, 2, 3], scrollY: 240 },
    })
  })

  it('stripOpenParam only drops `open`', () => {
    expect(stripOpenParam('/books?open=4')).toBe('/books')
    expect(stripOpenParam('/books?status=pending&open=4&q=a#x')).toBe('/books?status=pending&q=a#x')
    expect(stripOpenParam('/books?status=pending')).toBe('/books?status=pending')
    expect(stripOpenParam('/books')).toBe('/books')
  })
})

describe('useRecordNavContext', () => {
  it('J → J → Back: queue survives, history does not grow, Back lands on `from` with the current id', async () => {
    const user = userEvent.setup()
    setup()
    await user.click(screen.getByText('open-1'))
    expect(screen.getByTestId('index')).toHaveTextContent('0')
    expect(screen.getByTestId('from')).toHaveTextContent(FROM)

    await user.click(screen.getByText('next'))
    expect(screen.getByTestId('at')).toHaveTextContent('/books/2')
    expect(screen.getByTestId('index')).toHaveTextContent('1')
    await user.click(screen.getByText('next'))
    expect(screen.getByTestId('at')).toHaveTextContent('/books/3')
    expect(screen.getByTestId('index')).toHaveTextContent('2')

    // The queue survived both steps, still forwarded in history state.
    expect(JSON.parse(screen.getByTestId('state').textContent ?? '')).toEqual({
      from: FROM,
      queue: [1, 2, 3],
      scrollY: 240,
    })
    expect(JSON.parse(screen.getByTestId('queue').textContent ?? '')).toMatchObject({
      position: 3,
      total: 3,
      prevId: 2,
      nextId: null,
    })

    // Steps replaced: one history-back from record 3 lands on the LIST, not record 2.
    await user.click(screen.getByText('history-back'))
    expect(screen.getByTestId('list-at').textContent).toBe(FROM_WITH_OPEN)
  })

  it('Back navigates to `from` (no open) with focusBookId = current id and the saved scroll', async () => {
    const user = userEvent.setup()
    setup()
    await user.click(screen.getByText('open-1'))
    await user.click(screen.getByText('next'))
    await user.click(screen.getByText('next'))
    await user.click(screen.getByText('back'))
    expect(screen.getByTestId('list-at').textContent).toBe(FROM)
    expect(JSON.parse(screen.getByTestId('list-state').textContent ?? '')).toEqual({
      focusBookId: 3,
      scrollY: 240,
    } satisfies ListReturnState)
  })

  it('Back goes to /books and has no queue for a direct open', async () => {
    const user = userEvent.setup()
    setup(null, ['/books', '/books/9'])
    expect(screen.getByTestId('from')).toHaveTextContent('null')
    expect(JSON.parse(screen.getByTestId('queue').textContent ?? '')).toMatchObject({
      position: null,
      total: 0,
    })
    await user.click(screen.getByText('back'))
    expect(screen.getByTestId('list-at').textContent).toBe('/books')
    expect(screen.getByTestId('list-state').textContent).toBe('null')
  })

  it('in an approval context the queue is the approval log and step carries no paper', async () => {
    const user = userEvent.setup()
    const ctx: ApprovalContext = { tab: 'received', kind: 'sign', status: 'pending', sort: 'newest', page: 1 }
    setup(ctx, ['/books/12?paper=signed&tab=received'])
    await waitFor(() => expect(screen.getByTestId('index')).toHaveTextContent('1'))
    expect(JSON.parse(screen.getByTestId('queue').textContent ?? '')).toMatchObject({
      prevId: 11,
      prevVersionId: 111,
      nextId: 13,
      nextVersionId: 133,
    })
    await user.click(screen.getByText('next'))
    const at = screen.getByTestId('at').textContent ?? ''
    expect(at.startsWith('/books/13?')).toBe(true)
    const params = new URLSearchParams(at.split('?')[1])
    expect(params.get('version_id')).toBe('133')
    expect(params.get('tab')).toBe('received')
    expect(params.get('sort')).toBe('newest')
    expect(params.has('paper')).toBe(false)
  })
})

describe('describeListFrom', () => {
  const t = (key: string): string => key
  it('labels status, drafts, mine and the approvals log; nothing for an unfiltered list', () => {
    expect(describeListFrom('/books?status=pending', t)).toBe('books.approval.statePending')
    expect(describeListFrom('/books?drafts=1', t)).toBe('books.filters.drafts')
    expect(describeListFrom('/books?mine=1&status=pending', t)).toBe('books.list.myRecords')
    expect(describeListFrom('/books/approvals?tab=sent', t)).toBe('books.approvals.title')
    expect(describeListFrom('/books', t)).toBeNull()
    expect(describeListFrom(null, t)).toBeNull()
  })
})

describe('useListReturnFocus', () => {
  function ReturnList({
    isDesktop,
    onSelect,
    onFlash,
  }: {
    isDesktop: boolean
    onSelect?: (id: number) => void
    onFlash?: (id: number) => void
  }): React.JSX.Element {
    const scroller = useRef<HTMLDivElement>(null)
    const location = useLocation()
    const navigate = useNavigate()
    useListReturnFocus(scroller, {
      isDesktop,
      ready: true,
      onSelect: (id) => {
        onSelect?.(id)
        const params = new URLSearchParams(location.search)
        params.set('open', String(id))
        navigate({ search: `?${params}` }, { replace: true, state: location.state })
      },
      onFlash,
      rowSelector: (id) => `[data-id="${id}"]`,
    })
    return (
      <div>
        <output data-testid="at">{location.pathname}{location.search}</output>
        <output data-testid="state">{JSON.stringify(location.state)}</output>
        <div ref={scroller} data-testid="scroller" style={{ overflow: 'auto', height: 100 }}>
          <div data-id="3">row 3</div>
        </div>
      </div>
    )
  }

  function renderReturn(props: { isDesktop: boolean; onSelect?: (id: number) => void; onFlash?: (id: number) => void }) {
    const state: ListReturnState = { focusBookId: 3, scrollY: 77 }
    return render(
      <MemoryRouter initialEntries={[{ pathname: '/books', search: '?status=pending', state }]}>
        <Routes>
          <Route path="/books" element={<ReturnList {...props} />} />
        </Routes>
      </MemoryRouter>,
    )
  }

  it('desktop: restores scroll, selects the row via open, reveals it, then clears the state', async () => {
    const scrollIntoView = vi.fn()
    Element.prototype.scrollIntoView = scrollIntoView
    const onSelect = vi.fn()
    renderReturn({ isDesktop: true, onSelect })
    await waitFor(() => expect(screen.getByTestId('state')).toHaveTextContent('null'))
    expect(screen.getByTestId('scroller').scrollTop).toBe(77)
    expect(onSelect).toHaveBeenCalledWith(3)
    expect(scrollIntoView).toHaveBeenCalledWith({ block: 'nearest' })
    // The clearing navigate kept the `open` the selection wrote.
    expect(screen.getByTestId('at')).toHaveTextContent('/books?status=pending&open=3')
  })

  it('phone: flashes the card, never sets open, then clears the state', async () => {
    const scrollIntoView = vi.fn()
    Element.prototype.scrollIntoView = scrollIntoView
    const onSelect = vi.fn()
    const onFlash = vi.fn()
    renderReturn({ isDesktop: false, onSelect, onFlash })
    await waitFor(() => expect(screen.getByTestId('state')).toHaveTextContent('null'))
    expect(onFlash).toHaveBeenCalledWith(3)
    expect(onSelect).not.toHaveBeenCalled()
    expect(scrollIntoView).toHaveBeenCalledWith({ block: 'center' })
    expect(screen.getByTestId('at').textContent).toBe('/books?status=pending')
  })
})
