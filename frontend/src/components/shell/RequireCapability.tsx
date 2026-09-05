/**
 * RequireCapability — route guard. When the user lacks `cap`, renders a
 * centered "no access" card instead of redirecting to `/`. Most capabilities
 * can be requested from the card; administrator-managed capabilities cannot.
 * Backend enforcement remains the security boundary.
 */

import { useRef, useState } from 'react'
import { Lock } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import { useCapabilities } from '@/lib/useCapabilities'
import { useCapabilityCatalog } from '@/lib/useCapabilityCatalog'
import { PermissionRequestDialog } from '@/components/perms/PermissionRequestDialog'

interface RequireCapabilityProps {
  cap: string
  children: React.ReactNode
}

interface RequireAnyCapabilityProps {
  caps: readonly string[]
  children: React.ReactNode
}

export function RequireCapability({
  cap,
  children,
}: RequireCapabilityProps): React.JSX.Element {
  const { t } = useTranslation()
  const { has, isLoading } = useCapabilities()
  const catalog = useCapabilityCatalog()
  const [dialogOpen, setDialogOpen] = useState(false)
  const requestTriggerRef = useRef<HTMLButtonElement>(null)

  if (isLoading) {
    return (
      <div className="flex flex-1 items-center justify-center">
        <div className="h-6 w-6 animate-spin rounded-full border-2 border-muted border-t-foreground" />
      </div>
    )
  }

  if (!has(cap)) {
    const request = catalog.requestState(cap)
    const requestable = request.kind === 'requestable'
    const explicitlyNonRequestable = request.kind === 'not_requestable'

    return (
      <div className="flex flex-1 items-center justify-center p-8">
        <div className="flex max-w-sm flex-col items-center gap-4 rounded-2xl border border-hairline bg-surface p-8 text-center shadow-sm">
          <Lock className="h-8 w-8 text-muted-foreground" />
          <p className="text-sm text-muted-foreground">
            {explicitlyNonRequestable
              ? t('requireCap.notRequestable', {
                  defaultValue:
                    'Access to this area is managed by administrators and cannot be requested.',
                })
              : t('perms.noAccessPage', { defaultValue: "You don't have access to this page" })}
          </p>
          {requestable ? (
            <button
              ref={requestTriggerRef}
              type="button"
              className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90"
              onClick={() => setDialogOpen(true)}
            >
              {t('perms.requestAccess', { defaultValue: 'Request access' })}
            </button>
          ) : null}
        </div>
        {requestable ? (
          <PermissionRequestDialog
            request={request}
            open={dialogOpen}
            onClose={() => setDialogOpen(false)}
            returnFocusRef={requestTriggerRef}
          />
        ) : null}
      </div>
    )
  }

  return <>{children}</>
}

/**
 * Route guard for destinations intentionally shared by distinct capabilities.
 * A denied state offers no request action because choosing one capability on
 * the user's behalf would make the request ambiguous.
 */
export function RequireAnyCapability({
  caps,
  children,
}: RequireAnyCapabilityProps): React.JSX.Element {
  const { t } = useTranslation()
  const { has, isLoading } = useCapabilities()

  if (isLoading) {
    return (
      <div className="flex flex-1 items-center justify-center">
        <div className="h-6 w-6 animate-spin rounded-full border-2 border-muted border-t-foreground" />
      </div>
    )
  }

  if (!caps.some(has)) {
    return (
      <div className="flex flex-1 items-center justify-center p-8">
        <div className="flex max-w-sm flex-col items-center gap-4 rounded-2xl border border-hairline bg-surface p-8 text-center shadow-sm">
          <Lock className="h-8 w-8 text-muted-foreground" />
          <p className="text-sm text-muted-foreground">
            {t('perms.noAccessPage', { defaultValue: "You don't have access to this page" })}
          </p>
        </div>
      </div>
    )
  }

  return <>{children}</>
}
