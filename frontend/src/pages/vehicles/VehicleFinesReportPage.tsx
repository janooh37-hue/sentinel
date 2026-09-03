/**
 * Fleet fines report — `/vehicles/fines-report`.
 *
 * The one surface in the module whose product IS a sheet of paper: an
 * investigation copy of the fleet's fines, filtered by site and date range,
 * grouped per vehicle with a subtotal each and a grand total, printed on the
 * GSSG letterhead. Unlike the fines letter it mints no book — nothing is filed,
 * so the reference line reads `VF-R`, the series and nothing more: the sheet
 * already carries the day it was drawn on its own Gregorian and Hijri lines,
 * and it owns no book number.
 *
 * «Hide employee names» defaults ON, because the normal reason to print the
 * fleet-wide copy is an internal investigation and a name on a sheet that
 * leaves the office is a disclosure. When it is on, the two identifying
 * columns are not blanked — they are not rendered at all, on the paper and in
 * the mobile cards alike, so there is no path by which a name reaches the
 * printer.
 *
 * Filtering is the server's job (`GET /vehicles/fines` applies site and both
 * dates); grouping, ordering, subtotals and the grand total are derived from
 * exactly the rows that came back, so the paper can never total a set the
 * filter bar does not describe. Rows read oldest-first inside a vehicle — a
 * report is read forwards, and the per-group numbering follows the dates —
 * while the API hands them over newest-first for the registers.
 *
 * Screen/paper split is CSS, not `useIsMobile`: print has to produce the paper
 * whatever the viewport is, so the sheet is `hidden md:block print:block` and
 * the phone's record cards carry `data-print-hide`. Both actions call
 * `window.print()` — «Save PDF» is the print dialog's own PDF target, which is
 * how every other document in the app is saved.
 *
 * The paper reads Arabic in both UI languages (`lng: 'ar'`, `name_ar`,
 * `type_ar`): it is an Arabic letterhead document, the same contract
 * `PaperSheet` and the fines letter hold. Everything around it — filter bar,
 * cards, actions — follows the UI language.
 */

import { useId, useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { ChevronLeft, ChevronRight, FileDown, FileText, Printer } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { Link } from 'react-router-dom'
import { toast } from 'sonner'

import { RefreshButton } from '@/components/refresh/RefreshButton'
import { Button } from '@/components/ui/button'
import { EmptyState } from '@/components/ui/empty-state'
import { Input } from '@/components/ui/input'
import { Skeleton } from '@/components/ui/skeleton'
import { api } from '@/lib/api'
import type { VehicleFineRead, VehicleSiteRead } from '@/lib/api'
import { cn } from '@/lib/utils'

import {
  EMPTY_VALUE,
  VEHICLE_QUERY_KEYS,
  employeeLabel,
  formatAed,
  formatIsoDate,
  formatLetterAed,
  formatLetterDate,
  formatNumber,
  isArabic,
  localized,
} from './vehicleUtils'
import { PaperNote, PaperSheet, PaperTable } from './components/PaperSheet'
import { PlateChip } from './components/PlateChip'

/** The letterhead ink, as `PaperSheet` pins it: a dark-theme operator must not
 *  print near-white rules onto white paper. */
const PAPER_NAVY = '#0d2845'

/** The reference the sheet prints. The report is not a filed book, so it names
 *  its series and nothing else — the sheet's own date lines say when the copy
 *  was drawn. */
const REPORT_REFERENCE = 'VF-R'

/** Stable empty list, so a pending or failed fetch does not re-run the
 *  grouping memo against a fresh `[]` on every render. */
const NO_FINES: readonly VehicleFineRead[] = []
const NO_SITES: readonly VehicleSiteRead[] = []

/**
 * The report's columns, in the RTL sheet's own order (first cell on the right).
 * Withholding the names removes the two identifying columns instead of dashing
 * them: this sheet has no fixed template to satisfy, and a narrower table is
 * the honest shape of an anonymous report.
 */
const COLUMNS_NAMED = [
  'vehicles.sequence',
  'vehicles.employee',
  'vehicles.gNumber',
  'vehicles.paperFineDate',
  'vehicles.paperFineAmount',
  'vehicles.paperBlackPoints',
] as const
const COLUMNS_ANONYMOUS = [
  'vehicles.sequence',
  'vehicles.paperFineDate',
  'vehicles.paperFineAmount',
  'vehicles.paperBlackPoints',
] as const

/** One vehicle's block of the report. */
interface FineGroup {
  vehicleId: number
  plate: string
  /** Vehicle type in the UI language (cards) and in Arabic (paper). */
  type: string
  typeAr: string
  /** Operating site, same pair. Empty when the site is no longer listed. */
  site: string
  siteAr: string
  fines: VehicleFineRead[]
  subtotal: number
  points: number
}

/** Oldest first inside a vehicle, so the printed numbering follows the dates. */
function reportOrder(a: VehicleFineRead, b: VehicleFineRead): number {
  return a.date === b.date ? a.id - b.id : a.date < b.date ? -1 : 1
}

export function VehicleFinesReportPage(): React.JSX.Element {
  const { t, i18n } = useTranslation()
  const lang = i18n.language
  const isAr = isArabic(lang)

  const siteFieldId = useId()
  const fromFieldId = useId()
  const toFieldId = useId()
  const paperHeadingId = useId()

  const [siteId, setSiteId] = useState<number | null>(null)
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')
  // ON by default: the fleet-wide copy exists for investigations.
  const [hideNames, setHideNames] = useState(true)

  /** Exactly the query string the API is asked for — and the query key, so a
   *  filter change is a new cache entry rather than a silent overwrite. */
  const params = useMemo(() => {
    const next: { site_id?: number; date_from?: string; date_to?: string } = {}
    if (siteId != null) next.site_id = siteId
    if (from) next.date_from = from
    if (to) next.date_to = to
    return next
  }, [siteId, from, to])

  const finesQuery = useQuery({
    queryKey: [...VEHICLE_QUERY_KEYS.fines, params],
    queryFn: () => api.listVehicleFines(params),
  })
  const sitesQuery = useQuery({
    queryKey: VEHICLE_QUERY_KEYS.sites,
    queryFn: () => api.listVehicleSites(),
  })

  const fines = finesQuery.data ?? NO_FINES
  const sites = sitesQuery.data ?? NO_SITES
  const activeSites = useMemo(() => sites.filter((site) => site.active), [sites])
  const selectedSite = siteId == null ? null : (sites.find((s) => s.id === siteId) ?? null)

  const sitesById = useMemo(
    () => new Map(sites.map((site) => [site.id, site])),
    [sites],
  )

  const groups = useMemo<FineGroup[]>(() => {
    const byVehicle = new Map<number, FineGroup>()
    for (const fine of fines) {
      let group = byVehicle.get(fine.vehicle_id)
      if (!group) {
        const site = sitesById.get(fine.vehicle_site_id)
        group = {
          vehicleId: fine.vehicle_id,
          plate: fine.vehicle_plate_label,
          type: localized(fine.vehicle_type_ar, fine.vehicle_type_en, lang),
          typeAr: fine.vehicle_type_ar,
          site: site ? localized(site.name_ar, site.name_en, lang) : '',
          siteAr: site?.name_ar ?? '',
          fines: [],
          subtotal: 0,
          points: 0,
        }
        byVehicle.set(fine.vehicle_id, group)
      }
      group.fines.push(fine)
      group.subtotal += fine.amount
      group.points += fine.black_points
    }
    const list = [...byVehicle.values()]
    for (const group of list) group.fines.sort(reportOrder)
    // Site, then plate: a fleet report is read site by site, and the group
    // header names the site, so neighbouring blocks share one.
    list.sort(
      (a, b) =>
        a.site.localeCompare(b.site, lang) ||
        a.plate.localeCompare(b.plate, lang, { numeric: true }),
    )
    return list
  }, [fines, sitesById, lang])

  const grandTotal = groups.reduce((sum, group) => sum + group.subtotal, 0)
  const recordCount = groups.reduce((sum, group) => sum + group.fines.length, 0)

  /** Both actions are the same act: the browser's print dialog owns the
   *  printer and the «Save as PDF» target alike. */
  const print = (): void => {
    window.print()
    toast.success(t('vehicles.sentPrint'))
  }

  return (
    <div className="flex flex-1 flex-col overflow-hidden bg-background">
      {/* `<header>` is deleted by the global print stylesheet, which is why
          every screen-only control lives in one. */}
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
              {t('vehicles.finesReport')}
            </h1>
            <p className="mt-1 hidden text-[0.84em] text-muted-foreground md:block">
              {t('vehicles.finesReportDesc')}
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <RefreshButton />
            <Button type="button" variant="secondary" size="sm" onClick={print}>
              <Printer className="h-3.5 w-3.5" aria-hidden />
              {t('vehicles.print')}
            </Button>
            <Button type="button" size="sm" onClick={print}>
              <FileDown className="h-3.5 w-3.5" aria-hidden />
              {t('vehicles.savePdf')}
            </Button>
          </div>
        </div>
      </header>

      <div className="flex-1 overflow-y-auto px-4 pb-24 md:px-6">
        <div
          className="mb-4 rounded-xl border border-border bg-surface p-2.5"
          data-print-hide
        >
          <div className="flex flex-wrap items-end gap-2.5">
            <div className="min-w-[11rem] flex-1">
              <label
                htmlFor={siteFieldId}
                className="mb-1 block text-[0.72em] font-medium text-muted-foreground"
              >
                {t('vehicles.site')}
              </label>
              <select
                id={siteFieldId}
                className="h-9 w-full rounded-md border border-input bg-surface px-2.5 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:ring-offset-background"
                value={siteId == null ? '' : String(siteId)}
                onChange={(event) =>
                  setSiteId(event.target.value ? Number(event.target.value) : null)
                }
              >
                <option value="">{t('vehicles.allSites')}</option>
                {activeSites.map((site) => (
                  <option key={site.id} value={site.id}>
                    {localized(site.name_ar, site.name_en, lang)}
                  </option>
                ))}
              </select>
            </div>

            {/* The two bounds cap each other, so the range cannot be inverted
                into a silently empty report. */}
            <div className="min-w-[9rem]">
              <label
                htmlFor={fromFieldId}
                className="mb-1 block text-[0.72em] font-medium text-muted-foreground"
              >
                {t('vehicles.fromDate')}
              </label>
              <Input
                id={fromFieldId}
                type="date"
                className="h-9 font-mono tabular-nums"
                value={from}
                max={to || undefined}
                onChange={(event) => setFrom(event.target.value)}
              />
            </div>
            <div className="min-w-[9rem]">
              <label
                htmlFor={toFieldId}
                className="mb-1 block text-[0.72em] font-medium text-muted-foreground"
              >
                {t('vehicles.toDate')}
              </label>
              <Input
                id={toFieldId}
                type="date"
                className="h-9 font-mono tabular-nums"
                value={to}
                min={from || undefined}
                onChange={(event) => setTo(event.target.value)}
              />
            </div>

            <HideNamesSwitch checked={hideNames} onChange={setHideNames} />
          </div>
        </div>

        {finesQuery.isError || sitesQuery.isError ? (
          <div className="rounded-xl border border-border bg-surface" data-print-hide>
            <EmptyState
              icon={FileText}
              message={t('common.loadError')}
              actionLabel={t('common.retry')}
              onAction={() => {
                if (finesQuery.isError) void finesQuery.refetch()
                if (sitesQuery.isError) void sitesQuery.refetch()
              }}
            />
          </div>
        ) : finesQuery.isLoading ? (
          <div className="flex flex-col gap-3" data-print-hide>
            <Skeleton className="h-9 w-56" />
            <Skeleton className="h-[26rem] w-full" />
          </div>
        ) : (
          <>
            {/* Phone: the same report as records, plus the totals box. Never
                printed — the paper below is the document at every width. */}
            <section className="flex flex-col gap-2.5 md:hidden" data-print-hide>
              <h2 className="sr-only">{t('vehicles.finesReport')}</h2>
              {hideNames && recordCount > 0 && (
                <p className="rounded-lg border border-warning/40 bg-warning-soft px-3 py-2 text-[0.78em] leading-snug text-foreground">
                  {t('vehicles.anonymousNote')}
                </p>
              )}
              {groups.length === 0 ? (
                <div className="rounded-xl border border-border bg-surface">
                  <EmptyState
                    icon={FileText}
                    message={t('vehicles.noRecords')}
                    description={t('vehicles.adjustFilters')}
                  />
                </div>
              ) : (
                <>
                  {groups.map((group) => (
                    <RecordCard
                      key={group.vehicleId}
                      group={group}
                      hideNames={hideNames}
                      lang={lang}
                    />
                  ))}
                  <div className="flex items-baseline justify-between gap-3 rounded-xl border border-primary/30 bg-primary-soft px-3.5 py-3">
                    <strong className="text-[0.88em] font-bold text-foreground">
                      {t('vehicles.grandTotal')}
                      {': '}
                      <bdi>{formatAed(grandTotal, lang)}</bdi>
                    </strong>
                    <span className="shrink-0 text-[0.76em] text-muted-foreground">
                      <bdi>{`${formatNumber(recordCount, lang)} ${t('vehicles.records')}`}</bdi>
                    </span>
                  </div>
                </>
              )}
            </section>

            {/* The document. `print-vehicle-report` takes the named A4 page
                that carries a real per-sheet margin (index.css), and
                `print:block` is what puts the paper on the printer from a
                phone as well as from a desk. */}
            <section
              aria-labelledby={paperHeadingId}
              className="print-vehicle-report hidden overflow-hidden rounded-xl border border-border bg-surface md:block print:block print:rounded-none print:border-0"
            >
              <h2 id={paperHeadingId} className="sr-only">
                {t('vehicles.finesReport')}
              </h2>
              <div className="overflow-x-auto p-3 print:p-0">
                {/* The `print-report-*` classes carry nothing on screen: they
                    are the named hooks the print stylesheet re-declares each
                    intended fill through, since the global rule flattens every
                    background inside `#root` so the shell cannot ink a sheet. */}
                <PaperSheet
                  reference={REPORT_REFERENCE}
                  title={t('vehicles.finesReport', { lng: 'ar' })}
                  className="print-report-sheet print:w-full print:px-0"
                >
                  <ReportScope
                    site={selectedSite}
                    from={from}
                    to={to}
                    recordCount={recordCount}
                  />

                  {hideNames && (
                    <div className="print-report-note">
                      <PaperNote>{t('vehicles.anonymousNote', { lng: 'ar' })}</PaperNote>
                    </div>
                  )}

                  <ReportTable groups={groups} hideNames={hideNames} />

                  <div
                    className="mt-3 flex items-baseline justify-between gap-3 border-2 px-3 py-2 text-[0.68rem] font-bold"
                    style={{ borderColor: PAPER_NAVY }}
                  >
                    <span>
                      {t('vehicles.grandTotal', { lng: 'ar' })}
                      {': '}
                      <bdi dir="ltr">{formatLetterAed(grandTotal)}</bdi>
                    </span>
                    <span className="font-mono font-bold">
                      <bdi dir="ltr">{recordCount}</bdi>{' '}
                      {t('vehicles.records', { lng: 'ar' })}
                    </span>
                  </div>
                </PaperSheet>
              </div>
            </section>
          </>
        )}
      </div>
    </div>
  )
}

/**
 * What this copy covers, printed on the sheet itself: a filtered report whose
 * paper does not say which site and which dates it filtered is unfileable.
 * Arabic labels, Arabic site name — the sheet's own language.
 */
function ReportScope({
  site,
  from,
  to,
  recordCount,
}: {
  site: VehicleSiteRead | null
  from: string
  to: string
  recordCount: number
}): React.JSX.Element {
  const { t } = useTranslation()
  const entries: Array<{ label: string; value: string; mono?: boolean }> = [
    {
      label: t('vehicles.site', { lng: 'ar' }),
      value: site ? site.name_ar : t('vehicles.allSites', { lng: 'ar' }),
    },
  ]
  if (from) {
    entries.push({
      label: t('vehicles.fromDate', { lng: 'ar' }),
      value: formatLetterDate(from),
      mono: true,
    })
  }
  if (to) {
    entries.push({
      label: t('vehicles.toDate', { lng: 'ar' }),
      value: formatLetterDate(to),
      mono: true,
    })
  }
  entries.push({
    label: t('vehicles.records', { lng: 'ar' }),
    value: String(recordCount),
    mono: true,
  })

  return (
    <dl className="print-report-scope mb-4 flex flex-wrap items-baseline justify-center gap-x-5 gap-y-1 border border-[#333] bg-[#fafafa] px-3 py-2 text-[0.62rem]">
      {entries.map((entry) => (
        <div key={entry.label} className="flex items-baseline gap-1">
          <dt className="text-[#3c3c3c]">{entry.label}:</dt>
          <dd className={cn('font-bold', entry.mono && 'font-mono')}>
            <bdi dir={entry.mono ? 'ltr' : 'auto'}>{entry.value}</bdi>
          </dd>
        </div>
      ))}
    </dl>
  )
}

/**
 * The report table: one `<tbody>` per vehicle so a browser keeps a vehicle's
 * block on one sheet where it fits, and so the group header is a real
 * row-group header rather than a styled row. Nothing depends on a fill — the
 * print stylesheet flattens every background in `#root`, so the group and
 * subtotal lines are told apart by weight and rules.
 */
function ReportTable({
  groups,
  hideNames,
}: {
  groups: readonly FineGroup[]
  hideNames: boolean
}): React.JSX.Element {
  const { t } = useTranslation()
  const columns = hideNames ? COLUMNS_ANONYMOUS : COLUMNS_NAMED
  const cols = columns.length

  return (
    <PaperTable>
      <thead>
        <tr>
          {columns.map((key) => (
            <th key={key} scope="col">
              {t(key, { lng: 'ar' })}
            </th>
          ))}
        </tr>
      </thead>
      {groups.length === 0 ? (
        <tbody>
          <tr>
            {/* A filtered range with no fines is a valid, fileable answer, so
                the paper states it instead of printing a blank table. */}
            <td colSpan={cols}>{t('vehicles.noRecords', { lng: 'ar' })}</td>
          </tr>
        </tbody>
      ) : (
        groups.map((group) => (
          <tbody key={group.vehicleId} className="break-inside-avoid">
            <tr>
              <th scope="rowgroup" colSpan={cols} className="print-report-group !bg-[#f0efe9]">
                <bdi dir="ltr" className="font-mono">
                  {group.plate}
                </bdi>
                {' · '}
                {group.typeAr}
                {group.siteAr && ` · ${group.siteAr}`}
              </th>
            </tr>
            {group.fines.map((fine, index) => (
              <tr key={fine.id}>
                <td className="font-mono">{index + 1}</td>
                {!hideNames && (
                  <>
                    <td>
                      {fine.employee_id
                        ? fine.employee_name_ar || fine.employee_name_en || EMPTY_VALUE
                        : t('vehicles.unassigned', { lng: 'ar' })}
                    </td>
                    <td className="font-mono">
                      {fine.employee_id ? (
                        <bdi dir="ltr">{fine.employee_id}</bdi>
                      ) : (
                        EMPTY_VALUE
                      )}
                    </td>
                  </>
                )}
                <td className="font-mono">
                  <bdi dir="ltr">{formatLetterDate(fine.date)}</bdi>
                </td>
                <td>
                  <bdi dir="ltr">{formatLetterAed(fine.amount)}</bdi>
                </td>
                <td className="font-mono">{fine.black_points}</td>
              </tr>
            ))}
            <tr>
              <th scope="row" colSpan={cols - 2} className="!text-end">
                {t('vehicles.subtotal', { lng: 'ar' })}
              </th>
              <td className="font-bold">
                <bdi dir="ltr">{formatLetterAed(group.subtotal)}</bdi>
              </td>
              <td className="font-mono font-bold">{group.points}</td>
            </tr>
          </tbody>
        ))
      )}
    </PaperTable>
  )
}

/** One vehicle's block on a phone: the same rows, the same subtotal, in the UI
 *  language and the module's card grammar. */
function RecordCard({
  group,
  hideNames,
  lang,
}: {
  group: FineGroup
  hideNames: boolean
  lang: string
}): React.JSX.Element {
  const { t } = useTranslation()
  const unassigned = t('vehicles.unassigned')

  return (
    <article className="overflow-hidden rounded-xl border border-border bg-surface">
      <div className="flex items-start justify-between gap-2 border-b border-hairline px-3.5 py-2.5">
        <div className="min-w-0">
          <h3 className="flex flex-wrap items-center gap-2 text-[0.88em] font-semibold text-foreground">
            <PlateChip plate={group.plate} size="sm" />
            <span dir="auto" className="truncate">
              {group.type}
            </span>
          </h3>
          {group.site && (
            <p dir="auto" className="mt-0.5 truncate text-[0.74em] text-muted-foreground">
              {group.site}
            </p>
          )}
        </div>
        <strong className="shrink-0 text-[0.84em] font-bold text-foreground">
          <bdi>{formatAed(group.subtotal, lang)}</bdi>
        </strong>
      </div>

      <ol className="flex flex-col">
        {group.fines.map((fine, index) => (
          <li
            key={fine.id}
            className="flex items-baseline justify-between gap-3 border-b border-hairline px-3.5 py-2 last:border-b-0"
          >
            <span className="min-w-0">
              <span className="block text-[0.8em] text-foreground">
                <bdi className="font-mono tabular-nums">{index + 1}</bdi>
                <span aria-hidden> · </span>
                <bdi className="font-mono tabular-nums">{formatIsoDate(fine.date)}</bdi>
                <span aria-hidden> · </span>
                <bdi>{`${formatNumber(fine.black_points, lang)} ${t('vehicles.points')}`}</bdi>
              </span>
              {/* Rendered only when names are shown — withheld means absent,
                  not blanked. */}
              {!hideNames && (
                <span dir="auto" className="mt-0.5 block truncate text-[0.74em] text-muted-foreground">
                  {employeeLabel(fine, lang, unassigned)}
                  {fine.employee_id && (
                    <>
                      <span aria-hidden> · </span>
                      <bdi className="font-mono">{fine.employee_id}</bdi>
                    </>
                  )}
                </span>
              )}
            </span>
            <strong className="shrink-0 text-[0.8em] font-semibold text-foreground">
              <bdi>{formatAed(fine.amount, lang)}</bdi>
            </strong>
          </li>
        ))}
      </ol>
    </article>
  )
}

/**
 * «Hide employee names» in the filter bar — the app's switch grammar (a
 * `role="switch"` button with a thumb mirrored for RTL), compact because it
 * sits in a row of filters. The hint states the consequence: the label alone
 * does not say that the printed copy is the investigation copy.
 */
function HideNamesSwitch({
  checked,
  onChange,
}: {
  checked: boolean
  onChange: (next: boolean) => void
}): React.JSX.Element {
  const { t } = useTranslation()
  const label = t('vehicles.hideNames')

  return (
    <label className="flex min-w-[13rem] flex-1 items-center gap-3 rounded-md border border-hairline bg-muted/20 px-3 py-1.5">
      <span className="min-w-0">
        <span className="block text-[0.8em] font-medium text-foreground">{label}</span>
        <span className="mt-0.5 block text-[0.72em] text-muted-foreground">
          {t('vehicles.hideNamesHint')}
        </span>
      </span>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        aria-label={label}
        onClick={() => onChange(!checked)}
        className={cn(
          'relative ms-auto inline-flex h-6 w-11 shrink-0 items-center rounded-full px-0.5 transition-colors',
          'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:ring-offset-surface',
          'motion-reduce:transition-none',
          checked ? 'bg-primary' : 'bg-muted',
        )}
      >
        <span
          className={cn(
            'inline-block h-5 w-5 rounded-full bg-white shadow transition-transform motion-reduce:transition-none',
            checked ? 'translate-x-5 rtl:-translate-x-5' : 'translate-x-0',
          )}
        />
      </button>
    </label>
  )
}
