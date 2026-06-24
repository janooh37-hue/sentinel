/**
 * useAwaitingReturnCount — lightweight hook that returns the number of leaves
 * currently in the `AwaitingReturn` display state (approved leave whose end
 * date has passed and no return form filed yet).
 *
 * Reuses the same query key / fetcher as `useLeaveReport` so the two share a
 * cache — no extra request when both are mounted.
 */
import { useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { api } from '@/lib/api'
import type { LeaveListItem } from '@/lib/api'
import { todayIso } from '@/lib/leaveDateMath'
import { displayState } from './lifecycle'

const PAGE_SIZE = 500

async function fetchAllLeaves(): Promise<LeaveListItem[]> {
  const first = await api.listLeaves({ limit: PAGE_SIZE })
  const items = [...first.items]
  let total = first.total
  while (items.length < total) {
    const next = await api.listLeaves({ limit: PAGE_SIZE, offset: items.length })
    if (next.items.length === 0) break
    items.push(...next.items)
    total = next.total
  }
  return items
}

export function useAwaitingReturnCount(): number {
  const today = todayIso()
  const { data } = useQuery({
    queryKey: ['leaves-list', 'report-all'],
    queryFn: fetchAllLeaves,
    staleTime: 60_000,
  })
  return useMemo(
    () =>
      (data ?? []).filter(
        (r) =>
          displayState(r.leave_type, r.status, r.end_date, today, r.has_certificate) ===
          'AwaitingReturn',
      ).length,
    [data, today],
  )
}
