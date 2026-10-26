import { useMutation, useQueryClient } from '@tanstack/react-query'
import { FormProvider, useForm } from 'react-hook-form'
import { useTranslation } from 'react-i18next'
import { toast } from '@/lib/toast'

import { RecipientPickerField } from '@/components/application/fields/RecipientPickerField'
import { Button } from '@/components/ui/button'
import { api, type VehiclesSummary } from '@/lib/api'
import { EMPTY_VALUE, VEHICLE_QUERY_KEYS, vehicleErrorMessage } from '../vehicleUtils'

export function MaintenanceContractorSetting({ summary, canEdit }: {
  summary: VehiclesSummary
  canEdit: boolean
}): React.JSX.Element {
  const { t } = useTranslation()
  const queryClient = useQueryClient()
  const methods = useForm<{ maintenance_contractor_id: number | null }>({
    defaultValues: { maintenance_contractor_id: summary.maintenance_contractor_id ?? null },
  })
  const selectedId = methods.watch('maintenance_contractor_id')
  const mutation = useMutation({
    mutationFn: (id: number | null) => api.setVehicleMaintenanceContractor(id),
    onSuccess: (next) => {
      queryClient.setQueryData(VEHICLE_QUERY_KEYS.summary, next)
      toast.success(t('vehicles.maintenanceContractorSaved'))
    },
    onError: (error) => toast.error(vehicleErrorMessage(error, t)),
  })

  return (
    <div className="w-full sm:w-auto sm:min-w-72">
      {canEdit ? (
        <FormProvider {...methods}>
          <form onSubmit={methods.handleSubmit((values) => {
            if (!mutation.isPending) mutation.mutate(values.maintenance_contractor_id)
          })}>
            <fieldset disabled={mutation.isPending} className="flex items-end gap-2">
              <div className="min-w-0 flex-1">
                <RecipientPickerField
                  name="maintenance_contractor_id"
                  label_en={t('vehicles.maintenanceContractor', { lng: 'en' })}
                  label_ar={t('vehicles.maintenanceContractor', { lng: 'ar' })}
                />
              </div>
              <Button type="submit" size="sm" variant="outline" disabled={mutation.isPending || selectedId === (summary.maintenance_contractor_id ?? null)}>{t(mutation.isPending ? 'common.saving' : 'common.save')}</Button>
            </fieldset>
          </form>
        </FormProvider>
      ) : (
        <p className="text-xs text-muted-foreground">{t('vehicles.maintenanceContractor')}: <span dir="auto">{summary.maintenance_contractor_name || EMPTY_VALUE}</span></p>
      )}
    </div>
  )
}
