/**
 * RenewLicenseDialog — close the current license period and open the next one.
 *
 * The service archives the period that is ending (and the scan that belonged to
 * it) onto a renewal row, so the operator only states the NEW window: it
 * defaults to the day after the current expiry, one year less a day. A new scan
 * is uploaded first (`kind=license`) and handed over as `scan_file_id`, which
 * is what becomes the vehicle's current license file.
 */

import { useId, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { zodResolver } from '@hookform/resolvers/zod'
import { useForm } from 'react-hook-form'
import { useTranslation } from 'react-i18next'
import { toast } from '@/lib/toast'
import { z } from 'zod'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { api } from '@/lib/api'
import type { VehicleListItem, VehicleRead } from '@/lib/api'
import { localized } from '@/lib/language'
import dirhamMark from '../../../assets/dirham-symbol.png'
import { Field, FieldGrid, FormAlert, UploadSlot } from '@/components/forms/DialogShell'
import {
  DOCUMENT_ACCEPT,
  VEHICLE_QUERY_KEYS,
  addDaysIso,
  formatIsoDate,
  invalidateVehicleQueries,
  licenseWindowEnd,
  plateLabel,
  vehicleErrorMessage,
} from '../vehicleUtils'
import { AedAmount } from './FineAmount'
import { PlateChip } from './PlateChip'
import { RequestBody, RequestFooter, RequestNote, RequestShell } from './RequestShell'
import { VehicleStatusBadge } from './VehicleStatusBadge'

const DEFAULT_COST = '1450'
const schema = z.object({
  start: z.string().min(1),
  expiry: z.string().min(1),
  cost: z.string().regex(/^\d{1,7}$/),
}).superRefine((values, ctx) => {
  if (values.expiry <= values.start) ctx.addIssue({ code: 'custom', path: ['expiry'], message: 'expiry' })
})
type Values = z.output<typeof schema>

interface Props {
  open: boolean
  onOpenChange: (open: boolean) => void
  vehicle?: {
    id: number
    plate_code?: string | null
    plate_number: string
    license_expiry: string
  } | null
  initialVehicleId?: number | null
  onSaved?: (vehicle: VehicleRead) => void
}

export function RenewLicenseDialog({
  open, onOpenChange, vehicle = null, initialVehicleId = null, onSaved,
}: Props): React.JSX.Element {
  const { t, i18n } = useTranslation()
  const pickerId = useId()
  const [busy, setBusy] = useState(false)
  const [pickedId, setPickedId] = useState(initialVehicleId)
  const fleetQuery = useQuery({
    queryKey: [...VEHICLE_QUERY_KEYS.list, { state: 'active' }],
    queryFn: () => api.listVehicles({ state: 'active' }),
    enabled: open && !vehicle,
  })
  const options = fleetQuery.data?.filter((item) => !item.archived_at).sort((a, b) => a.license_expiry.localeCompare(b.license_expiry)) ?? []
  const chosen = vehicle ?? options.find((item) => item.id === pickedId) ?? options[0] ?? null
  const detailQuery = useQuery({
    queryKey: VEHICLE_QUERY_KEYS.detail(chosen?.id ?? 0),
    queryFn: () => api.getVehicle(chosen!.id),
    enabled: open && chosen != null,
  })

  return (
    <RequestShell open={open} onOpenChange={onOpenChange} title={t('vehicles.renewTitle')} description={t('vehicles.renewDesc')} busy={busy}>
      <RenewForm
        key={chosen?.id ?? 'empty'}
        vehicle={chosen}
        detail={detailQuery.data}
        detailError={detailQuery.isError}
        detailLoading={detailQuery.isPending}
        onRetryDetail={() => void detailQuery.refetch()}
        picker={vehicle ? null : (
          <Field id={pickerId} label={t('vehicles.vehicle')} required>
            <Select value={chosen ? String(chosen.id) : ''} onValueChange={(value) => setPickedId(Number(value))} disabled={busy || options.length === 0}>
              <SelectTrigger id={pickerId}><SelectValue placeholder={fleetQuery.isPending ? t('common.loading') : t('vehicles.noVehicles')} /></SelectTrigger>
              <SelectContent>{options.map((item) => <SelectItem key={item.id} value={String(item.id)}><bdi dir="ltr" className="font-mono">{plateLabel(item)}</bdi> · {localized(item.type_ar, item.type_en, i18n.language)}</SelectItem>)}</SelectContent>
            </Select>
            {fleetQuery.isError && <div role="alert" className="text-sm text-destructive">{t('common.loadError')} <Button type="button" size="sm" variant="ghost" onClick={() => void fleetQuery.refetch()}>{t('common.retry')}</Button></div>}
          </Field>
        )}
        onSaved={onSaved}
        onOpenChange={onOpenChange}
        onBusyChange={setBusy}
      />
    </RequestShell>
  )
}

function RenewForm({
  vehicle, detail, detailError, detailLoading, onRetryDetail, picker, onSaved, onOpenChange, onBusyChange,
}: {
  vehicle: NonNullable<Props['vehicle']> | VehicleListItem | null
  detail: VehicleRead | undefined
  detailError: boolean
  detailLoading: boolean
  onRetryDetail: () => void
  picker: React.ReactNode
  onSaved?: (vehicle: VehicleRead) => void
  onOpenChange: (open: boolean) => void
  onBusyChange: (busy: boolean) => void
}): React.JSX.Element {
  const { t } = useTranslation()
  const queryClient = useQueryClient()
  const fieldId = useId()
  const alertId = `${fieldId}-alert`
  const [scan, setScan] = useState<File | null>(null)
  const [serverError, setServerError] = useState<string | null>(null)
  const [expiryEdited, setExpiryEdited] = useState(false)
  const defaultStart = vehicle ? addDaysIso(vehicle.license_expiry, 1) : ''
  const { register, handleSubmit, setValue, formState: { errors } } = useForm<z.input<typeof schema>, unknown, Values>({
    resolver: zodResolver(schema),
    defaultValues: { start: defaultStart, expiry: defaultStart ? licenseWindowEnd(defaultStart) : '', cost: DEFAULT_COST },
  })
  const mutation = useMutation({
    onMutate: () => onBusyChange(true),
    onSettled: () => onBusyChange(false),
    mutationFn: async (values: Values): Promise<VehicleRead> => {
      if (!vehicle) throw new Error(t('vehicles.noVehicles'))
      const scanFileId = scan ? (await api.uploadVehicleFile(vehicle.id, 'license', scan)).id : null
      return api.renewVehicleLicense(vehicle.id, { start: values.start, expiry: values.expiry, cost: Number(values.cost), scan_file_id: scanFileId })
    },
    onSuccess: (updated) => {
      invalidateVehicleQueries(queryClient, { vehicleId: updated.id })
      toast.success(t('vehicles.licenseRenewed'))
      onSaved?.(updated)
      onOpenChange(false)
    },
    onError: (err) => {
      const message = vehicleErrorMessage(err)
      setServerError(message)
      toast.error(message)
    },
  })
  const alert = serverError ?? (Object.keys(errors).length ? t('vehicles.requiredFields') : null)
  const flag = (field: keyof Values): { 'aria-invalid'?: true; 'aria-describedby'?: string } =>
    errors[field] ? { 'aria-invalid': true, 'aria-describedby': alertId } : {}
  const startField = register('start')

  return (
    <form className="flex min-h-0 flex-1 flex-col" onSubmit={handleSubmit((values) => { if (!vehicle) return; setServerError(null); mutation.mutate(values) })}>
      <RequestBody aside={vehicle ? (
        <RequestNote title={<span className="flex flex-wrap items-center gap-2">{t('vehicles.currentLicense')} <PlateChip plate={plateLabel(vehicle)} /></span>}>
          {detailError ? <div role="alert">{t('common.loadError')} <Button type="button" variant="ghost" size="sm" onClick={onRetryDetail}>{t('common.retry')}</Button></div> : detailLoading ? <p role="status">{t('common.loading')}</p> : detail ? <>
            <dl className="grid gap-3 sm:grid-cols-3">
              <div><dt className="text-muted-foreground">{t('vehicles.licenseStart')}</dt><dd><bdi dir="ltr" className="font-mono">{formatIsoDate(detail.license_start)}</bdi></dd></div>
              <div><dt className="text-muted-foreground">{t('vehicles.licenseExpiry')}</dt><dd><bdi dir="ltr" className="font-mono">{formatIsoDate(detail.license_expiry)}</bdi></dd></div>
              <div><dt className="text-muted-foreground">{t('vehicles.status')}</dt><dd><VehicleStatusBadge family="expiry" status={detail.expiry_status} /></dd></div>
            </dl>
            <h3 className="mb-2 mt-6 font-bold text-primary-text">{t('vehicles.renewalHistory')}</h3>
            {detail.renewals?.length ? <ol className="divide-y divide-border">{detail.renewals.map((renewal) => <li key={renewal.id} className="py-3">
              <bdi dir="ltr" className="block font-mono">{formatIsoDate(renewal.start)} → {formatIsoDate(renewal.expiry)}</bdi>
              <p className="mt-1 flex flex-wrap items-center gap-1 text-muted-foreground">{t('vehicles.renewedOn')}: <bdi dir="ltr">{formatIsoDate(renewal.renewed_on)}</bdi>{renewal.cost != null && <span> · {t('vehicles.cost')}: <AedAmount value={renewal.cost} size="sm" /></span>}</p>
            </li>)}</ol> : <p className="text-muted-foreground">{t('vehicles.noRenewals')}</p>}
          </> : null}
        </RequestNote>
      ) : null}>
        <FormAlert id={alertId} message={alert} />
        {picker ?? (vehicle && <div className="space-y-2"><Label>{t('vehicles.vehicle')}</Label><div><PlateChip plate={plateLabel(vehicle)} /></div></div>)}
        <FieldGrid>
          <Field id={`${fieldId}-start`} label={t('vehicles.newStart')} required>
            <Input id={`${fieldId}-start`} type="date" dir="ltr" className="font-mono" autoFocus={!picker} disabled={!vehicle || mutation.isPending} {...startField} onChange={(event) => { void startField.onChange(event); if (!expiryEdited) setValue('expiry', licenseWindowEnd(event.target.value)) }} {...flag('start')} />
          </Field>
          <Field id={`${fieldId}-expiry`} label={t('vehicles.newExpiry')} required>
            <Input id={`${fieldId}-expiry`} type="date" dir="ltr" className="font-mono" disabled={!vehicle || mutation.isPending} {...register('expiry', { onChange: () => setExpiryEdited(true) })} {...flag('expiry')} />
          </Field>
          <Field id={`${fieldId}-cost`} label={t('vehicles.renewalCost')} required>
            <div className="relative">
              <span aria-hidden className="pointer-events-none absolute inset-y-0 start-3 my-auto h-4 w-4 bg-current text-muted-foreground" style={{ maskImage: `url(${dirhamMark})`, maskRepeat: 'no-repeat', maskSize: 'contain', maskPosition: 'center' }} />
              <Input id={`${fieldId}-cost`} type="number" min={0} step={1} inputMode="numeric" className="ps-9 font-mono" disabled={!vehicle || mutation.isPending} {...register('cost')} {...flag('cost')} />
            </div>
          </Field>
          <div><p className="mb-2 text-sm font-medium">{t('vehicles.licenseScan')}</p><UploadSlot label={t('vehicles.uploadScan')} accept={DOCUMENT_ACCEPT} file={scan} onFile={setScan} onClear={() => setScan(null)} clearLabel={t('common.remove')} disabled={!vehicle || mutation.isPending} /></div>
        </FieldGrid>
      </RequestBody>
      <RequestFooter busy={mutation.isPending}><Button type="submit" size="lg" className="sm:min-w-[11rem]" disabled={!vehicle || mutation.isPending}>{mutation.isPending ? t('common.saving') : t('vehicles.renew')}</Button></RequestFooter>
    </form>
  )
}
