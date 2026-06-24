/**
 * RoleGate — render children only if the current user meets the role bar.
 *
 * Hierarchy: admin > manager > operator. ``role="manager"`` lets admins and
 * managers through; ``role="admin"`` is admin-only. Renders nothing while the
 * identity query is loading so operators never flash admin-only UI.
 */

import type { ReactNode } from 'react'

import { useIdentity } from '@/lib/useIdentity'

interface RoleGateProps {
  role: 'admin' | 'manager'
  children: ReactNode
  /** Optional fallback shown when the gate fails. */
  fallback?: ReactNode
}

export function RoleGate({ role, children, fallback = null }: RoleGateProps): React.JSX.Element {
  const { isAdmin, isManager, isLoading } = useIdentity()
  if (isLoading) return <>{fallback}</>
  const allowed = role === 'admin' ? isAdmin : isManager
  return <>{allowed ? children : fallback}</>
}
