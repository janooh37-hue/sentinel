/**
 * useAwaitingReturnCount — number of leaves in the `AwaitingReturn` display
 * state (overdue, and a return form may be filed now), counted server-side.
 *
 * Lives under the `leaves-list` prefix so every leave mutation that
 * invalidates the register also refreshes this badge.
 */
import { useQuery } from '@tanstack/react-query'
import { api } from '@/lib/api'

export function useAwaitingReturnCount(enabled = true): number {
  const { data } = useQuery({
    queryKey: ['leaves-list', 'awaiting-return-count'],
    queryFn: api.getLeaveAwaitingReturnCount,
    enabled,
    staleTime: 60_000,
  })
  return enabled ? (data?.count ?? 0) : 0
}
