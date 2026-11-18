import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, renderHook, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider, notifyManager, type QueryKey } from '@tanstack/react-query'

import type { NotificationCounts } from '@/lib/api'
import { subscribeToPush } from '@/lib/push'

const getCounts = vi.fn<() => Promise<NotificationCounts>>()
vi.mock('@/lib/api', () => ({ api: { getNotificationCounts: () => getCounts() } }))
vi.mock('@/lib/push', () => ({ subscribeToPush: vi.fn() }))
vi.mock('@/lib/authContext', async () => {
  // Vitest hoists this factory before React's static import can initialize.
  const { createContext } = await import('react')
  return { AuthContext: createContext({ user: { id: 7 } }) }
})

import { useNotificationStream } from '../useNotificationStream'

const ZERO: NotificationCounts = {
  approvals: 0,
  decisions: 0,
  leaves: 0,
  scans: 0,
  emails: 0,
  monthly_reviews: 0,
  monthly_approvals: 0,
  inbox: 0,
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

function mount(enabled = true, pushEnabled = enabled): { qc: QueryClient; invalidated: QueryKey[] } {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const invalidated: QueryKey[] = []
  const real = qc.invalidateQueries.bind(qc)
  vi.spyOn(qc, 'invalidateQueries').mockImplementation((filters) => {
    invalidated.push(filters?.queryKey ?? [])
    return real(filters)
  })
  renderHook(() => useNotificationStream(enabled, { pushEnabled }), {
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
    vi.mocked(subscribeToPush).mockReset().mockResolvedValue(null)
    FakeEventSource.last = null
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

  it('refreshes decisions and the Sent log when a decision count changes', () => {
    getCounts.mockReturnValue(NEVER)
    const { invalidated } = mount()
    const es = FakeEventSource.last!
    es.emit(ZERO)
    es.emit({ ...ZERO, decisions: 1 })
    expect(invalidated).toEqual([['notifications', 'decisions'], ['books', 'approval-log']])
    invalidated.length = 0
    es.emit(ZERO)
    expect(invalidated).toEqual([['notifications', 'decisions'], ['books', 'approval-log']])
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

  it('subscribes fleet push without opening counts or the stream', async () => {
    vi.stubGlobal('Notification', { permission: 'granted', requestPermission: vi.fn() })
    vi.stubGlobal('isSecureContext', true)
    vi.stubGlobal('navigator', { serviceWorker: {} })
    mount(false, true)
    await waitFor(() => expect(subscribeToPush).toHaveBeenCalledExactlyOnceWith(7))
    expect(getCounts).not.toHaveBeenCalled()
    expect(FakeEventSource.last).toBeNull()
  })

  it('keeps push, permission prompts, counts, and the stream off for inmates', () => {
    const requestPermission = vi.fn()
    vi.stubGlobal('Notification', { permission: 'default', requestPermission })
    vi.stubGlobal('isSecureContext', true)
    vi.stubGlobal('navigator', { serviceWorker: {} })
    mount(false, false)
    expect(requestPermission).not.toHaveBeenCalled()
    expect(subscribeToPush).not.toHaveBeenCalled()
    expect(getCounts).not.toHaveBeenCalled()
    expect(FakeEventSource.last).toBeNull()
  })
})
