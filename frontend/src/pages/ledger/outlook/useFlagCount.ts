/**
 * useFlagCount — the current user's follow-up flag count (Phase 2, D3b).
 *
 * Drives the FolderRail 🚩 Follow-ups badge AND the notifications bell. Shares
 * the `['ledger-flag-count']` query key the flag mutations invalidate, so the
 * count updates the moment a flag is set/cleared anywhere.
 */
import { useQuery } from '@tanstack/react-query'

import { api } from '@/lib/api'

export function useFlagCount(): number {
  const { data } = useQuery({
    queryKey: ['ledger-flag-count'],
    queryFn: () => api.getLedgerFlagCount(),
    staleTime: 30_000,
    refetchInterval: 120_000,
  })
  return data?.count ?? 0
}
