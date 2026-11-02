import { useQuery } from '@tanstack/react-query'

import { api } from '@/lib/api'
import { useAuth } from '@/lib/authContext'

export function useDecisionNotices() {
  const { status, user } = useAuth()
  return useQuery({
    queryKey: ['notifications', 'decisions', user?.id ?? 0],
    queryFn: api.getDecisionNotices,
    enabled: status === 'authed' && user?.role !== 'inmate_reporter',
    staleTime: 30_000,
    // The counts stream refetches this only when the total moves, and an
    // acknowledgement plus a new decision leaves the total level.
    refetchInterval: 60_000,
  })
}
