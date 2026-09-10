/**
 * Edit vehicle — `/vehicles/edit` (searchable active-vehicle selector) and
 * `/vehicles/edit/:id` (the full-page editor).
 *
 * Two-step flow: pick a vehicle (or arrive by direct link), then edit its
 * profile. Field schema, rendering, and payload mapping are shared with
 * `AddVehicleDialog` via `vehicleForm.ts` / `VehicleFormFields`. Editing
 * identity/spec fields never rewrites stored licence dates — the diff-based
 * `vehicleUpdatePayload` only sends what the operator actually changed, and
 * the section links to the existing Renew action for starting a new period.
 */

import { useEffect, useId, useRef, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { zodResolver } from '@hookform/resolvers/zod'
import { FileText, Image as ImageIcon, Search, Upload, X } from 'lucide-react'
import { useForm } from 'react-hook-form'
import { useTranslation } from 'react-i18next'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import { ConfirmDialog } from '@/components/ui/confirm-dialog'
import { EmptyState } from '@/components/ui/empty-state'
import { Input } from '@/components/ui/input'
import { Skeleton } from '@/components/ui/skeleton'
import { ApiError, api } from '@/lib/api'
import { isolateBidi } from '@/lib/useCapabilityCatalog'
import type { VehicleListItem, VehicleRead, VehicleUpdate } from '@/lib/api'
import { useDebouncedValue } from '@/lib/useDebouncedValue'

import {
  type VehicleFormInput,
  type VehicleFormValues,
  vehicleFormDefaults,
  vehicleFormSchema,
  vehicleUpdatePayload,
} from './vehicleForm'
import {
  DOCUMENT_ACCEPT,
  IMAGE_ACCEPT,
  VEHICLE_QUERY_KEYS,
  invalidateVehicleQueries,
  localized,
  plateLabel,
  vehicleErrorMessage,
} from './vehicleUtils'
import { PlateChip } from './components/PlateChip'
import { UploadSlot } from './components/VehicleDialogShell'
import { VehicleLicenceScanControl } from './components/VehicleLicenceScanControl'
import { VehicleFormFields } from './components/VehicleFormFields'

export function VehicleEditPage(): React.JSX.Element {
  const { id } = useParams<{ id: string }>()
  const vehicleId = id && /^\d+$/.test(id) ? Number(id) : null
  return vehicleId == null ? <VehicleEditSelector /> : <VehicleEditEditor vehicleId={vehicleId} />
}

// ── Selector ────────────────────────────────────────────────────────────────

function VehicleEditSelector(): React.JSX.Element {
  const { t } = useTranslation()
  const searchId = useId()
  const [query, setQuery] = useState('')
  const debouncedQuery = useDebouncedValue(query.trim(), 300)

  const searchQuery = useQuery({
    queryKey: [...VEHICLE_QUERY_KEYS.list, { q: debouncedQuery, state: 'active' as const }],
    queryFn: () => api.listVehicles({ q: debouncedQuery || undefined, state: 'active' }),
  })
  const results = searchQuery.data ?? []

  return (
    <div className="flex flex-1 flex-col overflow-hidden bg-background">
      <header className="shrink-0 px-4 pb-2 pt-3 md:px-6 md:pb-3 md:pt-5">
        <h1 className="text-xl font-bold tracking-tight text-foreground md:text-[1.55em]">
          {t('vehicles.editVehicleService')}
        </h1>
        <p className="mt-1 text-[0.84em] text-muted-foreground">{t('vehicles.selectVehicleToEdit')}</p>
      </header>
      <div className="flex-1 overflow-y-auto px-4 pb-24 md:px-6">
        <div className="relative mb-4 max-w-md">
          <Search
            className="pointer-events-none absolute inset-y-0 start-2.5 my-auto h-3.5 w-3.5 text-muted-foreground"
            aria-hidden
          />
          <label className="sr-only" htmlFor={searchId}>
            {t('vehicles.searchVehicle')}
          </label>
          <Input
            id={searchId}
            type="search"
            dir="auto"
            autoFocus
            className="ps-8"
            placeholder={t('vehicles.searchVehicle')}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
        </div>

        {searchQuery.isError ? (
          <EmptyState
            message={t('common.loadError')}
            actionLabel={t('common.retry')}
            onAction={() => void searchQuery.refetch()}
          />
        ) : searchQuery.isLoading ? (
          <div className="flex flex-col gap-2">
            {Array.from({ length: 4 }).map((_, index) => (
              <Skeleton key={index} className="h-14 w-full" />
            ))}
          </div>
        ) : results.length === 0 ? (
          <EmptyState message={t('vehicles.noVehicles')} description={t('vehicles.adjustFilters')} />
        ) : (
          <ul className="flex flex-col gap-2">
            {results.map((vehicle) => (
              <li key={vehicle.id}>
                <SelectorRow vehicle={vehicle} />
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  )
}

function SelectorRow({ vehicle }: { vehicle: VehicleListItem }): React.JSX.Element {
  const { i18n } = useTranslation()
  return (
    <Link
      to={`/vehicles/edit/${vehicle.id}`}
      className="flex items-center justify-between gap-3 rounded-xl border border-border bg-surface p-3 transition-colors hover:border-border-strong focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:ring-offset-background"
    >
      <span className="flex items-center gap-3">
        <PlateChip plate={vehicle.plate_label || vehicle.plate_number} />
        <span dir="auto" className="text-[0.85rem] font-medium text-foreground">
          {localized(vehicle.type_ar, vehicle.type_en, i18n.language)}
        </span>
      </span>
    </Link>
  )
}

// ── Editor ──────────────────────────────────────────────────────────────────

function VehicleEditEditor({ vehicleId }: { vehicleId: number }): React.JSX.Element {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const fieldId = useId()
  const alertId = `${fieldId}-alert`

  const vehicleQuery = useQuery({
    queryKey: VEHICLE_QUERY_KEYS.detail(vehicleId),
    queryFn: () => api.getVehicle(vehicleId),
  })
  const sitesQuery = useQuery({
    queryKey: VEHICLE_QUERY_KEYS.sites,
    queryFn: () => api.listVehicleSites(),
    staleTime: 60_000,
  })

  const notFound =
    vehicleQuery.error instanceof ApiError && vehicleQuery.error.status === 404
  const vehicle = vehicleQuery.data
  const sites = sitesQuery.data

  if (notFound) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-3 bg-background p-6">
        <EmptyState message={t('vehicles.vehicleNotFound')} description={t('vehicles.vehicleNotFoundDesc')} />
        <Link to="/vehicles/edit" className="text-sm font-medium text-primary hover:underline">
          {t('vehicles.selectVehicleToEdit')}
        </Link>
      </div>
    )
  }
  if (vehicleQuery.isError) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-3 bg-background p-6">
        <EmptyState
          message={t('common.loadError')}
          actionLabel={t('vehicles.retry')}
          onAction={() => void vehicleQuery.refetch()}
        />
      </div>
    )
  }
  if (!vehicle || !sites) {
    return (
      <div className="flex flex-1 flex-col gap-3 bg-background p-4 md:p-6">
        <Skeleton className="h-9 w-72" />
        <Skeleton className="h-64 w-full" />
      </div>
    )
  }

  if (vehicle.archived_at) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-3 bg-background p-6 text-center">
        <PlateChip plate={vehicle.plate_label || vehicle.plate_number} size="lg" />
        <p className="text-sm font-medium text-foreground">{t('vehicles.archivedStatus')}</p>
        <p className="max-w-sm text-sm text-muted-foreground">{t('vehicles.archivedNotice')}</p>
        <Link
          to={`/vehicles/${vehicle.id}`}
          className="text-sm font-medium text-primary hover:underline"
        >
          {t('vehicles.backHub')}
        </Link>
      </div>
    )
  }

  return (
    <EditorForm
      vehicle={vehicle}
      sites={sites}
      fieldId={fieldId}
      alertId={alertId}
      onSaved={(saved) => {
        toast.success(t('vehicles.vehicleUpdated'))
        navigate(`/vehicles/${saved.id}`)
      }}
    />
  )
}

type PendingLicenceFile = {
  file: File
  uploadedFileId: number | null
}

type EditorSaveResult = {
  vehicle: VehicleRead
  galleryUploaded: File[]
  licenceFile: File | null
  licenceUploadedFileId: number | null
  licenceAttached: boolean
  failures: string[]
}

const VEHICLE_IDENTITY_PATCH_FIELDS: readonly (keyof VehicleUpdate)[] = [
  'plate_code',
  'plate_number',
  'traffic_code',
  'vin',
  'type_ar',
  'type_en',
  'class_ar',
  'class_en',
  'site_id',
]

function EditorSection({
  title,
  children,
}: {
  title: string
  children: React.ReactNode
}): React.JSX.Element {
  return (
    <section className="space-y-3">
      <h3 className="text-sm font-semibold text-foreground">{title}</h3>
      {children}
    </section>
  )
}

function EditorForm({
  vehicle,
  sites,
  fieldId,
  alertId,
  onSaved,
}: {
  vehicle: VehicleRead
  sites: Parameters<typeof vehicleFormDefaults>[1]
  fieldId: string
  alertId: string
  onSaved: (vehicle: VehicleRead) => void
}): React.JSX.Element {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const savedVehicleRef = useRef(vehicle)
  const scanRetainedFileRef = useRef<File | null>(null)
  const [serverError, setServerError] = useState<string | null>(null)
  const [discardConfirmOpen, setDiscardConfirmOpen] = useState(false)
  const [pendingGalleryFiles, setPendingGalleryFiles] = useState<File[]>([])
  const [pendingLicence, setPendingLicence] = useState<PendingLicenceFile | null>(null)

  const form = useForm<VehicleFormInput, unknown, VehicleFormValues>({
    resolver: zodResolver(vehicleFormSchema),
    defaultValues: vehicleFormDefaults(vehicle, sites),
  })
  const {
    handleSubmit,
    formState: { errors, isDirty },
  } = form
  const currentValues = form.watch()
  const hasPendingFiles = pendingGalleryFiles.length > 0 || pendingLicence != null
  const hasUnsavedChanges = isDirty || hasPendingFiles

  // Tab close/reload while dirty — Cancel/back inside the app is handled by
  // the confirm dialog below (BrowserRouter has no navigation blocker).
  useEffect(() => {
    if (!hasUnsavedChanges) return
    const handler = (event: BeforeUnloadEvent) => {
      event.preventDefault()
    }
    window.addEventListener('beforeunload', handler)
    return () => window.removeEventListener('beforeunload', handler)
  }, [hasUnsavedChanges])

  const mutation = useMutation({
    mutationFn: async (values: VehicleFormValues): Promise<EditorSaveResult> => {
      let savedVehicle = savedVehicleRef.current
      const patch = vehicleUpdatePayload(values, savedVehicle)
      if (Object.keys(patch).length > 0) {
        savedVehicle = await api.updateVehicle(vehicle.id, patch)
        const identityChanged = VEHICLE_IDENTITY_PATCH_FIELDS.some((field) =>
          Object.prototype.hasOwnProperty.call(patch, field),
        )
        invalidateVehicleQueries(queryClient, {
          vehicleId: savedVehicle.id,
          registers: identityChanged
            ? ['sites', 'fines', 'accidents', 'maintenance']
            : undefined,
        })
      }

      const galleryUploaded: File[] = []
      const failures: string[] = []
      for (const file of pendingGalleryFiles) {
        try {
          await api.uploadVehicleFile(vehicle.id, 'gallery', file)
          invalidateVehicleQueries(queryClient, { vehicleId: vehicle.id })
          galleryUploaded.push(file)
        } catch (err) {
          failures.push(vehicleErrorMessage(err, t))
        }
      }

      const licenceFile = pendingLicence?.file ?? null
      let licenceUploadedFileId = pendingLicence?.uploadedFileId ?? null
      let licenceAttached = false
      if (pendingLicence) {
        if (licenceUploadedFileId == null) {
          try {
            const uploadedFile = await api.uploadVehicleFile(
              vehicle.id,
              'license',
              pendingLicence.file,
            )
            licenceUploadedFileId = uploadedFile.id
            invalidateVehicleQueries(queryClient, { vehicleId: vehicle.id })
          } catch (err) {
            failures.push(vehicleErrorMessage(err, t))
          }
        }
        if (licenceUploadedFileId != null) {
          try {
            savedVehicle = await api.updateVehicle(vehicle.id, {
              license_file_id: licenceUploadedFileId,
            })
            invalidateVehicleQueries(queryClient, { vehicleId: vehicle.id })
            licenceAttached = true
          } catch (err) {
            failures.push(vehicleErrorMessage(err, t))
          }
        }
      }

      return {
        vehicle: savedVehicle,
        galleryUploaded,
        licenceFile,
        licenceUploadedFileId,
        licenceAttached,
        failures,
      }
    },
    onSuccess: (result) => {
      savedVehicleRef.current = result.vehicle
      form.reset(vehicleFormDefaults(result.vehicle, sites))
      if (result.galleryUploaded.length > 0) {
        setPendingGalleryFiles((current) =>
          current.filter((file) => !result.galleryUploaded.includes(file)),
        )
      }
      if (result.licenceFile) {
        setPendingLicence((current) => {
          if (!current || current.file !== result.licenceFile) return current
          if (result.licenceAttached) return null
          return { ...current, uploadedFileId: result.licenceUploadedFileId }
        })
      }

      if (result.failures.length > 0) {
        const summary = t('vehicles.filesFailedAfterSave', {
          count: isolateBidi(String(result.failures.length)),
        })
        setServerError(summary)
        toast.error(summary)
        for (const failure of result.failures) toast.error(failure)
        return
      }

      setServerError(null)
      setPendingGalleryFiles([])
      setPendingLicence(null)
      onSaved(result.vehicle)
    },
    onError: (err) => {
      const message = vehicleErrorMessage(err, t)
      setServerError(message)
      toast.error(message)
    },
  })

  const invalid = Object.keys(errors).length > 0
  const alert = serverError ?? (invalid ? t('vehicles.requiredFields') : null)
  const plate = vehicle.plate_label || plateLabel(vehicle)

  const leave = (): void => {
    if (hasUnsavedChanges) setDiscardConfirmOpen(true)
    else navigate(`/vehicles/${vehicle.id}`)
  }

  return (
    <div className="flex flex-1 flex-col overflow-hidden bg-background">
      <header className="shrink-0 px-4 pb-2 pt-3 md:px-6 md:pb-3 md:pt-5">
        <h1 className="flex flex-wrap items-center gap-2 text-xl font-bold tracking-tight text-foreground md:text-[1.55em]">
          {t('vehicles.editVehicle')}
          <span aria-hidden className="text-faint">
            ·
          </span>
          <PlateChip plate={plate} size="lg" />
        </h1>
        <p className="mt-1 hidden text-[0.84em] text-muted-foreground md:block">
          {t('vehicles.editVehicleDesc')}
        </p>
      </header>

      <form
        className="flex min-h-0 flex-1 flex-col"
        onSubmit={handleSubmit((values) => {
          setServerError(null)
          mutation.mutate(values)
        })}
      >
        <div className="flex-1 overflow-y-auto px-4 pb-24 md:px-6">
          {alert && (
            <p
              id={alertId}
              role="alert"
              className="mb-4 rounded-lg border border-accent/30 bg-accent-soft px-3 py-2 text-[0.8em] font-medium text-accent"
            >
              {alert}
            </p>
          )}
          <div className="space-y-6">
            <VehicleFormFields
              form={form}
              sites={sites}
              mode="edit"
              vehicle={vehicle}
              fieldIdPrefix={fieldId}
              alertId={alertId}
            />

            <EditorSection title={t('vehicles.sections.photos')}>
              {(vehicle.photo_url || vehicle.license_url) && (
                <div className="grid grid-cols-1 gap-3.5 sm:grid-cols-2">
                  {vehicle.photo_url && (
                    <div className="overflow-hidden rounded-lg border border-border bg-surface-raised">
                      <img
                        src={vehicle.photo_url}
                        alt={t('vehicles.mainPhoto')}
                        className="h-32 w-full object-cover"
                      />
                      <p className="px-3 py-2 text-xs font-medium text-foreground">
                        {t('vehicles.mainPhoto')}
                      </p>
                    </div>
                  )}
                  {vehicle.license_url && (
                    <a
                      href={vehicle.license_url}
                      target="_blank"
                      rel="noreferrer"
                      className="flex min-h-32 flex-col items-center justify-center gap-2 rounded-lg border border-border bg-surface-raised p-4 text-center transition-colors hover:bg-surface-tinted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    >
                      <FileText className="h-7 w-7 text-primary" strokeWidth={1.75} aria-hidden />
                      <span className="text-xs font-medium text-foreground">
                        {t('vehicles.currentLicense')}
                      </span>
                    </a>
                  )}
                </div>
              )}

              <div className="grid grid-cols-1 gap-3.5 lg:grid-cols-2">
                <VehicleLicenceScanControl
                  currentValues={currentValues}
                  onApply={(fields) => {
                    for (const [field, value] of Object.entries(fields) as Array<
                      [keyof VehicleFormValues, string]
                    >) {
                      form.setValue(field, value, {
                        shouldDirty: true,
                        shouldValidate: true,
                      })
                    }
                  }}
                  onFileRetained={(file) => {
                    const previouslyRetained = scanRetainedFileRef.current
                    scanRetainedFileRef.current = file
                    if (file) {
                      setPendingLicence({ file, uploadedFileId: null })
                    } else {
                      setPendingLicence((current) =>
                        current?.file === previouslyRetained ? null : current,
                      )
                    }
                  }}
                  disabled={mutation.isPending}
                />

                <div className="space-y-3">
                  <UploadSlot
                    label={t('vehicles.uploadScan')}
                    accept={DOCUMENT_ACCEPT}
                    file={pendingLicence?.file ?? null}
                    onFile={(file) => {
                      scanRetainedFileRef.current = null
                      setPendingLicence({ file, uploadedFileId: null })
                    }}
                    onClear={() => {
                      scanRetainedFileRef.current = null
                      setPendingLicence(null)
                    }}
                    disabled={mutation.isPending}
                    clearLabel={t('common.remove')}
                  />

                  <label className="flex cursor-pointer flex-col items-center justify-center gap-1.5 rounded-lg border border-dashed border-border px-4 py-6 text-center transition-colors focus-within:ring-2 focus-within:ring-ring focus-within:ring-offset-2 focus-within:ring-offset-background hover:border-primary hover:bg-surface-tinted">
                    <input
                      type="file"
                      accept={IMAGE_ACCEPT}
                      multiple
                      disabled={mutation.isPending}
                      className="sr-only"
                      aria-label={t('vehicles.addPhoto')}
                      onChange={(event) => {
                        const files = Array.from(event.currentTarget.files ?? [])
                        event.currentTarget.value = ''
                        if (files.length > 0) {
                          setPendingGalleryFiles((current) => [...current, ...files])
                        }
                      }}
                    />
                    <Upload className="h-5 w-5 text-muted-foreground" strokeWidth={1.75} aria-hidden />
                    <span className="text-sm font-medium text-foreground">
                      {t('vehicles.addPhoto')}
                    </span>
                  </label>

                  {pendingGalleryFiles.length > 0 && (
                    <ul className="space-y-2">
                      {pendingGalleryFiles.map((file, index) => (
                        <li
                          key={`${file.name}-${file.size}-${file.lastModified}-${index}`}
                          className="flex items-center gap-2 rounded-lg border border-border bg-surface-raised px-3 py-2"
                        >
                          <ImageIcon
                            className="h-4 w-4 shrink-0 text-muted-foreground"
                            strokeWidth={1.75}
                            aria-hidden
                          />
                          <span className="min-w-0 flex-1 truncate text-sm text-foreground" dir="auto">
                            {file.name}
                          </span>
                          <button
                            type="button"
                            disabled={mutation.isPending}
                            onClick={() =>
                              setPendingGalleryFiles((current) =>
                                current.filter((_, fileIndex) => fileIndex !== index),
                              )
                            }
                            aria-label={`${t('common.remove')}: ${isolateBidi(file.name)}`}
                            title={t('common.remove')}
                            className="rounded-md p-1 text-muted-foreground transition-colors hover:bg-surface-tinted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50"
                          >
                            <X className="h-4 w-4" aria-hidden />
                          </button>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              </div>
            </EditorSection>
          </div>
        </div>

        <div className="sticky bottom-0 flex shrink-0 items-center justify-end gap-2 border-t border-border bg-surface px-4 py-3 md:px-6">
          <Button type="button" variant="ghost" disabled={mutation.isPending} onClick={leave}>
            {t('vehicles.cancel')}
          </Button>
          <Button type="submit" disabled={mutation.isPending}>
            {mutation.isPending ? t('common.saving') : t('vehicles.save')}
          </Button>
        </div>
      </form>

      <ConfirmDialog
        open={discardConfirmOpen}
        onOpenChange={setDiscardConfirmOpen}
        title={t('vehicles.unsavedChangesTitle')}
        description={t('vehicles.unsavedChangesDesc')}
        confirmLabel={t('vehicles.discard')}
        destructive
        onConfirm={() => navigate(`/vehicles/${vehicle.id}`)}
      />
    </div>
  )
}
