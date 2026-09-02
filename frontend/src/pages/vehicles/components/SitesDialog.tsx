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
import { Archive, ArchiveRestore, Pencil, Plus } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Skeleton } from '@/components/ui/skeleton'
import { api } from '@/lib/api'
import type { VehicleSiteRead } from '@/lib/api'

import {
  VEHICLE_QUERY_KEYS,
  invalidateVehicleQueries,
  vehicleErrorMessage,
} from '../vehicleUtils'
import {
  VehicleDialogBody,
  VehicleDialogFooter,
  VehicleDialogShell,
  VehicleField,
  VehicleFieldGrid,
  VehicleFormAlert,
} from './VehicleDialogShell'

interface Props {
  open: boolean
  onOpenChange: (open: boolean) => void
}

export function SitesDialog({ open, onOpenChange }: Props): React.JSX.Element {
  const { t } = useTranslation()
  // The panel owns the mutations; the shell owns dismissal.
  const [busy, setBusy] = useState(false)
  return (
    <VehicleDialogShell
      open={open}
      onOpenChange={onOpenChange}
      title={t('vehicles.manageSites')}
      description={t('vehicles.manageSitesDesc')}
      size="lg"
      busy={busy}
    >
      <SitesPanel onClose={() => onOpenChange(false)} onBusyChange={setBusy} />
    </VehicleDialogShell>
  )
}

function SitesPanel({
  onClose,
  onBusyChange,
}: {
  onClose: () => void
  /** Reported to the shell so Escape and the overlay cannot dismiss the dialog
   *  while a rename, an archive or an add is still in flight. */
  onBusyChange: (busy: boolean) => void
}): React.JSX.Element {
  const { t } = useTranslation()
  const queryClient = useQueryClient()
  const fieldId = useId()
  const alertId = `${fieldId}-alert`

  const [editingId, setEditingId] = useState<number | null>(null)
  const [nameAr, setNameAr] = useState('')
  const [nameEn, setNameEn] = useState('')
  const [error, setError] = useState<string | null>(null)

  const sitesQuery = useQuery({
    queryKey: VEHICLE_QUERY_KEYS.sites,
    queryFn: () => api.listVehicleSites(),
    staleTime: 60_000,
  })

  /** Every site mutation refreshes the same surfaces: the sites list itself,
   *  the hub's active-site count, and the ledger (it groups and searches by
   *  site name). */
  const settle = (message: string): void => {
    invalidateVehicleQueries(queryClient, { registers: ['sites'] })
    toast.success(message)
  }
  const fail = (err: unknown): void => {
    const text = vehicleErrorMessage(err, t)
    setError(text)
    toast.error(text)
  }

  const createSite = useMutation({
    mutationFn: (body: { name_ar: string; name_en: string }) => api.createVehicleSite(body),
    onMutate: () => onBusyChange(true),
    onSettled: () => onBusyChange(false),
    onSuccess: () => {
      setNameAr('')
      setNameEn('')
      setError(null)
      settle(t('vehicles.siteAdded'))
    },
    onError: fail,
  })

  const updateSite = useMutation({
    mutationFn: (input: {
      siteId: number
      body: { name_ar?: string; name_en?: string; active?: boolean }
    }) => api.updateVehicleSite(input.siteId, input.body),
    onMutate: () => onBusyChange(true),
    onSettled: () => onBusyChange(false),
    onSuccess: () => {
      setEditingId(null)
      setError(null)
      settle(t('vehicles.siteUpdated'))
    },
    onError: fail,
  })

  const busy = createSite.isPending || updateSite.isPending
  const sites = sitesQuery.data

  return (
    <>
      <VehicleDialogBody>
        <VehicleFormAlert id={alertId} message={error} />

        <div className="overflow-hidden rounded-lg border border-border">
          {!sites ? (
            <div className="flex flex-col gap-2 p-3">
              <Skeleton className="h-8 w-full" />
              <Skeleton className="h-8 w-full" />
            </div>
          ) : sites.length === 0 ? (
            <p className="px-3 py-4 text-sm text-muted-foreground">{t('vehicles.noRecords')}</p>
          ) : (
            <ul className="divide-y divide-hairline">
              {sites.map((site) => (
                <SiteRow
                  key={site.id}
                  site={site}
                  editing={editingId === site.id}
                  busy={busy}
                  onEdit={() => {
                    setError(null)
                    setEditingId(site.id)
                  }}
                  onCancelEdit={() => setEditingId(null)}
                  onSave={(body) => updateSite.mutate({ siteId: site.id, body })}
                  onToggleActive={() =>
                    updateSite.mutate({ siteId: site.id, body: { active: !site.active } })
                  }
                />
              ))}
            </ul>
          )}
        </div>

        <form
          className="flex flex-col gap-3.5 rounded-lg border border-border bg-surface-raised p-3"
          onSubmit={(event) => {
            event.preventDefault()
            if (!nameAr.trim() || !nameEn.trim()) {
              setError(t('vehicles.requiredFields'))
              return
            }
            setError(null)
            createSite.mutate({ name_ar: nameAr.trim(), name_en: nameEn.trim() })
          }}
        >
          <VehicleFieldGrid>
            <VehicleField id={`${fieldId}-ar`} label={t('vehicles.siteNameAr')} required>
              <Input
                id={`${fieldId}-ar`}
                dir="rtl"
                value={nameAr}
                onChange={(event) => setNameAr(event.target.value)}
                disabled={busy}
              />
            </VehicleField>
            <VehicleField id={`${fieldId}-en`} label={t('vehicles.siteNameEn')} required>
              <Input
                id={`${fieldId}-en`}
                dir="ltr"
                value={nameEn}
                onChange={(event) => setNameEn(event.target.value)}
                disabled={busy}
              />
            </VehicleField>
          </VehicleFieldGrid>
          <Button type="submit" size="sm" className="self-start" disabled={busy}>
            <Plus className="h-3.5 w-3.5" aria-hidden />
            {createSite.isPending ? t('common.saving') : t('vehicles.addSite')}
          </Button>
        </form>
      </VehicleDialogBody>

      <VehicleDialogFooter>
        <Button type="button" variant="secondary" onClick={onClose}>
          {t('vehicles.close')}
        </Button>
      </VehicleDialogFooter>
    </>
  )
}

function SiteRow({
  site,
  editing,
  busy,
  onEdit,
  onCancelEdit,
  onSave,
  onToggleActive,
}: {
  site: VehicleSiteRead
  editing: boolean
  busy: boolean
  onEdit: () => void
  onCancelEdit: () => void
  onSave: (body: { name_ar: string; name_en: string }) => void
  onToggleActive: () => void
}): React.JSX.Element {
  const { t } = useTranslation()
  const rowId = useId()
  // Mounted fresh whenever the row enters edit mode (see the `editing` branch
  // below), so the inputs start from the site's current names.
  return (
    <li className="flex flex-wrap items-center gap-2 px-3 py-2.5">
      {editing ? (
        <SiteNameEditor
          site={site}
          busy={busy}
          idPrefix={rowId}
          onSave={onSave}
          onCancel={onCancelEdit}
        />
      ) : (
        <>
          <span className="min-w-0 flex-1">
            <span className="block truncate text-sm font-semibold text-foreground" dir="rtl">
              {site.name_ar}
            </span>
            <span className="block truncate text-xs text-muted-foreground" dir="ltr">
              {site.name_en}
            </span>
          </span>
          {!site.active && (
            <Badge tone="outline">
              <Archive className="h-3 w-3" aria-hidden />
              {t('vehicles.archive')}
            </Badge>
          )}
          <span
            className="grid min-h-[25px] min-w-[25px] place-items-center rounded-full bg-primary-soft px-1.5 font-mono text-[0.67rem] font-semibold tabular-nums text-primary"
            aria-label={`${site.vehicle_count} ${t('vehicles.vehicles')}`}
            title={`${site.vehicle_count} ${t('vehicles.vehicles')}`}
          >
            {site.vehicle_count}
          </span>
          <Button type="button" variant="secondary" size="sm" onClick={onEdit} disabled={busy}>
            <Pencil className="h-3.5 w-3.5" aria-hidden />
            {t('vehicles.rename')}
          </Button>
          <Button
            type="button"
            variant="secondary"
            size="sm"
            onClick={onToggleActive}
            disabled={busy}
          >
            {site.active ? (
              <Archive className="h-3.5 w-3.5" aria-hidden />
            ) : (
              <ArchiveRestore className="h-3.5 w-3.5" aria-hidden />
            )}
            {site.active ? t('vehicles.archive') : t('vehicles.restore')}
          </Button>
        </>
      )}
    </li>
  )
}

function SiteNameEditor({
  site,
  busy,
  idPrefix,
  onSave,
  onCancel,
}: {
  site: VehicleSiteRead
  busy: boolean
  idPrefix: string
  onSave: (body: { name_ar: string; name_en: string }) => void
  onCancel: () => void
}): React.JSX.Element {
  const { t } = useTranslation()
  const [ar, setAr] = useState(site.name_ar)
  const [en, setEn] = useState(site.name_en)
  const valid = ar.trim().length > 0 && en.trim().length > 0

  return (
    <>
      <span className="flex min-w-0 flex-1 flex-col gap-1.5 sm:flex-row">
        <span className="min-w-0 flex-1">
          <Label htmlFor={`${idPrefix}-ar`} className="sr-only">
            {t('vehicles.siteNameAr')}
          </Label>
          <Input
            id={`${idPrefix}-ar`}
            dir="rtl"
            value={ar}
            onChange={(event) => setAr(event.target.value)}
            disabled={busy}
            autoFocus
          />
        </span>
        <span className="min-w-0 flex-1">
          <Label htmlFor={`${idPrefix}-en`} className="sr-only">
            {t('vehicles.siteNameEn')}
          </Label>
          <Input
            id={`${idPrefix}-en`}
            dir="ltr"
            value={en}
            onChange={(event) => setEn(event.target.value)}
            disabled={busy}
          />
        </span>
      </span>
      <Button
        type="button"
        size="sm"
        disabled={busy || !valid}
        onClick={() => onSave({ name_ar: ar.trim(), name_en: en.trim() })}
      >
        {busy ? t('common.saving') : t('vehicles.save')}
      </Button>
      <Button type="button" variant="ghost" size="sm" onClick={onCancel} disabled={busy}>
        {t('vehicles.cancel')}
      </Button>
    </>
  )
}
