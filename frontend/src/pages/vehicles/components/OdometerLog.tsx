import { useId, useRef, useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { Gauge, Search } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'

import { EmptyState } from '@/components/ui/empty-state'
import { Input } from '@/components/ui/input'
import { TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { api, type OdometerMonthRead, type OdometerRowRead, type OdometerUpsert } from '@/lib/api'
import { normalizeDigits } from '@/lib/utils'
import { EMPTY_VALUE, formatAed, formatNumber, invalidateVehicleQueries, localized, vehicleErrorMessage } from '../vehicleUtils'
import { PlateChip } from './PlateChip'

export function OdometerLog({ data, canEdit, isMobile }: {
  data: OdometerMonthRead
  canEdit: boolean
  isMobile: boolean
}): React.JSX.Element {
  const { t, i18n } = useTranslation()
  const searchId = useId()
  const [query, setQuery] = useState('')
  const needle = searchKey(query)
  const rows = needle
    ? data.rows.filter((row) => searchKey(`${row.plate_label} ${row.vehicle_type_ar ?? ''} ${row.vehicle_type_en ?? ''}`).includes(needle))
    : data.rows
  const headings = ['plate', 'openingKm', 'closingKm', 'kmDriven', 'maintenanceCount', 'cost']
  return (
    <>
      <dl className="mb-4 flex flex-wrap gap-x-8 gap-y-3 rounded-xl border border-border bg-surface px-4 py-3">
        <div>
          <dt className="text-xs text-muted-foreground">{t('vehicles.fleetKmDriven')}</dt>
          <dd className="mt-1 font-mono font-semibold"><bdi>{formatNumber(data.total_km_driven, i18n.language)} {t('vehicles.km')}</bdi></dd>
        </div>
        <div>
          <dt className="text-xs text-muted-foreground">{t('vehicles.totalMaintenanceCost')}</dt>
          <dd className="mt-1 font-mono font-semibold"><bdi>{formatAed(data.total_maintenance_cost, i18n.language)}</bdi></dd>
        </div>
      </dl>
      {data.rows.length > 0 && (
        <div className="relative mb-4 max-w-md">
          <Search className="pointer-events-none absolute inset-y-0 start-2.5 my-auto h-3.5 w-3.5 text-muted-foreground" aria-hidden />
          <label className="sr-only" htmlFor={searchId}>{t('vehicles.odometerSearch')}</label>
          <Input
            id={searchId}
            type="search"
            className="ps-8"
            placeholder={t('vehicles.odometerSearch')}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
        </div>
      )}
      {data.rows.length === 0 ? (
        <EmptyState icon={Gauge} message={t('vehicles.noActiveVehicles')} />
      ) : rows.length === 0 ? (
        <EmptyState icon={Search} message={t('vehicles.noVehicles')} />
      ) : isMobile ? (
        <div className="flex flex-col gap-3">
          {rows.map((row) => <OdometerRow key={rowKey(row)} row={row} canEdit={canEdit} mobile />)}
        </div>
      ) : (
        <section className="overflow-x-auto rounded-xl border border-border bg-surface">
          <table className="w-full min-w-[800px] text-sm">
            <caption className="sr-only">{t('vehicles.monthlyLog')}</caption>
            <TableHeader><TableRow>{headings.map((key) => <TableHead key={key}>{t(`vehicles.${key}`)}</TableHead>)}</TableRow></TableHeader>
            <TableBody>{rows.map((row) => <OdometerRow key={rowKey(row)} row={row} canEdit={canEdit} mobile={false} />)}</TableBody>
          </table>
        </section>
      )}
    </>
  )
}

/** Plate digits match however they are typed: Arabic-Indic digits, spaces, or separators. */
function searchKey(text: string): string {
  return normalizeDigits(text).replace(/[^\p{L}\p{N}]/gu, '').toLowerCase()
}

/** Remount only when the month changes; typing in one reading must survive saving the other. */
function rowKey(row: OdometerRowRead): string {
  return `${row.month}:${row.vehicle_id}`
}

function OdometerRow({ row, canEdit, mobile }: { row: OdometerRowRead; canEdit: boolean; mobile: boolean }): React.JSX.Element {
  const { t, i18n } = useTranslation()
  const queryClient = useQueryClient()
  const [opening, setOpening] = useState(row.opening_km == null ? '' : String(row.opening_km))
  const [closing, setClosing] = useState(row.closing_km == null ? '' : String(row.closing_km))
  /** Saves run in order: tabbing from opening to closing must not let the older save land last. */
  const queue = useRef<Promise<unknown>>(Promise.resolve())
  const save = useMutation({
    mutationFn: (body: OdometerUpsert) => api.saveVehicleOdometer(row.vehicle_id, row.month, body),
    onSuccess: (saved) => {
      setOpening(saved.opening_km == null ? '' : String(saved.opening_km))
      invalidateVehicleQueries(queryClient, { vehicleId: row.vehicle_id, registers: ['odometer'] })
    },
    onError: (err) => toast.error(vehicleErrorMessage(err, t)),
  })
  const submit = () => {
    if (opening === '' && closing === '') return
    const openingKm = opening === '' ? null : Number(opening)
    const closingKm = closing === '' ? null : Number(closing)
    if (closingKm === row.closing_km && openingKm === row.opening_km) return
    if ((closing !== '' && !/^\d{1,7}$/.test(closing)) || (opening !== '' && !/^\d{1,7}$/.test(opening))) {
      toast.error(t('vehicles.odometerInvalidReading'))
      return
    }
    if (openingKm != null && closingKm != null && closingKm < openingKm) {
      toast.error(t('vehicles.odometerClosingBelowOpening'))
      return
    }
    if (row.opening_from_previous && closingKm == null) return
    const body = { closing_km: closingKm, ...(!row.opening_from_previous ? { opening_km: openingKm } : {}) }
    queue.current = queue.current.then(() => save.mutateAsync(body)).catch(() => undefined)
  }
  const reading = (kind: 'opening' | 'closing') => {
    const editable = canEdit && (kind === 'closing' || !row.opening_from_previous)
    const value = kind === 'opening' ? opening : closing
    if (!editable) {
      const number = kind === 'opening' ? row.opening_km : row.closing_km
      return <bdi>{number == null ? EMPTY_VALUE : formatNumber(number, i18n.language)}</bdi>
    }
    return <Input
      type="number"
      min={0}
      max={9999999}
      step={1}
      inputMode="numeric"
      aria-label={`${t(kind === 'opening' ? 'vehicles.openingKm' : 'vehicles.closingKm')} · ${row.plate_label}`}
      value={value}
      onChange={(event) => (kind === 'opening' ? setOpening : setClosing)(event.target.value)}
      onBlur={submit}
      onKeyDown={(event) => {
        if (event.key === 'Enter') {
          event.preventDefault()
          event.currentTarget.blur()
        }
      }}
      className="h-9 w-full min-w-24 max-w-36 text-start font-mono tabular-nums"
    />
  }
  const vehicle = (
    <div className="flex flex-col items-start gap-1">
      <PlateChip plate={row.plate_label} size="sm" />
      <span className="text-xs text-muted-foreground" dir="auto">
        {localized(row.vehicle_type_ar, row.vehicle_type_en, i18n.language) || EMPTY_VALUE}
      </span>
      {save.isPending && (
        <span role="status" className="text-xs text-muted-foreground">
          {t('vehicles.odometerSaving')}
        </span>
      )}
    </div>
  )
  const values = [
    reading('opening'),
    reading('closing'),
    <bdi key="distance">
      {row.km_driven == null ? EMPTY_VALUE : formatNumber(row.km_driven, i18n.language)}
    </bdi>,
    <bdi key="count">{formatNumber(row.maintenance_count, i18n.language)}</bdi>,
    <bdi key="cost">{formatAed(row.maintenance_cost, i18n.language)}</bdi>,
  ]
  if (mobile) return (
    <article className="rounded-xl border border-border bg-surface p-3">
      {vehicle}
      <dl className="mt-3 grid grid-cols-2 gap-3">
        {values.map((value, index) => (
          <div key={index}>
            <dt className="mb-1 text-xs text-muted-foreground">
              {t(`vehicles.${['openingKm', 'closingKm', 'kmDriven', 'maintenanceCount', 'cost'][index]}`)}
            </dt>
            <dd className="text-sm">{value}</dd>
          </div>
        ))}
      </dl>
    </article>
  )
  return (
    <TableRow>
      <TableCell>{vehicle}</TableCell>
      {values.map((value, index) => <TableCell key={index}>{value}</TableCell>)}
    </TableRow>
  )
}
