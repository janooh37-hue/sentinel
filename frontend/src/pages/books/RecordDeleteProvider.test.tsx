import { act, render, screen } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter, Route, Routes, useNavigate } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { ApiError } from '@/lib/api'
import { RecordDeleteProvider, useRecordDelete } from './RecordDeleteProvider'

const { deleteBook, toastFn, toastSuccess, toastError } = vi.hoisted(() => ({
  deleteBook: vi.fn(),
  toastFn: vi.fn(),
  toastSuccess: vi.fn(),
  toastError: vi.fn(),
}))

vi.mock('@/lib/api', async (orig) => {
  const actual = await orig<typeof import('@/lib/api')>()
  return { ...actual, api: { ...actual.api, deleteBook } }
})
vi.mock('sonner', () => ({
  toast: Object.assign(toastFn, { success: toastSuccess, error: toastError }),
}))

type ToastOpts = { duration: number; action: { label: string; onClick: () => void } }
const lastToast = (): [string, ToastOpts] => {
  const call = toastFn.mock.calls[toastFn.mock.calls.length - 1] as [string, ToastOpts]
  return call
}

function Rows({ ids }: { ids: number[] }): React.JSX.Element {
  const { pendingIds, scheduleDelete } = useRecordDelete()
  const nav = useNavigate()
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

let qc: QueryClient
function setup() {
  qc = new QueryClient()
  const invalidate = vi.spyOn(qc, 'invalidateQueries')
  const utils = render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={['/books']}>
        <RecordDeleteProvider>
          <Routes>
            <Route path="/books" element={<Rows ids={[1, 2, 3, 4]} />} />
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

beforeEach(() => {
  vi.useFakeTimers()
  deleteBook.mockReset().mockResolvedValue(undefined)
  toastFn.mockReset()
  toastSuccess.mockReset()
  toastError.mockReset()
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
    expect(msg).toBe('Record A-1 deleted')
    expect(opts.duration).toBe(6000)
    expect(opts.action.label).toBe('Undo')
    expect(deleteBook).not.toHaveBeenCalled()
  })

  it('Undo makes no API call and shows the restored toast', async () => {
    setup()
    click('one')
    act(() => lastToast()[1].action.onClick())
    expect(screen.getByText('row-1')).toBeInTheDocument()
    expect(toastSuccess).toHaveBeenCalledWith('Record A-1 restored')
    await act(async () => {
      await vi.advanceTimersByTimeAsync(10_000)
    })
    expect(deleteBook).not.toHaveBeenCalled()
  })

  it('commits exactly once after 6 s, then invalidates books and dashboard', async () => {
    const { invalidate } = setup()
    click('one')
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5_999)
    })
    expect(deleteBook).not.toHaveBeenCalled()
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1)
    })
    expect(deleteBook).toHaveBeenCalledTimes(1)
    expect(deleteBook).toHaveBeenCalledWith(1)
    await act(async () => {
      await vi.advanceTimersByTimeAsync(20_000)
    })
    expect(deleteBook).toHaveBeenCalledTimes(1)
    const keys = invalidate.mock.calls.map((c) => (c[0] as { queryKey: unknown[] }).queryKey[0])
    expect(keys).toEqual(expect.arrayContaining(['books', 'dashboard']))
  })

  it('a route change does not commit early (the provider outlives the page)', async () => {
    setup()
    click('one')
    click('go')
    expect(screen.getByText('elsewhere')).toBeInTheDocument()
    await act(async () => {
      await vi.advanceTimersByTimeAsync(3_000)
    })
    expect(deleteBook).not.toHaveBeenCalled()
    await act(async () => {
      await vi.advanceTimersByTimeAsync(3_000)
    })
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
    await act(async () => {
      await vi.advanceTimersByTimeAsync(10_000)
    })
    expect(deleteBook).not.toHaveBeenCalled()
  })

  it('bulk: commits one call per id after 6 s', async () => {
    setup()
    click('two')
    await act(async () => {
      await vi.advanceTimersByTimeAsync(6_000)
    })
    expect(deleteBook.mock.calls.map((c) => c[0]).sort()).toEqual([2, 3])
  })

  it('a 409 on commit shows an error toast and still invalidates', async () => {
    deleteBook.mockRejectedValue(new ApiError(409, 'BOOK_NOT_DELETABLE', 'Record is in flight'))
    const { invalidate } = setup()
    click('one')
    await act(async () => {
      await vi.advanceTimersByTimeAsync(6_000)
    })
    expect(toastError).toHaveBeenCalledWith('Record is in flight')
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['books'] })
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['dashboard'] })
    // The failed id is no longer pending, so the row reappears after the refetch.
    expect(screen.getByText('row-1')).toBeInTheDocument()
  })

  it('useRecordDelete outside the provider throws', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    expect(() => render(<Rows ids={[]} />)).toThrow(/RecordDeleteProvider/)
    spy.mockRestore()
  })
})
