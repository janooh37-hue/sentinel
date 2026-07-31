/**
 * useAwaitingQueue — where the open record sits in the manager's approval
 * queue, and which books flank it.
 *
 * Reuses the query the dashboard's BooksAwaitingWidget already runs
 * (`['books','awaiting']` → GET /books/awaiting, ordered created_at DESC), so
 * the record page's arrows walk exactly the list the manager already sees and
 * the two surfaces share one cache entry.
 */
import { useQuery } from '@tanstack/react-query'

import { api } from '@/lib/api'

export interface AwaitingQueue {
  /** 1-based position of the open book, or null when it isn't queued. */
  position: number | null
  total: number
  prevId: number | null
  nextId: number | null
}

export function useAwaitingQueue(bookId: number | null, enabled: boolean): AwaitingQueue {
  const { data = [] } = useQuery({
    queryKey: ['books', 'awaiting'],
    queryFn: api.listAwaitingBooks,
    staleTime: 30_000,
    enabled,
  })

  const ids = data.map((b) => b.id)
  const i = bookId == null ? -1 : ids.indexOf(bookId)
  if (i < 0) return { position: null, total: ids.length, prevId: null, nextId: null }
  return {
    position: i + 1,
    total: ids.length,
    prevId: i > 0 ? (ids[i - 1] ?? null) : null,
    nextId: i < ids.length - 1 ? (ids[i + 1] ?? null) : null,
  }
}

/** Where a return/reject lands: the next book still awaiting, else the list. */
export function nextAfterDecision(nextId: number | null): string {
  return nextId != null ? `/books/${nextId}` : '/books'
}
