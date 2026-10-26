import { useId, useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { zodResolver } from '@hookform/resolvers/zod'
import { Controller, useForm } from 'react-hook-form'
import { useTranslation } from 'react-i18next'
import { useNavigate } from 'react-router-dom'
import { toast } from '@/lib/toast'
import { z } from 'zod'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
import { api, type VehicleMaintenanceRead, type VehicleRead } from '@/lib/api'
import {
  EMPTY_VALUE,
  MAINTENANCE_TYPES,
  formatAed,
  formatIsoDate,
  formatNumber,
  invalidateVehicleQueries,
  plateLabel,
  vehicleErrorMessage,
} from '../vehicleUtils'
import { PlateChip } from './PlateChip'
import {
  VehicleDialogBody,
  VehicleDialogFooter,
  VehicleDialogShell,
  VehicleEmployeeField,
  VehicleField,
  VehicleFieldGrid,
  VehicleFormAlert,
} from './VehicleDialogShell'

const schema = z.object({
  type: z.enum(['service', 'repair', 'tires', 'other']),
  description: z.string().trim().min(1),
  odometer_km: z.string().regex(/^\d{0,9}$/),
})
type Values = z.infer<typeof schema>

type RequestVehicle = Pick<VehicleRead, 'id' | 'plate_code' | 'plate_number' | 'current_odometer_km'>

export function MaintenanceRequestDialog({ vehicle, lastMaintenance, open, onOpenChange }: {
  vehicle: RequestVehicle
  lastMaintenance: VehicleMaintenanceRead | null
  open: boolean
  onOpenChange: (open: boolean) => void
}): React.JSX.Element {
  const { t } = useTranslation()
  const [busy, setBusy] = useState(false)
  return (
    <VehicleDialogShell open={open} onOpenChange={onOpenChange} title={t('vehicles.requestMaintenance')} description={t('vehicles.maintenanceRequestDesc')} busy={busy}>
      <MaintenanceRequestForm vehicle={vehicle} lastMaintenance={lastMaintenance} onOpenChange={onOpenChange} onBusyChange={setBusy} />
    </VehicleDialogShell>
  )
}

function MaintenanceRequestForm({ vehicle, lastMaintenance, onOpenChange, onBusyChange }: {
  vehicle: RequestVehicle
  lastMaintenance: VehicleMaintenanceRead | null
  onOpenChange: (open: boolean) => void
  onBusyChange: (busy: boolean) => void
}): React.JSX.Element {
  const { t, i18n } = useTranslation()
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const fieldId = useId()
  const alertId = `${fieldId}-alert`
  const [employeeId, setEmployeeId] = useState<string | null>(null)
  const [serverError, setServerError] = useState<string | null>(null)
  const { register, control, handleSubmit, formState: { errors } } = useForm<Values>({
    resolver: zodResolver(schema),
    defaultValues: {
      type: 'service',
      description: '',
      odometer_km: vehicle.current_odometer_km == null ? '' : String(vehicle.current_odometer_km),
    },
  })
  const mutation = useMutation({
    mutationFn: (values: Values) => api.createVehicleMaintenanceRequest(vehicle.id, {
      type: values.type,
      description: values.description,
      employee_id: employeeId,
      odometer_km: values.odometer_km === '' ? null : Number(values.odometer_km),
    }),
    onMutate: () => onBusyChange(true),
    onSettled: () => onBusyChange(false),
    onSuccess: (result) => {
      invalidateVehicleQueries(queryClient, { vehicleId: vehicle.id })
      void queryClient.invalidateQueries({ queryKey: ['books'] })
      void queryClient.invalidateQueries({ queryKey: ['dashboard'] })
      toast.success(t('vehicles.letterSaved'), { reference: result.letter.ref_number })
      navigate(`/books/${result.letter.book_id}`)
    },
    onError: (error) => {
      const message = vehicleErrorMessage(error, t)
      setServerError(message)
      toast.error(message)
    },
  })
  const alert = serverError ?? (Object.keys(errors).length > 0 ? t('vehicles.requiredFields') : null)
  const flag = (field: keyof Values): { 'aria-invalid'?: true; 'aria-describedby'?: string } =>
    errors[field] ? { 'aria-invalid': true, 'aria-describedby': alertId } : {}

  return (
    <form className="flex min-h-0 flex-1 flex-col" aria-busy={mutation.isPending} onSubmit={handleSubmit((values) => {
      if (mutation.isPending) return
      setServerError(null)
      mutation.mutate(values)
    })}>
      <VehicleDialogBody>
        <VehicleFormAlert id={alertId} message={alert} />
        <PlateChip plate={plateLabel(vehicle)} className="self-start" />
        <section aria-labelledby={`${fieldId}-last`} className="rounded-lg bg-surface-tinted p-3">
          <h3 id={`${fieldId}-last`} className="text-sm font-semibold">{t('vehicles.lastMaintenance')}</h3>
          {lastMaintenance ? (
            <dl className="mt-2 grid grid-cols-2 gap-x-4 gap-y-2 text-xs">
              <div><dt className="text-muted-foreground">{t('vehicles.date')}</dt><dd><bdi dir="ltr">{formatIsoDate(lastMaintenance.date)}</bdi></dd></div>
              <div><dt className="text-muted-foreground">{t('vehicles.maintenanceType')}</dt><dd>{t(`vehicles.${lastMaintenance.type}`)}</dd></div>
              <div><dt className="text-muted-foreground">{t('vehicles.odometer')}</dt><dd><bdi>{lastMaintenance.odometer_km == null ? EMPTY_VALUE : `${formatNumber(lastMaintenance.odometer_km, i18n.language)} ${t('vehicles.km')}`}</bdi></dd></div>
              <div><dt className="text-muted-foreground">{t('vehicles.cost')}</dt><dd><bdi>{formatAed(lastMaintenance.cost, i18n.language)}</bdi></dd></div>
            </dl>
          ) : <p className="mt-1 text-xs text-muted-foreground">{t('vehicles.noPreviousMaintenance')}</p>}
        </section>
        <fieldset disabled={mutation.isPending} className="contents">
          <VehicleFieldGrid>
            <VehicleField id={`${fieldId}-type`} label={t('vehicles.maintenanceType')} required>
              <Controller control={control} name="type" render={({ field }) => (
                <Select value={field.value} onValueChange={field.onChange}>
                  <SelectTrigger id={`${fieldId}-type`} {...flag('type')}><SelectValue /></SelectTrigger>
                  <SelectContent>{MAINTENANCE_TYPES.map((type) => <SelectItem key={type} value={type}>{t(`vehicles.${type}`)}</SelectItem>)}</SelectContent>
                </Select>
              )} />
            </VehicleField>
            <VehicleField id={`${fieldId}-odometer`} label={t('vehicles.currentOdometer')}>
              <Input id={`${fieldId}-odometer`} inputMode="numeric" dir="ltr" className="font-mono" {...register('odometer_km')} {...flag('odometer_km')} />
            </VehicleField>
            <VehicleField id={`${fieldId}-description`} label={t('vehicles.requestedWork')} required full>
              <Textarea id={`${fieldId}-description`} dir="auto" rows={3} {...register('description')} {...flag('description')} />
            </VehicleField>
            <VehicleEmployeeField employeeId={employeeId} onChange={setEmployeeId} hint={t('vehicles.maintenanceRequestDriverHint')} />
          </VehicleFieldGrid>
        </fieldset>
      </VehicleDialogBody>
      <VehicleDialogFooter>
        <Button type="button" variant="outline" disabled={mutation.isPending} onClick={() => onOpenChange(false)}>{t('common.cancel')}</Button>
        <Button type="submit" disabled={mutation.isPending}>{t(mutation.isPending ? 'vehicles.odometerSaving' : 'vehicles.saveLetter')}</Button>
      </VehicleDialogFooter>
    </form>
  )
}
