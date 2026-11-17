import { useEffect, useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Car } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { Link, useSearchParams } from 'react-router-dom'

import { Button } from '@/components/ui/button'
import { buttonVariants } from '@/components/ui/button-variants'
import { EmptyState } from '@/components/ui/empty-state'
import { Skeleton } from '@/components/ui/skeleton'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { api } from '@/lib/api'
import type { VehicleListItem } from '@/lib/api'
import { localized } from '@/lib/language'
import { useCapabilities } from '@/lib/useCapabilities'
import { useIsMobile } from '@/lib/useIsMobile'
import { useUrlOverlay } from '@/lib/urlState'
import { PlateChip } from './components/PlateChip'
import { RenewLicenseDialog } from './components/RenewLicenseDialog'
import { RegisterBar, RegisterSheet, RegisterStats, RegisterTabs, ServiceCounter, ServicePage } from './components/ServiceLayout'
import { VehicleStatusBadge } from './components/VehicleStatusBadge'
import { EMPTY_VALUE, VEHICLE_QUERY_KEYS, formatCount, formatIsoDate, plateLabel } from './vehicleUtils'

type Filter = 'attention' | 'valid' | 'all'

export function VehicleRenewalsPage(): React.JSX.Element {
  const { t, i18n } = useTranslation()
  const { has, isLoading: capabilitiesLoading } = useCapabilities()
  const canEdit = has('vehicles.edit')
  const isMobile = useIsMobile()
  const [params, setParams] = useSearchParams()
  const filter: Filter = params.get('status') === 'valid' ? 'valid' : params.get('status') === 'all' ? 'all' : 'attention'
  const overlay = useUrlOverlay('action', ['vehicle', 'fixed'])
  const fleetQuery = useQuery({
    queryKey: [...VEHICLE_QUERY_KEYS.list, { state: 'active' }],
    queryFn: () => api.listVehicles({ state: 'active' }),
  })
  const sitesQuery = useQuery({ queryKey: VEHICLE_QUERY_KEYS.sites, queryFn: () => api.listVehicleSites() })
  const summaryQuery = useQuery({ queryKey: VEHICLE_QUERY_KEYS.summary, queryFn: () => api.vehiclesSummary() })
  const fleet = useMemo(() => fleetQuery.data?.filter((vehicle) => !vehicle.archived_at).sort((a, b) => a.license_expiry.localeCompare(b.license_expiry)), [fleetQuery.data])
  const attention = fleet?.filter((vehicle) => vehicle.expiry_status !== 'valid').length ?? 0
  const rows = fleet?.filter((vehicle) => filter === 'all' || (vehicle.expiry_status === 'valid') === (filter === 'valid')) ?? []
  const selected = fleet?.find((vehicle) => String(vehicle.id) === params.get('vehicle')) ?? null
  const fixed = params.get('fixed') === '1'

  useEffect(() => {
    if (!overlay.value || capabilitiesLoading) return
    if (!canEdit || overlay.value !== 'renew' || (fleetQuery.isSuccess && (!selected && params.has('vehicle')))) overlay.close()
  }, [canEdit, capabilitiesLoading, fleetQuery.isSuccess, overlay.value, overlay.close, params, selected])

  const actions = (vehicle: VehicleListItem) => (
    <div className="flex flex-wrap justify-end gap-2">
      {canEdit && <Button variant="secondary" size="sm" onClick={() => overlay.open('renew', { vehicle: String(vehicle.id), fixed: '1' })} aria-label={`${t('vehicles.renew')} · ${plateLabel(vehicle)}`}>{t('vehicles.renew')}</Button>}
      <Link className={buttonVariants({ variant: 'ghost', size: 'sm' })} to={`/vehicles/${vehicle.id}?tab=renewals`} aria-label={`${t('vehicles.open')} · ${plateLabel(vehicle)}`}>{t('vehicles.open')}</Link>
    </div>
  )
  const siteName = (vehicle: VehicleListItem) => {
    const site = sitesQuery.data?.find((item) => item.id === vehicle.site_id)
    return site ? localized(site.name_ar, site.name_en, i18n.language) : EMPTY_VALUE
  }
  const expiry = (vehicle: VehicleListItem) => <span className="inline-flex flex-wrap items-center gap-2"><bdi dir="ltr" className="font-mono">{formatIsoDate(vehicle.license_expiry)}</bdi><VehicleStatusBadge family="expiry" status={vehicle.expiry_status} /></span>
  const insurance = (vehicle: VehicleListItem) => vehicle.insurance_expiry ? <bdi dir="ltr" className="font-mono">{formatIsoDate(vehicle.insurance_expiry)}</bdi> : <span className="text-muted-foreground">{t('vehicles.insuranceNotRecorded')}</span>

  return (
    <>
      <ServicePage
        band={{ back: { to: '/vehicles', label: t('vehicles.backHub') }, title: t('vehicles.renewService'), description: t('vehicles.renewServiceDesc') }}
        counter={canEdit ? <ServiceCounter artwork="vehicle-licence-renewal" title={t('vehicles.start.renewal')} description={t('vehicles.renewDesc')} actionLabel={t('vehicles.renew')} vehicles={fleet} onStart={(id) => overlay.open('renew', { vehicle: String(id) })} /> : null}
      >
        <RegisterBar>
          <RegisterTabs<Filter> label={t('vehicles.renewService')} value={filter} onChange={(next) => setParams((previous) => { const updated = new URLSearchParams(previous); if (next === 'attention') updated.delete('status'); else updated.set('status', next); return updated }, { replace: true })} items={[
            { key: 'attention', label: t('vehicles.attention'), count: formatCount(attention) },
            { key: 'valid', label: t('vehicles.valid'), count: formatCount((fleet?.length ?? 0) - attention) },
            { key: 'all', label: t('vehicles.allStatuses'), count: formatCount(fleet?.length ?? 0) },
          ]} />
          {summaryQuery.data ? <RegisterStats items={[{ label: t('vehicles.notifyBefore'), value: <><bdi>{formatCount(summaryQuery.data.notify_days)}</bdi> {t('vehicles.days')}</> }]} /> : summaryQuery.isError ? <Button variant="ghost" size="sm" onClick={() => void summaryQuery.refetch()}>{t('common.retry')}</Button> : null}
        </RegisterBar>
        <RegisterSheet>
          {fleetQuery.isError ? <EmptyState icon={Car} message={t('common.loadError')} actionLabel={t('common.retry')} onAction={() => void fleetQuery.refetch()} /> : fleetQuery.isPending ? <Skeleton className="m-4 h-48" /> : rows.length === 0 ? <EmptyState icon={Car} message={t(filter === 'attention' ? 'vehicles.noRenewalAttention' : filter === 'valid' ? 'vehicles.noValidLicences' : 'vehicles.noVehicles')} /> : isMobile ? (
            <div className="divide-y divide-border">{rows.map((vehicle) => <article key={vehicle.id} className="space-y-4 p-4">
              <div className="flex flex-wrap items-center justify-between gap-2"><PlateChip plate={plateLabel(vehicle)} />{expiry(vehicle)}</div>
              <div><strong dir="auto" className="text-sm">{localized(vehicle.type_ar, vehicle.type_en, i18n.language)}</strong><p dir="auto" className="text-xs text-muted-foreground">{localized(vehicle.class_ar, vehicle.class_en, i18n.language)} · {siteName(vehicle)}</p></div>
              <dl className="grid grid-cols-2 gap-3 text-xs"><div><dt className="text-muted-foreground">{t('vehicles.licenseStart')}</dt><dd><bdi dir="ltr">{formatIsoDate(vehicle.license_start)}</bdi></dd></div><div><dt className="text-muted-foreground">{t('vehicles.insuranceExpiry')}</dt><dd>{insurance(vehicle)}</dd></div></dl>
              {actions(vehicle)}
            </article>)}</div>
          ) : <Table>
            <TableHeader><TableRow>{['plate', 'type', 'site', 'licenseStart', 'licenseExpiry', 'insuranceExpiry', 'action'].map((key) => <TableHead key={key} className={key === 'action' ? 'text-end' : undefined}>{t(`vehicles.${key}`)}</TableHead>)}</TableRow></TableHeader>
            <TableBody>{rows.map((vehicle) => <TableRow key={vehicle.id}>
              <TableCell><PlateChip plate={plateLabel(vehicle)} /></TableCell>
              <TableCell><strong dir="auto" className="block">{localized(vehicle.type_ar, vehicle.type_en, i18n.language)}</strong><small dir="auto" className="text-muted-foreground">{localized(vehicle.class_ar, vehicle.class_en, i18n.language)}</small></TableCell>
              <TableCell dir="auto">{siteName(vehicle)}</TableCell>
              <TableCell><bdi dir="ltr" className="font-mono">{formatIsoDate(vehicle.license_start)}</bdi></TableCell>
              <TableCell>{expiry(vehicle)}</TableCell><TableCell>{insurance(vehicle)}</TableCell><TableCell>{actions(vehicle)}</TableCell>
            </TableRow>)}</TableBody>
          </Table>}
        </RegisterSheet>
      </ServicePage>
      {/* Mounted once the fleet is known, so a deep link's vehicle is the
          one the request starts on (the dialog reads it only at mount). */}
      {canEdit && fleetQuery.isSuccess && overlay.value === 'renew' && (!fixed || selected) && <RenewLicenseDialog open vehicle={fixed ? selected : null} initialVehicleId={selected?.id} onOpenChange={(open) => { if (!open) overlay.close() }} />}
    </>
  )
}
