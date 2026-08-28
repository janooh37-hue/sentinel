/**
 * useFlagCount — the current user's follow-up flag count (Phase 2, D3b).
 *
 * Drives the FolderRail 🚩 Follow-ups badge AND the notifications bell. Shares
 * the `['ledger-flag-count']` query key the flag mutations invalidate, so the
 * count updates the moment a flag is set/cleared anywhere.
 */
import { useQuery } from '@tanstack/react-query'

import { api } from '@/lib/api'

export function useFlagCount(enabled = true): number {
  const { data } = useQuery({
    queryKey: ['ledger-flag-count'],
    queryFn: () => api.getLedgerFlagCount(),
    enabled,
    staleTime: 30_000,
    refetchInterval: 120_000,
  })
  return enabled ? (data?.count ?? 0) : 0
}
