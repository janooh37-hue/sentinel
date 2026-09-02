/**
 * AccidentDialog — file an incident report against a vehicle.
 *
 * Arabic location and description are required because they are the body of the
 * official letter (GSSG-VA); the English halves are optional working copies.
 * Photos are uploaded first (`kind=accident`) and the returned ids are what the
 * report is created with, so a failed upload never leaves a report that claims
 * evidence it does not have.
 *
 * Opened from the vehicle file the vehicle is fixed; opened from the register
 * it is chosen here.
 */

import { useId, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { zodResolver } from '@hookform/resolvers/zod'
import { Controller, useForm } from 'react-hook-form'
import { useTranslation } from 'react-i18next'
import { X } from 'lucide-react'
import { toast } from 'sonner'
import { z } from 'zod'

import { Button } from '@/components/ui/button'
import { FileUploadZone } from '@/components/ui/file-upload-zone'
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
import { Textarea } from '@/components/ui/textarea'
import { api } from '@/lib/api'
import type { VehicleAccidentRead, VehicleListItem } from '@/lib/api'

import {
  IMAGE_ACCEPT,
  VEHICLE_QUERY_KEYS,
  invalidateVehicleQueries,
  localized,
  nowTime,
  plateLabel,
  todayIso,
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
  vehicle_id: z.string().min(1),
  employee_id: z.string(),
  date: z.string().min(1),
  time: z.string().min(1),
  location_ar: z.string().trim().min(1),
  location_en: z.string().trim(),
  description_ar: z.string().trim().min(1),
  description_en: z.string().trim(),
  police_ref: z.string().trim().max(64),
  damage_cost: z.string().regex(/^\d{1,9}$/),
})

type Values = z.output<typeof schema>

/** The subset of a vehicle the dialog needs to lock onto one. */
export interface AccidentDialogVehicle {
  id: number
  plate_code?: string | null
  plate_number: string
}

interface Props {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** Fixed vehicle (vehicle file), or `null` to let the operator choose. */
  vehicle?: AccidentDialogVehicle | null
  onSaved?: (accident: VehicleAccidentRead) => void
}

export function AccidentDialog({
  open,
  onOpenChange,
  vehicle = null,
  onSaved,
}: Props): React.JSX.Element {
  const { t } = useTranslation()
  // The form owns the mutation (photo uploads + report); the shell owns
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
      title={t('vehicles.newReport')}
      description={t('vehicles.addAccidentDesc')}
      size="xl"
      busy={busy}
    >
      {options ? (
        <AccidentForm
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

function AccidentForm({
  locked,
  options,
  onSaved,
  onOpenChange,
  onBusyChange,
}: {
  locked: AccidentDialogVehicle | null
  options: readonly VehicleListItem[]
  onSaved?: (accident: VehicleAccidentRead) => void
  onOpenChange: (open: boolean) => void
  onBusyChange: (busy: boolean) => void
}): React.JSX.Element {
  const { t, i18n } = useTranslation()
  const queryClient = useQueryClient()
  const fieldId = useId()
  const alertId = `${fieldId}-alert`

  const [photos, setPhotos] = useState<File[]>([])
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
      employee_id: '',
      date: todayIso(),
      time: nowTime(),
      location_ar: '',
      location_en: '',
      description_ar: '',
      description_en: '',
      police_ref: '',
      damage_cost: '0',
    },
  })

  const mutation = useMutation({
    onMutate: () => onBusyChange(true),
    onSettled: () => onBusyChange(false),
    mutationFn: async (values: Values): Promise<VehicleAccidentRead> => {
      const vehicleId = Number(values.vehicle_id)
      // Evidence first: the report is created with ids that already exist.
      const photoIds: number[] = []
      for (const photo of photos) {
        photoIds.push((await api.uploadVehicleFile(vehicleId, 'accident', photo)).id)
      }
      return api.createVehicleAccident({
        vehicle_id: vehicleId,
        employee_id: values.employee_id || null,
        date: values.date,
        time: values.time,
        location_ar: values.location_ar,
        location_en: values.location_en || null,
        description_ar: values.description_ar,
        description_en: values.description_en || null,
        police_ref: values.police_ref || null,
        damage_cost: Number(values.damage_cost),
        photo_file_ids: photoIds,
      })
    },
    onSuccess: (accident) => {
      invalidateVehicleQueries(queryClient, {
        vehicleId: accident.vehicle_id,
        registers: ['accidents'],
      })
      toast.success(t('vehicles.accidentFiled'))
      onSaved?.(accident)
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
          <VehicleField id={`${fieldId}-time`} label={t('vehicles.time')} required>
            <Input
              id={`${fieldId}-time`}
              type="time"
              className="font-mono"
              {...register('time')}
              {...flag('time')}
            />
          </VehicleField>
          <Controller
            control={control}
            name="employee_id"
            render={({ field }) => (
              <VehicleEmployeeField
                employeeId={field.value || null}
                onChange={(employeeId) => field.onChange(employeeId ?? '')}
                hint={t('vehicles.unassigned')}
              />
            )}
          />
          <VehicleField
            id={`${fieldId}-location-ar`}
            label={`${t('vehicles.location')} · AR`}
            required
          >
            <Input
              id={`${fieldId}-location-ar`}
              dir="rtl"
              {...register('location_ar')}
              {...flag('location_ar')}
            />
          </VehicleField>
          <VehicleField id={`${fieldId}-location-en`} label={`${t('vehicles.location')} · EN`}>
            <Input id={`${fieldId}-location-en`} dir="ltr" {...register('location_en')} />
          </VehicleField>
          <VehicleField id={`${fieldId}-police`} label={t('vehicles.policeRef')}>
            <Input
              id={`${fieldId}-police`}
              dir="ltr"
              className="font-mono"
              {...register('police_ref')}
            />
          </VehicleField>
          <VehicleField id={`${fieldId}-cost`} label={t('vehicles.damageCost')} required>
            <Input
              id={`${fieldId}-cost`}
              type="number"
              min={0}
              step={1}
              inputMode="numeric"
              className="font-mono"
              {...register('damage_cost')}
              {...flag('damage_cost')}
            />
          </VehicleField>
          <VehicleField
            id={`${fieldId}-desc-ar`}
            label={`${t('vehicles.description')} · AR`}
            required
            full
          >
            <Textarea
              id={`${fieldId}-desc-ar`}
              dir="rtl"
              rows={3}
              {...register('description_ar')}
              {...flag('description_ar')}
            />
          </VehicleField>
          <VehicleField
            id={`${fieldId}-desc-en`}
            label={`${t('vehicles.description')} · EN`}
            full
          >
            <Textarea
              id={`${fieldId}-desc-en`}
              dir="ltr"
              rows={3}
              {...register('description_en')}
            />
          </VehicleField>
        </VehicleFieldGrid>

        <div className="flex flex-col gap-2">
          {photos.length > 0 && (
            <ul className="flex flex-col gap-1.5">
              {photos.map((photo, index) => (
                <li
                  key={`${photo.name}-${index}`}
                  className="flex items-center gap-2 rounded-lg border border-border bg-surface-raised px-3 py-2"
                >
                  <span className="min-w-0 flex-1 truncate text-sm text-foreground" dir="auto">
                    {photo.name}
                  </span>
                  <button
                    type="button"
                    onClick={() => setPhotos((current) => current.filter((_, i) => i !== index))}
                    disabled={mutation.isPending}
                    aria-label={`${t('common.remove')} — ${photo.name}`}
                    className="rounded-md p-1 text-muted-foreground transition-colors hover:bg-surface-tinted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50"
                  >
                    <X className="h-4 w-4" aria-hidden />
                  </button>
                </li>
              ))}
            </ul>
          )}
          <FileUploadZone
            accept={IMAGE_ACCEPT}
            label={t('vehicles.uploadPhotos')}
            hint={`${t('vehicles.photosLabel')}: ${photos.length}`}
            disabled={mutation.isPending}
            onFile={(file) => setPhotos((current) => [...current, file])}
          />
        </div>
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
