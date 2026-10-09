import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, renderHook, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider, notifyManager, type QueryKey } from '@tanstack/react-query'

import type { NotificationCounts } from '@/lib/api'

const getCounts = vi.fn<() => Promise<NotificationCounts>>()
vi.mock('@/lib/api', () => ({ api: { getNotificationCounts: () => getCounts() } }))
vi.mock('@/lib/push', () => ({ subscribeToPush: vi.fn() }))

import { useNotificationStream } from '../useNotificationStream'

const ZERO: NotificationCounts = {
  approvals: 0,
  leaves: 0,
  scans: 0,
  emails: 0,
  monthly_reviews: 0,
  monthly_approvals: 0,
}

// The tsconfig lib predates Promise.withResolvers.
const NEVER = new Promise<NotificationCounts>(() => {})

class FakeEventSource {
  static last: FakeEventSource | null = null
  private listeners = new Map<string, (e: MessageEvent) => void>()
  constructor() {
    FakeEventSource.last = this
  }
  addEventListener(type: string, fn: (e: MessageEvent) => void): void {
    this.listeners.set(type, fn)
  }
  close(): void {}
  emit(counts: NotificationCounts): void {
    act(() => {
      this.listeners.get('counts')?.(new MessageEvent('counts', { data: JSON.stringify(counts) }))
    })
  }
}

function mount(): { qc: QueryClient; invalidated: QueryKey[] } {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const invalidated: QueryKey[] = []
  const real = qc.invalidateQueries.bind(qc)
  vi.spyOn(qc, 'invalidateQueries').mockImplementation((filters) => {
    invalidated.push(filters?.queryKey ?? [])
    return real(filters)
  })
  renderHook(() => useNotificationStream(true), {
    wrapper: ({ children }) => <QueryClientProvider client={qc}>{children}</QueryClientProvider>,
  })
  return { qc, invalidated }
}

describe('useNotificationStream', () => {
  beforeEach(() => {
    vi.stubGlobal('EventSource', FakeEventSource)
    // Render each cache write inside the emitting act(), not on a later tick.
    notifyManager.setScheduler((cb) => cb())
    getCounts.mockReset()
  })
  afterEach(() => vi.unstubAllGlobals())

  it('treats the first counts as a baseline and ignores unchanged frames', () => {
    getCounts.mockReturnValue(NEVER) // poll never answers
    const { invalidated } = mount()
    const es = FakeEventSource.last!

    es.emit({ ...ZERO, scans: 3, emails: 7 })
    es.emit({ ...ZERO, scans: 3, emails: 7 })

    expect(invalidated).toEqual([])
  })

  it('refetches only the queries behind the counts that changed', () => {
    getCounts.mockReturnValue(NEVER)
    const { qc, invalidated } = mount()
    const es = FakeEventSource.last!
    es.emit(ZERO)

    es.emit({ ...ZERO, scans: 1 })
    expect(invalidated).toEqual([['scan-inbox', 'count']])

    invalidated.length = 0
    es.emit({ ...ZERO, scans: 1, emails: 2 })
    expect(invalidated).toEqual([['ledger', 'unread-recent'], ['ledger-unread-count']])
    expect(qc.getQueryData(['notifications', 'counts'])).toEqual({ ...ZERO, scans: 1, emails: 2 })
  })

  it('applies the same targeted refetch when the safety poll sees a change', async () => {
    getCounts.mockResolvedValueOnce(ZERO).mockResolvedValueOnce({ ...ZERO, approvals: 1 })
    const { qc, invalidated } = mount()
    await waitFor(() => expect(qc.getQueryData(['notifications', 'counts'])).toEqual(ZERO))

    await act(() => qc.refetchQueries({ queryKey: ['notifications', 'counts'] }))

    await waitFor(() =>
      expect(invalidated).toEqual([
        ['books', 'approval-summary'],
        ['books', 'awaiting'],
      ]),
    )
  })
})
