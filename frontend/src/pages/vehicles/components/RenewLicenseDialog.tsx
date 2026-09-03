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
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { zodResolver } from '@hookform/resolvers/zod'
import { useForm } from 'react-hook-form'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { z } from 'zod'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { api } from '@/lib/api'
import type { VehicleRead } from '@/lib/api'

import {
  DOCUMENT_ACCEPT,
  addDaysIso,
  invalidateVehicleQueries,
  licenseWindowEnd,
  plateLabel,
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

/** What this fleet's renewal has cost; overridden when the receipt differs. */
const DEFAULT_COST = '1450'

const schema = z
  .object({
    start: z.string().min(1),
    expiry: z.string().min(1),
    /** Whole dirhams as typed; converted on submit. */
    cost: z.string().regex(/^\d{1,7}$/),
  })
  .superRefine((values, ctx) => {
    if (values.expiry <= values.start) {
      ctx.addIssue({ code: 'custom', path: ['expiry'], message: 'expiry' })
    }
  })

type Values = z.output<typeof schema>

interface Props {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** Plate + current window, from the ledger row or the vehicle file. */
  vehicle: {
    id: number
    plate_code?: string | null
    plate_number: string
    license_expiry: string
  }
  onSaved?: (vehicle: VehicleRead) => void
}

export function RenewLicenseDialog({
  open,
  onOpenChange,
  vehicle,
  onSaved,
}: Props): React.JSX.Element {
  const { t } = useTranslation()
  // The form owns the mutation (scan upload + renewal); the shell owns
  // dismissal, so the in-flight state is reported up to it.
  const [busy, setBusy] = useState(false)
  return (
    <VehicleDialogShell
      open={open}
      onOpenChange={onOpenChange}
      title={t('vehicles.renewTitle')}
      description={t('vehicles.renewDesc')}
      size="lg"
      busy={busy}
    >
      <RenewForm
        vehicle={vehicle}
        onSaved={onSaved}
        onOpenChange={onOpenChange}
        onBusyChange={setBusy}
      />
    </VehicleDialogShell>
  )
}

function RenewForm({
  vehicle,
  onSaved,
  onOpenChange,
  onBusyChange,
}: {
  vehicle: Props['vehicle']
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
  // The expiry follows the start until the operator sets it himself.
  const [expiryEdited, setExpiryEdited] = useState(false)

  const defaultStart = addDaysIso(vehicle.license_expiry, 1)
  const {
    register,
    handleSubmit,
    setValue,
    formState: { errors },
  } = useForm<z.input<typeof schema>, unknown, Values>({
    resolver: zodResolver(schema),
    defaultValues: {
      start: defaultStart,
      expiry: licenseWindowEnd(defaultStart),
      cost: DEFAULT_COST,
    },
  })

  const mutation = useMutation({
    onMutate: () => onBusyChange(true),
    onSettled: () => onBusyChange(false),
    mutationFn: async (values: Values): Promise<VehicleRead> => {
      // The scan has to exist before the renewal can reference it.
      const scanFileId = scan
        ? (await api.uploadVehicleFile(vehicle.id, 'license', scan)).id
        : null
      return api.renewVehicleLicense(vehicle.id, {
        start: values.start,
        expiry: values.expiry,
        cost: Number(values.cost),
        scan_file_id: scanFileId,
      })
    },
    onSuccess: (updated) => {
      invalidateVehicleQueries(queryClient, { vehicleId: vehicle.id })
      toast.success(t('vehicles.licenseRenewed'))
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

  const startField = register('start')

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
          <Label id={`${fieldId}-plate-label`}>{t('vehicles.plate')}</Label>
          <div
            role="group"
            aria-labelledby={`${fieldId}-plate-label`}
            className="flex flex-wrap items-center gap-2"
          >
            <PlateChip plate={plateLabel(vehicle)} />
            <span className="text-xs text-muted-foreground">
              {t('vehicles.licenseExpiry')}:{' '}
              <bdi dir="ltr" className="font-mono">
                {vehicle.license_expiry}
              </bdi>
            </span>
          </div>
        </div>

        <VehicleFieldGrid>
          <VehicleField id={`${fieldId}-start`} label={t('vehicles.newStart')} required>
            <Input
              id={`${fieldId}-start`}
              type="date"
              className="font-mono"
              autoFocus
              {...startField}
              onChange={(event) => {
                void startField.onChange(event)
                if (!expiryEdited) setValue('expiry', licenseWindowEnd(event.target.value))
              }}
              {...flag('start')}
            />
          </VehicleField>
          <VehicleField id={`${fieldId}-expiry`} label={t('vehicles.newExpiry')} required>
            <Input
              id={`${fieldId}-expiry`}
              type="date"
              className="font-mono"
              {...register('expiry', { onChange: () => setExpiryEdited(true) })}
              {...flag('expiry')}
            />
          </VehicleField>
          <VehicleField id={`${fieldId}-cost`} label={t('vehicles.renewalCost')} required>
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
        </VehicleFieldGrid>

        <UploadSlot
          label={t('vehicles.uploadScan')}
          accept={DOCUMENT_ACCEPT}
          file={scan}
          onFile={setScan}
          onClear={() => setScan(null)}
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
        <Button type="submit" disabled={mutation.isPending}>
          {mutation.isPending ? t('common.saving') : t('vehicles.renew')}
        </Button>
      </VehicleDialogFooter>
    </form>
  )
}
