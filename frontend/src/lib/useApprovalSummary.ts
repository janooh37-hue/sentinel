/**
 * useApprovalSummary — the caller's authorized approvals counts/oldest rows
 * (#31, revision-scoped). Backs the generic Approvals landing rule, Home
 * summary widgets, the nav bell badge, and the Approvals-entry visibility
 * check — one query, one cache entry, shared by every consumer.
 */
import { useQuery } from '@tanstack/react-query'

import { api } from '@/lib/api'
import type { ApprovalSummaryResponse } from '@/lib/api'
import { useAuth } from '@/lib/authContext'

export function useApprovalSummary() {
  const { status, user } = useAuth()
  return useQuery<ApprovalSummaryResponse>({
    queryKey: ['books', 'approval-summary', user?.id ?? 0],
    queryFn: api.getApprovalSummary,
    enabled: status === 'authed',
    staleTime: 30_000,
    refetchInterval: 60_000,
  })
}
