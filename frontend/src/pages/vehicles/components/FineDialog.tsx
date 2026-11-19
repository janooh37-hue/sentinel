/**
 * FineDialog — record a fine, or edit one that is already on the vehicle.
 *
 * Edit mode is what assigns a driver to an imported fine: EVG rows arrive with
 * no employee, show as «Unassigned», and this dialog is where a name is put
 * against them. The employee is therefore optional in BOTH modes, and clearing
 * the picker is a real edit (`employee_id: null`), not a no-op.
 *
 * Opened from the vehicle file the vehicle is fixed; opened from the fleet
 * ledger it is chosen here — same locked-vehicle-or-picker pattern as
 * `MaintenanceDialog`/`AccidentDialog`.
 *
 * The amount field takes AED with an optional fractional part (`349.50`) in
 * either digit set and is parsed to exact fils; nothing here rounds. Edits
 * carry the fine's current `version` as `If-Match` — a stale value surfaces
 * the server's conflict error like any other field validation failure; the
 * operator reopens the dialog against the refreshed row rather than the save
 * silently overwriting a concurrent change.
 */

import { useId, useMemo, useState } from 'react'
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
import { Textarea } from '@/components/ui/textarea'
import { api } from '@/lib/api'
import type { VehicleFineRead, VehicleListItem, VehicleRead } from '@/lib/api'
import { localized } from '@/lib/language'
import dirhamMark from '../../../assets/dirham-symbol.png'

import {
  VEHICLE_QUERY_KEYS,
  filsToEditableText,
  invalidateVehicleQueries,
  parseAmountToFils,
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
} from '@/components/forms/DialogShell'
import { VehicleEmployeeField } from './VehicleEmployeeField'
import { RequestBody, RequestFooter, RequestNote, RequestSection, RequestShell } from './RequestShell'
import { FineAmount } from './FineAmount'
import { VehicleStatusBadge } from './VehicleStatusBadge'

/** A first fine is almost always the AED 300 speeding ticket. */
const DEFAULT_AMOUNT = '300'

const schema = z.object({
  vehicle_id: z.string().min(1),
  /** `''` means unassigned — a legitimate state, not a missing field. */
  employee_id: z.string(),
  date: z.string().min(1),
  /** `''` or `HH:MM`; EVG rows carry a time, manual entries often do not. */
  time: z.string(),
  /** Exact AED with 0–2 decimals; converted to fils on submit. */
  amount: z.string().refine((value) => parseAmountToFils(value) !== null),
  black_points: z.string().regex(/^\d{1,3}$/),
  location: z.string().trim().max(512),
  description: z.string().trim().max(2048),
})

type Values = z.output<typeof schema>

/** The subset of a vehicle the dialog needs to lock onto one. */
export interface FineDialogVehicle {
  id: number
  plate_code?: string | null
  plate_number: string
}

interface Props {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** Fixed vehicle (vehicle file), or `null` to let the operator choose. */
  vehicle?: FineDialogVehicle | null
  initialVehicleId?: number | null
  /** Omit to add; pass a row to edit it. */
  fine?: VehicleFineRead | null
  /** Fires only for a new fine, with the created row (for post-save highlight). */
  onSaved?: (fine: VehicleFineRead) => void
}

export function FineDialog({
  open,
  onOpenChange,
  vehicle = null,
  initialVehicleId = null,
  fine = null,
  onSaved,
}: Props): React.JSX.Element {
  const { t } = useTranslation()
  // The form owns the mutation; the shell owns dismissal. Reporting the
  // in-flight state up here is what lets the shell refuse Escape mid-save.
  const [busy, setBusy] = useState(false)
  const vehiclesQuery = useQuery({
    queryKey: [...VEHICLE_QUERY_KEYS.list, {}],
    queryFn: () => api.listVehicles({}),
    enabled: open && !vehicle && !fine,
    staleTime: 60_000,
  })
  const options = vehicle || fine ? [] : (vehiclesQuery.data ?? [])
  const ready = Boolean(vehicle) || Boolean(fine) || vehiclesQuery.isSuccess

  return (
    <RequestShell
      open={open}
      onOpenChange={onOpenChange}
      title={fine ? t('vehicles.editFine') : t('vehicles.addFineTitle')}
      description={t('vehicles.addFineDesc')}
      busy={busy}
    >
      {ready ? (
        <FineForm
          locked={vehicle ?? (fine ? { id: fine.vehicle_id, plate_number: '', plate_code: null } : null)}
          lockedLabel={fine?.vehicle_plate_label}
          initialVehicleId={initialVehicleId}
          options={options}
          fine={fine}
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

function FineForm({
  locked,
  lockedLabel,
  initialVehicleId,
  options,
  fine,
  onSaved,
  onOpenChange,
  onBusyChange,
}: {
  locked: FineDialogVehicle | null
  /** A pre-built plate label for an edited fine, which carries no live vehicle object. */
  lockedLabel?: string
  initialVehicleId: number | null
  options: readonly VehicleListItem[]
  fine: VehicleFineRead | null
  onSaved?: (fine: VehicleFineRead) => void
  onOpenChange: (open: boolean) => void
  onBusyChange: (busy: boolean) => void
}): React.JSX.Element {
  const { t, i18n } = useTranslation()
  const queryClient = useQueryClient()
  const fieldId = useId()
  const alertId = `${fieldId}-alert`
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
      vehicle_id: String(locked?.id ?? initialVehicleId ?? options[0]?.id ?? ''),
      employee_id: fine?.employee_id ?? '',
      date: fine?.date?.slice(0, 10) ?? todayIso(),
      time: fine?.time?.slice(0, 5) ?? '',
      amount: fine ? filsToEditableText(fine.amount_fils) : DEFAULT_AMOUNT,
      black_points: fine ? String(fine.black_points) : '0',
      location: fine?.location ?? '',
      description: fine?.description ?? '',
    },
  })

  const mutation = useMutation({
    onMutate: () => onBusyChange(true),
    onSettled: () => onBusyChange(false),
    mutationFn: (values: Values): Promise<VehicleFineRead | VehicleRead> => {
      const vehicleId = Number(values.vehicle_id)
      const body = {
        employee_id: values.employee_id || null,
        date: values.date,
        time: values.time || null,
        amount_fils: parseAmountToFils(values.amount) as number,
        black_points: Number(values.black_points),
        location: values.location || null,
        description: values.description || null,
      }
      return fine
        ? api.updateVehicleFine(vehicleId, fine.id, body, fine.version)
        : api.addVehicleFine(vehicleId, body)
    },
    onSuccess: (result) => {
      const vehicleId = Number(watch('vehicle_id'))
      invalidateVehicleQueries(queryClient, { vehicleId, registers: ['fines'] })
      toast.success(t(fine ? 'vehicles.fineUpdated' : 'vehicles.fineAdded'))
      if (!fine) onSaved?.(result as VehicleFineRead)
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
  const editingLocked = Boolean(fine)
  const historyQuery = useQuery({
    queryKey: VEHICLE_QUERY_KEYS.detail(Number(selectedId)),
    queryFn: () => api.getVehicle(Number(selectedId)),
    enabled: Boolean(selectedId),
  })
  const history = useMemo(
    () => [...(historyQuery.data?.fines ?? [])].sort((a, b) => b.date.localeCompare(a.date) || b.id - a.id),
    [historyQuery.data?.fines],
  )
  const outstanding = useMemo(() => history.filter((record) => record.payment_status !== 'paid'), [history])
  const selectedVehicle = locked ?? options.find((option) => String(option.id) === selectedId)
  const selectedPlate = lockedLabel || (selectedVehicle ? plateLabel(selectedVehicle) : '')

  return (
    <form
      className="flex min-h-0 flex-1 flex-col"
      onSubmit={handleSubmit((values) => {
        setServerError(null)
        mutation.mutate(values)
      })}
    >
      <RequestBody asideLabel={t('vehicles.finesOnVehicle')} aside={
        <RequestNote title={<>{t('vehicles.finesOnVehicle')}{selectedPlate && <PlateChip plate={selectedPlate} size="sm" />}</>}>
          {historyQuery.isPending && selectedId ? <Skeleton className="h-24 w-full" /> : historyQuery.isError ? (
            <p role="alert">{t('common.loadError')} <Button type="button" variant="ghost" size="sm" onClick={() => void historyQuery.refetch()}>{t('common.retry')}</Button></p>
          ) : history.length ? <>
            <ul className="divide-y divide-border">
              {history.slice(0, 5).map((record) => <li key={record.id} className="flex flex-wrap items-center justify-between gap-2 py-3">
                <bdi dir="ltr" className="font-mono text-xs">{formatIsoDate(record.date)}</bdi>
                <FineAmount fils={record.amount_fils} />
                <VehicleStatusBadge family="payment" status={record.payment_status} />
              </li>)}
            </ul>
            <dl className="mt-4 grid gap-3">
              <div><dt className="text-muted-foreground">{t('vehicles.fineOpenTotal')}</dt><dd className="flex flex-wrap items-center gap-2"><bdi dir="ltr">{formatCount(outstanding.length)}</bdi> · <FineAmount fils={outstanding.reduce((sum, record) => sum + record.amount_fils, 0)} /></dd></div>
              <div><dt className="text-muted-foreground">{t('vehicles.blackPoints')}</dt><dd><bdi dir="ltr">{formatCount(outstanding.reduce((sum, record) => sum + record.black_points, 0))}</bdi></dd></div>
            </dl>
          </> : <p className="text-muted-foreground">{t('vehicles.noFines')}</p>}
        </RequestNote>
      }>
        <FormAlert id={alertId} message={alert} />

        <RequestSection index={1} title={t('vehicles.request.fine')}>
        {locked ? (
          <div className="flex flex-col gap-1.5">
            <Label id={`${fieldId}-vehicle-label`}>{t('vehicles.selectedVehicle')}</Label>
            <div role="group" aria-labelledby={`${fieldId}-vehicle-label`}>
              <PlateChip plate={lockedLabel || plateLabel(locked)} />
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
          </Field>
        )}

        <FieldGrid>
          <Field id={`${fieldId}-date`} label={t('vehicles.date')} required>
            <Input
              id={`${fieldId}-date`}
              type="date"
              dir="ltr"
              className="font-mono"
              autoFocus={editingLocked}
              {...register('date')}
              {...flag('date')}
            />
          </Field>
          <Field id={`${fieldId}-time`} label={t('vehicles.time')}>
            <Input
              id={`${fieldId}-time`}
              type="time"
              dir="ltr"
              className="font-mono"
              {...register('time')}
              {...flag('time')}
            />
          </Field>
          <Field id={`${fieldId}-amount`} label={t('vehicles.amount')} required>
            <div className="relative" dir="ltr">
              <span aria-hidden="true" className="pointer-events-none absolute inset-y-0 start-3 my-auto h-4 w-4 bg-current text-muted-foreground" style={{ mask: `url(${dirhamMark}) center / contain no-repeat`, WebkitMask: `url(${dirhamMark}) center / contain no-repeat` }} />
              <Input
                id={`${fieldId}-amount`}
                type="text"
                inputMode="decimal"
                className="ps-9 font-mono"
                dir="ltr"
                {...register('amount')}
                {...flag('amount')}
              />
            </div>
          </Field>
          <Field id={`${fieldId}-points`} label={t('vehicles.blackPoints')} required>
            <Input
              id={`${fieldId}-points`}
              type="number"
              min={0}
              step={1}
              inputMode="numeric"
              dir="ltr"
              className="font-mono"
              {...register('black_points')}
              {...flag('black_points')}
            />
          </Field>
        </FieldGrid>
        </RequestSection>
        <RequestSection index={2} title={t('vehicles.request.driverDetails')}>
        <FieldGrid>
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
          <Field id={`${fieldId}-location`} label={t('vehicles.location')} full>
            <Input id={`${fieldId}-location`} dir="auto" {...register('location')} />
          </Field>
          <Field id={`${fieldId}-description`} label={t('vehicles.description')} full>
            <Textarea
              id={`${fieldId}-description`}
              dir="auto"
              rows={2}
              className="min-h-[64px]"
              {...register('description')}
            />
          </Field>
        </FieldGrid>
        </RequestSection>
      </RequestBody>

      <RequestFooter busy={mutation.isPending}>
        <Button type="submit" size="lg" className="sm:min-w-[11rem]" disabled={mutation.isPending || !selectedId}>
          {mutation.isPending ? t('common.saving') : t('vehicles.save')}
        </Button>
      </RequestFooter>
    </form>
  )
}
