/**
 * AddVehicleDialog registers a vehicle and its first licence. The reusable
 * main photo is selected or uploaded before submit, so the asset pointer lands
 * in the create request. A licence attachment still follows creation; failures
 * there are reported without inviting a duplicate vehicle retry.
 */

import { useId, useRef, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { zodResolver } from '@hookform/resolvers/zod'
import { useForm } from 'react-hook-form'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { api } from '@/lib/api'
import type { VehiclePhotoRead, VehicleRead, VehicleSiteRead, VehicleUpdate } from '@/lib/api'

import {
  DOCUMENT_ACCEPT,
  VEHICLE_QUERY_KEYS,
  invalidateVehicleQueries,
  vehicleErrorMessage,
} from '../vehicleUtils'
import {
  type VehicleFormInput,
  type VehicleFormValues,
  vehicleCreatePayload,
  vehicleFormDefaults,
  vehicleFormSchema,
} from '../vehicleForm'
import {
  UploadSlot,
  VehicleDialogBody,
  VehicleDialogFooter,
  VehicleDialogShell,
  VehicleFormAlert,
} from './VehicleDialogShell'
import { VehicleFormFields } from './VehicleFormFields'
import { VehicleLicenceScanControl } from './VehicleLicenceScanControl'
import { VehiclePhotoPicker } from './VehiclePhotoPicker'

interface Props {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** The stored record, once every request has landed. */
  onSaved?: (vehicle: VehicleRead) => void
}

export function AddVehicleDialog({ open, onOpenChange, onSaved }: Props): React.JSX.Element {
  const { t } = useTranslation()
  // The form owns the mutation, the shell owns dismissal — so the form reports
  // its in-flight state up here, where the shell can refuse Escape and the
  // overlay for the whole create → upload → patch sequence.
  const [busy, setBusy] = useState(false)
  const sitesQuery = useQuery({
    queryKey: VEHICLE_QUERY_KEYS.sites,
    queryFn: () => api.listVehicleSites(),
    enabled: open,
    staleTime: 60_000,
  })
  const sites = sitesQuery.data

  return (
    <VehicleDialogShell
      open={open}
      onOpenChange={onOpenChange}
      title={t('vehicles.addVehicleTitle')}
      description={t('vehicles.addVehicleDesc')}
      size="xl"
      busy={busy}
    >
      {sites ? (
        <AddVehicleForm
          sites={sites}
          onSaved={onSaved}
          onOpenChange={onOpenChange}
          onBusyChange={setBusy}
        />
      ) : (
        <VehicleDialogBody>
          <Skeleton className="h-9 w-full" />
          <Skeleton className="h-9 w-2/3" />
          <Skeleton className="h-9 w-1/2" />
        </VehicleDialogBody>
      )}
    </VehicleDialogShell>
  )
}

/**
 * Mounted only while the dialog is open (Radix unmounts the content), so every
 * default below is re-applied on each open without a re-seeding effect.
 */
function AddVehicleForm({
  sites,
  onSaved,
  onOpenChange,
  onBusyChange,
}: {
  sites: readonly VehicleSiteRead[]
  onSaved?: (vehicle: VehicleRead) => void
  onOpenChange: (open: boolean) => void
  onBusyChange: (busy: boolean) => void
}): React.JSX.Element {
  const { t } = useTranslation()
  const queryClient = useQueryClient()
  const fieldId = useId()
  const alertId = `${fieldId}-alert`

  const [photoPickerOpen, setPhotoPickerOpen] = useState(false)
  const [selectedPhoto, setSelectedPhoto] = useState<VehiclePhotoRead | null>(null)
  const scanRetainedFileRef = useRef<File | null>(null)
  const [licenseFile, setLicenseFile] = useState<File | null>(null)
  const [serverError, setServerError] = useState<string | null>(null)

  const form = useForm<VehicleFormInput, unknown, VehicleFormValues>({
    resolver: zodResolver(vehicleFormSchema),
    defaultValues: vehicleFormDefaults(null, sites),
  })
  const {
    handleSubmit,
    formState: { errors },
  } = form

  const mutation = useMutation({
    mutationFn: async (
      values: VehicleFormValues,
    ): Promise<{ vehicle: VehicleRead; failures: string[] }> => {
      const body = {
        ...vehicleCreatePayload(values),
        photo_asset_id: selectedPhoto?.id ?? null,
      }
      let vehicle = await api.createVehicle(body)
      const patch: VehicleUpdate = {}
      const failures: string[] = []
      if (licenseFile) {
        try {
          patch.license_file_id = (
            await api.uploadVehicleFile(vehicle.id, 'license', licenseFile)
          ).id
        } catch (err) {
          failures.push(vehicleErrorMessage(err, t))
        }
      }
      if (Object.keys(patch).length > 0) {
        try {
          vehicle = await api.updateVehicle(vehicle.id, patch)
        } catch (err) {
          // The vehicle EXISTS by now; only the file pointers failed to land.
          // Failing the whole mutation here would report "nothing happened"
          // and invite a retry that collides with the plate just registered
          // (PLATE_EXISTS). So the record is reported as saved, the unlinked
          // attachment as the one failure, and the caches are refreshed either
          // way — the operator re-attaches from the vehicle file.
          failures.push(vehicleErrorMessage(err, t))
        }
      }
      return { vehicle, failures }
    },
    onMutate: () => onBusyChange(true),
    onSettled: () => onBusyChange(false),
    onSuccess: ({ vehicle, failures }) => {
      invalidateVehicleQueries(queryClient, { vehicleId: vehicle.id, registers: ['sites'] })
      toast.success(t('vehicles.vehicleAdded'))
      for (const failure of failures) toast.error(failure)
      onSaved?.(vehicle)
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

  return (
    <>
    <form
      className="flex min-h-0 flex-1 flex-col"
      onSubmit={handleSubmit((values) => {
        setServerError(null)
        mutation.mutate(values)
      })}
    >
      <VehicleDialogBody>
        <VehicleFormAlert id={alertId} message={alert} />
        <VehicleFormFields
          form={form}
          sites={sites}
          mode="create"
          fieldIdPrefix={fieldId}
          alertId={alertId}
        />

        <div className="grid grid-cols-1 gap-3.5 sm:grid-cols-2">
          <div className="flex flex-col gap-2 rounded-lg border border-border bg-surface-raised p-3">
            <span className="text-xs font-semibold text-foreground">
              {t('vehicles.mainPhoto')}
            </span>
            {selectedPhoto ? (
              <img
                src={selectedPhoto.preview_url}
                alt={t('vehicles.mainPhoto')}
                className="h-28 w-full rounded-md bg-surface-tinted object-contain"
              />
            ) : (
              <p className="grid h-20 place-items-center text-center text-xs text-muted-foreground">
                {t('vehicles.photoLibrary.noSelection')}
              </p>
            )}
            <Button
              type="button"
              size="sm"
              variant="secondary"
              disabled={mutation.isPending}
              onClick={() => setPhotoPickerOpen(true)}
            >
              {t('vehicles.photoLibrary.choose')}
            </Button>
          </div>
          <div className="flex flex-col gap-3.5">
            <UploadSlot
              label={t('vehicles.licenseScan')}
              accept={DOCUMENT_ACCEPT}
              file={licenseFile}
              onFile={(file) => {
                scanRetainedFileRef.current = null
                setLicenseFile(file)
              }}
              onClear={() => {
                scanRetainedFileRef.current = null
                setLicenseFile(null)
              }}
              disabled={mutation.isPending}
              clearLabel={t('common.remove')}
            />
            <VehicleLicenceScanControl
              currentValues={form.watch()}
              onApply={(fields) => {
                for (const [field, value] of Object.entries(fields) as Array<
                  [keyof VehicleFormValues, string]
                >) {
                  form.setValue(field, value, { shouldDirty: true, shouldValidate: true })
                }
              }}
              onFileRetained={(file) => {
                const previouslyRetained = scanRetainedFileRef.current
                scanRetainedFileRef.current = file
                if (file) {
                  setLicenseFile(file)
                } else {
                  setLicenseFile((current) =>
                    current === previouslyRetained ? null : current,
                  )
                }
              }}
              disabled={mutation.isPending}
            />
          </div>
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
        <Button type="submit" disabled={mutation.isPending}>
          {mutation.isPending ? t('common.saving') : t('vehicles.save')}
        </Button>
      </VehicleDialogFooter>
    </form>
      <VehiclePhotoPicker
        open={photoPickerOpen}
        onOpenChange={setPhotoPickerOpen}
        currentAssetId={selectedPhoto?.id ?? null}
        currentPreviewUrl={selectedPhoto?.preview_url}
        onSave={setSelectedPhoto}
      />
    </>
  )
}
