/**
 * useCapabilities — the signed-in user's effective capabilities.
 *
 * Backed by `GET /auth/me/capabilities` (role defaults ± per-user overrides,
 * resolved on the backend — the authoritative gate). The UI uses this only for
 * soft gating; the backend enforces the same capabilities on every request.
 *
 * Only fetches when authenticated; returns `has = false` while loading so
 * operators never flash capability-gated UI.
 */

import { useQuery } from '@tanstack/react-query'

import { api } from '@/lib/api'
import { useAuth } from '@/lib/authContext'

interface UseCapabilitiesResult {
  capabilities: Set<string>
  isLoading: boolean
  has: (cap: string) => boolean
}

export function useCapabilities(): UseCapabilitiesResult {
  const { status } = useAuth()
  const query = useQuery({
    queryKey: ['my-capabilities'],
    queryFn: () => api.myCapabilities(),
    enabled: status === 'authed',
    staleTime: 5 * 60_000,
  })

  const capabilities = new Set(query.data ?? [])
  return {
    capabilities,
    isLoading: status === 'authed' && query.isLoading,
    has: (cap: string) => capabilities.has(cap),
  }
}
