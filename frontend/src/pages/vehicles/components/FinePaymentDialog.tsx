/**
 * FinePaymentDialog — record a completed payment, or attach a receipt later.
 *
 * Reused by the fleet ledger and the per-vehicle detail panel, matching the
 * app's one-form-per-record-action convention. Two modes over the same shell:
 * `payment` posts the atomic payment endpoint (optional receipt); `receipt`
 * attaches a receipt to a fine that is already paid and has none. Recording
 * payment never means cash changed hands here — it marks an already-settled
 * fine, exactly as the ledger explains.
 *
 * Stale `version` (another operator changed the fine first) follows the same
 * recovery as `AttendanceCorrectionDrawer`: refresh the underlying data and
 * show a banner, but never silently retry — the operator reviews and
 * resubmits explicitly, and the file/selection they picked is not lost
 * because this component never remounts on conflict.
 */

import { useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'

import { ApiError, api } from '@/lib/api'
import type { VehicleFineRead } from '@/lib/api'

import { FINE_RECEIPT_ACCEPT, invalidateVehicleQueries, vehicleErrorMessage } from '../vehicleUtils'
import { FineAmount } from './FineAmount'
import {
  UploadSlot,
  VehicleDialogBody,
  VehicleDialogFooter,
  VehicleDialogShell,
  VehicleFormAlert,
} from './VehicleDialogShell'
import { Button } from '@/components/ui/button'

export type FinePaymentMode = 'payment' | 'receipt'

interface Props {
  open: boolean
  onOpenChange: (open: boolean) => void
  fine: VehicleFineRead
  mode: FinePaymentMode
  onSaved?: (fine: VehicleFineRead) => void
}

export function FinePaymentDialog({
  open,
  onOpenChange,
  fine,
  mode,
  onSaved,
}: Props): React.JSX.Element {
  const { t } = useTranslation()
  const [busy, setBusy] = useState(false)
  return (
    <VehicleDialogShell
      open={open}
      onOpenChange={onOpenChange}
      title={t(mode === 'payment' ? 'vehicles.fines.recordPayment' : 'vehicles.fines.attachReceipt')}
      description={t(
        mode === 'payment' ? 'vehicles.fines.recordPaymentDesc' : 'vehicles.fines.attachReceiptDesc',
      )}
      size="md"
      busy={busy}
    >
      <PaymentForm
        fine={fine}
        mode={mode}
        onSaved={onSaved}
        onOpenChange={onOpenChange}
        onBusyChange={setBusy}
      />
    </VehicleDialogShell>
  )
}

function PaymentForm({
  fine,
  mode,
  onSaved,
  onOpenChange,
  onBusyChange,
}: {
  fine: VehicleFineRead
  mode: FinePaymentMode
  onSaved?: (fine: VehicleFineRead) => void
  onOpenChange: (open: boolean) => void
  onBusyChange: (busy: boolean) => void
}): React.JSX.Element {
  const { t } = useTranslation()
  const queryClient = useQueryClient()
  const [file, setFile] = useState<File | null>(null)
  const [serverError, setServerError] = useState<string | null>(null)
  const [conflict, setConflict] = useState(false)

  const mutation = useMutation({
    onMutate: () => onBusyChange(true),
    onSettled: () => onBusyChange(false),
    mutationFn: (): Promise<VehicleFineRead> =>
      mode === 'payment'
        ? api.recordVehicleFinePayment(fine.vehicle_id, fine.id, fine.version, file)
        : api.attachVehicleFineReceipt(fine.vehicle_id, fine.id, fine.version, file as File),
    onSuccess: (updated) => {
      invalidateVehicleQueries(queryClient, { vehicleId: fine.vehicle_id, registers: ['fines'] })
      toast.success(
        t(mode === 'payment' ? 'vehicles.fines.paymentRecorded' : 'vehicles.fines.receiptAttachedToast'),
      )
      onSaved?.(updated)
      onOpenChange(false)
    },
    onError: (err) => {
      if (err instanceof ApiError && err.code === 'VEHICLE_FINE_VERSION_CONFLICT') {
        setConflict(true)
        invalidateVehicleQueries(queryClient, { vehicleId: fine.vehicle_id, registers: ['fines'] })
        return
      }
      const message = vehicleErrorMessage(err, t)
      setServerError(message)
      toast.error(message)
    },
  })

  const canSubmit = mode === 'payment' || file != null
  const alert = conflict
    ? t('vehicles.fines.errors.versionConflict')
    : serverError

  return (
    <form
      className="flex min-h-0 flex-1 flex-col"
      onSubmit={(event) => {
        event.preventDefault()
        setConflict(false)
        setServerError(null)
        mutation.mutate()
      }}
    >
      <VehicleDialogBody>
        <VehicleFormAlert id="fine-payment-alert" message={alert} />

        <div className="flex flex-col gap-1 rounded-lg border border-border bg-surface-raised p-3">
          <span className="text-[0.72rem] text-muted-foreground" dir="auto">
            {fine.vehicle_plate_label}
          </span>
          <FineAmount fils={fine.amount_fils} size="lg" />
        </div>

        <UploadSlot
          label={t(
            mode === 'payment' ? 'vehicles.fines.receiptOptional' : 'vehicles.fines.receiptFile',
          )}
          accept={FINE_RECEIPT_ACCEPT}
          file={file}
          onFile={setFile}
          onClear={() => setFile(null)}
          clearLabel={t('common.remove')}
          disabled={mutation.isPending}
          hint={t('vehicles.fines.receiptHint')}
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
        <Button type="submit" disabled={mutation.isPending || !canSubmit}>
          {mutation.isPending
            ? t('common.saving')
            : t(mode === 'payment' ? 'vehicles.fines.recordPayment' : 'vehicles.fines.attachReceipt')}
        </Button>
      </VehicleDialogFooter>
    </form>
  )
}
