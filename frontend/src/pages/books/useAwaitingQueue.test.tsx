/**
 * Queue walk for the record page's prev/next arrows. Order must match the
 * server's (created_at DESC) so the arrows track the same list the manager
 * sees on the dashboard and they never lose their place.
 */
import { renderHook, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { createElement, type ReactNode } from 'react'
import { describe, it, expect, vi, beforeEach } from 'vitest'

import { useAwaitingQueue } from './useAwaitingQueue'
import * as apiMod from '@/lib/api'

function wrapper({ children }: { children: ReactNode }) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return createElement(QueryClientProvider, { client: qc }, children)
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.spyOn(apiMod.api, 'listAwaitingBooks').mockResolvedValue(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    [{ id: 10 }, { id: 20 }, { id: 30 }] as any,
  )
})

describe('useAwaitingQueue', () => {
  it('reports position and both neighbours for a middle book', async () => {
    const { result } = renderHook(() => useAwaitingQueue(20, true), { wrapper })
    await waitFor(() => expect(result.current.total).toBe(3))
    expect(result.current.position).toBe(2)
    expect(result.current.prevId).toBe(10)
    expect(result.current.nextId).toBe(30)
  })

  it('has no prev at the head and no next at the tail', async () => {
    const head = renderHook(() => useAwaitingQueue(10, true), { wrapper })
    await waitFor(() => expect(head.result.current.position).toBe(1))
    expect(head.result.current.prevId).toBeNull()

    const tail = renderHook(() => useAwaitingQueue(30, true), { wrapper })
    await waitFor(() => expect(tail.result.current.position).toBe(3))
    expect(tail.result.current.nextId).toBeNull()
  })

  it('reports null position for a book that is not in the queue', async () => {
    const { result } = renderHook(() => useAwaitingQueue(999, true), { wrapper })
    await waitFor(() => expect(result.current.total).toBe(3))
    expect(result.current.position).toBeNull()
    expect(result.current.prevId).toBeNull()
    expect(result.current.nextId).toBeNull()
  })

  it('does not fetch when disabled', async () => {
    const { result } = renderHook(() => useAwaitingQueue(20, false), { wrapper })
    await waitFor(() => expect(result.current.total).toBe(0))
    expect(apiMod.api.listAwaitingBooks).not.toHaveBeenCalled()
  })
})
