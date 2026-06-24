import { useQuery } from '@tanstack/react-query'
import { api } from '@/lib/api'

export function useScanInboxCount(): number {
  const { data } = useQuery({
    queryKey: ['scan-inbox', 'count'],
    queryFn: () => api.getScanInboxCount(),
    // Phase 4 LAN: SSE stream drives live invalidation; this is a safety-poll fallback.
    refetchInterval: 120_000,
    staleTime: 15_000,
  })
  return data?.total ?? 0
}
