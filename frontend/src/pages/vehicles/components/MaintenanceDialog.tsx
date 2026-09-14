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

import { useId, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { zodResolver } from '@hookform/resolvers/zod'
import { Controller, useForm } from 'react-hook-form'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
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
import type { VehicleListItem, VehicleMaintenanceRead } from '@/lib/api'

import {
  DOCUMENT_ACCEPT,
  MAINTENANCE_TYPES,
  VEHICLE_QUERY_KEYS,
  invalidateVehicleQueries,
  localized,
  plateLabel,
  todayIso,
  vehicleErrorMessage,
} from '../vehicleUtils'
import { PlateChip } from './PlateChip'
import {
  UploadSlot,
  VehicleDialogBody,
  VehicleDialogFooter,
  VehicleDialogShell,
  VehicleField,
  VehicleFieldGrid,
  VehicleFormAlert,
} from './VehicleDialogShell'

const schema = z.object({
  vehicle_id: z.string().min(1),
  date: z.string().min(1),
  type: z.enum(['service', 'repair', 'tires', 'other']),
  /** Blank is allowed — not every garage records the odometer. */
  odometer_km: z.string().regex(/^\d{0,9}$/),
  cost: z.string().regex(/^\d{1,9}$/),
  vendor_ar: z.string().trim().max(128),
  vendor_en: z.string().trim().max(128),
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
  onSaved?: (record: VehicleMaintenanceRead) => void
}

export function MaintenanceDialog({
  open,
  onOpenChange,
  vehicle = null,
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
    <VehicleDialogShell
      open={open}
      onOpenChange={onOpenChange}
      title={t('vehicles.addMaintenance')}
      description={t('vehicles.addMaintenanceDesc')}
      size="lg"
      busy={busy}
    >
      {options ? (
        <MaintenanceForm
          locked={vehicle}
          options={options}
          onSaved={onSaved}
          onOpenChange={onOpenChange}
          onBusyChange={setBusy}
        />
      ) : (
        <VehicleDialogBody>
          <Skeleton className="h-9 w-full" />
          <Skeleton className="h-9 w-2/3" />
        </VehicleDialogBody>
      )}
    </VehicleDialogShell>
  )
}

function MaintenanceForm({
  locked,
  options,
  onSaved,
  onOpenChange,
  onBusyChange,
}: {
  locked: MaintenanceDialogVehicle | null
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
    watch,
    formState: { errors },
  } = useForm<z.input<typeof schema>, unknown, Values>({
    resolver: zodResolver(schema),
    defaultValues: {
      vehicle_id: String(locked?.id ?? options[0]?.id ?? ''),
      date: todayIso(),
      type: 'service',
      odometer_km: '',
      cost: '0',
      vendor_ar: '',
      vendor_en: '',
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
        vendor_ar: values.vendor_ar || null,
        vendor_en: values.vendor_en || null,
        next_due: values.next_due || null,
        receipt_file_id: receiptFileId,
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
      const message = vehicleErrorMessage(err, t)
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

  return (
    <form
      className="flex min-h-0 flex-1 flex-col"
      onSubmit={handleSubmit((values) => {
        setServerError(null)
        mutation.mutate(values)
      })}
    >
      <VehicleDialogBody>
        <VehicleFormAlert id={alertId} message={alert} />

        {locked ? (
          <div className="flex flex-col gap-1.5">
            <Label id={`${fieldId}-vehicle-label`}>{t('vehicles.selectedVehicle')}</Label>
            <div role="group" aria-labelledby={`${fieldId}-vehicle-label`}>
              <PlateChip plate={plateLabel(locked)} />
            </div>
          </div>
        ) : (
          <VehicleField
            id={`${fieldId}-vehicle`}
            label={t('vehicles.selectedVehicle')}
            required
            error={noVehicles ? t('vehicles.noVehicles') : undefined}
          >
            <Controller
              control={control}
              name="vehicle_id"
              render={({ field }) => (
                <Select value={field.value} onValueChange={field.onChange} disabled={noVehicles}>
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
          </VehicleField>
        )}

        <VehicleFieldGrid>
          <VehicleField id={`${fieldId}-date`} label={t('vehicles.date')} required>
            <Input
              id={`${fieldId}-date`}
              type="date"
              className="font-mono"
              {...register('date')}
              {...flag('date')}
            />
          </VehicleField>
          <VehicleField id={`${fieldId}-type`} label={t('vehicles.maintenanceType')} required>
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
          </VehicleField>
          <VehicleField id={`${fieldId}-odometer`} label={`${t('vehicles.odometer')} (${t('vehicles.km')})`}>
            <Input
              id={`${fieldId}-odometer`}
              type="number"
              min={0}
              step={1}
              inputMode="numeric"
              className="font-mono"
              {...register('odometer_km')}
              {...flag('odometer_km')}
            />
          </VehicleField>
          <VehicleField id={`${fieldId}-cost`} label={t('vehicles.cost')} required>
            <Input
              id={`${fieldId}-cost`}
              type="number"
              min={0}
              step={1}
              inputMode="numeric"
              className="font-mono"
              {...register('cost')}
              {...flag('cost')}
            />
          </VehicleField>
          <VehicleField id={`${fieldId}-vendor-ar`} label={`${t('vehicles.garage')} · AR`}>
            <Input id={`${fieldId}-vendor-ar`} dir="rtl" {...register('vendor_ar')} />
          </VehicleField>
          <VehicleField id={`${fieldId}-vendor-en`} label={`${t('vehicles.garage')} · EN`}>
            <Input id={`${fieldId}-vendor-en`} dir="ltr" {...register('vendor_en')} />
          </VehicleField>
          <VehicleField
            id={`${fieldId}-next-due`}
            label={t('vehicles.nextDue')}
            hint={t('vehicles.reminderHint')}
            full
          >
            <Input
              id={`${fieldId}-next-due`}
              type="date"
              className="font-mono"
              {...register('next_due')}
            />
          </VehicleField>
        </VehicleFieldGrid>

        <UploadSlot
          label={t('vehicles.uploadReceipt')}
          accept={DOCUMENT_ACCEPT}
          file={receipt}
          onFile={setReceipt}
          onClear={() => setReceipt(null)}
          clearLabel={t('common.remove')}
          disabled={mutation.isPending}
        />
      </VehicleDialogBody>

      <VehicleDialogFooter>
        <Button
          type="button"
          variant="ghost"
          disabled={mutation.isPending}
          onClick={() => onOpenChange(false)}
        >
          {t('vehicles.cancel')}
        </Button>
        <Button type="submit" disabled={mutation.isPending || !selectedId}>
          {mutation.isPending ? t('common.saving') : t('vehicles.save')}
        </Button>
      </VehicleDialogFooter>
    </form>
  )
}
