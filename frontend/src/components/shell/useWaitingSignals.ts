/** Shared live counts for customizable mobile-dock approval and scan signals. */
import { useQuery } from '@tanstack/react-query'

import { api } from '@/lib/api'
import { useAuth } from '@/lib/authContext'

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

  const approvalsQuery = useQuery({
    queryKey: ['books', 'awaiting'],
    queryFn: api.listAwaitingBooks,
    enabled: authenticated && capabilities?.includes('books.approve') === true,
    staleTime: STALE_TIME,
    refetchInterval: REFRESH_INTERVAL,
  })
  const scanBackQuery = useQuery({
    queryKey: ['books', 'awaiting-scan', 'mine'],
    queryFn: () => api.listAwaitingScanBooks('mine'),
    enabled: authenticated && capabilities?.includes('books.manage') === true,
    staleTime: STALE_TIME,
    refetchInterval: REFRESH_INTERVAL,
  })

  const signals: Partial<Record<WaitingSignalId, number>> = {}
  if (approvalsQuery.isSuccess && !approvalsQuery.isError) {
    signals.approvals = approvalsQuery.data.length
  }
  if (scanBackQuery.isSuccess && !scanBackQuery.isError) {
    signals.scanback = scanBackQuery.data.length
  }

  return signals
}
