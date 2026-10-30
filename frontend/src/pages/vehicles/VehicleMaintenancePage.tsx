/** Monthly fleet mileage and maintenance records, sharing the selected month. */

import { useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ChevronLeft, ChevronRight, FileText, Gauge, Trash2, Wrench } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { Link } from 'react-router-dom'
import { toast } from '@/lib/toast'

import { FileTypeIcon } from '@/components/ledger/FileTypeIcon'
import { RefreshButton } from '@/components/refresh/RefreshButton'
import { Button } from '@/components/ui/button'
import { buttonVariants } from '@/components/ui/button-variants'
import { ConfirmDialog } from '@/components/ui/confirm-dialog'
import { DocumentViewerDialog } from '@/components/ui/document-viewer-dialog'
import type { DocViewerItem } from '@/components/ui/document-viewer-dialog'
import { EmptyState } from '@/components/ui/empty-state'
import { SkeletonRow } from '@/components/ui/skeleton'
import { TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { api } from '@/lib/api'
import type { VehicleMaintenanceRead } from '@/lib/api'
import { toBase64Url } from '@/lib/pdf'
import { useCapabilities } from '@/lib/useCapabilities'
import { useIsMobile } from '@/lib/useIsMobile'
import { cn } from '@/lib/utils'
import { useSearchParam } from '@/lib/urlState'
import { formatNumber, isArabic, localized } from '@/lib/language'
import { MonthSwitcher } from '@/pages/application/statistics/MonthSwitcher'
import { monthKey, parseMonthKey } from '@/pages/application/statistics/registerModel'

import {
  EMPTY_VALUE,
  VEHICLE_QUERY_KEYS,
  formatAed,
  formatIsoDate,
  invalidateVehicleQueries,
  vehicleErrorMessage,
} from './vehicleUtils'
import { MaintenanceDialog } from './components/MaintenanceDialog'
import { PlateChip } from './components/PlateChip'
import { TabChip } from './components/TabChip'
import { OdometerLog } from './components/OdometerLog'
import { OdometerFormDialog } from './components/OdometerFormDialog'
import { VehicleStatusBadge } from './components/VehicleStatusBadge'

/** Stable empty list, so a pending or failed fetch does not re-run the counting
 *  memo against a fresh `[]` on every render. */
const NO_RECORDS: readonly VehicleMaintenanceRead[] = []

export function VehicleMaintenancePage(): React.JSX.Element {
  const { t, i18n } = useTranslation()
  const lang = i18n.language
  const isAr = isArabic(lang)
  const queryClient = useQueryClient()
  const { has } = useCapabilities()
  const canEdit = has('vehicles.edit')
  const canDelete = has('vehicles.delete')
  const isMobile = useIsMobile()

  const [addOpen, setAddOpen] = useState(false)
  const [printOpen, setPrintOpen] = useState(false)
  const now = new Date()
  const [rawMonth, setMonth] = useSearchParam('month')
  const coordinate = parseMonthKey(rawMonth) ?? { year: now.getFullYear(), month: now.getMonth() + 1 }
  const month = monthKey(coordinate.year, coordinate.month)
  const [rawTab, setTab] = useSearchParam('tab', { fallback: 'log' })
  const tab = rawTab === 'records' ? 'records' : 'log'
  const [recordsScope, setRecordsScope] = useSearchParam('records')
  const recordsMonth = recordsScope === 'all' ? undefined : month
  const odometerQuery = useQuery({
    queryKey: VEHICLE_QUERY_KEYS.odometer(month),
    queryFn: () => api.getVehicleOdometer(month),
    enabled: tab === 'log',
  })
  const [recordToDelete, setRecordToDelete] = useState<VehicleMaintenanceRead | null>(null)

  const recordsQuery = useQuery({
    queryKey: VEHICLE_QUERY_KEYS.maintenance(recordsMonth),
    queryFn: () => api.listVehicleMaintenance(recordsMonth),
    enabled: tab === 'records',
  })

  const deleteRecord = useMutation({
    mutationFn: (target: { vehicleId: number; maintenanceId: number }) =>
      api.deleteVehicleMaintenance(target.vehicleId, target.maintenanceId),
    onSuccess: (_result, target) => {
      invalidateVehicleQueries(queryClient, {
        vehicleId: target.vehicleId,
        registers: ['maintenance'],
      })
      toast.success(t('common.deletedToast'))
    },
    onError: (err) => toast.error(vehicleErrorMessage(err, t)),
  })

  const records = recordsQuery.data ?? NO_RECORDS

  /** The two figures the register exists to answer, from the server's own
   *  `due_state` — never re-derived from `next_due` here, which would let the
   *  page and the reminder disagree about the same date. */
  const counts = useMemo(() => {
    let overdue = 0
    let due = 0
    for (const record of records) {
      if (record.due_state === 'overdue') overdue += 1
      else if (record.due_state === 'due') due += 1
    }
    return { overdue, due }
  }, [records])

  return (
    <div className="flex flex-1 flex-col overflow-hidden bg-background">
      <header className="shrink-0 px-4 pb-2 pt-3 md:px-6 md:pb-3 md:pt-5">
        <Link
          to="/vehicles"
          className="inline-flex items-center gap-1.5 text-[0.8em] font-medium text-primary transition-colors hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:ring-offset-background motion-reduce:transition-none"
        >
          {/* The chevron points the way back, which is rightwards in Arabic. */}
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
              {t('vehicles.maintenanceTitle')}
            </h1>
            <p className="mt-1 hidden text-[0.84em] text-muted-foreground md:block">
              {t('vehicles.maintenanceDesc')}
            </p>
          </div>

          <div className="flex shrink-0 flex-wrap items-center gap-2">
            {canEdit && (tab === 'log' ? (
              <Button type="button" size="sm" disabled={!odometerQuery.isSuccess} onClick={() => setPrintOpen(true)}>
                <FileText className="h-3.5 w-3.5" aria-hidden />
                {t('vehicles.printOdometerForm')}
              </Button>
            ) : (
              <Button type="button" size="sm" onClick={() => setAddOpen(true)}>
                <Wrench className="h-3.5 w-3.5" aria-hidden />
                {t('vehicles.addMaintenance')}
              </Button>
            ))}
            <RefreshButton />
          </div>
        </div>
        <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
          <MonthSwitcher
            {...coordinate}
            onChange={(next) => setMonth(monthKey(next.year, next.month))}
            labels={{ previous: t('vehicles.previousMonth'), next: t('vehicles.nextMonth'), label: t('vehicles.month') }}
          />
          <div role="group" aria-label={t('vehicles.maintenanceTitle')} className="flex flex-wrap gap-1.5">
            <TabChip active={tab === 'log'} label={t('vehicles.monthlyLog')} onClick={() => setTab('log')} />
            <TabChip active={tab === 'records'} label={t('vehicles.maintenanceRecords')} onClick={() => setTab('records')} />
          </div>
        </div>
      </header>

      <div className="flex-1 overflow-y-auto px-4 pb-24 md:px-6">
        {tab === 'log' ? (
          odometerQuery.isError ? (
            <EmptyState icon={Gauge} message={t('common.loadError')} actionLabel={t('common.retry')} onAction={() => void odometerQuery.refetch()} />
          ) : odometerQuery.isPending ? (
            <div className="rounded-xl border border-border bg-surface">{Array.from({ length: 5 }, (_, index) => <SkeletonRow key={index} cols={6} />)}</div>
          ) : (
            <OdometerLog data={odometerQuery.data} canEdit={canEdit} isMobile={isMobile} />
          )
        ) : <>
        <label className="mb-4 flex w-fit items-center gap-2 text-sm">
          <input type="checkbox" checked={recordsScope === 'all'} onChange={(event) => setRecordsScope(event.target.checked ? 'all' : null)} />
          {t('vehicles.allMonths')}
        </label>
        <dl className="mb-4 grid grid-cols-2 gap-2.5 sm:max-w-[26rem]">
          <SummaryBox
            state="overdue"
            count={counts.overdue}
            known={recordsQuery.isSuccess}
            lang={lang}
          />
          <SummaryBox
            state="due"
            count={counts.due}
            known={recordsQuery.isSuccess}
            lang={lang}
          />
        </dl>

        {recordsQuery.isError ? (
          <div className="rounded-xl border border-border bg-surface">
            <EmptyState
              icon={Wrench}
              message={t('common.loadError')}
              actionLabel={t('common.retry')}
              onAction={() => void recordsQuery.refetch()}
            />
          </div>
        ) : recordsQuery.isLoading ? (
          <div className="overflow-hidden rounded-xl border border-border bg-surface">
            {Array.from({ length: 5 }).map((_, index) => (
              <SkeletonRow key={index} cols={6} />
            ))}
          </div>
        ) : records.length === 0 ? (
          <div className="rounded-xl border border-border bg-surface">
            <EmptyState
              icon={Wrench}
              message={t('vehicles.noMaintenance')}
              // The empty register says what to do next instead of only that it
              // is empty — but only to an operator who may actually do it.
              description={canEdit ? t('vehicles.addMaintenanceDesc') : undefined}
              actionLabel={canEdit ? t('vehicles.addMaintenance') : undefined}
              onAction={canEdit ? () => setAddOpen(true) : undefined}
            />
          </div>
        ) : (
          <section className="overflow-hidden rounded-xl border border-border bg-surface">
            <header className="flex flex-wrap items-center justify-between gap-2 border-b border-hairline px-3 py-2.5">
              <p className="text-[0.72rem] text-muted-foreground">
                <bdi>{`${formatNumber(records.length, lang)} ${t('vehicles.records')}`}</bdi>
              </p>
            </header>

            {isMobile ? (
              <div className="flex flex-col gap-2.5 p-2.5">
                {records.map((record) => (
                  <MaintenanceRecordCard
                    key={record.id}
                    record={record}
                    canDelete={canDelete}
                    busy={deleteRecord.isPending}
                    onDelete={setRecordToDelete}
                  />
                ))}
              </div>
            ) : (
              /* The panel already draws the frame, so this uses the cell
                 primitives without `<Table>`'s own bordered wrapper — the same
                 in-panel table shape as the fleet ledger. */
              <div className="w-full overflow-x-auto">
                <table className="w-full min-w-[960px] text-sm">
                  <caption className="sr-only">{t('vehicles.maintenanceTitle')}</caption>
                  <TableHeader>
                    <TableRow>
                      <TableHead>{t('vehicles.plate')}</TableHead>
                      <TableHead>{t('vehicles.date')}</TableHead>
                      <TableHead>{t('vehicles.maintenanceType')}</TableHead>
                      <TableHead>{t('vehicles.odometer')}</TableHead>
                      <TableHead>{t('vehicles.cost')}</TableHead>
                      <TableHead>{t('vehicles.garage')}</TableHead>
                      <TableHead>{t('vehicles.nextDue')}</TableHead>
                      <TableHead className="w-[80px]">{t('vehicles.receipt')}</TableHead>
                      <TableHead className="text-end">{t('vehicles.action')}</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {records.map((record) => (
                      <MaintenanceRecordRow
                        key={record.id}
                        record={record}
                        canDelete={canDelete}
                        busy={deleteRecord.isPending}
                        onDelete={setRecordToDelete}
                      />
                    ))}
                  </TableBody>
                </table>
              </div>
            )}
          </section>
        )}
        </>}
      </div>

      {/* The dialog owns its own mutation, toast and invalidation; the register
          only owns whether it is open. No vehicle is passed, so it offers the
          fleet picker. */}
      {canEdit && <MaintenanceDialog open={addOpen} onOpenChange={setAddOpen} />}
      {canEdit && odometerQuery.data && (
        <OdometerFormDialog key={month} month={month} rows={odometerQuery.data.rows} open={printOpen} onOpenChange={setPrintOpen} />
      )}

      {canDelete && (
        <ConfirmDialog
          open={recordToDelete != null}
          onOpenChange={(open) => {
            if (!open) setRecordToDelete(null)
          }}
          title={t('vehicles.delete')}
          description={t('vehicles.deleteConfirm')}
          confirmLabel={t('vehicles.delete')}
          destructive
          onConfirm={() => {
            if (recordToDelete) {
              deleteRecord.mutate({
                vehicleId: recordToDelete.vehicle_id,
                maintenanceId: recordToDelete.id,
              })
            }
            setRecordToDelete(null)
          }}
        />
      )}
    </div>
  )
}

// ── Summary ─────────────────────────────────────────────────────────────────

/**
 * One of the two reminder figures. The badge carries the word and the glyph, so
 * the box never signals its meaning by colour alone; the tint is added only
 * when the count is non-zero, which is what makes a real backlog stand out from
 * a clean register.
 */
function SummaryBox({
  state,
  count,
  known,
  lang,
}: {
  state: 'overdue' | 'due'
  count: number
  /** False until the register has actually been fetched. */
  known: boolean
  lang: string
}): React.JSX.Element {
  const quiet = !known || count === 0
  return (
    <div
      className={cn(
        'flex items-center justify-between gap-3 rounded-xl border px-3.5 py-2.5 transition-colors motion-reduce:transition-none',
        quiet
          ? 'border-border bg-surface'
          : state === 'overdue'
            ? 'border-destructive/40 bg-destructive/5'
            : 'border-warning/40 bg-warning-soft',
      )}
    >
      <dt>
        <VehicleStatusBadge family="due" status={state} />
      </dt>
      <dd
        className={cn(
          'font-mono text-lg font-bold tabular-nums',
          quiet ? 'text-muted-foreground' : 'text-foreground',
        )}
      >
        {known ? formatNumber(count, lang) : EMPTY_VALUE}
      </dd>
    </div>
  )
}

// ── Rows and cards ──────────────────────────────────────────────────────────

function MaintenanceRecordRow({
  record,
  canDelete,
  busy,
  onDelete,
}: {
  record: VehicleMaintenanceRead
  canDelete: boolean
  busy: boolean
  onDelete: (record: VehicleMaintenanceRead) => void
}): React.JSX.Element {
  const { t, i18n } = useTranslation()
  const lang = i18n.language
  const plate = record.vehicle_plate_label || EMPTY_VALUE
  const vehicleType = localized(record.vehicle_type_ar, record.vehicle_type_en, lang)

  return (
    <TableRow>
      {/* Fleet-wide register: the plate alone is cryptic, so the vehicle type
          rides under it rather than costing a tenth column. */}
      <TableCell>
        <span className="flex flex-col items-start gap-1">
          <PlateChip plate={plate} size="sm" />
          {vehicleType && (
            <span className="text-[0.68rem] text-muted-foreground" dir="auto">
              {vehicleType}
            </span>
          )}
        </span>
      </TableCell>
      <TableCell className="text-[0.74rem]">
        <Mono>{formatIsoDate(record.date)}</Mono>
      </TableCell>
      <TableCell className="text-[0.76rem]" dir="auto">
        {t(`vehicles.${record.type}`)}
      </TableCell>
      <TableCell className="text-[0.74rem]">
        {record.odometer_km == null ? (
          EMPTY_VALUE
        ) : (
          <bdi>{`${formatNumber(record.odometer_km, lang)} ${t('vehicles.km')}`}</bdi>
        )}
      </TableCell>
      <TableCell className="text-[0.76rem] font-medium">
        <bdi>{formatAed(record.cost, lang)}</bdi>
      </TableCell>
      <TableCell className="text-[0.76rem]" dir="auto">
        {localized(record.vendor_ar, record.vendor_en, lang) || EMPTY_VALUE}
      </TableCell>
      <TableCell>
        <span className="flex flex-col items-start gap-1">
          <Mono>{formatIsoDate(record.next_due)}</Mono>
          {record.due_state && <VehicleStatusBadge family="due" status={record.due_state} />}
        </span>
      </TableCell>
      <TableCell>
        {record.receipt_url ? (
          <ReceiptTile url={record.receipt_url} label={t('vehicles.receipt')} />
        ) : (
          <span className="text-[0.74rem] text-muted-foreground">{EMPTY_VALUE}</span>
        )}
      </TableCell>
      <TableCell className="text-end">
        <span className="inline-flex items-center justify-end gap-1.5">
          <Link
            to={`/vehicles/${record.vehicle_id}?tab=maintenance`}
            aria-label={`${t('vehicles.open')} · ${plate}`}
            className={buttonVariants({ variant: 'secondary', size: 'sm' })}
          >
            {t('vehicles.open')}
          </Link>
          {canDelete && (
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              className="text-muted-foreground hover:text-destructive"
              disabled={busy}
              aria-label={t('vehicles.delete')}
              title={t('vehicles.delete')}
              onClick={() => onDelete(record)}
            >
              <Trash2 className="h-4 w-4" aria-hidden />
            </Button>
          )}
        </span>
      </TableCell>
    </TableRow>
  )
}

function MaintenanceRecordCard({
  record,
  canDelete,
  busy,
  onDelete,
}: {
  record: VehicleMaintenanceRead
  canDelete: boolean
  busy: boolean
  onDelete: (record: VehicleMaintenanceRead) => void
}): React.JSX.Element {
  const { t, i18n } = useTranslation()
  const lang = i18n.language
  const plate = record.vehicle_plate_label || EMPTY_VALUE
  const vehicleType = localized(record.vehicle_type_ar, record.vehicle_type_en, lang)

  return (
    <article className="rounded-xl border border-border bg-surface-raised p-3">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <h3 className="flex flex-wrap items-center gap-2 text-[0.82rem] font-semibold text-foreground">
            <PlateChip plate={plate} size="sm" />
            <span dir="auto">{t(`vehicles.${record.type}`)}</span>
          </h3>
          <p className="mt-1 flex flex-wrap items-center gap-1.5 text-[0.68rem] text-muted-foreground">
            <Mono>{formatIsoDate(record.date)}</Mono>
            {vehicleType && (
              <>
                <span aria-hidden className="text-faint">
                  ·
                </span>
                <span dir="auto">{vehicleType}</span>
              </>
            )}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-1.5">
          {record.due_state && <VehicleStatusBadge family="due" status={record.due_state} />}
          {canDelete && (
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              className="text-muted-foreground hover:text-destructive"
              disabled={busy}
              aria-label={t('vehicles.delete')}
              title={t('vehicles.delete')}
              onClick={() => onDelete(record)}
            >
              <Trash2 className="h-4 w-4" aria-hidden />
            </Button>
          )}
        </div>
      </div>

      <dl className="mt-2.5 grid grid-cols-2 gap-2 border-y border-hairline py-2.5">
        <Fact label={t('vehicles.odometer')}>
          {record.odometer_km == null ? (
            EMPTY_VALUE
          ) : (
            <bdi>{`${formatNumber(record.odometer_km, lang)} ${t('vehicles.km')}`}</bdi>
          )}
        </Fact>
        <Fact label={t('vehicles.cost')}>
          <bdi>{formatAed(record.cost, lang)}</bdi>
        </Fact>
        <Fact label={t('vehicles.garage')}>
          <span dir="auto">
            {localized(record.vendor_ar, record.vendor_en, lang) || EMPTY_VALUE}
          </span>
        </Fact>
        <Fact label={t('vehicles.nextDue')}>
          <Mono>{formatIsoDate(record.next_due)}</Mono>
        </Fact>
      </dl>

      <div className="mt-2.5 flex flex-wrap items-center justify-between gap-2">
        {record.receipt_url ? (
          <ReceiptTile url={record.receipt_url} label={t('vehicles.receipt')} />
        ) : (
          <span className="text-[0.7rem] text-muted-foreground">
            {`${t('vehicles.receipt')}: ${EMPTY_VALUE}`}
          </span>
        )}
        <Link
          to={`/vehicles/${record.vehicle_id}?tab=maintenance`}
          aria-label={`${t('vehicles.open')} · ${plate}`}
          className={buttonVariants({ variant: 'secondary', size: 'sm' })}
        >
          {t('vehicles.open')}
        </Link>
      </div>
    </article>
  )
}

// ── Small pieces ────────────────────────────────────────────────────────────

/** A digit run (plate, date, odometer) kept left-to-right inside Arabic. */
function Mono({ children }: { children: React.ReactNode }): React.JSX.Element {
  return (
    <bdi dir="ltr" className="font-mono tabular-nums">
      {children}
    </bdi>
  )
}

function Fact({
  label,
  children,
}: {
  label: string
  children: React.ReactNode
}): React.JSX.Element {
  return (
    <div className="min-w-0">
      <dt className="text-[0.63rem] uppercase tracking-[0.06em] text-muted-foreground">{label}</dt>
      <dd className="mt-0.5 break-words text-[0.78rem] font-medium text-foreground">{children}</dd>
    </div>
  )
}

/**
 * The garage receipt as a thumbnail that opens the shared lightbox.
 *
 * `VehicleMaintenanceRead` carries the file as a bare URL and no media type, so
 * the tile renders it as an image and switches to the PDF viewer when the
 * browser cannot decode it — `.pdf` is the only non-image type
 * `vehicle_service` accepts for a receipt. PDFs are read through
 * `?encoding=base64`, which the WebView2/IDM PDF handler cannot hijack.
 */
function ReceiptTile({ url, label }: { url: string; label: string }): React.JSX.Element {
  const [isPdf, setIsPdf] = useState(false)
  const [open, setOpen] = useState(false)
  const item: DocViewerItem = isPdf
    ? { name: label, kind: 'pdf', pdfBase64Url: toBase64Url(url), openUrl: url, downloadUrl: url }
    : { name: label, kind: 'image', imageUrl: url, openUrl: url, downloadUrl: url }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label={label}
        title={label}
        className={cn(
          'flex h-[38px] w-[54px] flex-col items-stretch overflow-hidden rounded-lg border border-border bg-surface-raised',
          'transition-colors hover:border-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:ring-offset-background',
          'motion-reduce:transition-none',
        )}
      >
        {isPdf ? (
          <span className="flex min-h-0 w-full flex-1 items-center justify-center p-1.5">
            <FileTypeIcon kind="pdf" size={22} />
          </span>
        ) : (
          <img
            src={url}
            alt=""
            loading="lazy"
            onError={() => setIsPdf(true)}
            className="min-h-0 w-full flex-1 object-cover"
          />
        )}
      </button>
      {open && <DocumentViewerDialog items={[item]} onClose={() => setOpen(false)} />}
    </>
  )
}
