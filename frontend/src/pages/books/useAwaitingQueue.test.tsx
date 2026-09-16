/**
 * Queue walk for the record page's prev/next arrows. Backed by the scoped
 * neighbors endpoint so the arrows track the SAME filtered/ordered worklist
 * the caller opened the record from, not the unrelated global queue.
 */
import { renderHook, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { createElement, type ReactNode } from 'react'
import { describe, it, expect, vi, beforeEach } from 'vitest'

import { useAwaitingQueue } from './useAwaitingQueue'
import type { ApprovalContext } from '@/lib/approvals'
import type { ApprovalLogItem, ApprovalLogNeighborsResponse } from '@/lib/api'
import * as apiMod from '@/lib/api'

const CONTEXT: ApprovalContext = { tab: 'received', kind: 'sign', status: 'pending', sort: 'oldest', page: 1 }

function wrapper({ children }: { children: ReactNode }) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return createElement(QueryClientProvider, { client: qc }, children)
}

function neighborRow(bookId: number, versionId: number): ApprovalLogItem {
  return {
    book_id: bookId,
    ref_number: `HR-${bookId}`,
    status: 'pending',
    priority: 'Normal',
    version_id: versionId,
    access_scope: 'full',
  }
}

function neighborsResult(
  overrides: Partial<ApprovalLogNeighborsResponse>,
): ApprovalLogNeighborsResponse {
  return {
    position: null, total: 0, previous: null, next: null,
    ...overrides,
  }
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('useAwaitingQueue', () => {
  it('reports position and both neighbours for a middle book', async () => {
    vi.spyOn(apiMod.api, 'approvalLogNeighbors').mockResolvedValue(
      neighborsResult({
        position: 2, total: 3,
        previous: neighborRow(10, 101),
        next: neighborRow(30, 301),
      }),
    )
    const { result } = renderHook(() => useAwaitingQueue(20, 201, CONTEXT, true), { wrapper })
    await waitFor(() => expect(result.current.total).toBe(3))
    expect(result.current.position).toBe(2)
    expect(result.current.prevId).toBe(10)
    expect(result.current.prevVersionId).toBe(101)
    expect(result.current.nextId).toBe(30)
    expect(result.current.nextVersionId).toBe(301)
    expect(apiMod.api.approvalLogNeighbors).toHaveBeenCalledWith(20, {
      scope: 'received', kind: 'approver', status: 'pending', sort: 'oldest', version_id: 201,
    })
  })

  it('has no prev at the head', async () => {
    vi.spyOn(apiMod.api, 'approvalLogNeighbors').mockResolvedValue(
      neighborsResult({ position: 1, total: 3, next: neighborRow(30, 301) }),
    )
    const head = renderHook(() => useAwaitingQueue(10, 101, CONTEXT, true), { wrapper })
    await waitFor(() => expect(head.result.current.position).toBe(1))
    expect(head.result.current.prevId).toBeNull()
  })

  it('reports null position for a book that is not in the worklist', async () => {
    vi.spyOn(apiMod.api, 'approvalLogNeighbors').mockResolvedValue(neighborsResult({ total: 3 }))
    const { result } = renderHook(() => useAwaitingQueue(999, null, CONTEXT, true), { wrapper })
    await waitFor(() => expect(result.current.total).toBe(3))
    expect(result.current.position).toBeNull()
    expect(result.current.prevId).toBeNull()
    expect(result.current.nextId).toBeNull()
  })

  it('does not fetch when disabled', async () => {
    vi.spyOn(apiMod.api, 'approvalLogNeighbors').mockResolvedValue(neighborsResult({}))
    const { result } = renderHook(() => useAwaitingQueue(20, 201, CONTEXT, false), { wrapper })
    await waitFor(() => expect(result.current.total).toBe(0))
    expect(apiMod.api.approvalLogNeighbors).not.toHaveBeenCalled()
  })

  it('does not fetch without an originating context — a direct/cold link has no queue', async () => {
    vi.spyOn(apiMod.api, 'approvalLogNeighbors').mockResolvedValue(neighborsResult({}))
    const { result } = renderHook(() => useAwaitingQueue(20, 201, null, true), { wrapper })
    await waitFor(() => expect(result.current.total).toBe(0))
    expect(apiMod.api.approvalLogNeighbors).not.toHaveBeenCalled()
  })
})
