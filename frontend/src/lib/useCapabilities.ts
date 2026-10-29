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

import { useEffect } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'

import { api } from '@/lib/api'
import { useAuth } from '@/lib/authContext'

interface UseCapabilitiesResult {
  capabilities: Set<string>
  isLoading: boolean
  has: (cap: string) => boolean
}

export function useCapabilities(): UseCapabilitiesResult {
  const { status } = useAuth()
  const client = useQueryClient()
  useEffect(() => {
    if (status !== 'authed') return
    const refresh = () => { void client.invalidateQueries({ queryKey: ['my-capabilities'] }, { cancelRefetch: false }) }
    const visible = () => { if (document.visibilityState === 'visible') refresh() }
    window.addEventListener('focus', refresh)
    window.addEventListener('gssg:capability-denied', refresh)
    document.addEventListener('visibilitychange', visible)
    return () => {
      window.removeEventListener('focus', refresh)
      window.removeEventListener('gssg:capability-denied', refresh)
      document.removeEventListener('visibilitychange', visible)
    }
  }, [client, status])
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
