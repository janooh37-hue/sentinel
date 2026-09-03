/**
 * FineDialog — record a fine, or edit one that is already on the vehicle.
 *
 * Edit mode is what assigns a driver to an imported fine: EVG rows arrive with
 * no employee, show as «Unassigned», and this dialog is where a name is put
 * against them. The employee is therefore optional in BOTH modes, and clearing
 * the picker is a real edit (`employee_id: null`), not a no-op.
 */

import { useId, useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { zodResolver } from '@hookform/resolvers/zod'
import { Controller, useForm } from 'react-hook-form'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { z } from 'zod'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { api } from '@/lib/api'
import type { VehicleFineRead, VehicleRead } from '@/lib/api'

import {
  invalidateVehicleQueries,
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

/** A first fine is almost always the AED 300 speeding ticket. */
const DEFAULT_AMOUNT = '300'

const schema = z.object({
  /** `''` means unassigned — a legitimate state, not a missing field. */
  employee_id: z.string(),
  date: z.string().min(1),
  /** `''` or `HH:MM`; EVG rows carry a time, manual entries often do not. */
  time: z.string(),
  amount: z.string().regex(/^\d{1,7}$/).refine((value) => Number(value) >= 1),
  black_points: z.string().regex(/^\d{1,3}$/),
  location: z.string().trim().max(512),
  description: z.string().trim().max(2048),
})

type Values = z.output<typeof schema>

interface Props {
  open: boolean
  onOpenChange: (open: boolean) => void
  vehicle: { id: number; plate_code?: string | null; plate_number: string }
  /** Omit to add; pass a row to edit it. */
  fine?: VehicleFineRead | null
  onSaved?: (vehicle: VehicleRead) => void
}

export function FineDialog({
  open,
  onOpenChange,
  vehicle,
  fine,
  onSaved,
}: Props): React.JSX.Element {
  const { t } = useTranslation()
  // The form owns the mutation; the shell owns dismissal. Reporting the
  // in-flight state up here is what lets the shell refuse Escape mid-save.
  const [busy, setBusy] = useState(false)
  return (
    <VehicleDialogShell
      open={open}
      onOpenChange={onOpenChange}
      title={fine ? t('vehicles.editFine') : t('vehicles.addFineTitle')}
      description={t('vehicles.addFineDesc')}
      size="lg"
      busy={busy}
    >
      <FineForm
        vehicle={vehicle}
        fine={fine ?? null}
        onSaved={onSaved}
        onOpenChange={onOpenChange}
        onBusyChange={setBusy}
      />
    </VehicleDialogShell>
  )
}

function FineForm({
  vehicle,
  fine,
  onSaved,
  onOpenChange,
  onBusyChange,
}: {
  vehicle: Props['vehicle']
  fine: VehicleFineRead | null
  onSaved?: (vehicle: VehicleRead) => void
  onOpenChange: (open: boolean) => void
  onBusyChange: (busy: boolean) => void
}): React.JSX.Element {
  const { t } = useTranslation()
  const queryClient = useQueryClient()
  const fieldId = useId()
  const alertId = `${fieldId}-alert`
  const [serverError, setServerError] = useState<string | null>(null)

  const {
    register,
    control,
    handleSubmit,
    formState: { errors },
  } = useForm<z.input<typeof schema>, unknown, Values>({
    resolver: zodResolver(schema),
    defaultValues: {
      employee_id: fine?.employee_id ?? '',
      date: fine?.date?.slice(0, 10) ?? todayIso(),
      time: fine?.time?.slice(0, 5) ?? '',
      amount: fine ? String(fine.amount) : DEFAULT_AMOUNT,
      black_points: fine ? String(fine.black_points) : '0',
      location: fine?.location ?? '',
      description: fine?.description ?? '',
    },
  })

  const mutation = useMutation({
    onMutate: () => onBusyChange(true),
    onSettled: () => onBusyChange(false),
    mutationFn: (values: Values): Promise<VehicleRead> => {
      const body = {
        employee_id: values.employee_id || null,
        date: values.date,
        time: values.time || null,
        amount: Number(values.amount),
        black_points: Number(values.black_points),
        location: values.location || null,
        description: values.description || null,
      }
      return fine
        ? api.updateVehicleFine(vehicle.id, fine.id, body)
        : api.addVehicleFine(vehicle.id, body)
    },
    onSuccess: (updated) => {
      invalidateVehicleQueries(queryClient, { vehicleId: vehicle.id, registers: ['fines'] })
      toast.success(t(fine ? 'vehicles.fineUpdated' : 'vehicles.fineAdded'))
      onSaved?.(updated)
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

        <div className="flex flex-col gap-1.5">
          <Label id={`${fieldId}-vehicle-label`}>{t('vehicles.selectedVehicle')}</Label>
          <div role="group" aria-labelledby={`${fieldId}-vehicle-label`}>
            <PlateChip plate={plateLabel(vehicle)} />
          </div>
        </div>

        <VehicleFieldGrid>
          <VehicleField id={`${fieldId}-date`} label={t('vehicles.date')} required>
            <Input
              id={`${fieldId}-date`}
              type="date"
              className="font-mono"
              autoFocus
              {...register('date')}
              {...flag('date')}
            />
          </VehicleField>
          <VehicleField id={`${fieldId}-time`} label={t('vehicles.time')}>
            <Input
              id={`${fieldId}-time`}
              type="time"
              className="font-mono"
              {...register('time')}
              {...flag('time')}
            />
          </VehicleField>
          <VehicleField id={`${fieldId}-amount`} label={t('vehicles.amount')} required>
            <Input
              id={`${fieldId}-amount`}
              type="number"
              min={1}
              step={1}
              inputMode="numeric"
              className="font-mono"
              {...register('amount')}
              {...flag('amount')}
            />
          </VehicleField>
          <VehicleField id={`${fieldId}-points`} label={t('vehicles.blackPoints')} required>
            <Input
              id={`${fieldId}-points`}
              type="number"
              min={0}
              step={1}
              inputMode="numeric"
              className="font-mono"
              {...register('black_points')}
              {...flag('black_points')}
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
          <VehicleField id={`${fieldId}-location`} label={t('vehicles.location')} full>
            <Input id={`${fieldId}-location`} dir="auto" {...register('location')} />
          </VehicleField>
          <VehicleField id={`${fieldId}-description`} label={t('vehicles.description')} full>
            <Textarea
              id={`${fieldId}-description`}
              dir="auto"
              rows={2}
              className="min-h-[64px]"
              {...register('description')}
            />
          </VehicleField>
        </VehicleFieldGrid>
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
        <Button type="submit" disabled={mutation.isPending}>
          {mutation.isPending ? t('common.saving') : t('vehicles.save')}
        </Button>
      </VehicleDialogFooter>
    </form>
  )
}
