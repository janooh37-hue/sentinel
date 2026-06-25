/**
 * RequireCapability — route guard. When the user lacks `cap`, renders a
 * centered "no access" card with a Request access button instead of
 * redirecting to `/`. Backend enforces the same capability on every API call;
 * this guard is UX (stops the 403-toast loop and the URL-poke), not the
 * security boundary.
 */

import { useState } from 'react'
import { Lock } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { useQuery } from '@tanstack/react-query'

import { useCapabilities } from '@/lib/useCapabilities'
import { api } from '@/lib/api'
import { PermissionRequestDialog } from '@/components/perms/PermissionRequestDialog'

interface RequireCapabilityProps {
  cap: string
  children: React.ReactNode
}

export function RequireCapability({
  cap,
  children,
}: RequireCapabilityProps): React.JSX.Element {
  const { t } = useTranslation()
  const { has, isLoading } = useCapabilities()
  const [dialogOpen, setDialogOpen] = useState(false)

  const catalogQuery = useQuery({
    queryKey: ['capabilities-catalog'],
    queryFn: () => api.listCapabilities(),
    staleTime: 5 * 60_000,
    enabled: !isLoading && !has(cap),
  })

  if (isLoading) {
    return (
      <div className="flex flex-1 items-center justify-center">
        <div className="h-6 w-6 animate-spin rounded-full border-2 border-muted border-t-foreground" />
      </div>
    )
  }

  if (!has(cap)) {
    const catalogEntry = catalogQuery.data?.find((c) => c.id === cap)
    const label = catalogEntry?.label ?? cap
    const description = catalogEntry?.description ?? ''

    return (
      <div className="flex flex-1 items-center justify-center p-8">
        <div className="flex max-w-sm flex-col items-center gap-4 rounded-2xl border border-hairline bg-surface p-8 text-center shadow-sm">
          <Lock className="h-8 w-8 text-muted-foreground" />
          <p className="text-sm text-muted-foreground">
            {t('perms.noAccessPage', { defaultValue: "You don't have access to this page" })}
          </p>
          <button
            type="button"
            className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90"
            onClick={() => setDialogOpen(true)}
          >
            {t('perms.requestAccess', { defaultValue: 'Request access' })}
          </button>
        </div>
        <PermissionRequestDialog
          capability={cap}
          label={label}
          description={description}
          open={dialogOpen}
          onClose={() => setDialogOpen(false)}
        />
      </div>
    )
  }

  return <>{children}</>
}
