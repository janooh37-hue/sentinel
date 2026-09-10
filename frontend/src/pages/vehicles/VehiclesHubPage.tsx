/**
 * Vehicle Services — the module's hub at `/vehicles`.
 *
 * Two surfaces on one page, in the order an operator works:
 *   1. service cards, each showing its own live figure from
 *      `GET /vehicles/summary`, so the count is the reason to click;
 *   2. the fleet ledger — the licensed fleet grouped by operating site, with
 *      search, a site filter, a license-state filter and the reminder window.
 *
 * Every number and every group comes from the server. `GET /vehicles` applies
 * the search and the two filters (the ledger is unpaginated — the fleet is tens
 * of rows), and the summary owns the card counts, so the hub never re-derives a
 * figure the API already decided. A failed query renders a retry, never an
 * honest-looking zero.
 *
 * Capability gating: the whole page needs `vehicles.view` (route-level). The
 * cards that open a dialog (Add Vehicle, Sites), the EVG fetch and the row
 * Renew action need `vehicles.edit`, and the reminder window is read-only
 * without it — a viewer is never shown a control the API would 403.
 */

import { useEffect, useId, useMemo, useRef, useState } from 'react'
import { flushSync } from 'react-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Car, ClipboardCopy, DownloadCloud, Printer, Search } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { Link } from 'react-router-dom'
import { toast } from 'sonner'

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
import { useReducedMotion } from '@/lib/useFakeProgress'
import { useIsMobile } from '@/lib/useIsMobile'
import { cn } from '@/lib/utils'

import {
  EMPTY_VALUE,
  VEHICLE_QUERY_KEYS,
  formatAed,
  formatIsoDate,
  formatNumber,
  invalidateVehicleQueries,
  localized,
  vehicleErrorMessage,
} from './vehicleUtils'
import { AddVehicleDialog } from './components/AddVehicleDialog'
import { EvgFetchDialog } from './components/EvgFetchDialog'
import { PlateChip } from './components/PlateChip'
import { RenewLicenseDialog } from './components/RenewLicenseDialog'
import { ServiceCard } from './components/ServiceCard'
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
  const { has } = useCapabilities()
  const canEdit = has('vehicles.edit')
  const isMobile = useIsMobile()
  const reducedMotion = useReducedMotion()

  const [query, setQuery] = useState('')
  const [siteId, setSiteId] = useState<number | null>(null)
  const [expiry, setExpiry] = useState<ExpiryFilter>('all')
  const [state, setState] = useState<StateFilter>('active')
  const [selectedIds, setSelectedIds] = useState<Set<number>>(() => new Set())
  const [copyPending, setCopyPending] = useState(false)
  const [printPending, setPrintPending] = useState(false)
  const [printOutput, setPrintOutput] = useState<VehiclePrintOutput | null>(null)
  /** `null` = follow the server; a string while the operator is typing. */
  const [notifyDraft, setNotifyDraft] = useState<string | null>(null)

  const [addOpen, setAddOpen] = useState(false)
  const [sitesOpen, setSitesOpen] = useState(false)
  const [evgOpen, setEvgOpen] = useState(false)
  const [renewTarget, setRenewTarget] = useState<VehicleListItem | null>(null)
  const [archiveTarget, setArchiveTarget] = useState<VehicleListItem | null>(null)
  const [restoreTarget, setRestoreTarget] = useState<VehicleListItem | null>(null)

  const ledgerRef = useRef<HTMLElement>(null)
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
          formattedCount: isolateBidi(formatNumber(selectedIds.size, lang)),
        })
      : t('vehicles.output.filteredScope', {
          count: scopeRows.length,
          formattedCount: isolateBidi(formatNumber(scopeRows.length, lang)),
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
      toast.error(vehicleErrorMessage(err, t))
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
    onError: (err) => toast.error(vehicleErrorMessage(err, t)),
  })
  const restoreMutation = useMutation({
    mutationFn: (vehicle: VehicleListItem) => api.restoreVehicle(vehicle.id),
    onSuccess: () => {
      invalidateVehicleQueries(queryClient, { registers: ['sites'] })
      toast.success(t('vehicles.vehicleRestored'))
    },
    onError: (err) => toast.error(vehicleErrorMessage(err, t)),
  })

  /** The Renew card is a filter, not a dialog: it narrows the ledger to the
   *  licenses that need action and takes the operator (and the keyboard focus)
   *  there, instead of asking which vehicle first. */
  const showLicenseAttention = (): void => {
    setExpiry('attention')
    const node = ledgerRef.current
    if (!node) return
    node.scrollIntoView({ behavior: reducedMotion ? 'auto' : 'smooth', block: 'start' })
    node.focus({ preventScroll: true })
  }

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
      for (const vehicle of vehicles) finesAmount += vehicle.fines_amount
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

  const finesFigure = summary
    ? `${formatNumber(summary.fines_count, lang)} · ${formatAed(summary.fines_amount, lang)}`
    : EMPTY_VALUE
  const figure = (value: number | undefined): string =>
    value == null ? EMPTY_VALUE : formatNumber(value, lang)

  return (
    <>
      <div
        data-print-hide
        className="flex flex-1 flex-col overflow-hidden bg-background"
      >
      <header className="shrink-0 px-4 pb-2 pt-3 md:px-6 md:pb-3 md:pt-5">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-[0.75em] font-medium uppercase tracking-[0.18em] text-muted-foreground">
              {t('vehicles.heroEyebrow')}
            </p>
            <h1 className="mt-1 text-xl font-bold tracking-tight text-foreground md:text-[1.7em]">
              {t('vehicles.heroTitle')}
            </h1>
            <p className="mt-1 hidden text-[0.86em] text-muted-foreground md:block">
              {t('vehicles.heroDesc')}
            </p>
          </div>
          <div className="flex shrink-0 items-center gap-2.5">
            <p className="hidden items-baseline gap-2 rounded-xl border border-border bg-surface px-3.5 py-2 sm:flex">
              <strong className="font-mono text-lg font-bold tabular-nums text-primary">
                {figure(summary?.vehicles)}
              </strong>
              <span className="text-[0.7rem] text-muted-foreground">
                {t('vehicles.fleetSize')}
              </span>
            </p>
            <RefreshButton />
          </div>
        </div>
      </header>

      <div className="flex-1 overflow-y-auto px-4 pb-24 md:px-6">
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

        <div
          className="grid grid-cols-2 gap-2.5 sm:grid-cols-3 xl:grid-cols-6"
          role="group"
          aria-label={t('vehicles.heroTitle')}
        >
          <ServiceCard
            artwork="vehicle-fines"
            to="/vehicles/fines-report"
            title={t('vehicles.finesService')}
            description={t('vehicles.finesServiceDesc')}
            count={finesFigure}
            countLabel={t('vehicles.fines')}
          />
          <ServiceCard
            artwork="vehicle-licence-renewal"
            onClick={showLicenseAttention}
            title={t('vehicles.renewService')}
            description={t('vehicles.renewServiceDesc')}
            count={figure(summary?.license_attention)}
            countLabel={t('vehicles.attention')}
          />
          <ServiceCard
            artwork="vehicle-accident"
            to="/vehicles/accidents"
            title={t('vehicles.accidentService')}
            description={t('vehicles.accidentServiceDesc')}
            count={figure(summary?.open_accidents)}
            countLabel={`${t('vehicles.accidentsTitle')} · ${t('vehicles.openStatus')}`}
          />
          <ServiceCard
            artwork="vehicle-maintenance"
            to="/vehicles/maintenance"
            title={t('vehicles.maintenanceService')}
            description={t('vehicles.maintenanceServiceDesc')}
            count={figure(summary?.maintenance_due)}
            countLabel={`${t('vehicles.maintenanceTitle')} · ${t('vehicles.dueSoon')}`}
          />
          {canEdit && (
            <ServiceCard
              artwork="vehicle-register"
              to="/vehicles/edit"
              title={t('vehicles.editVehicleService')}
              description={t('vehicles.editVehicleServiceDesc')}
              count={figure(summary?.vehicles)}
              countLabel={t('vehicles.fleetSize')}
            />
          )}
          {canEdit && (
            <ServiceCard
              artwork="vehicle-register"
              onClick={() => setAddOpen(true)}
              title={t('vehicles.addVehicleService')}
              description={t('vehicles.addVehicleServiceDesc')}
              count={figure(summary?.vehicles)}
              countLabel={t('vehicles.fleetSize')}
            />
          )}
          {canEdit && (
            <ServiceCard
              artwork="vehicle-sites"
              onClick={() => setSitesOpen(true)}
              title={t('vehicles.sitesService')}
              description={t('vehicles.sitesServiceDesc')}
              count={figure(summary?.active_sites)}
              countLabel={t('vehicles.sitesService')}
            />
          )}
        </div>

        {canEdit ? (
          <div className="mt-3 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border bg-surface px-3.5 py-3">
            <div className="min-w-0">
              <p className="text-sm font-semibold text-foreground">
                {t('vehicles.importService')}
              </p>
              <p className="mt-0.5 text-xs text-muted-foreground">
                {t('vehicles.importServiceDesc')}
              </p>
            </div>
            <Link
              to="/vehicles/import"
              className={cn(
                buttonVariants({ variant: 'secondary', size: 'sm' }),
                'shrink-0',
              )}
            >
              {t('vehicles.importService')}
            </Link>
          </div>
        ) : null}

        {/* Fleet ledger. `tabIndex={-1}` is the landing target of the Renew
            card, so a keyboard operator arrives inside the section instead of
            being scrolled somewhere their focus is not. */}
        <section
          ref={ledgerRef}
          tabIndex={-1}
          aria-labelledby={ledgerHeadingId}
          className="mt-6 outline-none"
        >
          <header className="mb-3 flex flex-wrap items-end justify-between gap-2">
            <div className="min-w-0">
              <h2
                id={ledgerHeadingId}
                className="text-[1.05rem] font-bold tracking-tight text-foreground"
              >
                {t('vehicles.fleet')}
              </h2>
              <p className="mt-0.5 text-[0.78rem] text-muted-foreground">
                {t('vehicles.fleetDesc')}
              </p>
            </div>
            <div className="flex flex-wrap items-center justify-end gap-2">
              <span
                className="text-[0.75rem] text-muted-foreground"
                aria-live="polite"
              >
                {t('vehicles.output.selectedCount', {
                  count: selectedIds.size,
                  formattedCount: isolateBidi(formatNumber(selectedIds.size, lang)),
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
                <Button type="button" size="sm" onClick={() => setEvgOpen(true)}>
                  <DownloadCloud className="h-3.5 w-3.5" aria-hidden />
                  {t('vehicles.importFines')}
                </Button>
              )}
            </div>
          </header>

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
                  readOnly={!canEdit}
                  disabled={notifyDays == null || setNotifyDays.isPending}
                  value={notifyValue}
                  onChange={(event) => {
                    if (!canEdit) return
                    setNotifyDraft(event.target.value)
                  }}
                  onBlur={commitNotifyDays}
                  onKeyDown={(event) => {
                    if (event.key !== 'Enter') return
                    event.preventDefault()
                    commitNotifyDays()
                  }}
                />
                <span id={notifyUnitId}>{t('vehicles.days')}</span>
              </div>
            </div>

            <div
              className="mt-2.5 flex flex-wrap gap-1.5"
              role="group"
              aria-label={t('vehicles.site')}
            >
              <SiteChip active={siteId === null} onClick={() => setSiteId(null)}>
                {t('vehicles.allSites')}
              </SiteChip>
              {activeSites.map((site) => (
                <SiteChip
                  key={site.id}
                  active={siteId === site.id}
                  onClick={() => setSiteId(siteId === site.id ? null : site.id)}
                >
                  {localized(site.name_ar, site.name_en, lang)}
                </SiteChip>
              ))}
            </div>
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
                <section
                  key={group.siteId}
                  className="overflow-hidden rounded-xl border border-border bg-surface"
                >
                  <header className="flex flex-wrap items-center justify-between gap-2 border-b border-hairline px-3 py-2.5">
                    <div className="flex min-w-0 items-center gap-2">
                      <h3
                        className="truncate text-[0.85rem] font-semibold text-foreground"
                        dir="auto"
                      >
                        {group.label}
                      </h3>
                      {/* The pill is a bare number on screen; the label is what
                          a screen reader reads instead of "2". */}
                      <span
                        aria-label={`${formatNumber(group.vehicles.length, lang)} ${t('vehicles.vehicles')}`}
                        className="rounded-full bg-primary-soft px-2 py-0.5 font-mono text-[0.66rem] font-semibold tabular-nums text-primary"
                      >
                        {formatNumber(group.vehicles.length, lang)}
                      </span>
                    </div>
                    {group.finesAmount > 0 && (
                      <span className="text-[0.68rem] text-muted-foreground">
                        {`${t('vehicles.fines')} · `}
                        <bdi>{formatAed(group.finesAmount, lang)}</bdi>
                      </span>
                    )}
                  </header>

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
                          onRenew={() => setRenewTarget(vehicle)}
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
                            <TableHead>{t('vehicles.fines')}</TableHead>
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
                              onRenew={() => setRenewTarget(vehicle)}
                              onArchive={() => setArchiveTarget(vehicle)}
                              onRestore={() => setRestoreTarget(vehicle)}
                            />
                          ))}
                        </TableBody>
                      </table>
                    </div>
                  )}
                </section>
              ))}
            </div>
          )}
        </section>
      </div>

      {/* Dialogs. Each one owns its own mutations, toasts and cache
          invalidation; the hub only owns whether it is open. */}
      {canEdit && (
        <>
          <AddVehicleDialog open={addOpen} onOpenChange={setAddOpen} />
          <SitesDialog open={sitesOpen} onOpenChange={setSitesOpen} />
          <EvgFetchDialog open={evgOpen} onOpenChange={setEvgOpen} />
          {renewTarget && (
            <RenewLicenseDialog
              open
              vehicle={renewTarget}
              onOpenChange={(open) => {
                if (!open) setRenewTarget(null)
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

function SiteChip({
  active,
  onClick,
  children,
}: {
  active: boolean
  onClick: () => void
  children: React.ReactNode
}): React.JSX.Element {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      dir="auto"
      className={cn(
        'rounded-full border px-3 py-1 text-[0.72rem] font-medium transition-colors',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:ring-offset-surface',
        'motion-reduce:transition-none',
        active
          ? 'border-primary bg-primary-soft text-primary'
          : 'border-border bg-surface text-muted-foreground hover:border-border-strong hover:text-foreground',
      )}
    >
      {children}
    </button>
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
  if (!vehicle.photo_url) {
    return (
      <span aria-hidden className={cn(box, 'grid place-items-center border-dashed bg-surface-raised')}>
        <Car className="h-4 w-4 text-faint" strokeWidth={1.6} />
      </span>
    )
  }
  return (
    <img
      src={vehicle.photo_url}
      alt={t('vehicles.mainPhoto')}
      loading="lazy"
      className={cn(box, 'object-cover')}
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
  const { t, i18n } = useTranslation()
  return (
    <span className="flex flex-col">
      <strong className="text-[0.76rem] font-semibold text-foreground">
        <bdi>{`${formatNumber(vehicle.fines_count, i18n.language)} · ${formatAed(vehicle.fines_amount, i18n.language)}`}</bdi>
      </strong>
      <small className="text-[0.66rem] text-muted-foreground">
        <bdi>{`${formatNumber(vehicle.black_points, i18n.language)} ${t('vehicles.points')}`}</bdi>
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
            {t('vehicles.fines')}
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
