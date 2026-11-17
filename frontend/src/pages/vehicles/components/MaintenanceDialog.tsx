/**
 * MaintenanceDialog — log a service, repair, tyre change or other work.
 *
 * `next_due` is the only field with a consequence beyond the record: it drives
 * the register's overdue/due badge and the daily push reminder, which is why
 * the field states that in a hint rather than leaving the operator to discover
 * it. The receipt is uploaded first (`kind=receipt`) and its id is what the row
 * is created with.
 *
 * Opened from the vehicle file the vehicle is fixed; opened from the register
 * it is chosen here.
 */

import { useEffect, useId, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { zodResolver } from '@hookform/resolvers/zod'
import { Controller, useForm } from 'react-hook-form'
import { useTranslation } from 'react-i18next'
import { toast } from '@/lib/toast'
import { z } from 'zod'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Skeleton } from '@/components/ui/skeleton'
import { api } from '@/lib/api'
import type { VehicleListItem, VehicleMaintenanceRead, VehicleMaintenanceRequestRead } from '@/lib/api'
import { isArabic, localized } from '@/lib/language'
import dirhamMark from '../../../assets/dirham-symbol.png'

import {
  DOCUMENT_ACCEPT,
  MAINTENANCE_TYPES,
  VEHICLE_QUERY_KEYS,
  invalidateVehicleQueries,
  plateLabel,
  formatCount,
  formatIsoDate,
  todayIso,
  vehicleErrorMessage,
} from '../vehicleUtils'
import { PlateChip } from './PlateChip'
import {
  Field,
  FieldGrid,
  FormAlert,
  UploadSlot,
} from '@/components/forms/DialogShell'
import { RequestBody, RequestFooter, RequestNote, RequestShell } from './RequestShell'
import { AedAmount } from './FineAmount'

const schema = z.object({
  vehicle_id: z.string().min(1),
  date: z.string().min(1),
  type: z.enum(['service', 'repair', 'tires', 'other']),
  /** Blank is allowed — not every garage records the odometer. */
  odometer_km: z.string().regex(/^\d{0,9}$/),
  cost: z.string().regex(/^\d{1,9}$/),
  vendor: z.string().trim().max(128),
  next_due: z.string(),
})

type Values = z.output<typeof schema>

/** The subset of a vehicle the dialog needs to lock onto one. */
export interface MaintenanceDialogVehicle {
  id: number
  plate_code?: string | null
  plate_number: string
}

interface Props {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** Fixed vehicle (vehicle file), or `null` to let the operator choose. */
  vehicle?: MaintenanceDialogVehicle | null
  initialVehicleId?: number | null
  request?: VehicleMaintenanceRequestRead | null
  onSaved?: (record: VehicleMaintenanceRead) => void
}

export function MaintenanceDialog({
  open,
  onOpenChange,
  vehicle = null,
  initialVehicleId = null,
  request = null,
  onSaved,
}: Props): React.JSX.Element {
  const { t } = useTranslation()
  // The form owns the mutation (receipt upload + record); the shell owns
  // dismissal, so the whole sequence is reported up to it as one busy state.
  const [busy, setBusy] = useState(false)
  const vehiclesQuery = useQuery({
    queryKey: [...VEHICLE_QUERY_KEYS.list, {}],
    queryFn: () => api.listVehicles({}),
    enabled: open && !vehicle,
    staleTime: 60_000,
  })
  const options = vehicle ? [] : vehiclesQuery.data

  return (
    <RequestShell
      open={open}
      onOpenChange={onOpenChange}
      title={t('vehicles.addMaintenance')}
      description={t('vehicles.addMaintenanceDesc')}
      busy={busy}
    >
      {options ? (
        <MaintenanceForm
          locked={vehicle}
          initialVehicleId={initialVehicleId}
          request={request}
          options={options}
          onSaved={onSaved}
          onOpenChange={onOpenChange}
          onBusyChange={setBusy}
        />
      ) : (
        <RequestBody>
          {vehiclesQuery.isError ? <p role="alert">{t('common.loadError')} <Button type="button" variant="secondary" onClick={() => void vehiclesQuery.refetch()}>{t('common.retry')}</Button></p> : <>
            <Skeleton className="h-9 w-full" />
            <Skeleton className="h-9 w-2/3" />
          </>}
        </RequestBody>
      )}
    </RequestShell>
  )
}

function MaintenanceForm({
  locked,
  initialVehicleId,
  request,
  options,
  onSaved,
  onOpenChange,
  onBusyChange,
}: {
  locked: MaintenanceDialogVehicle | null
  initialVehicleId: number | null
  request: VehicleMaintenanceRequestRead | null
  options: readonly VehicleListItem[]
  onSaved?: (record: VehicleMaintenanceRead) => void
  onOpenChange: (open: boolean) => void
  onBusyChange: (busy: boolean) => void
}): React.JSX.Element {
  const { t, i18n } = useTranslation()
  const queryClient = useQueryClient()
  const fieldId = useId()
  const alertId = `${fieldId}-alert`

  const [receipt, setReceipt] = useState<File | null>(null)
  const [serverError, setServerError] = useState<string | null>(null)

  const {
    register,
    control,
    handleSubmit,
    setValue,
    resetField,
    getFieldState,
    watch,
    formState: { errors },
  } = useForm<z.input<typeof schema>, unknown, Values>({
    resolver: zodResolver(schema),
    defaultValues: {
      vehicle_id: String(locked?.id ?? initialVehicleId ?? options[0]?.id ?? ''),
      date: todayIso(),
      type: request?.type ?? 'service',
      odometer_km: request?.odometer_km == null ? '' : String(request.odometer_km),
      cost: '',
      vendor: '',
      next_due: '',
    },
  })

  const mutation = useMutation({
    onMutate: () => onBusyChange(true),
    onSettled: () => onBusyChange(false),
    mutationFn: async (values: Values): Promise<VehicleMaintenanceRead> => {
      const vehicleId = Number(values.vehicle_id)
      const receiptFileId = receipt
        ? (await api.uploadVehicleFile(vehicleId, 'receipt', receipt)).id
        : null
      return api.createVehicleMaintenance({
        vehicle_id: vehicleId,
        date: values.date,
        type: values.type,
        odometer_km: values.odometer_km ? Number(values.odometer_km) : null,
        cost: Number(values.cost),
        vendor_ar: isArabic(i18n.language) ? values.vendor || null : null,
        vendor_en: isArabic(i18n.language) ? null : values.vendor || null,
        next_due: values.next_due || null,
        receipt_file_id: receiptFileId,
        ...(request ? { request_id: request.id } : {}),
      })
    },
    onSuccess: (record) => {
      invalidateVehicleQueries(queryClient, {
        vehicleId: record.vehicle_id,
        registers: ['maintenance'],
      })
      toast.success(t('vehicles.maintenanceLogged'))
      onSaved?.(record)
      onOpenChange(false)
    },
    onError: (err) => {
      const message = vehicleErrorMessage(err)
      setServerError(message)
      toast.error(message)
    },
  })

  const invalid = Object.keys(errors).length > 0
  const alert = serverError ?? (invalid ? t('vehicles.requiredFields') : null)
  const flag = (
    field: keyof Values,
  ): { 'aria-invalid'?: true; 'aria-describedby'?: string } =>
    errors[field] ? { 'aria-invalid': true, 'aria-describedby': alertId } : {}

  const selectedId = watch('vehicle_id')
  const noVehicles = !locked && options.length === 0
  const historyQuery = useQuery({
    queryKey: VEHICLE_QUERY_KEYS.detail(Number(selectedId)),
    queryFn: () => api.getVehicle(Number(selectedId)),
    enabled: Boolean(selectedId),
  })
  const last = historyQuery.data?.maintenance?.reduce<VehicleMaintenanceRead | null>(
    (latest, record) => !latest || record.date > latest.date || (record.date === latest.date && record.id > latest.id) ? record : latest,
    null,
  )
  // The reading belongs to the chosen vehicle: it is filled from that
  // vehicle's file until the operator types one, and choosing another vehicle
  // clears it (see the picker) so a reading never moves to a different plate.
  useEffect(() => {
    if (request || !historyQuery.data || String(historyQuery.data.id) !== selectedId) return
    if (getFieldState('odometer_km').isDirty) return
    const odometer = historyQuery.data.current_odometer_km
    setValue('odometer_km', odometer == null ? '' : String(odometer))
  }, [historyQuery.data, selectedId, request, getFieldState, setValue])

  return (
    <form
      className="flex min-h-0 flex-1 flex-col"
      onSubmit={handleSubmit((values) => {
        setServerError(null)
        mutation.mutate(values)
      })}
    >
      <RequestBody asideLabel={t('vehicles.lastService')} aside={
        <RequestNote title={t('vehicles.lastService')}>
          {historyQuery.isPending && selectedId ? <Skeleton className="h-24 w-full" /> : historyQuery.isError ? (
            <p role="alert">{t('common.loadError')} <Button type="button" variant="ghost" size="sm" onClick={() => void historyQuery.refetch()}>{t('common.retry')}</Button></p>
          ) : last ? (
            <dl className="grid gap-3 sm:grid-cols-2">
              <div><dt className="text-muted-foreground">{t('vehicles.date')}</dt><dd><bdi dir="ltr">{formatIsoDate(last.date)}</bdi></dd></div>
              <div><dt className="text-muted-foreground">{t('vehicles.maintenanceType')}</dt><dd>{t(`vehicles.${last.type}`)}</dd></div>
              <div><dt className="text-muted-foreground">{t('vehicles.odometer')}</dt><dd><bdi dir="ltr">{last.odometer_km == null ? '—' : formatCount(last.odometer_km)}</bdi> {t('vehicles.km')}</dd></div>
              <div><dt className="text-muted-foreground">{t('vehicles.cost')}</dt><dd><AedAmount value={last.cost} /></dd></div>
            </dl>
          ) : <p className="text-muted-foreground">{t('vehicles.noPreviousMaintenance')}</p>}
          <p className="mt-4 text-muted-foreground">{t('vehicles.reminder')}</p>
        </RequestNote>
      }>
        <FormAlert id={alertId} message={alert} />

        {locked ? (
          <div className="flex flex-col gap-1.5">
            <Label id={`${fieldId}-vehicle-label`}>{t('vehicles.selectedVehicle')}</Label>
            <div role="group" aria-labelledby={`${fieldId}-vehicle-label`}>
              <PlateChip plate={plateLabel(locked)} />
            </div>
          </div>
        ) : (
          <Field
            id={`${fieldId}-vehicle`}
            label={t('vehicles.selectedVehicle')}
            required
            error={noVehicles ? t('vehicles.noVehicles') : undefined}
          >
            <Controller
              control={control}
              name="vehicle_id"
              render={({ field }) => (
                <Select
                  value={field.value}
                  onValueChange={(next) => {
                    if (next !== field.value && !request) resetField('odometer_km', { defaultValue: '' })
                    field.onChange(next)
                  }}
                  disabled={noVehicles}
                >
                  <SelectTrigger id={`${fieldId}-vehicle`} {...flag('vehicle_id')}>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {options.map((option) => (
                      <SelectItem key={option.id} value={String(option.id)}>
                        <bdi dir="ltr" className="font-mono">
                          {plateLabel(option)}
                        </bdi>
                        {' · '}
                        {localized(option.type_ar, option.type_en, i18n.language)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
            />
          </Field>
        )}

        <FieldGrid>
          <Field id={`${fieldId}-date`} label={t('vehicles.date')} required>
            <Input
              id={`${fieldId}-date`}
              type="date"
              dir="ltr"
              className="font-mono"
              {...register('date')}
              {...flag('date')}
            />
          </Field>
          <Field id={`${fieldId}-type`} label={t('vehicles.maintenanceType')} required>
            <Controller
              control={control}
              name="type"
              render={({ field }) => (
                <Select value={field.value} onValueChange={field.onChange}>
                  <SelectTrigger id={`${fieldId}-type`}>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {MAINTENANCE_TYPES.map((type) => (
                      <SelectItem key={type} value={type}>
                        {t(`vehicles.${type}`)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
            />
          </Field>
          <Field id={`${fieldId}-odometer`} label={`${t('vehicles.odometer')} (${t('vehicles.km')})`}>
            <Input
              id={`${fieldId}-odometer`}
              type="number"
              min={0}
              step={1}
              inputMode="numeric"
              dir="ltr"
              className="font-mono"
              {...register('odometer_km')}
              {...flag('odometer_km')}
            />
          </Field>
          <Field id={`${fieldId}-cost`} label={t('vehicles.cost')} required>
            <div className="relative" dir="ltr">
              <span aria-hidden="true" className="pointer-events-none absolute inset-y-0 start-3 my-auto h-4 w-4 bg-current text-muted-foreground" style={{ mask: `url(${dirhamMark}) center / contain no-repeat`, WebkitMask: `url(${dirhamMark}) center / contain no-repeat` }} />
              <Input
                id={`${fieldId}-cost`}
                type="text"
                inputMode="numeric"
                dir="ltr"
                className="ps-9 font-mono"
                {...register('cost')}
                {...flag('cost')}
              />
            </div>
          </Field>
          <Field id={`${fieldId}-vendor`} label={t('vehicles.garage')} full>
            <Input id={`${fieldId}-vendor`} dir="auto" {...register('vendor')} {...flag('vendor')} />
          </Field>
          <Field
            id={`${fieldId}-next-due`}
            label={t('vehicles.nextDue')}
            hint={t('vehicles.reminderHint')}
            full
          >
            <Input
              id={`${fieldId}-next-due`}
              type="date"
              dir="ltr"
              className="font-mono"
              {...register('next_due')}
            />
          </Field>
        </FieldGrid>

        <UploadSlot
          label={t('vehicles.uploadReceipt')}
          accept={DOCUMENT_ACCEPT}
          file={receipt}
          onFile={setReceipt}
          onClear={() => setReceipt(null)}
          clearLabel={t('common.remove')}
          disabled={mutation.isPending}
        />
      </RequestBody>

      <RequestFooter busy={mutation.isPending}>
        <Button type="submit" size="lg" className="sm:min-w-[11rem]" disabled={mutation.isPending || !selectedId}>
          {mutation.isPending ? t('common.saving') : t('vehicles.save')}
        </Button>
      </RequestFooter>
    </form>
  )
}
