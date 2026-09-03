/**
 * EvgFetchDialog — pull fines from the Emirates Vehicle Gate and file the ones
 * that belong to the fleet.
 *
 * Two steps, because a fetch is a real network trip (a headless browser drives
 * evg.ae, up to two minutes) and its result is a proposal, not a fact:
 *
 *   1. Which traffic codes to search. The fleet's distinct codes, all selected
 *      — the normal case is "everything" — and each one is a toggle for the
 *      rare narrow re-fetch. No codes, no request.
 *   2. What the gate returned, one row per ticket, matched to a vehicle by
 *      plate. Only `matched` rows arrive checked; `ambiguous` and `unmatched`
 *      rows cannot be checked at all until the operator names the vehicle,
 *      because a fine without a vehicle has nowhere to be filed (the API
 *      rejects such a row with `EVG_ROW_UNMATCHED` before inserting anything).
 *      `already_imported` rows are shown and locked: seeing that yesterday's
 *      tickets are already on file is why the operator can trust the count.
 *
 * The row objects are passed back to `confirm` verbatim (plus the resolved
 * `vehicle_id`) — amount-after-discount, fine type and the violation
 * description all travel with them even where the table has no column for
 * them, so the stored fine carries everything the gate said.
 *
 * A failed fetch is usually EVG talking, not us: the 502 carries the page's own
 * visible text ("The vehicle does not belong to TCF owner"), which is quoted
 * verbatim under the translated sentence — it is the only thing that tells the
 * operator whether to retry, fix a traffic code, or call the driver.
 */

import { useId, useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  AlertTriangle,
  Car,
  CheckCircle2,
  DownloadCloud,
  FileCheck,
  HelpCircle,
  Loader2,
} from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { EmptyState } from '@/components/ui/empty-state'
import { Skeleton } from '@/components/ui/skeleton'
import {
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { ApiError, api } from '@/lib/api'
import type { EvgConfirmRequest, EvgPreviewResponse, EvgPreviewRow } from '@/lib/api'
import { useIsMobile } from '@/lib/useIsMobile'
import { cn } from '@/lib/utils'

import {
  EMPTY_VALUE,
  VEHICLE_QUERY_KEYS,
  formatAed,
  formatDateTime,
  formatNumber,
  invalidateVehicleQueries,
  plateLabel,
  vehicleErrorMessage,
  type VehicleTone,
} from '../vehicleUtils'
import { PlateChip } from './PlateChip'
import {
  VehicleDialogBody,
  VehicleDialogFooter,
  VehicleDialogShell,
  VehicleFormAlert,
} from './VehicleDialogShell'

type ConfirmRow = EvgConfirmRequest['rows'][number]
type MatchState = EvgPreviewRow['match']

/** The dialog always offers the whole fleet's codes, whatever the ledger
 *  filters behind it are narrowed to — and shares the hub's cache entry for
 *  that same unfiltered request. */
const FLEET_PARAMS = { expiry: 'all' } as const

const MATCH_LABEL_KEYS: Record<MatchState, string> = {
  matched: 'vehicles.evg.matched',
  ambiguous: 'vehicles.evg.ambiguous',
  unmatched: 'vehicles.evg.unmatched',
  already_imported: 'vehicles.evg.alreadyImported',
}

const MATCH_TONES: Record<MatchState, VehicleTone> = {
  matched: 'active',
  ambiguous: 'warning',
  unmatched: 'danger',
  already_imported: 'outline',
}

const MATCH_ICONS = {
  matched: CheckCircle2,
  ambiguous: HelpCircle,
  unmatched: AlertTriangle,
  already_imported: FileCheck,
} as const

/** Same chrome as the ledger's own filter select (VehiclesHubPage): a native
 *  control, so a 50-row preview does not mount 50 popovers. */
const SELECT_CLASS =
  'h-8 min-w-[9.5rem] max-w-full rounded-md border border-input bg-surface px-2 text-[0.76rem] text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:ring-offset-background'

const CHECKBOX_CLASS =
  'h-4 w-4 shrink-0 rounded border-input accent-primary disabled:cursor-not-allowed disabled:opacity-40'

interface Props {
  open: boolean
  onOpenChange: (open: boolean) => void
}

export function EvgFetchDialog({ open, onOpenChange }: Props): React.JSX.Element {
  const { t } = useTranslation()
  // The panel owns the fetch and the import; the shell owns dismissal, and
  // refuses it while either is in flight.
  const [busy, setBusy] = useState(false)
  return (
    <VehicleDialogShell
      open={open}
      onOpenChange={onOpenChange}
      title={t('vehicles.evg.title')}
      description={t('vehicles.evg.desc')}
      size="xl"
      busy={busy}
    >
      <EvgPanel onClose={() => onOpenChange(false)} onBusyChange={setBusy} />
    </VehicleDialogShell>
  )
}

function EvgPanel({
  onClose,
  onBusyChange,
}: {
  onClose: () => void
  onBusyChange: (busy: boolean) => void
}): React.JSX.Element {
  const { t, i18n } = useTranslation()
  const lang = i18n.language
  const queryClient = useQueryClient()
  const isMobile = useIsMobile()
  const baseId = useId()
  const alertId = `${baseId}-alert`
  const codesLabelId = `${baseId}-codes`

  /** `null` = every code the fleet has, including ones that arrive later. */
  const [pickedCodes, setPickedCodes] = useState<readonly string[] | null>(null)
  const [preview, setPreview] = useState<EvgPreviewResponse | null>(null)
  /** Operator-resolved vehicle per ticket — only `ambiguous`/`unmatched` rows
   *  ever get an entry here. */
  const [assigned, setAssigned] = useState<Record<string, number>>({})
  /** Explicit check state; a missing entry falls back to the row's own match. */
  const [checked, setChecked] = useState<Record<string, boolean>>({})
  const [error, setError] = useState<string | null>(null)
  const [errorDetail, setErrorDetail] = useState<string | null>(null)

  const fleetQuery = useQuery({
    queryKey: [...VEHICLE_QUERY_KEYS.list, FLEET_PARAMS],
    queryFn: () => api.listVehicles(FLEET_PARAMS),
  })

  /** The fleet's distinct codes in ledger order — one chip each, however many
   *  vehicles share a code. */
  const fleetCodes = useMemo(
    () => [...new Set((fleetQuery.data ?? []).map((vehicle) => vehicle.traffic_code))],
    [fleetQuery.data],
  )

  const activeCodes = pickedCodes ?? fleetCodes

  const fail = (err: unknown): void => {
    const text = vehicleErrorMessage(err, t)
    const detail =
      err instanceof ApiError && typeof err.details.text === 'string' ? err.details.text : null
    setError(text)
    setErrorDetail(detail && detail.trim() ? detail.trim() : null)
    toast.error(text)
  }

  const clearError = (): void => {
    setError(null)
    setErrorDetail(null)
  }

  const previewMutation = useMutation({
    mutationFn: (traffic_codes: string[]) => api.evgPreview({ traffic_codes }),
    onMutate: () => {
      onBusyChange(true)
      clearError()
    },
    onSettled: () => onBusyChange(false),
    onSuccess: (data) => {
      setPreview(data)
      setAssigned({})
      setChecked({})
    },
    onError: fail,
  })

  const confirmMutation = useMutation({
    mutationFn: (rows: ConfirmRow[]) => api.evgConfirm({ rows }),
    onMutate: () => {
      onBusyChange(true)
      clearError()
    },
    onSettled: () => onBusyChange(false),
    onSuccess: (result) => {
      // Imported fines change the hub summary, the ledger's fine counts and the
      // flat fines register; only a successful import closes the dialog.
      invalidateVehicleQueries(queryClient, { registers: ['fines'] })
      toast.success(
        t('vehicles.evg.imported', { created: result.created, skipped: result.skipped }),
      )
      onClose()
    },
    onError: fail,
  })

  const busy = previewMutation.isPending || confirmMutation.isPending

  /** The vehicle a row would be filed under: the operator's choice first, then
   *  whatever the server matched. `null` means the row is not fileable. */
  const vehicleIdFor = (row: EvgPreviewRow): number | null =>
    assigned[row.ticket_no] ?? row.vehicle_id

  const selectableRow = (row: EvgPreviewRow): boolean =>
    row.match !== 'already_imported' && vehicleIdFor(row) != null

  const rowChecked = (row: EvgPreviewRow): boolean =>
    selectableRow(row) && (checked[row.ticket_no] ?? row.match === 'matched')

  const setRowChecked = (row: EvgPreviewRow, next: boolean): void =>
    setChecked((current) => ({ ...current, [row.ticket_no]: next }))

  /** Naming a vehicle is also the act of accepting the row — otherwise the
   *  operator would have to click twice to say one thing. Clearing it drops
   *  the row back out of the import. */
  const assignVehicle = (row: EvgPreviewRow, value: string): void => {
    const id = Number.parseInt(value, 10)
    if (!Number.isFinite(id)) {
      setAssigned((current) => {
        const next = { ...current }
        delete next[row.ticket_no]
        return next
      })
      setRowChecked(row, false)
      return
    }
    setAssigned((current) => ({ ...current, [row.ticket_no]: id }))
    setRowChecked(row, true)
  }

  const rows = preview?.rows ?? []
  /** The payload, in the gate's own row order: checked rows only, each with the
   *  vehicle it resolved to. Cheap enough to derive every render (a fetch is
   *  tens of rows), and never stale against the two selection records. */
  const selectedRows: ConfirmRow[] = rows.flatMap((row) => {
    const vehicleId = vehicleIdFor(row)
    if (!rowChecked(row) || vehicleId == null) return []
    return [{ ...row, vehicle_id: vehicleId }]
  })

  const selectedTotal = selectedRows.reduce((sum, row) => sum + row.amount, 0)

  const plateById = useMemo(() => {
    const map = new Map<number, string>()
    for (const vehicle of preview?.vehicles ?? []) map.set(vehicle.id, vehicle.plate_label)
    return map
  }, [preview])

  const backToCodes = (): void => {
    setPreview(null)
    setAssigned({})
    setChecked({})
    clearError()
  }

  const errorRegion = (
    <>
      <VehicleFormAlert id={alertId} message={error} />
      {errorDetail && (
        <p
          dir="auto"
          className="whitespace-pre-line break-words rounded-md border border-hairline bg-surface-raised px-3 py-2 font-mono text-[0.7rem] leading-relaxed text-muted-foreground"
        >
          {errorDetail}
        </p>
      )}
    </>
  )

  // ── Step 1: which traffic codes ───────────────────────────────────────────
  if (!preview) {
    return (
      <>
        <VehicleDialogBody>
          {errorRegion}

          {fleetQuery.isError ? (
            <EmptyState
              icon={Car}
              message={t('common.loadError')}
              actionLabel={t('common.retry')}
              onAction={() => void fleetQuery.refetch()}
            />
          ) : fleetQuery.isLoading ? (
            <div className="flex flex-col gap-2">
              <Skeleton className="h-4 w-28" />
              <div className="flex flex-wrap gap-1.5">
                <Skeleton className="h-7 w-28 rounded-full" />
                <Skeleton className="h-7 w-28 rounded-full" />
                <Skeleton className="h-7 w-28 rounded-full" />
              </div>
            </div>
          ) : fleetCodes.length === 0 ? (
            <EmptyState
              icon={Car}
              message={t('vehicles.noVehicles')}
              description={t('vehicles.addVehicleServiceDesc')}
            />
          ) : (
            <>
              <div className="flex flex-col gap-2">
                <span id={codesLabelId} className="text-[0.78rem] font-semibold text-foreground">
                  {t('vehicles.evg.trafficCodes')}
                </span>
                <div className="flex flex-wrap gap-1.5" role="group" aria-labelledby={codesLabelId}>
                  {fleetCodes.map((code) => {
                    const on = activeCodes.includes(code)
                    return (
                      <button
                        key={code}
                        type="button"
                        aria-pressed={on}
                        disabled={busy}
                        onClick={() =>
                          setPickedCodes(
                            on
                              ? activeCodes.filter((entry) => entry !== code)
                              : [...activeCodes, code],
                          )
                        }
                        className={cn(
                          'rounded-full border px-3 py-1 font-mono text-[0.72rem] font-medium tabular-nums transition-colors',
                          'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:ring-offset-surface',
                          'disabled:cursor-not-allowed disabled:opacity-60 motion-reduce:transition-none',
                          on
                            ? 'border-primary bg-primary-soft text-primary'
                            : 'border-border bg-surface text-muted-foreground hover:border-border-strong hover:text-foreground',
                        )}
                      >
                        <bdi dir="ltr">{code}</bdi>
                      </button>
                    )
                  })}
                </div>
              </div>

              {previewMutation.isPending && (
                <p
                  role="status"
                  className="flex items-center gap-2 rounded-md border border-border bg-surface-raised px-3 py-2.5 text-[0.76rem] text-muted-foreground"
                >
                  <Loader2
                    aria-hidden
                    strokeWidth={1.8}
                    className="h-3.5 w-3.5 shrink-0 animate-spin motion-reduce:animate-none"
                  />
                  <span dir="auto">{t('vehicles.evg.fetching')}</span>
                </p>
              )}
            </>
          )}
        </VehicleDialogBody>

        <VehicleDialogFooter>
          <Button type="button" variant="secondary" onClick={onClose} disabled={busy}>
            {t('vehicles.cancel')}
          </Button>
          {fleetCodes.length > 0 && (
            <Button
              type="button"
              disabled={busy || activeCodes.length === 0}
              onClick={() => previewMutation.mutate([...activeCodes])}
            >
              <DownloadCloud className="h-3.5 w-3.5" aria-hidden />
              {previewMutation.isPending ? t('common.loading') : t('vehicles.evg.fetch')}
            </Button>
          )}
        </VehicleDialogFooter>
      </>
    )
  }

  // ── Step 2: what the gate returned ────────────────────────────────────────
  return (
    <>
      <VehicleDialogBody>
        {errorRegion}

        {rows.length === 0 ? (
          <EmptyState
            icon={DownloadCloud}
            message={t('vehicles.evg.noRows')}
            description={activeCodes.join(' · ')}
          />
        ) : (
          <>
            <div className="flex flex-wrap items-center justify-between gap-2 text-[0.74rem] text-muted-foreground">
              <span dir="auto">
                {t('vehicles.selectedSummary', {
                  count: selectedRows.length,
                  total: formatNumber(selectedTotal, lang),
                })}
              </span>
              <span dir="auto">
                <bdi>{`${formatNumber(rows.length, lang)} ${t('vehicles.records')}`}</bdi>
              </span>
            </div>

            {isMobile ? (
              <div className="flex flex-col gap-2.5">
                {rows.map((row) => (
                  <EvgCard
                    key={row.ticket_no}
                    row={row}
                    checked={rowChecked(row)}
                    selectable={selectableRow(row)}
                    vehicleId={vehicleIdFor(row)}
                    plateById={plateById}
                    options={preview.vehicles}
                    busy={busy}
                    onToggle={(next) => setRowChecked(row, next)}
                    onAssign={(value) => assignVehicle(row, value)}
                  />
                ))}
              </div>
            ) : (
              <div className="w-full overflow-x-auto rounded-lg border border-border">
                <table className="w-full min-w-[940px] text-sm">
                  <TableHeader>
                    <TableRow>
                      <TableHead className="w-9">
                        <span className="sr-only">{t('vehicles.selectedFines')}</span>
                      </TableHead>
                      <TableHead>{t('vehicles.evg.sourceRow')}</TableHead>
                      <TableHead>{t('vehicles.plate')}</TableHead>
                      <TableHead>{t('vehicles.date')}</TableHead>
                      <TableHead>{t('vehicles.amount')}</TableHead>
                      <TableHead>{t('vehicles.points')}</TableHead>
                      <TableHead>{t('vehicles.description')}</TableHead>
                      <TableHead>{t('vehicles.selectedVehicle')}</TableHead>
                      <TableHead>{t('vehicles.status')}</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {rows.map((row) => (
                      <EvgRow
                        key={row.ticket_no}
                        row={row}
                        checked={rowChecked(row)}
                        selectable={selectableRow(row)}
                        vehicleId={vehicleIdFor(row)}
                        plateById={plateById}
                        options={preview.vehicles}
                        busy={busy}
                        onToggle={(next) => setRowChecked(row, next)}
                        onAssign={(value) => assignVehicle(row, value)}
                      />
                    ))}
                  </TableBody>
                </table>
              </div>
            )}
          </>
        )}
      </VehicleDialogBody>

      <VehicleDialogFooter>
        <Button type="button" variant="ghost" onClick={backToCodes} disabled={busy}>
          {t('common.previous')}
        </Button>
        <Button type="button" variant="secondary" onClick={onClose} disabled={busy}>
          {t('vehicles.close')}
        </Button>
        {rows.length > 0 && (
          <Button
            type="button"
            disabled={busy || selectedRows.length === 0}
            onClick={() => confirmMutation.mutate(selectedRows)}
          >
            {confirmMutation.isPending
              ? t('common.saving')
              : t('vehicles.evg.willAdd', { count: selectedRows.length })}
          </Button>
        )}
      </VehicleDialogFooter>
    </>
  )
}

interface RowProps {
  row: EvgPreviewRow
  checked: boolean
  selectable: boolean
  vehicleId: number | null
  plateById: Map<number, string>
  options: EvgPreviewResponse['vehicles']
  busy: boolean
  onToggle: (next: boolean) => void
  onAssign: (value: string) => void
}

function MatchBadge({ match }: { match: MatchState }): React.JSX.Element {
  const { t } = useTranslation()
  const Icon = MATCH_ICONS[match]
  return (
    <Badge tone={MATCH_TONES[match]}>
      <Icon aria-hidden strokeWidth={2} className="h-3 w-3 shrink-0" />
      {t(MATCH_LABEL_KEYS[match])}
    </Badge>
  )
}

/** The checkbox is the only thing that puts a row in the payload, so it is
 *  disabled — not merely unchecked — for a row that has no vehicle yet, and for
 *  a ticket that is already on file. */
function RowCheckbox({
  row,
  checked,
  selectable,
  busy,
  onToggle,
}: Pick<RowProps, 'row' | 'checked' | 'selectable' | 'busy' | 'onToggle'>): React.JSX.Element {
  const { t } = useTranslation()
  return (
    <input
      type="checkbox"
      className={CHECKBOX_CLASS}
      aria-label={`${t('vehicles.evg.sourceRow')} ${row.ticket_no}`}
      checked={checked}
      disabled={!selectable || busy}
      onChange={(event) => onToggle(event.target.checked)}
    />
  )
}

/** A resolved plate for the rows the server settled, a picker for the ones it
 *  could not. `already_imported` rows keep the chip: the vehicle is a fact. */
function VehicleResolution({
  row,
  vehicleId,
  plateById,
  options,
  busy,
  onAssign,
}: Pick<
  RowProps,
  'row' | 'vehicleId' | 'plateById' | 'options' | 'busy' | 'onAssign'
>): React.JSX.Element {
  const { t } = useTranslation()
  const resolvedPlate = vehicleId != null ? plateById.get(vehicleId) : undefined

  if (row.match === 'matched' || row.match === 'already_imported') {
    return <PlateChip plate={resolvedPlate ?? plateLabel(row)} size="sm" />
  }

  return (
    <select
      className={SELECT_CLASS}
      aria-label={t('vehicles.evg.chooseVehicle')}
      disabled={busy}
      value={vehicleId != null ? String(vehicleId) : ''}
      onChange={(event) => onAssign(event.target.value)}
    >
      <option value="">{t('vehicles.evg.chooseVehicle')}</option>
      {options.map((option) => (
        <option key={option.id} value={String(option.id)}>
          {option.plate_label}
        </option>
      ))}
    </select>
  )
}

function EvgRow(props: RowProps): React.JSX.Element {
  const { row } = props
  const { i18n } = useTranslation()
  const lang = i18n.language
  return (
    <TableRow className={cn(row.match === 'already_imported' && 'opacity-60')}>
      <TableCell className="w-9">
        <RowCheckbox {...props} />
      </TableCell>
      <TableCell className="font-mono text-[0.72rem] text-muted-foreground">
        <bdi dir="ltr">{row.ticket_no}</bdi>
      </TableCell>
      <TableCell>
        <PlateChip plate={plateLabel(row)} size="sm" />
      </TableCell>
      <TableCell className="font-mono text-[0.72rem] text-foreground">
        <bdi dir="ltr">{formatDateTime(row.date, row.time)}</bdi>
      </TableCell>
      <TableCell className="text-[0.76rem] font-semibold text-foreground">
        <bdi>{formatAed(row.amount, lang)}</bdi>
      </TableCell>
      <TableCell className="font-mono text-[0.74rem] tabular-nums text-foreground">
        <bdi>{formatNumber(row.black_points, lang)}</bdi>
      </TableCell>
      <TableCell className="max-w-[16rem] text-[0.74rem] text-muted-foreground">
        <span className="line-clamp-2" dir="auto" title={row.description ?? undefined}>
          {row.description || EMPTY_VALUE}
        </span>
      </TableCell>
      <TableCell>
        <VehicleResolution {...props} />
      </TableCell>
      <TableCell>
        <MatchBadge match={row.match} />
      </TableCell>
    </TableRow>
  )
}

function EvgCard(props: RowProps): React.JSX.Element {
  const { row } = props
  const { t, i18n } = useTranslation()
  const lang = i18n.language
  return (
    <article
      className={cn(
        'rounded-xl border border-border bg-surface-raised p-3',
        row.match === 'already_imported' && 'opacity-60',
      )}
    >
      <div className="flex items-start gap-2.5">
        <RowCheckbox {...props} />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <PlateChip plate={plateLabel(row)} size="sm" />
            <MatchBadge match={row.match} />
          </div>
          <p className="mt-1.5 font-mono text-[0.68rem] text-muted-foreground">
            <bdi dir="ltr">{`${t('vehicles.evg.sourceRow')} ${row.ticket_no}`}</bdi>
          </p>
        </div>
      </div>

      <dl className="my-2.5 grid grid-cols-2 gap-2 border-y border-hairline py-2.5">
        <div className="min-w-0">
          <dt className="text-[0.63rem] uppercase tracking-[0.06em] text-muted-foreground">
            {t('vehicles.date')}
          </dt>
          <dd className="mt-0.5 font-mono text-[0.74rem] text-foreground">
            <bdi dir="ltr">{formatDateTime(row.date, row.time)}</bdi>
          </dd>
        </div>
        <div className="min-w-0">
          <dt className="text-[0.63rem] uppercase tracking-[0.06em] text-muted-foreground">
            {t('vehicles.amount')}
          </dt>
          <dd className="mt-0.5 text-[0.76rem] font-semibold text-foreground">
            <bdi>{`${formatAed(row.amount, lang)} · ${formatNumber(row.black_points, lang)} ${t('vehicles.points')}`}</bdi>
          </dd>
        </div>
      </dl>

      <p className="text-[0.74rem] text-muted-foreground" dir="auto">
        {row.description || EMPTY_VALUE}
      </p>

      <div className="mt-2.5">
        <VehicleResolution {...props} />
      </div>
    </article>
  )
}
