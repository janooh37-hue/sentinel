import { act, render, screen } from '@testing-library/react'
import { QueryClient, QueryClientProvider, useQuery } from '@tanstack/react-query'
import { MemoryRouter, Route, Routes, useNavigate } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { ApiError } from '@/lib/api'
import { bidi } from '@/lib/bidi'
import { RecordDeleteProvider, useRecordDelete } from './RecordDeleteProvider'

const { deleteBook, toastFn, toastSuccess, toastError, toastDismiss } = vi.hoisted(() => ({
  deleteBook: vi.fn(),
  toastFn: vi.fn(),
  toastSuccess: vi.fn(),
  toastError: vi.fn(),
  toastDismiss: vi.fn(),
}))

vi.mock('@/lib/api', async (orig) => {
  const actual = await orig<typeof import('@/lib/api')>()
  return { ...actual, api: { ...actual.api, deleteBook } }
})
vi.mock('sonner', () => ({
  toast: Object.assign(toastFn, {
    success: toastSuccess,
    error: toastError,
    dismiss: toastDismiss,
  }),
}))

type ToastOpts = { id: string; duration: number; action: { label: string; onClick: () => void } }
const lastToast = (): [string, ToastOpts] => {
  const call = toastFn.mock.calls[toastFn.mock.calls.length - 1] as [string, ToastOpts]
  return call
}

// A tiny "server": the list query reads it, deleteBook edits it, and a test can
// hold the refetch open to look at the screen while it is still in flight.
let serverIds: number[]
let gate: Promise<void> | null
const fetchBooks = vi.fn(async (): Promise<number[]> => {
  if (gate) await gate
  return [...serverIds]
})
function holdRefetch(): () => void {
  let open!: () => void
  gate = new Promise<void>((resolve) => {
    open = resolve
  })
  return () => {
    gate = null
    open()
  }
}

function Rows(): React.JSX.Element {
  const { pendingIds, scheduleDelete } = useRecordDelete()
  const nav = useNavigate()
  const { data: ids = [] } = useQuery({ queryKey: ['books', 'list'], queryFn: fetchBooks })
  return (
    <div>
      <ul data-testid="rows">
        {ids.filter((id) => !pendingIds.has(id)).map((id) => (
          <li key={id}>row-{id}</li>
        ))}
      </ul>
      <button onClick={() => scheduleDelete([{ id: 1, ref: 'A-1' }])}>one</button>
      <button
        onClick={() =>
          scheduleDelete([
            { id: 2, ref: 'A-2' },
            { id: 3, ref: 'A-3' },
          ])
        }
      >
        two
      </button>
      <button onClick={() => nav('/elsewhere')}>go</button>
    </div>
  )
}

function Probe(): null {
  useRecordDelete()
  return null
}

let qc: QueryClient
function setup() {
  qc = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } })
  qc.setQueryData(['books', 'list'], [1, 2, 3, 4])
  const invalidate = vi.spyOn(qc, 'invalidateQueries')
  const utils = render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={['/books']}>
        <RecordDeleteProvider>
          <Routes>
            <Route path="/books" element={<Rows />} />
            <Route path="/elsewhere" element={<p>elsewhere</p>} />
          </Routes>
        </RecordDeleteProvider>
      </MemoryRouter>
    </QueryClientProvider>,
  )
  return { ...utils, invalidate }
}

const click = (name: string): void => {
  act(() => {
    screen.getByText(name).click()
  })
}
const advance = (ms: number): Promise<void> =>
  act(async () => {
    await vi.advanceTimersByTimeAsync(ms)
  })
const invalidatedKeys = (invalidate: { mock: { calls: unknown[][] } }): unknown[] =>
  invalidate.mock.calls.map((c) => (c[0] as { queryKey: unknown[] }).queryKey[0])

beforeEach(() => {
  vi.useFakeTimers()
  serverIds = [1, 2, 3, 4]
  gate = null
  fetchBooks.mockClear()
  deleteBook.mockReset().mockImplementation(async (id: number) => {
    serverIds = serverIds.filter((x) => x !== id)
  })
  toastFn.mockReset()
  toastSuccess.mockReset()
  toastError.mockReset()
  toastDismiss.mockReset()
})
afterEach(() => {
  vi.useRealTimers()
})

describe('RecordDeleteProvider', () => {
  it('hides the rows at once and shows one Undo toast with the ref', () => {
    setup()
    click('one')
    expect(screen.queryByText('row-1')).toBeNull()
    expect(screen.getByText('row-2')).toBeInTheDocument()
    expect(toastFn).toHaveBeenCalledTimes(1)
    const [msg, opts] = lastToast()
    expect(msg).toBe(`Record ${bidi('A-1')} deleted`)
    expect(opts.duration).toBe(6000)
    expect(opts.action.label).toBe('Undo')
    expect(opts.id).toEqual(expect.any(String))
    expect(deleteBook).not.toHaveBeenCalled()
  })

  it('every batch gets its own toast id', () => {
    setup()
    click('one')
    click('two')
    const ids = toastFn.mock.calls.map((c) => (c[1] as ToastOpts).id)
    expect(ids).toHaveLength(2)
    expect(new Set(ids).size).toBe(2)
  })

  it('Undo makes no API call and shows the restored toast', async () => {
    const { invalidate } = setup()
    click('one')
    act(() => lastToast()[1].action.onClick())
    expect(screen.getByText('row-1')).toBeInTheDocument()
    expect(toastSuccess).toHaveBeenCalledWith(`Record ${bidi('A-1')} restored`)
    expect(toastError).not.toHaveBeenCalled()
    await advance(10_000)
    expect(deleteBook).not.toHaveBeenCalled()
    // Nothing reached the server, so there is nothing to refetch either.
    expect(invalidate).not.toHaveBeenCalled()
    expect(toastDismiss).not.toHaveBeenCalled()
  })

  it('a second Undo click on the same toast does nothing', () => {
    setup()
    click('one')
    act(() => lastToast()[1].action.onClick())
    act(() => lastToast()[1].action.onClick())
    expect(toastSuccess).toHaveBeenCalledTimes(1)
    expect(toastError).not.toHaveBeenCalled()
  })

  it('commits exactly once after 6 s, then invalidates books and dashboard once each', async () => {
    const { invalidate } = setup()
    click('one')
    await advance(5_999)
    expect(deleteBook).not.toHaveBeenCalled()
    await advance(1)
    expect(deleteBook).toHaveBeenCalledTimes(1)
    expect(deleteBook).toHaveBeenCalledWith(1)
    await advance(20_000)
    expect(deleteBook).toHaveBeenCalledTimes(1)
    expect(invalidatedKeys(invalidate)).toEqual(['books', 'dashboard'])
    expect(toastError).not.toHaveBeenCalled()
  })

  it('dismisses the Undo toast, by the id it was shown with, when the delete commits', async () => {
    setup()
    click('one')
    const { id } = lastToast()[1]
    await advance(5_999)
    expect(toastDismiss).not.toHaveBeenCalled()
    await advance(1)
    expect(toastDismiss).toHaveBeenCalledWith(id)
  })

  it('keeps the row hidden until the refetch lands, then it stays gone', async () => {
    setup()
    const openRefetch = holdRefetch()
    click('one')
    await advance(6_000)
    expect(deleteBook).toHaveBeenCalledWith(1)
    expect(fetchBooks).toHaveBeenCalledTimes(1)
    // The refetch is still in flight: the cached row must not flash back.
    expect(screen.queryByText('row-1')).toBeNull()
    openRefetch()
    await advance(10)
    expect(screen.queryByText('row-1')).toBeNull()
    expect(screen.getByText('row-2')).toBeInTheDocument()
    expect(toastError).not.toHaveBeenCalled()
  })

  it('a route change does not commit early (the provider outlives the page)', async () => {
    setup()
    click('one')
    click('go')
    expect(screen.getByText('elsewhere')).toBeInTheDocument()
    await advance(3_000)
    expect(deleteBook).not.toHaveBeenCalled()
    await advance(3_000)
    expect(deleteBook).toHaveBeenCalledTimes(1)
  })

  it('unmounting the provider commits at once and dismisses the toast', async () => {
    const { unmount } = setup()
    click('one')
    const { id } = lastToast()[1]
    unmount()
    expect(toastDismiss).toHaveBeenCalledWith(id)
    await advance(0)
    expect(deleteBook).toHaveBeenCalledTimes(1)
    expect(deleteBook).toHaveBeenCalledWith(1)
  })

  it('scheduling an id that is already pending is a no-op (one toast, one DELETE)', async () => {
    setup()
    click('one')
    click('one')
    expect(toastFn).toHaveBeenCalledTimes(1)
    await advance(6_000)
    expect(deleteBook).toHaveBeenCalledTimes(1)
  })

  it('bulk: one count toast, every id hidden, Undo restores them all with no API call', async () => {
    setup()
    click('two')
    expect(screen.queryByText('row-2')).toBeNull()
    expect(screen.queryByText('row-3')).toBeNull()
    expect(toastFn).toHaveBeenCalledTimes(1)
    expect(lastToast()[0]).toBe('2 records deleted')
    act(() => lastToast()[1].action.onClick())
    expect(toastSuccess).toHaveBeenCalledWith('2 records restored')
    expect(screen.getByText('row-2')).toBeInTheDocument()
    expect(screen.getByText('row-3')).toBeInTheDocument()
    await advance(10_000)
    expect(deleteBook).not.toHaveBeenCalled()
  })

  it('bulk: one call per id after 6 s, but ONE invalidation per key for the whole batch', async () => {
    const { invalidate } = setup()
    click('two')
    await advance(6_000)
    expect(deleteBook.mock.calls.map((c) => c[0]).sort()).toEqual([2, 3])
    expect(invalidatedKeys(invalidate)).toEqual(['books', 'dashboard'])
    expect(toastError).not.toHaveBeenCalled()
  })

  it('bulk: the whole batch stays hidden until the single refetch lands', async () => {
    setup()
    const openRefetch = holdRefetch()
    click('two')
    await advance(6_000)
    expect(fetchBooks).toHaveBeenCalledTimes(1)
    expect(screen.queryByText('row-2')).toBeNull()
    expect(screen.queryByText('row-3')).toBeNull()
    openRefetch()
    await advance(10)
    expect(screen.queryByText('row-2')).toBeNull()
    expect(screen.queryByText('row-3')).toBeNull()
  })

  it('a 409 shows ONE error toast with the ref, and the row returns only after the refetch lands', async () => {
    deleteBook.mockRejectedValue(new ApiError(409, 'BOOK_NOT_DELETABLE', 'Record is in flight'))
    const { invalidate } = setup()
    const openRefetch = holdRefetch()
    click('one')
    await advance(6_000)
    expect(toastError).toHaveBeenCalledTimes(1)
    expect(toastError).toHaveBeenCalledWith(
      `Record ${bidi('A-1')} wasn’t deleted: Record is in flight`,
    )
    expect(invalidatedKeys(invalidate)).toEqual(['books', 'dashboard'])
    // The refetch is the real check: until it lands the row stays hidden...
    expect(fetchBooks).toHaveBeenCalledTimes(1)
    expect(screen.queryByText('row-1')).toBeNull()
    // ...and then the server still has it, so it comes back.
    openRefetch()
    await advance(10)
    expect(screen.getByText('row-1')).toBeInTheDocument()
  })

  it('bulk with one failure: ONE error toast naming only the failed ref, one invalidation per key', async () => {
    deleteBook.mockImplementation(async (id: number) => {
      if (id === 3) throw new ApiError(409, 'BOOK_NOT_DELETABLE', 'Record is in flight')
      serverIds = serverIds.filter((x) => x !== id)
    })
    const { invalidate } = setup()
    click('two')
    await advance(6_000)
    await advance(10)
    expect(deleteBook).toHaveBeenCalledTimes(2)
    expect(toastError).toHaveBeenCalledTimes(1)
    const msg = toastError.mock.calls[0][0] as string
    expect(msg).toBe(`Record ${bidi('A-3')} wasn’t deleted: Record is in flight`)
    expect(msg).not.toContain('A-2')
    expect(invalidatedKeys(invalidate)).toEqual(['books', 'dashboard'])
    // A-2 is gone for good; A-3 is back (the server kept it).
    expect(screen.queryByText('row-2')).toBeNull()
    expect(screen.getByText('row-3')).toBeInTheDocument()
  })

  it('bulk with every delete rejected: ONE toast with the count and all refs, not one per id', async () => {
    deleteBook.mockRejectedValue(new ApiError(403, 'FORBIDDEN', 'No permission'))
    const { invalidate } = setup()
    click('two')
    await advance(6_000)
    expect(toastError).toHaveBeenCalledTimes(1)
    const msg = toastError.mock.calls[0][0] as string
    expect(msg).toContain('2 records weren’t deleted')
    expect(msg).toContain(bidi('A-2'))
    expect(msg).toContain(bidi('A-3'))
    expect(invalidatedKeys(invalidate)).toEqual(['books', 'dashboard'])
  })

  it('Undo that lands after the commit says "too late" and never "restored"', async () => {
    setup()
    click('one')
    const staleUndo = lastToast()[1].action.onClick
    await advance(6_000)
    expect(deleteBook).toHaveBeenCalledTimes(1)
    act(() => staleUndo())
    expect(toastSuccess).not.toHaveBeenCalled()
    expect(toastError).toHaveBeenCalledTimes(1)
    expect(toastError).toHaveBeenCalledWith(
      `Too late to undo — record ${bidi('A-1')} was already deleted.`,
    )
    expect(deleteBook).toHaveBeenCalledTimes(1)
  })

  it('bulk: a stale Undo reports how many records were already deleted', async () => {
    setup()
    click('two')
    const staleUndo = lastToast()[1].action.onClick
    await advance(6_000)
    act(() => staleUndo())
    expect(toastSuccess).not.toHaveBeenCalled()
    expect(toastError).toHaveBeenCalledWith('Too late to undo — 2 records were already deleted.')
  })

  it('useRecordDelete outside the provider throws', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    expect(() => render(<Probe />)).toThrow(/RecordDeleteProvider/)
    spy.mockRestore()
  })
})
