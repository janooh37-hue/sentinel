import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Laptop, Link2, Loader2, ShieldOff } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'

import { api, apiErrorMessage, type OutlookDeviceRead } from '@/lib/api'
import { launchOutlook } from '@/lib/outlookBridge'
import { useIsMobile } from '@/lib/useIsMobile'
import { SectionCard } from './SettingsPage'

const ACTION =
  'inline-flex min-h-11 items-center gap-2 rounded-full px-4 py-2 text-sm font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50'

function formatDate(value: string, locale: string): string {
  return new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value))
}

export function OutlookConnectionSection(): React.JSX.Element {
  const { t, i18n } = useTranslation()
  const isMobile = useIsMobile()
  const qc = useQueryClient()
  const devicesQuery = useQuery({
    queryKey: ['outlook-devices'],
    queryFn: () => api.listOutlookDevices(),
    staleTime: 10_000,
  })
  const locale = i18n?.language ?? 'en'

  const pairMutation = useMutation({
    mutationFn: () => api.createOutlookPairing(),
    onSuccess: (pairing) => {
      try {
        launchOutlook(`gssg-outlook://pair/${encodeURIComponent(pairing.token)}`)
        toast.success(t('settings.outlook.pairStarted'))
      } catch (error) {
        toast.error(apiErrorMessage(error))
      }
    },
    onError: (error) => toast.error(apiErrorMessage(error)),
  })

  const revokeMutation = useMutation({
    mutationFn: (deviceId: string) => api.revokeOutlookDevice(deviceId),
    onSuccess: () => {
      toast.success(t('settings.outlook.revoked'))
      void qc.invalidateQueries({ queryKey: ['outlook-devices'] })
    },
    onError: (error) => toast.error(apiErrorMessage(error)),
  })

  return (
    <SectionCard
      title={t('settings.outlook.title')}
      description={t('settings.outlook.description')}
    >
      <div className="space-y-4">
        <div className="flex items-start gap-3 rounded-xl border border-warning/30 bg-warning-soft p-4 text-sm text-warning">
          <Laptop className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
          <p>{t('settings.outlook.classicOnly')}</p>
        </div>

        {isMobile && (
          <p className="rounded-xl border border-border bg-surface-tinted p-4 text-sm text-muted-foreground">
            {t('settings.outlook.desktopRequired')}
          </p>
        )}

        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-hairline pb-4">
          <div>
            <h4 className="font-semibold text-foreground">{t('settings.outlook.devices')}</h4>
            <p className="mt-1 text-sm text-muted-foreground">{t('settings.outlook.devicesHint')}</p>
          </div>
          <button
            type="button"
            className={`${ACTION} bg-primary text-primary-foreground hover:bg-primary-hover`}
            disabled={isMobile || pairMutation.isPending}
            onClick={() => pairMutation.mutate()}
          >
            {pairMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <Link2 className="h-4 w-4" aria-hidden />}
            {t('settings.outlook.pair')}
          </button>
        </div>

        {devicesQuery.isPending && <p className="text-sm text-muted-foreground">{t('common.loading')}</p>}
        {devicesQuery.isError && <p className="text-sm text-accent">{t('settings.outlook.loadError')}</p>}
        {!devicesQuery.isPending && !devicesQuery.isError && (devicesQuery.data ?? []).length === 0 && (
          <p className="rounded-xl border border-dashed border-border p-4 text-sm text-muted-foreground">
            {t('settings.outlook.empty')}
          </p>
        )}
        <div className="space-y-2">
          {(devicesQuery.data ?? []).map((device: OutlookDeviceRead) => {
            const revoked = device.revoked_at != null
            return (
              <div key={device.id} className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-hairline bg-surface-raised p-4">
                <div className="min-w-0">
                  <div className="flex items-center gap-2 font-medium text-foreground">
                    <span dir="auto" className="truncate">{device.device_label}</span>
                    {revoked && <span className="rounded-full bg-accent-soft px-2 py-0.5 text-xs font-semibold text-accent">{t('settings.outlook.revokedLabel')}</span>}
                  </div>
                  <div className="mt-1 text-xs text-muted-foreground" dir="ltr">{device.mailbox_address}</div>
                  <div className="mt-1 text-xs text-muted-foreground">
                    {t('settings.outlook.lastSeen', { date: formatDate(device.last_seen_at, locale) })}
                  </div>
                </div>
                {!revoked && (
                  <button
                    type="button"
                    className={`${ACTION} border border-border text-muted-foreground hover:bg-surface-tinted hover:text-foreground`}
                    disabled={revokeMutation.isPending}
                    onClick={() => revokeMutation.mutate(device.id)}
                  >
                    <ShieldOff className="h-4 w-4" aria-hidden />
                    {t('settings.outlook.revoke')}
                  </button>
                )}
              </div>
            )
          })}
        </div>
      </div>
    </SectionCard>
  )
}
