/**
 * Vehicle Services — the module's hub at `/vehicles`.
 *
 * Request-first order: navy band, four service doors, fleet administration,
 * then the register grouped by operating site. Each service door links to its
 * register and, for operators with `vehicles.edit`, starts its own request.
 *
 * Every number and every group comes from the server. `GET /vehicles` applies
 * the search and the two filters (the ledger is unpaginated — the fleet is tens
 * of rows), and the summary owns the card counts, so the hub never re-derives a
 * figure the API already decided. A failed query renders a retry, never an
 * honest-looking zero.
 *
 * Capability gating: the whole page needs `vehicles.view` (route-level).
 * Requests, administration, EVG fetch and reminder settings need
 * `vehicles.edit`; viewers see register links without mutation controls.
 */

import { useEffect, useId, useMemo, useRef, useState } from 'react'
import { flushSync } from 'react-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Car, ChevronRight, ClipboardCopy, DownloadCloud, Plus, Printer, Search } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { Link } from 'react-router-dom'
import { toast } from '@/lib/toast'

import { RefreshButton } from '@/components/refresh/RefreshButton'
import { Button } from '@/components/ui/button'
import { buttonVariants } from '@/components/ui/button-variants'
import { ConfirmDialog } from '@/components/ui/confirm-dialog'
import { EmptyState } from '@/components/ui/empty-state'
import { Input } from '@/components/ui/input'
import { SkeletonRow } from '@/components/ui/skeleton'
import {
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { copyTable } from '@/lib/copyTable'
import { api } from '@/lib/api'
import type { VehicleListItem, VehicleSiteRead } from '@/lib/api'
import { isolateBidi } from '@/lib/useCapabilityCatalog'
import { useCapabilities } from '@/lib/useCapabilities'
import { useDebouncedValue } from '@/lib/useDebouncedValue'
import { useIsMobile } from '@/lib/useIsMobile'
import { useSearchParam, useUrlOverlay } from '@/lib/urlState'
import { cn } from '@/lib/utils'
import { localized } from '@/lib/language'
import { ServiceArtwork, type ServiceArtworkId } from '@/components/ui/service-artwork'

import {
  EMPTY_VALUE,
  VEHICLE_QUERY_KEYS,
  formatCount,
  formatIsoDate,
  invalidateVehicleQueries,
  vehicleErrorMessage,
} from './vehicleUtils'
import { AddVehicleDialog } from './components/AddVehicleDialog'
import { EvgFetchDialog } from './components/EvgFetchDialog'
import { MaintenanceContractorSetting } from './components/MaintenanceContractorSetting'
import { PlateChip } from './components/PlateChip'
import { RenewLicenseDialog } from './components/RenewLicenseDialog'
import { AccidentDialog } from './components/AccidentDialog'
import { FineDialog } from './components/FineDialog'
import { FineAmount } from './components/FineAmount'
import { MaintenanceDialog } from './components/MaintenanceDialog'
import { RegisterHeading, RegisterSheet, RegisterTabs, ServicePage } from './components/ServiceLayout'
import { SERVICE_LIFT } from './components/serviceStyles'
import { VehicleListPrintView } from './components/VehicleListPrintView'
import { SitesDialog } from './components/SitesDialog'
import { VehicleStatusBadge } from './components/VehicleStatusBadge'
import {
  buildVehicleTable,
  vehicleTableClipboard,
  type VehicleTableSnapshot,
} from './vehicleTable'

/** The license-state filter, exactly the values `GET /vehicles` accepts. */
const EXPIRY_FILTERS = ['all', 'attention', 'valid', 'due', 'expired'] as const
type ExpiryFilter = (typeof EXPIRY_FILTERS)[number]

/** The active/archived toggle, exactly the values `GET /vehicles` accepts. */
const STATE_FILTERS = ['active', 'archived'] as const
type StateFilter = (typeof STATE_FILTERS)[number]

/** The reminder window the API clamps to (`NotifyDaysUpdate`). */
const NOTIFY_MIN = 1
const NOTIFY_MAX = 365

/** Stable empty list, so a pending/failed fetch does not re-run the grouping
 *  memo on every render with a fresh `[]`. */
const NO_VEHICLES: readonly VehicleListItem[] = []

const selectClass =
  'h-9 rounded-md border border-input bg-surface px-2.5 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:ring-offset-background'

/** The administration row's actions: links and in-page requests read alike. */
const ADMIN_LINK =
  'rounded-sm font-medium text-primary-text underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:ring-offset-background'

/** One site group of the ledger, in render order. `finesAmount` is the sum of
 *  the group's own server-side per-vehicle totals — the one figure that makes
 *  the group header worth reading beyond its name. */
interface SiteGroup {
  siteId: number
  label: string
  vehicles: VehicleListItem[]
  finesAmount: number
}

interface VehiclePrintOutput {
  table: VehicleTableSnapshot
  scopeLabel: string
}

export function VehiclesHubPage(): React.JSX.Element {
  const { t, i18n } = useTranslation()
  const lang = i18n.language
  const queryClient = useQueryClient()
  const { has, isLoading: capabilityLoading } = useCapabilities()
  const canEdit = has('vehicles.edit')
  const isMobile = useIsMobile()

  const [query, setQuery] = useSearchParam('q')
  const [site, setSite] = useSearchParam('site')
  const [expiryValue, setExpiryValue] = useSearchParam('expiry', { fallback: 'all' })
  const [stateValue, setStateValue] = useSearchParam('state', { fallback: 'active' })
  const expiry: ExpiryFilter = EXPIRY_FILTERS.includes(expiryValue as ExpiryFilter)
    ? (expiryValue as ExpiryFilter)
    : 'all'
  const state: StateFilter = STATE_FILTERS.includes(stateValue as StateFilter)
    ? (stateValue as StateFilter)
    : 'active'
  const siteId = site && Number.isInteger(Number(site)) ? Number(site) : null
  const actionOverlay = useUrlOverlay('action')
  const setExpiry = (value: ExpiryFilter): void => setExpiryValue(value)
  const setState = (value: StateFilter): void => setStateValue(value)
  const renewOverlay = useUrlOverlay('renew')
  const [selectedIds, setSelectedIds] = useState<Set<number>>(() => new Set())
  const [copyPending, setCopyPending] = useState(false)
  const [printPending, setPrintPending] = useState(false)
  const [printOutput, setPrintOutput] = useState<VehiclePrintOutput | null>(null)
  /** `null` = follow the server; a string while the operator is typing. */
  const [notifyDraft, setNotifyDraft] = useState<string | null>(null)
  const [archiveTarget, setArchiveTarget] = useState<VehicleListItem | null>(null)
  const [restoreTarget, setRestoreTarget] = useState<VehicleListItem | null>(null)

  const searchId = useId()
  const ledgerHeadingId = useId()
  const notifyId = useId()
  const notifyUnitId = useId()

  // A burst of keystrokes must not fire a request per character; the site and
  // expiry filters are single clicks and go straight through.
  const debouncedQuery = useDebouncedValue(query.trim(), 300)
  const params = useMemo(
    () => ({
      ...(debouncedQuery ? { q: debouncedQuery } : {}),
      ...(siteId != null ? { site_id: siteId } : {}),
      expiry,
      state,
    }),
    [debouncedQuery, siteId, expiry, state],
  )

  const summaryQuery = useQuery({
    queryKey: VEHICLE_QUERY_KEYS.summary,
    queryFn: () => api.vehiclesSummary(),
  })
  const sitesQuery = useQuery({
    queryKey: VEHICLE_QUERY_KEYS.sites,
    queryFn: () => api.listVehicleSites(),
    staleTime: 60_000,
  })
  const listQuery = useQuery({
    queryKey: [...VEHICLE_QUERY_KEYS.list, params],
    queryFn: () => api.listVehicles(params),
  })

  const summary = summaryQuery.data
  const sites = sitesQuery.data
  const rows = listQuery.data ?? NO_VEHICLES
  const renewTarget = rows.find((vehicle) => String(vehicle.id) === renewOverlay.value) ?? null

  useEffect(() => {
    const action = actionOverlay.value
    if (!action || capabilityLoading) return
    if (!canEdit || !['add', 'sites', 'evg', 'fine', 'renew', 'accident', 'maintenance'].includes(action)) actionOverlay.close()
  }, [actionOverlay.close, actionOverlay.value, canEdit, capabilityLoading])

  useEffect(() => {
    if (!renewOverlay.value || capabilityLoading || listQuery.isFetching) return
    if (!canEdit || !renewTarget) renewOverlay.close()
  }, [canEdit, capabilityLoading, listQuery.isFetching, renewOverlay.close, renewOverlay.value, renewTarget])

  // A refetch can remove vehicles independently of the visible filters (for
  // example, after another operator archives one). Keep only ids present in
  // the fresh result, and preserve Set identity when there is nothing to prune.
  useEffect(() => {
    const availableIds = new Set(rows.map((vehicle) => vehicle.id))
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setSelectedIds((current) => {
      let pruned = false
      const next = new Set<number>()
      for (const id of current) {
        if (availableIds.has(id)) next.add(id)
        else pruned = true
      }
      return pruned ? next : current
    })
  }, [rows])

  // A filter change starts a different working set. Language and viewport are
  // deliberately absent: selection survives translation and responsive layout.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setSelectedIds((current) => (current.size === 0 ? current : new Set()))
  }, [debouncedQuery, siteId, expiry, state])

  const scopeRows = useMemo(
    () =>
      selectedIds.size > 0 ? rows.filter((vehicle) => selectedIds.has(vehicle.id)) : rows,
    [rows, selectedIds],
  )
  const vehicleTable = useMemo(
    () => buildVehicleTable(scopeRows, lang, t),
    [scopeRows, lang, t],
  )
  const listActionsDisabled =
    listQuery.isLoading ||
    listQuery.isError ||
    listQuery.isFetching ||
    query.trim() !== debouncedQuery ||
    copyPending ||
    printPending
  const allRowsSelected =
    rows.length > 0 && rows.every((vehicle) => selectedIds.has(vehicle.id))
  const someRowsSelected =
    !allRowsSelected && rows.some((vehicle) => selectedIds.has(vehicle.id))
  const scopeLabel = `${t(
    `vehicles.state${state === 'active' ? 'Active' : 'Archived'}`,
  )} · ${
    selectedIds.size > 0
      ? t('vehicles.output.selectedScope', {
          count: selectedIds.size,
          formattedCount: isolateBidi(formatCount(selectedIds.size)),
        })
      : t('vehicles.output.filteredScope', {
          count: scopeRows.length,
          formattedCount: isolateBidi(formatCount(scopeRows.length)),
        })
  }`

  const toggleVehicle = (id: number, checked: boolean): void => {
    setSelectedIds((current) => {
      const next = new Set(current)
      if (checked) next.add(id)
      else next.delete(id)
      return next
    })
  }

  const toggleAllRows = (checked: boolean): void => {
    setSelectedIds(checked ? new Set(rows.map((vehicle) => vehicle.id)) : new Set())
  }

  const copyVehicleTable = async (): Promise<void> => {
    if (selectedIds.size === 0) return
    setCopyPending(true)
    try {
      await copyTable(vehicleTableClipboard(vehicleTable))
      toast.success(t('vehicles.output.copied'))
    } catch {
      toast.error(t('vehicles.output.copyFailed'))
    } finally {
      setCopyPending(false)
    }
  }

  const printVehicleList = (): void => {
    flushSync(() => {
      setPrintPending(true)
      setPrintOutput({ table: vehicleTable, scopeLabel })
    })
    // Sandboxed or policy-blocked print calls can return normally without
    // opening a dialog. `beforeprint` confirms only that printing started;
    // neither it nor `afterprint` can claim a physical print completed.
    let printStarted = false
    const markPrintStarted = (): void => {
      printStarted = true
    }
    window.addEventListener('beforeprint', markPrintStarted, { once: true })
    try {
      window.print()
      if (!printStarted) {
        toast.error(t('vehicles.output.printFailed'))
      }
    } catch {
      toast.error(t('vehicles.output.printFailed'))
    } finally {
      window.removeEventListener('beforeprint', markPrintStarted)
      flushSync(() => {
        setPrintPending(false)
        setPrintOutput(null)
      })
    }
  }

  const notifyDays = summary?.notify_days
  const notifyValue = notifyDraft ?? (notifyDays != null ? String(notifyDays) : '')

  const setNotifyDays = useMutation({
    mutationFn: (days: number) => api.setVehicleNotifyDays(days),
    onSuccess: (next) => {
      // The response IS the new summary, so it is written straight in; only the
      // ledger has to be refetched, because the due/expired badge and the
      // `attention` filter are derived from this window server-side.
      queryClient.setQueryData(VEHICLE_QUERY_KEYS.summary, next)
      void queryClient.invalidateQueries({ queryKey: VEHICLE_QUERY_KEYS.list })
      setNotifyDraft(null)
      toast.success(t('vehicles.notifyDaysSaved'))
    },
    onError: (err) => {
      setNotifyDraft(null)
      toast.error(vehicleErrorMessage(err))
    },
  })

  /** Persist only a value that is in range AND actually different. */
  const commitNotifyDays = (): void => {
    if (notifyDraft === null || notifyDays == null) return
    const days = Number.parseInt(notifyDraft, 10)
    if (
      !Number.isFinite(days) ||
      days < NOTIFY_MIN ||
      days > NOTIFY_MAX ||
      days === notifyDays
    ) {
      setNotifyDraft(null)
      return
    }
    setNotifyDays.mutate(days)
  }

  const canDelete = has('vehicles.delete')
  const archiveMutation = useMutation({
    mutationFn: (vehicle: VehicleListItem) => api.archiveVehicle(vehicle.id),
    onSuccess: () => {
      invalidateVehicleQueries(queryClient, { registers: ['sites'] })
      toast.success(t('vehicles.vehicleArchived'))
    },
    onError: (err) => toast.error(vehicleErrorMessage(err)),
  })
  const restoreMutation = useMutation({
    mutationFn: (vehicle: VehicleListItem) => api.restoreVehicle(vehicle.id),
    onSuccess: () => {
      invalidateVehicleQueries(queryClient, { registers: ['sites'] })
      toast.success(t('vehicles.vehicleRestored'))
    },
    onError: (err) => toast.error(vehicleErrorMessage(err)),
  })


  const activeSites = useMemo(
    () => (sites ?? []).filter((site) => site.active),
    [sites],
  )

  // Groups follow the rows the server returned, ordered by the sites list
  // (active first, archived last — an archived site keeps its group for as long
  // as it still owns a vehicle). A site the sites query has not answered for
  // yet still shows its rows rather than dropping them.
  const groups = useMemo<SiteGroup[]>(() => {
    const bySite = new Map<number, VehicleListItem[]>()
    for (const vehicle of rows) {
      const list = bySite.get(vehicle.site_id)
      if (list) list.push(vehicle)
      else bySite.set(vehicle.site_id, [vehicle])
    }
    const ordered: SiteGroup[] = []
    const known: readonly VehicleSiteRead[] = sites ?? []
    const groupOf = (siteId: number, label: string, vehicles: VehicleListItem[]): SiteGroup => {
      let finesAmount = 0
      for (const vehicle of vehicles) finesAmount += vehicle.fines_amount_fils
      return { siteId, label, vehicles, finesAmount }
    }
    for (const wantActive of [true, false]) {
      for (const site of known) {
        if (site.active !== wantActive) continue
        const vehicles = bySite.get(site.id)
        if (!vehicles) continue
        bySite.delete(site.id)
        ordered.push(groupOf(site.id, localized(site.name_ar, site.name_en, lang), vehicles))
      }
    }
    for (const [unknownSiteId, vehicles] of bySite) {
      ordered.push(groupOf(unknownSiteId, `#${unknownSiteId}`, vehicles))
    }
    return ordered
  }, [rows, sites, lang])

  const services: {
    artwork: ServiceArtworkId
    title: string
    to: string
    count: number | undefined
    unit: string
    action: string
    label: string
  }[] = [
    { artwork: 'vehicle-fines', title: t('vehicles.finesService'), to: '/vehicles/fines', count: summary?.fines_count, unit: t('vehicles.fines.status.unpaid'), action: 'fine', label: t('vehicles.addFine') },
    { artwork: 'vehicle-licence-renewal', title: t('vehicles.renewService'), to: '/vehicles/renewals', count: summary?.license_attention, unit: t('vehicles.attention'), action: 'renew', label: t('vehicles.renew') },
    { artwork: 'vehicle-accident', title: t('vehicles.accidentService'), to: '/vehicles/accidents', count: summary?.open_accidents, unit: t('vehicles.openStatus'), action: 'accident', label: t('vehicles.newReport') },
    { artwork: 'vehicle-maintenance', title: t('vehicles.maintenanceService'), to: '/vehicles/maintenance', count: summary?.maintenance_due, unit: t('vehicles.dueSoon'), action: 'maintenance', label: t('vehicles.addMaintenance') },
  ]
  const doors = (
    <section aria-label={t('vehicles.heroTitle')} className="grid grid-cols-2 gap-2 md:grid-cols-4 md:gap-3">
      {services.map((service) => (
        <div key={service.action} className={cn('grid grid-rows-[1fr_auto] gap-3 rounded-md border border-border bg-surface p-3 md:p-4', SERVICE_LIFT)}>
          <Link to={service.to} className="group grid grid-cols-[auto_minmax(0,1fr)] items-center gap-2 rounded-sm text-start focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring md:grid-cols-[auto_minmax(0,1fr)_auto] md:gap-3">
            <ServiceArtwork artwork={service.artwork} className="!h-8 !w-8 md:!h-11 md:!w-11" />
            <span className="min-w-0">
              <strong className="block text-[0.86rem] font-bold text-primary-text group-hover:underline md:text-[1.05rem]">{service.title}</strong>
              <small className="mt-1 flex flex-wrap items-center gap-2 text-[0.74rem] text-muted-foreground">
                <bdi className={cn('min-w-6 rounded-full px-1.5 py-0.5 text-center font-mono font-semibold tabular-nums', (service.count ?? 0) > 0 ? 'bg-primary-soft text-primary-text' : 'bg-surface-tinted text-muted-foreground')}>
                  {service.count == null ? EMPTY_VALUE : formatCount(service.count)}
                </bdi>
                {service.unit}
              </small>
            </span>
            <ChevronRight className="hidden h-4 w-4 text-faint rtl:rotate-180 md:block" aria-hidden />
          </Link>
          {canEdit && (
            <Button type="button" size="lg" className="h-auto min-h-11 whitespace-normal px-2 text-[0.78rem] md:px-4 md:text-sm" onClick={() => actionOverlay.open(service.action)}>
              <Plus className="h-4 w-4 shrink-0" aria-hidden />
              {service.label}
            </Button>
          )}
        </div>
      ))}
    </section>
  )

  return (
    <>
      <div
        data-print-hide
        className="flex flex-1 flex-col overflow-hidden bg-background"
      >
      <ServicePage
        band={{
          big: true,
          eyebrow: t('vehicles.heroEyebrow'),
          title: t('vehicles.heroTitle'),
          description: t('vehicles.heroDesc'),
          actions: (
            <p className="hidden items-baseline gap-2 md:flex">
              <strong className="font-mono text-[1.6rem] font-bold tabular-nums">
                <bdi>{summary ? formatCount(summary.vehicles) : EMPTY_VALUE}</bdi>
              </strong>
              <span className="text-[0.76rem] text-primary-foreground/80">{t('vehicles.fleetSize')}</span>
            </p>
          ),
        }}
        counter={canEdit ? doors : null}
      >
        {!canEdit && doors}
        {summaryQuery.isError && (
          <div className="mb-3 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border bg-surface px-3.5 py-2.5">
            <span className="text-[0.8em] text-muted-foreground">{t('common.loadError')}</span>
            <Button
              type="button"
              variant="secondary"
              size="sm"
              onClick={() => void summaryQuery.refetch()}
            >
              {t('common.retry')}
            </Button>
          </div>
        )}

        {canEdit && (
          <nav aria-label={t('vehicles.manageFleet')} className="flex flex-wrap items-center gap-x-4 gap-y-2 text-[0.76rem]">
            <span className="font-semibold text-muted-foreground">{t('vehicles.manageFleet')}</span>
            <button type="button" className={ADMIN_LINK} onClick={() => actionOverlay.open('add')}>{t('vehicles.addVehicleService')}</button>
            <Link to="/vehicles/edit" className={ADMIN_LINK}>{t('vehicles.editVehicleService')}</Link>
            <button type="button" className={ADMIN_LINK} onClick={() => actionOverlay.open('sites')}>{t('vehicles.sitesService')}</button>
            <Link to="/vehicles/import" className={ADMIN_LINK}>{t('vehicles.importService')}</Link>
          </nav>
        )}
        <section
          tabIndex={-1}
          aria-labelledby={ledgerHeadingId}
          className="mt-6 outline-none"
        >
          <RegisterHeading
            id={ledgerHeadingId}
            title={t('vehicles.fleet')}
            description={t('vehicles.fleetDesc')}
            tools={<>
              <RefreshButton />
              <span
                className="text-[0.75rem] text-muted-foreground"
                aria-live="polite"
              >
                {t('vehicles.output.selectedCount', {
                  count: selectedIds.size,
                  formattedCount: isolateBidi(formatCount(selectedIds.size)),
                })}
              </span>
              <label className="inline-flex h-8 items-center gap-1.5 rounded-md border border-border px-2.5 text-[0.75rem] font-medium text-foreground">
                <SelectionCheckbox
                  checked={allRowsSelected}
                  indeterminate={someRowsSelected}
                  disabled={rows.length === 0}
                  label={t('vehicles.output.selectAllShown')}
                  onChange={toggleAllRows}
                />
                <span>{t('vehicles.output.selectAllShown')}</span>
              </label>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                disabled={selectedIds.size === 0}
                onClick={() => setSelectedIds(new Set())}
              >
                {t('vehicles.output.clearSelection')}
              </Button>
              <Button
                type="button"
                variant="secondary"
                size="sm"
                disabled={listActionsDisabled}
                onClick={printVehicleList}
              >
                <Printer className="h-3.5 w-3.5" aria-hidden />
                {t('vehicles.output.print')}
              </Button>
              <Button
                type="button"
                variant="secondary"
                size="sm"
                disabled={listActionsDisabled || selectedIds.size === 0}
                onClick={() => void copyVehicleTable()}
              >
                <ClipboardCopy className="h-3.5 w-3.5" aria-hidden />
                {t('vehicles.output.copy')}
              </Button>
              {canEdit && (
                <Button type="button" variant="secondary" size="sm" onClick={() => actionOverlay.open('evg')}>
                  <DownloadCloud className="h-3.5 w-3.5" aria-hidden />
                  {t('vehicles.importFines')}
                </Button>
              )}
            </>}
          />

          {!!summary?.insurance_attention && (
            <p className="mb-3 text-[0.78rem] text-muted-foreground">
              {t('vehicles.insuranceAttentionNotice', {
                count: isolateBidi(String(summary.insurance_attention)),
              })}
            </p>
          )}

          <div className="mb-4 rounded-xl border border-border bg-surface p-2.5">
            <div className="flex flex-wrap items-center gap-2">
              <div className="relative min-w-[13rem] flex-1">
                <Search
                  className="pointer-events-none absolute inset-y-0 start-2.5 my-auto h-3.5 w-3.5 text-muted-foreground"
                  aria-hidden
                />
                <label className="sr-only" htmlFor={searchId}>
                  {t('vehicles.search')}
                </label>
                <Input
                  id={searchId}
                  type="search"
                  dir="auto"
                  className="ps-8"
                  placeholder={t('vehicles.search')}
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                />
              </div>
              <select
                className={selectClass}
                aria-label={t('vehicles.licenseExpiry')}
                value={expiry}
                onChange={(event) => setExpiry(event.target.value as ExpiryFilter)}
              >
                {EXPIRY_FILTERS.map((option) => (
                  <option key={option} value={option}>
                    {option === 'all' ? t('vehicles.allExpiry') : t(`vehicles.${option}`)}
                  </option>
                ))}
              </select>
              <select
                className={selectClass}
                aria-label={t('vehicles.stateFilter')}
                value={state}
                onChange={(event) => setState(event.target.value as StateFilter)}
              >
                {STATE_FILTERS.map((option) => (
                  <option key={option} value={option}>
                    {t(`vehicles.state${option === 'active' ? 'Active' : 'Archived'}`)}
                  </option>
                ))}
              </select>
              {canEdit && (
                <div className="flex items-center gap-2 text-[0.75rem] text-muted-foreground">
                  <label htmlFor={notifyId}>{t('vehicles.notifyBefore')}</label>
                  <Input
                    id={notifyId}
                    type="number"
                    inputMode="numeric"
                    min={NOTIFY_MIN}
                    max={NOTIFY_MAX}
                    className="h-9 w-[5.5rem] font-mono tabular-nums"
                    aria-describedby={notifyUnitId}
                    disabled={notifyDays == null || setNotifyDays.isPending}
                    value={notifyValue}
                    onChange={(event) => setNotifyDraft(event.target.value)}
                    onBlur={commitNotifyDays}
                    onKeyDown={(event) => {
                      if (event.key !== 'Enter') return
                      event.preventDefault()
                      commitNotifyDays()
                    }}
                  />
                  <span id={notifyUnitId}>{t('vehicles.days')}</span>
                </div>
              )}
              {summary && (
                <MaintenanceContractorSetting
                  key={summary.maintenance_contractor_id ?? 'none'}
                  summary={summary}
                  canEdit={canEdit}
                />
              )}
            </div>

            <RegisterTabs
              label={t('vehicles.site')}
              className="mt-2.5"
              value={siteId == null ? '' : String(siteId)}
              onChange={(value) => setSite(value || null)}
              items={[
                { key: '', label: t('vehicles.allSites') },
                ...activeSites.map((item) => ({ key: String(item.id), label: localized(item.name_ar, item.name_en, lang) })),
              ]}
            />
          </div>

          {listQuery.isError ? (
            <div className="rounded-xl border border-border bg-surface py-8">
              <EmptyState
                icon={Car}
                message={t('common.loadError')}
                actionLabel={t('common.retry')}
                onAction={() => void listQuery.refetch()}
              />
            </div>
          ) : listQuery.isLoading ? (
            <div className="overflow-hidden rounded-xl border border-border bg-surface">
              {Array.from({ length: 5 }).map((_, index) => (
                <SkeletonRow key={index} cols={6} />
              ))}
            </div>
          ) : groups.length === 0 ? (
            <div className="rounded-xl border border-border bg-surface">
              <EmptyState
                icon={Car}
                message={t('vehicles.noVehicles')}
                description={t('vehicles.adjustFilters')}
              />
            </div>
          ) : (
            <div className="flex flex-col gap-3">
              {groups.map((group) => (
                <RegisterSheet
                  key={group.siteId}
                  title={<span dir="auto">{group.label}</span>}
                  meta={<>
                    <bdi className="font-mono tabular-nums">{formatCount(group.vehicles.length)}</bdi> {t('vehicles.vehicles')}
                    {group.finesAmount > 0 && <span className="ms-3">{t('vehicles.tabFines')} · <FineAmount fils={group.finesAmount} /></span>}
                  </>}
                >

                  {isMobile ? (
                    <div className="flex flex-col gap-2.5 p-2.5">
                      {group.vehicles.map((vehicle) => (
                        <VehicleCard
                          key={vehicle.id}
                          vehicle={vehicle}
                          selected={selectedIds.has(vehicle.id)}
                          onToggle={(checked) => toggleVehicle(vehicle.id, checked)}
                          canEdit={canEdit}
                          canDelete={canDelete}
                          state={state}
                          onRenew={() => renewOverlay.open(String(vehicle.id))}
                          onArchive={() => setArchiveTarget(vehicle)}
                          onRestore={() => setRestoreTarget(vehicle)}
                        />
                      ))}
                    </div>
                  ) : (
                    /* The group card already draws the frame, so this uses the
                       cell primitives without `<Table>`'s own bordered wrapper
                       — the same in-panel table shape as AbsencesTab. */
                    <div className="w-full overflow-x-auto">
                      <table className="w-full min-w-[860px] text-sm">
                        <TableHeader>
                          <TableRow>
                            <TableHead className="w-10">
                              <SelectionCheckbox
                                checked={allRowsSelected}
                                indeterminate={someRowsSelected}
                                label={t('vehicles.output.selectAllShown')}
                                onChange={toggleAllRows}
                              />
                            </TableHead>
                            <TableHead className="w-[76px]">{t('vehicles.mainPhoto')}</TableHead>
                            <TableHead>{t('vehicles.plate')}</TableHead>
                            <TableHead>{t('vehicles.type')}</TableHead>
                            <TableHead>{t('vehicles.class')}</TableHead>
                            <TableHead>{t('vehicles.trafficCode')}</TableHead>
                            <TableHead>{t('vehicles.licenseExpiry')}</TableHead>
                            <TableHead>{t('vehicles.tabFines')}</TableHead>
                            <TableHead className="text-end">{t('vehicles.action')}</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {group.vehicles.map((vehicle) => (
                            <VehicleRow
                              key={vehicle.id}
                              vehicle={vehicle}
                              selected={selectedIds.has(vehicle.id)}
                              onToggle={(checked) => toggleVehicle(vehicle.id, checked)}
                              canEdit={canEdit}
                              canDelete={canDelete}
                              state={state}
                              onRenew={() => renewOverlay.open(String(vehicle.id))}
                              onArchive={() => setArchiveTarget(vehicle)}
                              onRestore={() => setRestoreTarget(vehicle)}
                            />
                          ))}
                        </TableBody>
                      </table>
                    </div>
                  )}
                </RegisterSheet>
              ))}
            </div>
          )}
        </section>
      </ServicePage>

      {/* Dialogs. Each one owns its own mutations, toasts and cache
          invalidation; the hub only owns whether it is open. */}
      {canEdit && (
        <>
          <AddVehicleDialog
            open={actionOverlay.value === 'add'}
            onOpenChange={(open) => {
              if (!open) actionOverlay.close()
            }}
          />
          <SitesDialog
            open={actionOverlay.value === 'sites'}
            onOpenChange={(open) => {
              if (!open) actionOverlay.close()
            }}
          />
          <EvgFetchDialog
            open={actionOverlay.value === 'evg'}
            onOpenChange={(open) => {
              if (!open) actionOverlay.close()
            }}
          />
          {/* Mounted per request, so each one starts from its own defaults. */}
          {actionOverlay.value === 'fine' && (
            <FineDialog open onOpenChange={(open) => { if (!open) actionOverlay.close() }} />
          )}
          {actionOverlay.value === 'renew' && (
            <RenewLicenseDialog open onOpenChange={(open) => { if (!open) actionOverlay.close() }} />
          )}
          {actionOverlay.value === 'accident' && (
            <AccidentDialog vehicle={null} open onOpenChange={(open) => { if (!open) actionOverlay.close() }} />
          )}
          {actionOverlay.value === 'maintenance' && (
            <MaintenanceDialog open onOpenChange={(open) => { if (!open) actionOverlay.close() }} />
          )}
          {renewTarget && (
            <RenewLicenseDialog
              open
              vehicle={renewTarget}
              onOpenChange={(open) => {
                if (!open) renewOverlay.close()
              }}
            />
          )}
        </>
      )}
      {canDelete && (
        <>
          <ConfirmDialog
            open={archiveTarget != null}
            onOpenChange={(open) => {
              if (!open) setArchiveTarget(null)
            }}
            title={t('vehicles.archiveConfirmTitle', {
              plate: isolateBidi(
                archiveTarget ? archiveTarget.plate_label || archiveTarget.plate_number : '',
              ),
            })}
            description={t('vehicles.archiveConfirmDesc')}
            confirmLabel={t('vehicles.archiveVehicle')}
            destructive
            onConfirm={() => {
              if (archiveTarget) archiveMutation.mutate(archiveTarget)
              setArchiveTarget(null)
            }}
          />
          <ConfirmDialog
            open={restoreTarget != null}
            onOpenChange={(open) => {
              if (!open) setRestoreTarget(null)
            }}
            title={t('vehicles.restoreConfirmTitle', {
              plate: isolateBidi(
                restoreTarget ? restoreTarget.plate_label || restoreTarget.plate_number : '',
              ),
            })}
            description={t('vehicles.restoreConfirmDesc')}
            confirmLabel={t('vehicles.restoreVehicle')}
            onConfirm={() => {
              if (restoreTarget) restoreMutation.mutate(restoreTarget)
              setRestoreTarget(null)
            }}
          />
        </>
      )}
      </div>
      {printOutput && (
        <VehicleListPrintView
          table={printOutput.table}
          title={t('vehicles.fleet')}
          scopeLabel={printOutput.scopeLabel}
        />
      )}
    </>
  )
}


function SelectionCheckbox({
  checked,
  indeterminate = false,
  disabled = false,
  label,
  onChange,
}: {
  checked: boolean
  indeterminate?: boolean
  disabled?: boolean
  label: string
  onChange: (checked: boolean) => void
}): React.JSX.Element {
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (inputRef.current) inputRef.current.indeterminate = indeterminate
  }, [indeterminate])

  return (
    <input
      ref={inputRef}
      type="checkbox"
      checked={checked}
      disabled={disabled}
      onChange={(event) => onChange(event.target.checked)}
      aria-label={label}
      className="h-4 w-4 accent-primary"
    />
  )
}

/** The main photo as the ledger shows it, or a quiet placeholder. */
function VehiclePhoto({
  vehicle,
  className,
}: {
  vehicle: VehicleListItem
  className?: string
}): React.JSX.Element {
  const { t } = useTranslation()
  const box = cn('h-[38px] w-[54px] shrink-0 rounded-lg border border-border', className)
  if (!vehicle.photo_thumbnail_url) {
    return (
      <span aria-hidden className={cn(box, 'grid place-items-center border-dashed bg-surface-raised')}>
        <Car className="h-4 w-4 text-faint" strokeWidth={1.6} />
      </span>
    )
  }
  return (
    <img
      src={vehicle.photo_thumbnail_url}
      alt={t('vehicles.mainPhoto')}
      loading="lazy"
      className={cn(box, 'bg-surface-raised object-contain')}
    />
  )
}

/** Renew (only while the license needs it) + Edit + Open + Archive/Restore,
 *  shared by row and card. Archived vehicles never offer Edit/Renew — the
 *  file stays viewable, but only Restore resumes editing. */
function VehicleActions({
  vehicle,
  canEdit,
  canDelete,
  state,
  onRenew,
  onArchive,
  onRestore,
}: {
  vehicle: VehicleListItem
  canEdit: boolean
  canDelete: boolean
  state: StateFilter
  onRenew: () => void
  onArchive: () => void
  onRestore: () => void
}): React.JSX.Element {
  const { t } = useTranslation()
  const plate = vehicle.plate_label || vehicle.plate_number
  const archived = state === 'archived'
  return (
    <div className="flex flex-wrap items-center justify-end gap-1.5">
      {!archived && canEdit && vehicle.expiry_status !== 'valid' && (
        <Button
          type="button"
          variant="secondary"
          size="sm"
          onClick={onRenew}
          aria-label={`${t('vehicles.renew')} · ${plate}`}
        >
          {t('vehicles.renew')}
        </Button>
      )}
      {!archived && canEdit && (
        <Link
          to={`/vehicles/edit/${vehicle.id}`}
          aria-label={`${t('vehicles.editVehicle')} · ${plate}`}
          className={buttonVariants({ variant: 'secondary', size: 'sm' })}
        >
          {t('vehicles.editVehicle')}
        </Link>
      )}
      <Link
        to={`/vehicles/${vehicle.id}`}
        aria-label={`${t('vehicles.open')} · ${plate}`}
        className={buttonVariants({ variant: 'secondary', size: 'sm' })}
      >
        {t('vehicles.open')}
      </Link>
      {canDelete && !archived && (
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={onArchive}
          aria-label={`${t('vehicles.archiveVehicle')} · ${plate}`}
        >
          {t('vehicles.archiveVehicle')}
        </Button>
      )}
      {canDelete && archived && (
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={onRestore}
          aria-label={`${t('vehicles.restoreVehicle')} · ${plate}`}
        >
          {t('vehicles.restoreVehicle')}
        </Button>
      )}
    </div>
  )
}

function FinesFigure({ vehicle }: { vehicle: VehicleListItem }): React.JSX.Element {
  const { t } = useTranslation()
  return (
    <span className="flex flex-col">
      <strong className="text-[0.76rem] font-semibold text-foreground">
        <bdi>{formatCount(vehicle.fines_count)}</bdi> · <FineAmount fils={vehicle.fines_amount_fils} />
      </strong>
      <small className="text-[0.66rem] text-muted-foreground">
        <bdi>{formatCount(vehicle.black_points)} {t('vehicles.points')}</bdi>
      </small>
    </span>
  )
}

/** Licence status already carries its own date; insurance adds a second,
 *  clearly labelled line in the same cell rather than a new column — a
 *  missing date reads as "Not recorded" and never a badge. */
function InsuranceStatus({ vehicle }: { vehicle: VehicleListItem }): React.JSX.Element {
  const { t } = useTranslation()
  if (!vehicle.insurance_expiry || !vehicle.insurance_status) {
    return (
      <span className="text-[0.68rem] text-muted-foreground">
        {t('vehicles.insuranceExpiry')} · {t('vehicles.insuranceNotRecorded')}
      </span>
    )
  }
  return (
    <span className="flex items-center gap-1.5">
      <span className="text-[0.68rem] text-muted-foreground">{t('vehicles.insuranceExpiry')}</span>
      <bdi dir="ltr" className="font-mono text-[0.7rem] font-medium text-foreground">
        {formatIsoDate(vehicle.insurance_expiry)}
      </bdi>
      <VehicleStatusBadge family="expiry" status={vehicle.insurance_status} />
    </span>
  )
}

function VehicleRow({
  vehicle,
  selected,
  canEdit,
  canDelete,
  state,
  onToggle,
  onRenew,
  onArchive,
  onRestore,
}: {
  vehicle: VehicleListItem
  selected: boolean
  canEdit: boolean
  canDelete: boolean
  state: StateFilter
  onToggle: (checked: boolean) => void
  onRenew: () => void
  onArchive: () => void
  onRestore: () => void
}): React.JSX.Element {
  const { t, i18n } = useTranslation()
  const lang = i18n.language
  return (
    <TableRow className={selected ? 'bg-primary-soft' : undefined}>
      <TableCell className="w-10">
        <SelectionCheckbox
          checked={selected}
          label={t('vehicles.output.selectVehicle', {
            plate: vehicle.plate_label || vehicle.plate_number,
          })}
          onChange={onToggle}
        />
      </TableCell>
      <TableCell className="w-[76px]">
        <VehiclePhoto vehicle={vehicle} />
      </TableCell>
      <TableCell>
        <span className="flex flex-col gap-1">
          <PlateChip plate={vehicle.plate_label || vehicle.plate_number} />
          {vehicle.archived_at && (
            <span className="text-[0.66rem] font-medium text-muted-foreground">
              {t('vehicles.archivedStatus')}
            </span>
          )}
        </span>
      </TableCell>
      <TableCell>
        <span className="flex flex-col">
          <strong className="text-[0.78rem] font-semibold text-foreground" dir="auto">
            {localized(vehicle.type_ar, vehicle.type_en, lang)}
          </strong>
          <small className="font-mono text-[0.66rem] text-muted-foreground">
            <bdi dir="ltr">{vehicle.vin || EMPTY_VALUE}</bdi>
          </small>
        </span>
      </TableCell>
      <TableCell className="text-[0.76rem]" dir="auto">
        {localized(vehicle.class_ar, vehicle.class_en, lang)}
      </TableCell>
      <TableCell className="font-mono text-[0.72rem]">
        <bdi dir="ltr">{vehicle.traffic_code}</bdi>
      </TableCell>
      <TableCell>
        <span className="flex flex-col items-start gap-1">
          <bdi dir="ltr" className="font-mono text-[0.74rem] font-medium text-foreground">
            {formatIsoDate(vehicle.license_expiry)}
          </bdi>
          <VehicleStatusBadge family="expiry" status={vehicle.expiry_status} />
          <InsuranceStatus vehicle={vehicle} />
        </span>
      </TableCell>
      <TableCell>
        <FinesFigure vehicle={vehicle} />
      </TableCell>
      <TableCell className="text-end">
        <VehicleActions
          vehicle={vehicle}
          canEdit={canEdit}
          canDelete={canDelete}
          state={state}
          onRenew={onRenew}
          onArchive={onArchive}
          onRestore={onRestore}
        />
      </TableCell>
    </TableRow>
  )
}

function VehicleCard({
  vehicle,
  selected,
  canEdit,
  canDelete,
  state,
  onToggle,
  onRenew,
  onArchive,
  onRestore,
}: {
  vehicle: VehicleListItem
  selected: boolean
  canEdit: boolean
  canDelete: boolean
  state: StateFilter
  onToggle: (checked: boolean) => void
  onRenew: () => void
  onArchive: () => void
  onRestore: () => void
}): React.JSX.Element {
  const { t, i18n } = useTranslation()
  const lang = i18n.language
  return (
    <article
      className={cn(
        'rounded-xl border border-border p-3',
        selected ? 'bg-primary-soft' : 'bg-surface-raised',
      )}
    >
      <div className="flex items-start justify-between gap-2.5">
        <SelectionCheckbox
          checked={selected}
          label={t('vehicles.output.selectVehicle', {
            plate: vehicle.plate_label || vehicle.plate_number,
          })}
          onChange={onToggle}
        />
        <div className="min-w-0">
          <span className="flex items-center gap-1.5">
            <PlateChip plate={vehicle.plate_label || vehicle.plate_number} size="sm" />
            {vehicle.archived_at && (
              <span className="text-[0.64rem] font-medium text-muted-foreground">
                {t('vehicles.archivedStatus')}
              </span>
            )}
          </span>
          <h4 className="mt-1.5 text-[0.82rem] font-semibold text-foreground" dir="auto">
            {localized(vehicle.type_ar, vehicle.type_en, lang)}
          </h4>
          <p className="text-[0.7rem] text-muted-foreground" dir="auto">
            {localized(vehicle.class_ar, vehicle.class_en, lang)}
          </p>
        </div>
        <VehiclePhoto vehicle={vehicle} className="h-[46px] w-[66px]" />
      </div>

      <dl className="my-2.5 grid grid-cols-2 gap-2 border-y border-hairline py-2.5">
        <div className="min-w-0">
          <dt className="text-[0.63rem] uppercase tracking-[0.06em] text-muted-foreground">
            {t('vehicles.licenseExpiry')}
          </dt>
          <dd className="mt-0.5 font-mono text-[0.74rem] font-medium text-foreground">
            <bdi dir="ltr">{formatIsoDate(vehicle.license_expiry)}</bdi>
          </dd>
        </div>
        <div className="min-w-0">
          <dt className="text-[0.63rem] uppercase tracking-[0.06em] text-muted-foreground">
            {t('vehicles.tabFines')}
          </dt>
          <dd className="mt-0.5">
            <FinesFigure vehicle={vehicle} />
          </dd>
        </div>
      </dl>

      <div className="mb-2.5">
        <InsuranceStatus vehicle={vehicle} />
      </div>

      <div className="flex items-center justify-between gap-2">
        <VehicleStatusBadge family="expiry" status={vehicle.expiry_status} />
        <VehicleActions
          vehicle={vehicle}
          canEdit={canEdit}
          canDelete={canDelete}
          state={state}
          onRenew={onRenew}
          onArchive={onArchive}
          onRestore={onRestore}
        />
      </div>
    </article>
  )
}
