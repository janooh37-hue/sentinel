/**
 * Shared live counts for customizable mobile-dock waiting signals.
 *
 * Sources intentionally mirror their existing surfaces: scan-back shares the
 * books awaiting-scan query, ledger unread shares NavBell's unread preview
 * query (whose response carries the authoritative total), and approvals uses
 * the assignment-aware worklist summary (#31) — never gated behind
 * `books.approve`, since a review-only user's late feedback is just as
 * actionable as a signer's pending decision. Every source is optional: an
 * unavailable capability or failed request produces no signal.
 */
import { useQuery } from '@tanstack/react-query'

import { api } from '@/lib/api'
import { useAuth } from '@/lib/authContext'
import { useApprovalSummary } from '@/lib/useApprovalSummary'

import type { WaitingSignalId } from './navCustomization'

const STALE_TIME = 30_000
const REFRESH_INTERVAL = 60_000

export function useWaitingSignals(enabled: boolean): Partial<Record<WaitingSignalId, number>> {
  const { status } = useAuth()
  const authenticated = enabled && status === 'authed'

  // This is the same cache entry consumed by useCapabilities, but unlike that
  // hook it respects the dock's enabled flag so a hidden dock starts no request.
  const capabilitiesQuery = useQuery({
    queryKey: ['my-capabilities'],
    queryFn: () => api.myCapabilities(),
    enabled: authenticated,
    staleTime: 5 * 60_000,
  })
  const capabilities = capabilitiesQuery.data
  const canViewBooks = capabilities?.includes('books.view') === true
  const canEditBooks = capabilities?.includes('books.edit') === true
  const canViewLedger = capabilities?.includes('ledger.view') === true

  const approvalSummaryQuery = useApprovalSummary()
  const scanBackQuery = useQuery({
    queryKey: ['books', 'awaiting-scan', 'mine'],
    queryFn: () => api.listAwaitingScanBooks('mine'),
    enabled: authenticated && canViewBooks && canEditBooks,
    staleTime: STALE_TIME,
    refetchInterval: REFRESH_INTERVAL,
  })
  const ledgerUnreadQuery = useQuery({
    queryKey: ['ledger', 'unread-recent'],
    queryFn: () => api.getLedgerUnreadRecent(5),
    enabled: authenticated && canViewLedger,
    staleTime: STALE_TIME,
    refetchInterval: REFRESH_INTERVAL,
  })

  const signals: Partial<Record<WaitingSignalId, number>> = {}
  if (approvalSummaryQuery.isSuccess && !approvalSummaryQuery.isError) {
    signals.approvals = approvalSummaryQuery.data.actionable_count
  }
  if (scanBackQuery.isSuccess && !scanBackQuery.isError) {
    signals.scanback = scanBackQuery.data.length
  }
  if (ledgerUnreadQuery.isSuccess && !ledgerUnreadQuery.isError) {
    signals.ledgerUnread = ledgerUnreadQuery.data.total_unread
  }

  return signals
}
