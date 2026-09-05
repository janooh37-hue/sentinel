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

import { cloneElement, isValidElement, useContext, useRef, useState } from 'react'
import type { ReactElement, ReactNode } from 'react'
import { Lock } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import { QueryClientContext } from '@tanstack/react-query'
import { AuthContext } from '@/lib/authContext'
import { useCapabilities } from '@/lib/useCapabilities'
import { localizeCapability, useCapabilityCatalog } from '@/lib/useCapabilityCatalog'
import { PermissionRequestDialog } from '@/components/perms/PermissionRequestDialog'

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
  const { t, i18n } = useTranslation()
  const { has, isLoading } = useCapabilities()
  const catalog = useCapabilityCatalog()
  const [dialogOpen, setDialogOpen] = useState(false)
  const requestTriggerRef = useRef<HTMLSpanElement>(null)

  if (isLoading) return <>{fallback}</>

  if (has(cap)) return <>{children}</>

  // Lock mode — show children wrapped in a clickable lock affordance.
  // We intentionally use a <span role="button"> instead of <button> so that
  // children that are themselves <button> or <a> elements do not produce
  // nested interactive elements (invalid HTML, breaks a11y/hydration).
  // The child is rendered with pointer-events-none + reduced opacity so its
  // own click never fires — the wrapper intercepts and opens the dialog.
  const request = catalog.requestState(cap)
  if (requestable && request.kind === 'requestable') {
    const { label } = localizeCapability(request.entry, cap, i18n.language)
    const visualChildren = isValidElement(children)
      ? cloneElement(children as ReactElement<{ tabIndex?: number }>, { tabIndex: -1 })
      : children

    return (
      <>
        <span
          ref={requestTriggerRef}
          role="button"
          tabIndex={0}
          className="relative inline-flex cursor-pointer items-center gap-1 opacity-70"
          onClick={() => setDialogOpen(true)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault()
              setDialogOpen(true)
            }
          }}
          aria-label={t('perms.locked', { label, defaultValue: `You need permission for ${label}. Click to request access.` })}
        >
          <Lock className="h-3.5 w-3.5 shrink-0" />
          {/* The child stays visible while inert and aria-hidden. Explicitly
              removing a top-level element from tab order also covers DOM test
              environments and older engines that do not implement inert. */}
          <span className="pointer-events-none" aria-hidden="true" inert>{visualChildren}</span>
        </span>
        <PermissionRequestDialog
          request={request}
          open={dialogOpen}
          onClose={() => setDialogOpen(false)}
          returnFocusRef={requestTriggerRef}
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
