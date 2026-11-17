/**
 * SitesDialog — the operating sites the fleet ledger groups by.
 *
 * Rename in place, archive, restore, add. There is no delete: a site is a
 * historical fact on every vehicle that ever sat under it, so the API only
 * archives — and refuses even that while the site still owns vehicles
 * (`SITE_HAS_VEHICLES`, surfaced as the module's own sentence rather than the
 * raw server text). The vehicle count on each row is what makes that refusal
 * predictable instead of surprising.
 */

import { useId, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Archive, ArchiveRestore, Plus } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { toast } from '@/lib/toast'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Skeleton } from '@/components/ui/skeleton'
import { Field, FormAlert } from '@/components/forms/DialogShell'
import { api } from '@/lib/api'
import type { VehicleSiteRead } from '@/lib/api'
import { localized } from '@/lib/language'
import { VEHICLE_QUERY_KEYS, formatCount, invalidateVehicleQueries, vehicleErrorMessage } from '../vehicleUtils'
import { RequestBody, RequestFooter, RequestShell } from './RequestShell'

interface Props {
  open: boolean
  onOpenChange: (open: boolean) => void
}

export function SitesDialog({ open, onOpenChange }: Props): React.JSX.Element {
  const { t } = useTranslation()
  const [busy, setBusy] = useState(false)
  return (
    <RequestShell open={open} onOpenChange={onOpenChange} title={t('vehicles.manageSites')} description={t('vehicles.manageSitesDesc')} busy={busy}>
      <SitesPanel onBusyChange={setBusy} />
    </RequestShell>
  )
}

function SitesPanel({ onBusyChange }: { onBusyChange: (busy: boolean) => void }): React.JSX.Element {
  const { t, i18n } = useTranslation()
  const queryClient = useQueryClient()
  const fieldId = useId()
  const alertId = `${fieldId}-alert`
  const formId = `${fieldId}-add`
  const [name, setName] = useState('')
  const [error, setError] = useState<string | null>(null)
  const sitesQuery = useQuery({
    queryKey: VEHICLE_QUERY_KEYS.sites,
    queryFn: () => api.listVehicleSites(),
    staleTime: 60_000,
  })
  const settle = (message: string): void => {
    invalidateVehicleQueries(queryClient, { registers: ['sites'] })
    setError(null)
    toast.success(message)
  }
  const fail = (err: unknown): void => {
    const text = vehicleErrorMessage(err)
    setError(text)
    toast.error(text)
  }
  const createSite = useMutation({
    mutationFn: (body: { name_ar: string; name_en: string }) => api.createVehicleSite(body),
    onMutate: () => onBusyChange(true),
    onSettled: () => onBusyChange(false),
    onSuccess: () => {
      setName('')
      settle(t('vehicles.siteAdded'))
    },
    onError: fail,
  })
  const updateSite = useMutation({
    mutationFn: (input: { siteId: number; body: { name_ar?: string; name_en?: string; active?: boolean } }) =>
      api.updateVehicleSite(input.siteId, input.body),
    onMutate: () => onBusyChange(true),
    onSettled: () => onBusyChange(false),
    onSuccess: () => settle(t('vehicles.siteUpdated')),
    onError: fail,
  })
  const busy = createSite.isPending || updateSite.isPending
  const sites = sitesQuery.data

  return (
    <>
      <RequestBody>
        <FormAlert id={alertId} message={error} />
        {sitesQuery.isError ? (
          <div className="flex flex-wrap items-center gap-3">
            <p className="text-sm text-muted-foreground">{t('common.loadError')}</p>
            <Button type="button" variant="secondary" onClick={() => void sitesQuery.refetch()}>{t('common.retry')}</Button>
          </div>
        ) : !sites ? (
          <div className="space-y-2"><Skeleton className="h-10 w-full" /><Skeleton className="h-10 w-full" /></div>
        ) : sites.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t('vehicles.noRecords')}</p>
        ) : (
          <ul className="divide-y divide-hairline border-y border-border">
            {sites.map((site) => (
              <SiteRow
                key={`${site.id}-${site.name_ar}-${site.name_en}-${i18n.language}`}
                site={site}
                busy={busy}
                onSave={(text) => updateSite.mutate({ siteId: site.id, body: { name_ar: text, name_en: text } })}
                onToggleActive={() => updateSite.mutate({ siteId: site.id, body: { active: !site.active } })}
              />
            ))}
          </ul>
        )}
        <form id={formId} className="mt-6" onSubmit={(event) => {
          event.preventDefault()
          if (!name.trim()) {
            setError(t('vehicles.requiredFields'))
            return
          }
          setError(null)
          createSite.mutate({ name_ar: name.trim(), name_en: name.trim() })
        }}>
          <Field id={`${fieldId}-name`} label={t('vehicles.siteName')} required>
            <Input id={`${fieldId}-name`} dir="auto" value={name} maxLength={128} onChange={(event) => setName(event.target.value)} disabled={busy} required aria-describedby={error ? alertId : undefined} />
          </Field>
        </form>
      </RequestBody>
      <RequestFooter busy={busy}>
        <Button type="submit" form={formId} size="lg" className="sm:min-w-[11rem]" disabled={busy}>
          <Plus className="h-4 w-4" aria-hidden />
          {createSite.isPending ? t('common.saving') : t('vehicles.addSite')}
        </Button>
      </RequestFooter>
    </>
  )
}

function SiteRow({ site, busy, onSave, onToggleActive }: {
  site: VehicleSiteRead
  busy: boolean
  onSave: (name: string) => void
  onToggleActive: () => void
}): React.JSX.Element {
  const { t, i18n } = useTranslation()
  const rowId = useId()
  const original = localized(site.name_ar, site.name_en, i18n.language)
  const [name, setName] = useState(original)
  return (
    <li className="py-3">
      <form className="flex flex-wrap items-center gap-2" onSubmit={(event) => {
        event.preventDefault()
        if (name.trim()) onSave(name.trim())
      }}>
        <div className="min-w-[10rem] flex-1">
          <Label htmlFor={rowId} className="sr-only">{t('vehicles.siteName')} · {original}</Label>
          <Input id={rowId} dir="auto" value={name} maxLength={128} onChange={(event) => setName(event.target.value)} disabled={busy} required />
        </div>
        <Badge tone="outline"><bdi className="font-mono tabular-nums">{formatCount(site.vehicle_count)}</bdi> {t('vehicles.vehicles')}</Badge>
        {!site.active && <Badge tone="outline">{t('vehicles.archive')}</Badge>}
        <Button type="submit" variant="secondary" size="sm" disabled={busy || !name.trim() || name.trim() === original}>{t('vehicles.save')}</Button>
        {(!site.active || site.vehicle_count === 0) && (
          <Button type="button" variant="secondary" size="sm" onClick={onToggleActive} disabled={busy}>
            {site.active ? <Archive className="h-3.5 w-3.5" aria-hidden /> : <ArchiveRestore className="h-3.5 w-3.5" aria-hidden />}
            {site.active ? t('vehicles.archive') : t('vehicles.restore')}
          </Button>
        )}
      </form>
    </li>
  )
}
