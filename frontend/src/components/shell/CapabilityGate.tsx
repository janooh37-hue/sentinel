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
 *
 * Lock mode (`requestable` prop):
 *   When `requestable` is passed, the children are rendered VISIBLE but wrapped
 *   in a lock affordance (a button with a Lock icon) that opens
 *   PermissionRequestDialog. Sensitive caps (`users.manage`, `system.admin`)
 *   are never lockable and fall back to the hidden (default) behaviour.
 */

import { useContext, useState } from 'react'
import type { ReactNode } from 'react'
import { Lock } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { useQuery } from '@tanstack/react-query'

import { QueryClientContext } from '@tanstack/react-query'
import { AuthContext } from '@/lib/authContext'
import { useCapabilities } from '@/lib/useCapabilities'
import { api } from '@/lib/api'
import { PermissionRequestDialog } from '@/components/perms/PermissionRequestDialog'

/** Caps that must never surface the lock affordance (security-sensitive). */
const SENSITIVE_CAPS = new Set(['users.manage', 'system.admin'])

interface CapabilityGateProps {
  cap: string
  children: ReactNode
  /** Optional fallback shown when the gate fails / is loading. */
  fallback?: ReactNode
  /**
   * When true, and the user lacks the cap, render the children VISIBLE but
   * wrapped in a lock button that opens the permission-request dialog.
   * Sensitive caps (`users.manage`, `system.admin`) ignore this flag.
   */
  requestable?: boolean
}

/** Inner gate — only rendered when providers are available. */
function GateInner({
  cap,
  children,
  fallback = null,
  requestable = false,
}: CapabilityGateProps): React.JSX.Element {
  const { t } = useTranslation()
  const { has, isLoading } = useCapabilities()
  const [dialogOpen, setDialogOpen] = useState(false)

  // Fetch capabilities catalog for label/description lookup (cached 5 min).
  // Only needed when requestable mode is active and the cap is missing.
  const catalogQuery = useQuery({
    queryKey: ['capabilities-catalog'],
    queryFn: () => api.listCapabilities(),
    staleTime: 5 * 60_000,
    enabled: requestable && !SENSITIVE_CAPS.has(cap),
  })

  if (isLoading) return <>{fallback}</>

  if (has(cap)) return <>{children}</>

  // Lock mode — show children wrapped in a clickable lock affordance.
  if (requestable && !SENSITIVE_CAPS.has(cap)) {
    const catalogEntry = catalogQuery.data?.find((c) => c.id === cap)
    const label = catalogEntry?.label ?? cap
    const description = catalogEntry?.description ?? ''

    return (
      <>
        <button
          type="button"
          className="relative inline-flex cursor-pointer items-center gap-1 opacity-70"
          onClick={() => setDialogOpen(true)}
          aria-label={t('perms.locked', { label, defaultValue: `You need permission for ${label}. Click to request access.` })}
        >
          <Lock className="h-3.5 w-3.5 shrink-0" />
          {children}
        </button>
        <PermissionRequestDialog
          capability={cap}
          label={label}
          description={description}
          open={dialogOpen}
          onClose={() => setDialogOpen(false)}
        />
      </>
    )
  }

  // Default: hidden
  return <>{fallback}</>
}

export function CapabilityGate({
  cap,
  children,
  fallback = null,
  requestable = false,
}: CapabilityGateProps): React.JSX.Element {
  const authCtx = useContext(AuthContext)
  const queryClient = useContext(QueryClientContext)
  // Outside provider tree (e.g. unit tests) — treat as unauthenticated.
  if (!authCtx || !queryClient) return <>{fallback}</>
  return (
    <GateInner cap={cap} fallback={fallback} requestable={requestable}>
      {children}
    </GateInner>
  )
}
