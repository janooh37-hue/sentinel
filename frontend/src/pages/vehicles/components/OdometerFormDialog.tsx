import { useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { useNavigate } from 'react-router-dom'
import { toast } from '@/lib/toast'

import { Button } from '@/components/ui/button'
import { api, type OdometerRowRead } from '@/lib/api'
import { localized, vehicleErrorMessage } from '../vehicleUtils'
import { PlateChip } from './PlateChip'
import { VehicleDialogBody, VehicleDialogFooter, VehicleDialogShell } from './VehicleDialogShell'

export function OdometerFormDialog({ month, rows, open, onOpenChange }: {
  month: string
  rows: OdometerRowRead[]
  open: boolean
  onOpenChange: (open: boolean) => void
}): React.JSX.Element {
  const { t } = useTranslation()
  const [busy, setBusy] = useState(false)
  return (
    <VehicleDialogShell open={open} onOpenChange={onOpenChange} title={t('vehicles.printOdometerForm')} description={t('vehicles.odometerFormDesc')} size="md" busy={busy}>
      <OdometerForm month={month} rows={rows} onClose={() => onOpenChange(false)} onBusyChange={setBusy} />
    </VehicleDialogShell>
  )
}

function OdometerForm({ month, rows, onClose, onBusyChange }: { month: string; rows: OdometerRowRead[]; onClose: () => void; onBusyChange: (busy: boolean) => void }): React.JSX.Element {
  const { t, i18n } = useTranslation()
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const [scope, setScope] = useState('all')
  const [selected, setSelected] = useState<number[]>([])
  const mutation = useMutation({
    mutationFn: () => api.generateOdometerForm({ month, vehicle_ids: scope === 'all' ? null : selected }),
    onMutate: () => onBusyChange(true),
    onSettled: () => onBusyChange(false),
    onSuccess: (result) => {
      void queryClient.invalidateQueries({ queryKey: ['books'] })
      void queryClient.invalidateQueries({ queryKey: ['dashboard'] })
      toast.success(t('vehicles.letterSaved'), { reference: result.ref_number })
      navigate(`/books/${result.book_id}`)
    },
    onError: (err) => toast.error(vehicleErrorMessage(err, t)),
  })
  return (
    <form className="flex min-h-0 flex-1 flex-col" aria-busy={mutation.isPending} onSubmit={(event) => {
      event.preventDefault()
      if (!mutation.isPending && (scope === 'all' || selected.length > 0)) mutation.mutate()
    }}>
      <VehicleDialogBody>
        <fieldset disabled={mutation.isPending} className="flex flex-col gap-3">
          <legend className="sr-only">{t('vehicles.odometerFormVehicles')}</legend>
          <label className="flex items-center gap-2 text-sm"><input type="radio" name="vehicle-scope" value="all" checked={scope === 'all'} onChange={() => setScope('all')} />{t('vehicles.allVehicles')}</label>
          <label className="flex items-center gap-2 text-sm"><input type="radio" name="vehicle-scope" value="selected" checked={scope === 'selected'} onChange={() => setScope('selected')} />{t('vehicles.selectedVehicles')}</label>
          {scope === 'selected' && <>
            <p className="text-xs text-muted-foreground">{t('vehicles.selectAtLeastOneVehicle')}</p>
            <div className="flex flex-col divide-y divide-hairline rounded-lg border border-border">
              {rows.map((row) => <label key={row.vehicle_id} className="flex cursor-pointer items-center gap-3 px-3 py-2.5">
                <input type="checkbox" checked={selected.includes(row.vehicle_id)} onChange={(event) => setSelected((previous) => event.target.checked ? [...previous, row.vehicle_id] : previous.filter((id) => id !== row.vehicle_id))} />
                <PlateChip plate={row.plate_label} size="sm" />
                <span className="text-xs text-muted-foreground" dir="auto">{localized(row.vehicle_type_ar, row.vehicle_type_en, i18n.language)}</span>
              </label>)}
            </div>
          </>}
        </fieldset>
      </VehicleDialogBody>
      <VehicleDialogFooter>
        <Button type="button" variant="outline" disabled={mutation.isPending} onClick={onClose}>{t('common.cancel')}</Button>
        <Button type="submit" disabled={mutation.isPending || rows.length === 0 || (scope === 'selected' && selected.length === 0)}>{t(mutation.isPending ? 'vehicles.odometerSaving' : 'vehicles.saveLetter')}</Button>
      </VehicleDialogFooter>
    </form>
  )
}
