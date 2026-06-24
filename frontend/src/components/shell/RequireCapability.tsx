/**
 * RequireCapability — route guard. Redirects users who lack `cap` to `/` so
 * admin-only pages (permissions matrix, access requests) aren't reachable by
 * URL. Backend enforces the same capability on every API call; this guard is
 * UX (stops the 403-toast loop and the URL-poke), not the security boundary.
 */

import { Navigate } from 'react-router-dom'

import { useCapabilities } from '@/lib/useCapabilities'

interface RequireCapabilityProps {
  cap: string
  children: React.ReactNode
}

export function RequireCapability({
  cap,
  children,
}: RequireCapabilityProps): React.JSX.Element {
  const { has, isLoading } = useCapabilities()
  if (isLoading) {
    return (
      <div className="flex flex-1 items-center justify-center">
        <div className="h-6 w-6 animate-spin rounded-full border-2 border-muted border-t-foreground" />
      </div>
    )
  }
  if (!has(cap)) return <Navigate to="/" replace />
  return <>{children}</>
}
