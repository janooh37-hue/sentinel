import { useQuery, type UseQueryResult } from '@tanstack/react-query'

import { api, type GatewayStatusOut } from '@/lib/api'
import { useCapabilities } from '@/lib/useCapabilities'

export type GatewayState = 'disabled' | 'unreachable' | 'disconnected' | 'connected'

/** 60s poll cadence, or a permanent stop once the feature is disabled (dormant). */
export function pollInterval(state: GatewayState | undefined): number | false {
  return state === 'disabled' ? false : 60_000
}

/**
 * Shared gateway-status query. All consumers hit the same ['gateway-status'] cache;
 * pass { poll: true } on the one always-mounted observer (the header indicator) to
 * drive app-wide refresh — other observers piggyback the shared cache for free.
 */
export function useGatewayStatus(opts?: { poll?: boolean }): UseQueryResult<GatewayStatusOut> {
  const { has } = useCapabilities()
  const poll = opts?.poll ?? false
  return useQuery({
    queryKey: ['gateway-status'],
    queryFn: api.gatewayStatus,
    enabled: has('messages.broadcast'),
    staleTime: 30_000,
    refetchOnWindowFocus: poll,
    refetchInterval: poll ? (q) => pollInterval(q.state.data?.state as GatewayState | undefined) : false,
  })
}
