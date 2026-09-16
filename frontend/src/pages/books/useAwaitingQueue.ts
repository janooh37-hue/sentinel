/**
 * useAwaitingQueue — where the open record sits in the SAME filtered/ordered
 * approvals worklist the caller arrived from, and which books flank it.
 *
 * Backed by `GET /books/approval-log/{book_id}/neighbors` (#31, revision-
 * scoped) rather than the global `/books/awaiting` signing queue: a manager
 * reviewing a `status=returned` filtered list wants prev/next within THAT
 * filtered set, not the unrelated global pending-signature queue. Needs the
 * originating `ApprovalContext` (tab/kind/status/sort) the record was opened
 * with — absent context (a direct link, a basket, …) means no queue: the
 * caller passes `context: null` and gets back the empty queue.
 */
import { useQuery } from '@tanstack/react-query'

import { api } from '@/lib/api'
import { apiKindOf } from '@/lib/approvals'
import type { ApprovalContext } from '@/lib/approvals'

export interface AwaitingQueue {
  /** 1-based position of the open book, or null when it isn't queued. */
  position: number | null
  total: number
  prevId: number | null
  prevVersionId: number | null
  nextId: number | null
  nextVersionId: number | null
}

const EMPTY: AwaitingQueue = {
  position: null, total: 0, prevId: null, prevVersionId: null, nextId: null, nextVersionId: null,
}

export function useAwaitingQueue(
  bookId: number | null,
  versionId: number | null,
  context: ApprovalContext | null,
  enabled: boolean,
): AwaitingQueue {
  const { data } = useQuery({
    queryKey: ['books', 'approval-log', 'neighbors', bookId, versionId, context],
    queryFn: () =>
      api.approvalLogNeighbors(bookId!, {
        scope: context!.tab,
        kind: context!.tab === 'received' ? apiKindOf(context!.kind) : undefined,
        status: context!.status,
        sort: context!.sort,
        version_id: versionId ?? undefined,
      }),
    enabled: enabled && bookId != null && context != null,
    staleTime: 30_000,
  })
  if (!data) return EMPTY
  return {
    position: data.position,
    total: data.total,
    prevId: data.previous?.book_id ?? null,
    prevVersionId: data.previous?.version_id ?? null,
    nextId: data.next?.book_id ?? null,
    nextVersionId: data.next?.version_id ?? null,
  }
}

/** Where a return/reject lands with no queue context: the same record's list
 *  fallback — the next book still awaiting, else the list. */
export function nextAfterDecision(nextId: number | null): string {
  return nextId != null ? `/books/${nextId}` : '/books'
}
