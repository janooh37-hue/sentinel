/**
 * CapabilityGate — render children only if the signed-in user has the given
 * capability (resolved by the backend via `useCapabilities`).
 *
 * This is the capability-aware successor to `RoleGate`. Use it for any UI that
 * maps to a specific backend capability (e.g. `settings.edit`, `email.manage`).
 * Renders the fallback (default: nothing) while caps are loading so operators
 * never flash gated UI.
 *
 * Safe outside <AuthProvider>/<QueryClientProvider> (e.g. in unit tests that
 * render leaf components without the full app tree) — returns the fallback.
 */

import { useContext } from 'react'
import type { ReactNode } from 'react'

import { QueryClientContext } from '@tanstack/react-query'
import { AuthContext } from '@/lib/authContext'
import { useCapabilities } from '@/lib/useCapabilities'

interface CapabilityGateProps {
  cap: string
  children: ReactNode
  /** Optional fallback shown when the gate fails / is loading. */
  fallback?: ReactNode
}

/** Inner gate — only rendered when providers are available. */
function GateInner({
  cap,
  children,
  fallback = null,
}: CapabilityGateProps): React.JSX.Element {
  const { has, isLoading } = useCapabilities()
  if (isLoading) return <>{fallback}</>
  return <>{has(cap) ? children : fallback}</>
}

export function CapabilityGate({
  cap,
  children,
  fallback = null,
}: CapabilityGateProps): React.JSX.Element {
  const authCtx = useContext(AuthContext)
  const queryClient = useContext(QueryClientContext)
  // Outside provider tree (e.g. unit tests) — treat as unauthenticated.
  if (!authCtx || !queryClient) return <>{fallback}</>
  return <GateInner cap={cap} fallback={fallback}>{children}</GateInner>
}
