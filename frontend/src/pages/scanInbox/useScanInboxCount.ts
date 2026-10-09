import { useQuery } from '@tanstack/react-query'
import { api } from '@/lib/api'

export function useScanInboxCount(enabled: boolean): number {
  const { data } = useQuery({
    queryKey: ['scan-inbox', 'count'],
    queryFn: () => api.getScanInboxCount(),
    enabled,
    // Freshness comes from useNotificationStream's `scans` count diff.
    staleTime: 15_000,
  })
  return enabled ? (data?.total ?? 0) : 0
}
