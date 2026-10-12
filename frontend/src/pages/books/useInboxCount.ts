/**
 * Records sent to me (direct send): `GET /books/inbox/summary`, one cache entry
 * shared by the Records chips, the bell row, the dock signal and the dashboard
 * widget. It lives under `['books', …]`, so every send/recall/level change that
 * invalidates `['books']` refreshes it; new arrivals come through
 * useNotificationStream's `inbox` count diff.
 */
import { useQuery } from '@tanstack/react-query'

import { api } from '@/lib/api'

export const inboxSummaryKey = ['books', 'inbox-summary'] as const

export function useInboxSummary(enabled = true) {
  return useQuery({
    queryKey: inboxSummaryKey,
    queryFn: () => api.getInboxSummary(),
    enabled,
    staleTime: 15_000,
  })
}

/** Unread received records; 0 while disabled or loading. */
export function useInboxCount(enabled = true): number {
  const { data } = useInboxSummary(enabled)
  return enabled ? (data?.unread ?? 0) : 0
}
