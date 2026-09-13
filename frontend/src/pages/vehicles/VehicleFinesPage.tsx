/**
 * Fleet fines ledger — `/vehicles/fines`.
 *
 * The fleet-wide working surface for every fine on record, across every
 * vehicle: where a fine is added, a payment is recorded, a receipt is
 * attached, a historical `unknown` row is classified, and settled clutter is
 * archived. `/vehicles/fines-report` remains the separate, historical Arabic
 * print copy (still includes archived/unknown/paid rows); this page is the
 * live working list.
 *
 * Data model: `GET /vehicles/fines` returns every fine regardless of payment
 * or archive state, unpaginated (the existing report architecture). This page
 * fetches it once under the shared `VEHICLE_QUERY_KEYS.fines` and derives the
 * overview, the filtered/sorted working set, and the batch-archive candidates
 * from that single array — never a second, differently-filtered request.
 *
 * The overview band always summarizes the *entire* fleet dataset, including
 * archived paid fines: switching the toolbar's scope/status/search/site/date
 * filters narrows only the table/cards below, never the four boxes above,
 * so a fine does not appear to vanish from the fleet's history by archiving
 * it. Scope/status/search/site/date are URL search params (`replace`d, not
 * pushed), so a refresh or a back navigation returns to the same working set.
 *
 * Newest date/time first, id as the tie-breaker — the server's own
 * `date desc, id desc` order does not account for `time`, so this page
 * re-sorts rather than trusting response order.
 *
 * Archive UX mirrors the vehicle-detail fines panel's gating (`FineActions`,
 * shared): only a paid, active row offers Archive; only an archived row
 * offers Restore; unknown/unpaid never archive. The batch action snapshots
 * the *currently filtered* paid-active rows' id/version pairs and sends them
 * once on confirm — never an open-ended server-side query — and a stale/
 * invalid row in that batch fails the whole request atomically (the API's
 * contract), after which this page simply refetches and asks again.
 *
 * `FineDialog`'s `onSaved` (create only) resets every filter to its default
 * (Active/All/no search/no site/no dates) and highlights the created row by
 * its response `id` — never inferred from a max-id or list diff — so an old-
 * dated fine is still found and shown even though the ledger sorts by date.
 */

import { useCallback, useEffect, useId, useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ChevronLeft, ChevronRight, FileText, Plus, Search } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { Link, useSearchParams } from 'react-router-dom'
import { toast } from 'sonner'

import { RefreshButton } from '@/components/refresh/RefreshButton'
import { Button } from '@/components/ui/button'
import { buttonVariants } from '@/components/ui/button-variants'
import { ConfirmDialog } from '@/components/ui/confirm-dialog'
import { EmptyState } from '@/components/ui/empty-state'
import { Input } from '@/components/ui/input'
import { Skeleton } from '@/components/ui/skeleton'
import { TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { api } from '@/lib/api'
import type { VehicleFineRead, VehicleSiteRead } from '@/lib/api'
import { isolateBidi } from '@/lib/useCapabilityCatalog'
import { useCapabilities } from '@/lib/useCapabilities'
import { useIsMobile } from '@/lib/useIsMobile'
import { useReducedMotion } from '@/lib/useFakeProgress'
import { cn } from '@/lib/utils'

import {
  EMPTY_VALUE,
  VEHICLE_QUERY_KEYS,
  employeeLabel,
  formatDateTime,
  formatNumber,
  invalidateVehicleQueries,
  isArabic,
  localized,
  vehicleErrorMessage,
} from './vehicleUtils'
import { FineActions, type FineActionCallbacks } from './components/FineActions'
import { FineAmount } from './components/FineAmount'
import { FineDialog } from './components/FineDialog'
import { FinePaymentDialog, type FinePaymentMode } from './components/FinePaymentDialog'
import { PlateChip } from './components/PlateChip'
import { VehicleFileThumb } from './components/VehicleFileViewer'
import { VehicleStatusBadge } from './components/VehicleStatusBadge'

/** Stable empty list, so a pending or failed fetch does not re-run the
 *  overview/filter memos against a fresh `[]` on every render. */
const NO_FINES: readonly VehicleFineRead[] = []
const NO_SITES: readonly VehicleSiteRead[] = []

const SCOPES = ['active', 'archive', 'all'] as const
type Scope = (typeof SCOPES)[number]

const STATUS_FILTERS = ['all', 'unpaid', 'paid', 'unknown'] as const
type StatusFilterValue = (typeof STATUS_FILTERS)[number]

function scopeFromSearch(params: URLSearchParams): Scope {
  const value = params.get('scope')
  return value === 'archive' || value === 'all' ? value : 'active'
}

function statusFromSearch(params: URLSearchParams): StatusFilterValue {
  const value = params.get('status')
  return value === 'unpaid' || value === 'paid' || value === 'unknown' ? value : 'all'
}

const selectClass =
  'h-9 rounded-md border border-input bg-surface px-2.5 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:ring-offset-background'

export function VehicleFinesPage(): React.JSX.Element {
  const { t, i18n } = useTranslation()
  const lang = i18n.language
  const isAr = isArabic(lang)
  const queryClient = useQueryClient()
  const { has } = useCapabilities()
  const canEdit = has('vehicles.edit')
  const canDelete = has('vehicles.delete')
  const isMobile = useIsMobile()
  const reducedMotion = useReducedMotion()

  const [searchParams, setSearchParams] = useSearchParams()
  const scope = scopeFromSearch(searchParams)
  const statusFilter = statusFromSearch(searchParams)
  const search = searchParams.get('q') ?? ''
  const siteParam = searchParams.get('site_id')
  const siteId = siteParam && /^\d+$/.test(siteParam) ? Number(siteParam) : null
  const dateFrom = searchParams.get('date_from') ?? ''
  const dateTo = searchParams.get('date_to') ?? ''
  const hasActiveFilters =
    scope !== 'active' || statusFilter !== 'all' || search !== '' || siteId !== null || dateFrom !== '' || dateTo !== ''

  const setFilter = useCallback(
    (key: string, value: string | null) => {
      setSearchParams(
        (previous) => {
          const params = new URLSearchParams(previous)
          if (value === null || value === '') params.delete(key)
          else params.set(key, value)
          return params
        },
        { replace: true },
      )
    },
    [setSearchParams],
  )

  const resetFilters = useCallback(() => {
    setSearchParams(new URLSearchParams(), { replace: true })
  }, [setSearchParams])

  const [addOpen, setAddOpen] = useState(false)
  const [editTarget, setEditTarget] = useState<VehicleFineRead | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<VehicleFineRead | null>(null)
  const [paymentTarget, setPaymentTarget] = useState<{ fine: VehicleFineRead; mode: FinePaymentMode } | null>(
    null,
  )
  const [archiveTarget, setArchiveTarget] = useState<VehicleFineRead | null>(null)
  const [batchArchiveOpen, setBatchArchiveOpen] = useState(false)
  const [highlightedId, setHighlightedId] = useState<number | null>(null)

  const finesQuery = useQuery({
    queryKey: VEHICLE_QUERY_KEYS.fines,
    queryFn: () => api.listVehicleFines(),
  })
  const sitesQuery = useQuery({
    queryKey: VEHICLE_QUERY_KEYS.sites,
    queryFn: () => api.listVehicleSites(),
    staleTime: 60_000,
  })

  const fines = finesQuery.data ?? NO_FINES
  const sites = sitesQuery.data ?? NO_SITES
  const activeSites = useMemo(() => sites.filter((site) => site.active), [sites])

  useEffect(() => {
    if (highlightedId === null) return
    const handle = window.setTimeout(() => setHighlightedId(null), 1800)
    return () => window.clearTimeout(handle)
  }, [highlightedId])

  /** Always the whole fleet dataset — never `filtered` — so archiving a paid
   *  fine or narrowing the toolbar cannot make it look like the money moved. */
  const overview = useMemo(() => {
    let unpaidCount = 0
    let unpaidFils = 0
    let paidCount = 0
    let paidFils = 0
    let unknownCount = 0
    let unknownFils = 0
    for (const fine of fines) {
      if (fine.payment_status === 'unpaid') {
        unpaidCount += 1
        unpaidFils += fine.amount_fils
      } else if (fine.payment_status === 'paid') {
        paidCount += 1
        paidFils += fine.amount_fils
      } else {
        unknownCount += 1
        unknownFils += fine.amount_fils
      }
    }
    return { total: fines.length, unpaidCount, unpaidFils, paidCount, paidFils, unknownCount, unknownFils }
  }, [fines])

  const datesInvalid = Boolean(dateFrom && dateTo && dateFrom > dateTo)

  const scopedFines = useMemo(() => {
    if (scope === 'active') return fines.filter((fine) => !fine.archived_at)
    if (scope === 'archive') return fines.filter((fine) => fine.archived_at)
    return fines
  }, [fines, scope])

  const filtered = useMemo(() => {
    if (datesInvalid) return []
    const q = search.trim().toLocaleLowerCase(lang)
    return scopedFines
      .filter((fine) => {
        if (statusFilter !== 'all' && fine.payment_status !== statusFilter) return false
        if (siteId !== null && fine.vehicle_site_id !== siteId) return false
        if (dateFrom && fine.date < dateFrom) return false
        if (dateTo && fine.date > dateTo) return false
        if (q) {
          const haystack = [
            fine.vehicle_plate_label,
            fine.vehicle_type_ar,
            fine.vehicle_type_en,
            fine.employee_name_ar,
            fine.employee_name_en,
            fine.employee_id,
          ]
            .filter(Boolean)
            .join(' ')
            .toLocaleLowerCase(lang)
          if (!haystack.includes(q)) return false
        }
        return true
      })
      .sort((a, b) => {
        const keyA = `${a.date} ${a.time ?? '00:00'}`
        const keyB = `${b.date} ${b.time ?? '00:00'}`
        if (keyA !== keyB) return keyA < keyB ? 1 : -1
        return b.id - a.id
      })
  }, [scopedFines, statusFilter, siteId, dateFrom, dateTo, search, datesInvalid, lang])

  /** The batch action's exact candidates: paid, active, and currently shown —
   *  a snapshot of id/version pairs, not a live server-side query. */
  const archivablePaid = useMemo(
    () => filtered.filter((fine) => fine.payment_status === 'paid' && !fine.archived_at),
    [filtered],
  )

  const reportHref = useMemo(() => {
    const params = new URLSearchParams()
    if (siteId !== null) params.set('site_id', String(siteId))
    if (dateFrom) params.set('date_from', dateFrom)
    if (dateTo) params.set('date_to', dateTo)
    const qs = params.toString()
    return qs ? `/vehicles/fines-report?${qs}` : '/vehicles/fines-report'
  }, [siteId, dateFrom, dateTo])

  const highlightCreated = useCallback(
    (fine: VehicleFineRead) => {
      resetFilters()
      setHighlightedId(fine.id)
      window.setTimeout(() => {
        const node = document.querySelector<HTMLElement>(`[data-fine-id="${fine.id}"]`)
        node?.scrollIntoView({ block: 'center', behavior: reducedMotion ? 'auto' : 'smooth' })
        node?.focus({ preventScroll: true })
      }, 120)
    },
    [resetFilters, reducedMotion],
  )

  const invalidateAfterChange = (fine: VehicleFineRead): void => {
    invalidateVehicleQueries(queryClient, { vehicleId: fine.vehicle_id, registers: ['fines'] })
  }

  const deleteFine = useMutation({
    mutationFn: (fine: VehicleFineRead) => api.deleteVehicleFine(fine.vehicle_id, fine.id, fine.version),
    onSuccess: (_result, fine) => {
      invalidateAfterChange(fine)
      toast.success(t('common.deletedToast'))
    },
    onError: (err) => toast.error(vehicleErrorMessage(err, t)),
  })

  const markUnpaid = useMutation({
    mutationFn: (fine: VehicleFineRead) =>
      api.updateVehicleFine(fine.vehicle_id, fine.id, { payment_status: 'unpaid' }, fine.version),
    onSuccess: (_result, fine) => {
      invalidateAfterChange(fine)
      toast.success(t('vehicles.fines.classified'))
    },
    onError: (err) => toast.error(vehicleErrorMessage(err, t)),
  })

  const archiveOne = useMutation({
    mutationFn: (fine: VehicleFineRead) => api.archiveVehicleFines([{ id: fine.id, version: fine.version }]),
    onSuccess: (_result, fine) => {
      invalidateAfterChange(fine)
      toast.success(t('vehicles.fines.archived', { count: 1 }))
    },
    onError: (err) => {
      void finesQuery.refetch()
      toast.error(vehicleErrorMessage(err, t))
    },
  })

  const restoreOne = useMutation({
    mutationFn: (fine: VehicleFineRead) => api.restoreVehicleFines([{ id: fine.id, version: fine.version }]),
    onSuccess: (_result, fine) => {
      invalidateAfterChange(fine)
      toast.success(t('vehicles.fines.restored', { count: 1 }))
    },
    onError: (err) => {
      void finesQuery.refetch()
      toast.error(vehicleErrorMessage(err, t))
    },
  })

  const archiveBatch = useMutation({
    mutationFn: (rows: readonly VehicleFineRead[]) =>
      api.archiveVehicleFines(rows.map((fine) => ({ id: fine.id, version: fine.version }))),
    onSuccess: (result) => {
      invalidateVehicleQueries(queryClient, { registers: ['fines'] })
      toast.success(t('vehicles.fines.archived', { count: result.changed_count }))
    },
    onError: (err) => {
      // The batch rejected atomically (a stale/invalid row) — refetch so the
      // next confirmation snapshots current data rather than repeating it.
      void finesQuery.refetch()
      toast.error(vehicleErrorMessage(err, t))
    },
  })

  const busy =
    deleteFine.isPending ||
    markUnpaid.isPending ||
    archiveOne.isPending ||
    restoreOne.isPending ||
    archiveBatch.isPending

  const actions: FineActionCallbacks = {
    onEdit: setEditTarget,
    onDelete: setDeleteTarget,
    onRecordPayment: (fine) => setPaymentTarget({ fine, mode: 'payment' }),
    onAttachReceipt: (fine) => setPaymentTarget({ fine, mode: 'receipt' }),
    onMarkUnpaid: (fine) => markUnpaid.mutate(fine),
    onArchive: setArchiveTarget,
    onRestore: (fine) => restoreOne.mutate(fine),
  }

  const searchId = useId()
  const siteFieldId = useId()
  const fromFieldId = useId()
  const toFieldId = useId()

  const showActions = canEdit || canDelete
  const fleetEmpty = finesQuery.isSuccess && fines.length === 0
  const archiveEmpty = finesQuery.isSuccess && !fleetEmpty && scope === 'archive' && scopedFines.length === 0
  const noMatches = finesQuery.isSuccess && !fleetEmpty && !archiveEmpty && filtered.length === 0

  return (
    <div className="flex flex-1 flex-col overflow-hidden bg-background">
      <header className="shrink-0 px-4 pb-2 pt-3 md:px-6 md:pb-3 md:pt-5">
        <Link
          to="/vehicles"
          className="inline-flex items-center gap-1.5 text-[0.8em] font-medium text-primary transition-colors hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:ring-offset-background motion-reduce:transition-none"
        >
          {isAr ? (
            <ChevronRight className="h-3.5 w-3.5" strokeWidth={1.8} aria-hidden />
          ) : (
            <ChevronLeft className="h-3.5 w-3.5" strokeWidth={1.8} aria-hidden />
          )}
          {t('vehicles.backHub')}
        </Link>

        <div className="mt-1.5 flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <h1 className="text-xl font-bold tracking-tight text-foreground md:text-[1.55em]">
              {t('vehicles.finesLedgerTitle')}
            </h1>
            <p className="mt-1 hidden text-[0.84em] text-muted-foreground md:block">
              {t('vehicles.finesLedgerDesc')}
            </p>
          </div>

          <div className="flex shrink-0 flex-wrap items-center gap-2">
            <Link
              to={reportHref}
              className={cn(buttonVariants({ variant: 'secondary', size: 'sm' }))}
            >
              <FileText className="h-3.5 w-3.5" aria-hidden />
              {t('vehicles.finesReport')}
            </Link>
            <RefreshButton />
            {canEdit && (
              <Button type="button" size="sm" onClick={() => setAddOpen(true)}>
                <Plus className="h-3.5 w-3.5" aria-hidden />
                {t('vehicles.addFine')}
              </Button>
            )}
          </div>
        </div>
      </header>

      <div className="flex-1 overflow-y-auto px-4 pb-24 md:px-6">
        {/* Overview: always the whole fleet, never affected by the toolbar. */}
        <div className="mb-4 grid grid-cols-2 gap-2.5 md:grid-cols-4">
          <OverviewBox
            label={t('vehicles.fines.overviewUnpaid')}
            count={overview.unpaidCount}
            amountFils={overview.unpaidFils}
            known={finesQuery.isSuccess}
            lang={lang}
            tone="warning"
          />
          <OverviewBox
            label={t('vehicles.fines.overviewPaid')}
            count={overview.paidCount}
            amountFils={overview.paidFils}
            known={finesQuery.isSuccess}
            lang={lang}
            tone="success"
          />
          <OverviewBox
            label={t('vehicles.fines.overviewTotal')}
            count={overview.total}
            known={finesQuery.isSuccess}
            lang={lang}
            tone="neutral"
          />
          <OverviewBox
            label={t('vehicles.fines.overviewUnknown')}
            count={overview.unknownCount}
            amountFils={overview.unknownFils}
            known={finesQuery.isSuccess}
            lang={lang}
            tone="neutral"
          />
        </div>
        <p className="mb-3 -mt-2 text-[0.72rem] text-muted-foreground">
          {t('vehicles.fines.overviewIncludesArchived')}
        </p>

        {finesQuery.isError ? (
          <div className="rounded-xl border border-border bg-surface">
            <EmptyState
              icon={FileText}
              message={t('common.loadError')}
              actionLabel={t('common.retry')}
              onAction={() => void finesQuery.refetch()}
            />
          </div>
        ) : (
          <>
            {/* ── Toolbar ── */}
            <div className="mb-3 rounded-xl border border-border bg-surface p-2.5">
              <div className="flex flex-wrap items-center gap-2">
                <div
                  role="group"
                  aria-label={t('vehicles.fines.scopeGroup')}
                  className="inline-flex rounded-full border border-border bg-raised p-0.5"
                >
                  {SCOPES.map((option) => (
                    <button
                      key={option}
                      type="button"
                      aria-pressed={scope === option}
                      onClick={() => setFilter('scope', option === 'active' ? null : option)}
                      className={cn(
                        'rounded-full px-3 py-1.5 text-[0.76rem] font-semibold transition-colors',
                        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:ring-offset-surface',
                        'motion-reduce:transition-none',
                        scope === option
                          ? 'bg-primary text-primary-foreground'
                          : 'text-muted-foreground hover:text-foreground',
                      )}
                    >
                      {t(`vehicles.fines.scope${option === 'active' ? 'Active' : option === 'archive' ? 'Archive' : 'All'}`)}
                    </button>
                  ))}
                </div>

                <select
                  className={selectClass}
                  aria-label={t('vehicles.fines.statusColumn')}
                  value={statusFilter}
                  onChange={(event) => setFilter('status', event.target.value === 'all' ? null : event.target.value)}
                >
                  {STATUS_FILTERS.map((option) => (
                    <option key={option} value={option}>
                      {option === 'all' ? t('vehicles.fines.statusAll') : t(`vehicles.fines.status.${option}`)}
                    </option>
                  ))}
                </select>

                <div className="relative min-w-[13rem] flex-1">
                  <Search
                    className="pointer-events-none absolute inset-y-0 start-2.5 my-auto h-3.5 w-3.5 text-muted-foreground"
                    aria-hidden
                  />
                  <label className="sr-only" htmlFor={searchId}>
                    {t('vehicles.fines.searchPlaceholder')}
                  </label>
                  <Input
                    id={searchId}
                    type="search"
                    dir="auto"
                    className="ps-8"
                    placeholder={t('vehicles.fines.searchPlaceholder')}
                    value={search}
                    onChange={(event) => setFilter('q', event.target.value)}
                  />
                </div>

                <label className="sr-only" htmlFor={siteFieldId}>
                  {t('vehicles.site')}
                </label>
                <select
                  id={siteFieldId}
                  className={selectClass}
                  value={siteId ?? ''}
                  onChange={(event) => setFilter('site_id', event.target.value || null)}
                >
                  <option value="">{t('vehicles.allSites')}</option>
                  {activeSites.map((site) => (
                    <option key={site.id} value={site.id}>
                      {localized(site.name_ar, site.name_en, lang)}
                    </option>
                  ))}
                </select>

                <label className="sr-only" htmlFor={fromFieldId}>
                  {t('vehicles.fromDate')}
                </label>
                <Input
                  id={fromFieldId}
                  type="date"
                  aria-label={t('vehicles.fromDate')}
                  aria-invalid={datesInvalid || undefined}
                  className="h-9 w-[9.5rem] font-mono tabular-nums"
                  value={dateFrom}
                  onChange={(event) => setFilter('date_from', event.target.value || null)}
                />
                <label className="sr-only" htmlFor={toFieldId}>
                  {t('vehicles.toDate')}
                </label>
                <Input
                  id={toFieldId}
                  type="date"
                  aria-label={t('vehicles.toDate')}
                  aria-invalid={datesInvalid || undefined}
                  className="h-9 w-[9.5rem] font-mono tabular-nums"
                  value={dateTo}
                  onChange={(event) => setFilter('date_to', event.target.value || null)}
                />

                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  disabled={!hasActiveFilters}
                  onClick={resetFilters}
                >
                  {t('vehicles.fines.resetFilters')}
                </Button>
              </div>

              {datesInvalid && (
                <p role="alert" className="mt-2 text-[0.74rem] text-destructive">
                  {t('vehicles.fines.invalidDateRange')}
                </p>
              )}
            </div>

            {canDelete && archivablePaid.length > 0 && (
              <div className="mb-3 flex flex-wrap items-center justify-between gap-2 rounded-xl border border-border bg-surface px-3 py-2.5">
                <p className="text-[0.78rem] text-muted-foreground">
                  {t('vehicles.fines.archivePaidResultsHint', {
                    count: archivablePaid.length,
                    formattedCount: isolateBidi(formatNumber(archivablePaid.length, lang)),
                  })}
                </p>
                <Button
                  type="button"
                  variant="secondary"
                  size="sm"
                  disabled={busy}
                  onClick={() => setBatchArchiveOpen(true)}
                >
                  {t('vehicles.fines.archivePaidResults', {
                    count: archivablePaid.length,
                    formattedCount: isolateBidi(formatNumber(archivablePaid.length, lang)),
                  })}
                </Button>
              </div>
            )}

            {finesQuery.isLoading ? (
              <div className="overflow-hidden rounded-xl border border-border bg-surface">
                {Array.from({ length: 5 }).map((_, index) => (
                  <Skeleton key={index} className="m-2.5 h-16 w-full rounded-lg" />
                ))}
              </div>
            ) : fleetEmpty ? (
              <div className="rounded-xl border border-border bg-surface">
                <EmptyState
                  icon={FileText}
                  message={t('vehicles.fines.noFinesAtAll')}
                  description={canEdit ? t('vehicles.fines.noFinesAtAllDesc') : undefined}
                  actionLabel={canEdit ? t('vehicles.addFine') : undefined}
                  onAction={canEdit ? () => setAddOpen(true) : undefined}
                />
              </div>
            ) : archiveEmpty ? (
              <div className="rounded-xl border border-border bg-surface">
                <EmptyState icon={FileText} message={t('vehicles.fines.noArchivedFines')} />
              </div>
            ) : noMatches ? (
              <div className="rounded-xl border border-border bg-surface">
                <EmptyState
                  icon={FileText}
                  message={t('vehicles.noRecords')}
                  description={datesInvalid ? t('vehicles.fines.invalidDateRange') : t('vehicles.adjustFilters')}
                  actionLabel={t('vehicles.fines.resetFilters')}
                  onAction={resetFilters}
                />
              </div>
            ) : (
              <section className="overflow-hidden rounded-xl border border-border bg-surface">
                <header className="flex flex-wrap items-center justify-between gap-2 border-b border-hairline px-3 py-2.5">
                  <p aria-live="polite" className="text-[0.72rem] text-muted-foreground">
                    <bdi>{`${formatNumber(filtered.length, lang)} ${t('vehicles.records')}`}</bdi>
                  </p>
                </header>

                {isMobile ? (
                  <div className="flex flex-col gap-2.5 p-2.5">
                    {filtered.map((fine) => (
                      <FineLedgerCard
                        key={fine.id}
                        fine={fine}
                        canEdit={canEdit}
                        canDelete={canDelete}
                        busy={busy}
                        highlighted={fine.id === highlightedId}
                        lang={lang}
                        t={t}
                        {...actions}
                      />
                    ))}
                  </div>
                ) : (
                  <div className="w-full overflow-x-auto">
                    <table className="w-full min-w-[1080px] text-sm">
                      <caption className="sr-only">{t('vehicles.finesLedgerTitle')}</caption>
                      <TableHeader>
                        <TableRow>
                          <TableHead>{t('vehicles.date')}</TableHead>
                          <TableHead>{t('vehicles.fines.vehicleColumn')}</TableHead>
                          <TableHead>{t('vehicles.employee')}</TableHead>
                          <TableHead>{t('vehicles.fines.detailsColumn')}</TableHead>
                          <TableHead>{t('vehicles.amount')}</TableHead>
                          <TableHead>{t('vehicles.blackPoints')}</TableHead>
                          <TableHead>{t('vehicles.fines.statusColumn')}</TableHead>
                          {showActions && <TableHead className="text-end">{t('vehicles.action')}</TableHead>}
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {filtered.map((fine) => (
                          <FineLedgerRow
                            key={fine.id}
                            fine={fine}
                            canEdit={canEdit}
                            canDelete={canDelete}
                            busy={busy}
                            showActions={showActions}
                            highlighted={fine.id === highlightedId}
                            lang={lang}
                            t={t}
                            {...actions}
                          />
                        ))}
                      </TableBody>
                    </table>
                  </div>
                )}
              </section>
            )}
          </>
        )}
      </div>

      {canEdit && (
        <>
          <FineDialog open={addOpen} onOpenChange={setAddOpen} vehicle={null} onSaved={highlightCreated} />
          {editTarget && (
            <FineDialog
              open
              onOpenChange={(open) => {
                if (!open) setEditTarget(null)
              }}
              vehicle={{
                id: editTarget.vehicle_id,
                plate_number: editTarget.vehicle_plate_label,
              }}
              fine={editTarget}
            />
          )}
        </>
      )}

      {paymentTarget && (
        <FinePaymentDialog
          open
          onOpenChange={(open) => {
            if (!open) setPaymentTarget(null)
          }}
          fine={paymentTarget.fine}
          mode={paymentTarget.mode}
        />
      )}

      {canDelete && (
        <>
          <ConfirmDialog
            open={deleteTarget != null}
            onOpenChange={(open) => {
              if (!open) setDeleteTarget(null)
            }}
            title={t('vehicles.delete')}
            description={t('vehicles.deleteConfirm')}
            confirmLabel={t('vehicles.delete')}
            destructive
            onConfirm={() => {
              if (deleteTarget) deleteFine.mutate(deleteTarget)
              setDeleteTarget(null)
            }}
          />
          <ConfirmDialog
            open={archiveTarget != null}
            onOpenChange={(open) => {
              if (!open) setArchiveTarget(null)
            }}
            title={t('vehicles.fines.archiveOne')}
            description={t('vehicles.fines.archiveOneConfirm')}
            confirmLabel={t('vehicles.fines.archive')}
            onConfirm={() => {
              if (archiveTarget) archiveOne.mutate(archiveTarget)
              setArchiveTarget(null)
            }}
          />
          <ConfirmDialog
            open={batchArchiveOpen}
            onOpenChange={setBatchArchiveOpen}
            title={t('vehicles.fines.archivePaidResultsConfirmTitle', {
              count: archivablePaid.length,
              formattedCount: isolateBidi(formatNumber(archivablePaid.length, lang)),
            })}
            description={t('vehicles.fines.archivePaidResultsConfirmDesc')}
            confirmLabel={t('vehicles.fines.archive')}
            onConfirm={() => {
              if (archivablePaid.length > 0) archiveBatch.mutate(archivablePaid)
              setBatchArchiveOpen(false)
            }}
          />
        </>
      )}
    </div>
  )
}

// ── Overview box ─────────────────────────────────────────────────────────────

function OverviewBox({
  label,
  count,
  amountFils,
  known,
  lang,
  tone,
}: {
  label: string
  count: number
  amountFils?: number
  known: boolean
  lang: string
  tone: 'warning' | 'success' | 'neutral'
}): React.JSX.Element {
  return (
    <div
      className={cn(
        'rounded-xl border p-3',
        tone === 'warning' && 'border-warning/40 bg-warning-soft',
        tone === 'success' && 'border-success/40 bg-success-soft',
        tone === 'neutral' && 'border-border bg-surface',
      )}
    >
      <p className="text-[0.68rem] font-semibold uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className="mt-1 flex flex-wrap items-baseline gap-x-2">
        {amountFils != null ? (
          <FineAmount fils={known ? amountFils : 0} size="lg" className={!known ? 'opacity-0' : undefined} />
        ) : (
          <strong className="font-mono text-lg font-semibold tabular-nums text-foreground">
            <bdi>{known ? formatNumber(count, lang) : EMPTY_VALUE}</bdi>
          </strong>
        )}
        {amountFils != null && (
          <span className="text-[0.74rem] text-muted-foreground">
            <bdi>{known ? formatNumber(count, lang) : EMPTY_VALUE}</bdi>
          </span>
        )}
      </p>
    </div>
  )
}

// ── Rows and cards ────────────────────────────────────────────────────────────

/** A digit run (plate, date) kept left-to-right inside Arabic. */
function Mono({ children }: { children: React.ReactNode }): React.JSX.Element {
  return (
    <bdi dir="ltr" className="font-mono tabular-nums">
      {children}
    </bdi>
  )
}

type Translate = (key: string, options?: Record<string, unknown>) => string

function FineLedgerRow({
  fine,
  canEdit,
  canDelete,
  busy,
  showActions,
  highlighted,
  lang,
  t,
  onEdit,
  onDelete,
  onRecordPayment,
  onAttachReceipt,
  onMarkUnpaid,
  onArchive,
  onRestore,
}: FineActionCallbacks & {
  fine: VehicleFineRead
  canEdit: boolean
  canDelete: boolean
  busy: boolean
  showActions: boolean
  highlighted: boolean
  lang: string
  t: Translate
}): React.JSX.Element {
  return (
    <TableRow
      data-fine-id={fine.id}
      tabIndex={-1}
      className={cn('outline-none', highlighted && 'bg-accent-soft')}
    >
      <TableCell className="text-[0.74rem]">
        <Mono>{formatDateTime(fine.date, fine.time)}</Mono>
      </TableCell>
      <TableCell>
        <span className="flex flex-col gap-1">
          <PlateChip plate={fine.vehicle_plate_label} size="sm" />
          <small className="text-[0.68rem] text-muted-foreground" dir="auto">
            {localized(fine.vehicle_type_ar, fine.vehicle_type_en, lang)}
          </small>
        </span>
      </TableCell>
      <TableCell>
        <span className="flex flex-col">
          <strong className="text-[0.78rem] font-semibold text-foreground" dir="auto">
            {employeeLabel(fine, lang, t('vehicles.unassigned'))}
          </strong>
          {fine.employee_id && (
            <small className="font-mono text-[0.64rem] text-muted-foreground">
              <Mono>{fine.employee_id}</Mono>
            </small>
          )}
        </span>
      </TableCell>
      <TableCell className="max-w-[16rem] text-[0.76rem]" dir="auto">
        {fine.description || fine.location || EMPTY_VALUE}
      </TableCell>
      <TableCell className="text-[0.76rem] font-medium">
        <FineAmount fils={fine.amount_fils} />
      </TableCell>
      <TableCell className="font-mono text-[0.74rem] tabular-nums">
        {formatNumber(fine.black_points, lang)}
      </TableCell>
      <TableCell>
        <div className="flex flex-col items-start gap-1">
          <VehicleStatusBadge family="payment" status={fine.payment_status} />
          {fine.receipt && (
            <VehicleFileThumb vehicleId={fine.vehicle_id} file={fine.receipt} className="h-[26px] w-[36px]" />
          )}
        </div>
      </TableCell>
      {showActions && (
        <TableCell className="text-end">
          <FineActions
            fine={fine}
            canEdit={canEdit}
            canDelete={canDelete}
            busy={busy}
            onEdit={onEdit}
            onDelete={onDelete}
            onRecordPayment={onRecordPayment}
            onAttachReceipt={onAttachReceipt}
            onMarkUnpaid={onMarkUnpaid}
            onArchive={onArchive}
            onRestore={onRestore}
          />
        </TableCell>
      )}
    </TableRow>
  )
}

function FineLedgerCard({
  fine,
  canEdit,
  canDelete,
  busy,
  highlighted,
  lang,
  t,
  onEdit,
  onDelete,
  onRecordPayment,
  onAttachReceipt,
  onMarkUnpaid,
  onArchive,
  onRestore,
}: FineActionCallbacks & {
  fine: VehicleFineRead
  canEdit: boolean
  canDelete: boolean
  busy: boolean
  highlighted: boolean
  lang: string
  t: Translate
}): React.JSX.Element {
  return (
    <article
      data-fine-id={fine.id}
      tabIndex={-1}
      className={cn(
        'rounded-xl border border-border bg-surface-raised p-3 outline-none',
        highlighted && 'bg-accent-soft',
      )}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="flex items-center gap-1.5">
            <PlateChip plate={fine.vehicle_plate_label} size="sm" />
            <small className="text-[0.68rem] text-muted-foreground" dir="auto">
              {localized(fine.vehicle_type_ar, fine.vehicle_type_en, lang)}
            </small>
          </div>
          <h3 className="mt-1.5 text-[0.82rem] font-semibold text-foreground" dir="auto">
            {employeeLabel(fine, lang, t('vehicles.unassigned'))}
          </h3>
          {fine.employee_id && (
            <p className="mt-0.5 text-[0.68rem] text-muted-foreground">
              <Mono>{fine.employee_id}</Mono>
            </p>
          )}
        </div>
        {(canEdit || canDelete) && (
          <FineActions
            fine={fine}
            canEdit={canEdit}
            canDelete={canDelete}
            busy={busy}
            onEdit={onEdit}
            onDelete={onDelete}
            onRecordPayment={onRecordPayment}
            onAttachReceipt={onAttachReceipt}
            onMarkUnpaid={onMarkUnpaid}
            onArchive={onArchive}
            onRestore={onRestore}
          />
        )}
      </div>
      <dl className="mt-2.5 grid grid-cols-3 gap-2 border-t border-hairline pt-2.5">
        <InfoItem label={t('vehicles.date')}>
          <Mono>{formatDateTime(fine.date, fine.time)}</Mono>
        </InfoItem>
        <InfoItem label={t('vehicles.amount')}>
          <FineAmount fils={fine.amount_fils} />
        </InfoItem>
        <InfoItem label={t('vehicles.blackPoints')}>
          <Mono>{formatNumber(fine.black_points, lang)}</Mono>
        </InfoItem>
      </dl>
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <VehicleStatusBadge family="payment" status={fine.payment_status} />
        {fine.receipt && (
          <VehicleFileThumb vehicleId={fine.vehicle_id} file={fine.receipt} className="h-[26px] w-[36px]" />
        )}
      </div>
      {(fine.description || fine.location) && (
        <p className="mt-2 text-[0.7rem] text-muted-foreground" dir="auto">
          {fine.description || fine.location}
        </p>
      )}
    </article>
  )
}

function InfoItem({ label, children }: { label: string; children: React.ReactNode }): React.JSX.Element {
  return (
    <div className="flex flex-col gap-0.5">
      <dt className="text-[0.64rem] text-muted-foreground">{label}</dt>
      <dd className="text-[0.78rem] font-medium text-foreground">{children}</dd>
    </div>
  )
}
