import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Check, ImagePlus, Loader2 } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import { Button } from '@/components/ui/button'
import { EmptyState } from '@/components/ui/empty-state'
import { Input } from '@/components/ui/input'
import { Skeleton } from '@/components/ui/skeleton'
import { api } from '@/lib/api'
import type { VehiclePhotoRead } from '@/lib/api'
import { cn } from '@/lib/utils'

import {
  IMAGE_ACCEPT,
  VEHICLE_QUERY_KEYS,
  localized,
  vehicleErrorMessage,
} from '../vehicleUtils'
import {
  UploadSlot,
  VehicleDialogBody,
  VehicleDialogFooter,
  VehicleDialogShell,
  VehicleField,
  VehicleFormAlert,
} from './VehicleDialogShell'

export interface VehiclePhotoPickerProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  currentAssetId: number | null
  currentPreviewUrl?: string | null
  onSave: (asset: VehiclePhotoRead | null) => void | Promise<void>
}

/**
 * Shared main-photo selector. The library is requested only while this surface
 * is open. Its draft is mounted inside the dialog, so cancelling or a failed
 * upload cannot leak a selection back to the vehicle form behind it.
 */
export function VehiclePhotoPicker({
  open,
  onOpenChange,
  currentAssetId,
  currentPreviewUrl,
  onSave,
}: VehiclePhotoPickerProps): React.JSX.Element {
  const { t } = useTranslation()
  const [busy, setBusy] = useState(false)

  return (
    <VehicleDialogShell
      open={open}
      onOpenChange={onOpenChange}
      title={t('vehicles.photoLibrary.title')}
      description={t('vehicles.photoLibrary.description')}
      size="xl"
      busy={busy}
    >
      {open ? (
        <VehiclePhotoPickerForm
          currentAssetId={currentAssetId}
          currentPreviewUrl={currentPreviewUrl}
          onBusyChange={setBusy}
          onCancel={() => onOpenChange(false)}
          onSave={async (asset) => {
            await onSave(asset)
            onOpenChange(false)
          }}
        />
      ) : null}
    </VehicleDialogShell>
  )
}

function VehiclePhotoPickerForm({
  currentAssetId,
  currentPreviewUrl,
  onBusyChange,
  onCancel,
  onSave,
}: {
  currentAssetId: number | null
  currentPreviewUrl?: string | null
  onBusyChange: (busy: boolean) => void
  onCancel: () => void
  onSave: (asset: VehiclePhotoRead | null) => Promise<void>
}): React.JSX.Element {
  const { t, i18n } = useTranslation()
  const queryClient = useQueryClient()
  const [draftId, setDraftId] = useState<number | null>(currentAssetId)
  const [file, setFile] = useState<File | null>(null)
  const [labelAr, setLabelAr] = useState('')
  const [labelEn, setLabelEn] = useState('')
  const [error, setError] = useState<string | null>(null)

  const libraryQuery = useQuery({
    queryKey: VEHICLE_QUERY_KEYS.photoLibrary,
    queryFn: () => api.listVehiclePhotos(),
    staleTime: 60_000,
  })
  const selectedAsset =
    libraryQuery.data?.find((asset) => asset.id === draftId) ?? null
  const selectionChanged = draftId !== currentAssetId
  const previewUrl = selectedAsset?.preview_url ??
    (draftId === currentAssetId ? currentPreviewUrl : null)
  const selectedLabel = selectedAsset
    ? localized(selectedAsset.label_ar, selectedAsset.label_en, i18n.language) ||
      selectedAsset.original_name
    : t('vehicles.mainPhoto')

  const upload = useMutation({
    mutationFn: () => {
      if (!file || !labelAr.trim() || !labelEn.trim()) {
        throw new Error(t('vehicles.photoLibrary.completeUpload'))
      }
      return api.uploadVehiclePhoto(file, {
        label_ar: labelAr.trim(),
        label_en: labelEn.trim(),
      })
    },
    onMutate: () => {
      setError(null)
      onBusyChange(true)
    },
    onSuccess: (asset) => {
      queryClient.setQueryData<VehiclePhotoRead[]>(VEHICLE_QUERY_KEYS.photoLibrary, (current) => [
        asset,
        ...(current ?? []).filter((candidate) => candidate.id !== asset.id),
      ])
      setDraftId(asset.id)
      setFile(null)
      setLabelAr('')
      setLabelEn('')
    },
    onError: (cause) => setError(vehicleErrorMessage(cause, t)),
    onSettled: () => onBusyChange(false),
  })

  const save = useMutation({
    mutationFn: async () => {
      if (!selectionChanged) return
      if (draftId != null && !selectedAsset) throw new Error(t('vehicles.photoLibrary.selectionUnavailable'))
      await onSave(selectedAsset)
    },
    onMutate: () => {
      setError(null)
      onBusyChange(true)
    },
    onError: (cause) => setError(vehicleErrorMessage(cause, t)),
    onSettled: () => onBusyChange(false),
  })

  const busy = upload.isPending || save.isPending

  return (
    <>
      <VehicleDialogBody className="gap-5">
        <VehicleFormAlert id="vehicle-photo-library-error" message={error} />

        <section aria-labelledby="vehicle-photo-current" className="space-y-2">
          <h3 id="vehicle-photo-current" className="text-sm font-semibold text-foreground">
            {t('vehicles.photoLibrary.preview')}
          </h3>
          <div className="grid min-h-40 place-items-center overflow-hidden rounded-xl border border-border bg-surface-raised p-2">
            {previewUrl ? (
              <img
                src={previewUrl}
                alt={selectedLabel}
                className="max-h-52 w-full object-contain"
              />
            ) : (
              <span className="flex flex-col items-center gap-2 text-center text-sm text-muted-foreground">
                <ImagePlus className="h-7 w-7 text-faint" strokeWidth={1.6} aria-hidden />
                {t('vehicles.photoLibrary.noSelection')}
              </span>
            )}
          </div>
        </section>

        <section aria-labelledby="vehicle-photo-existing" className="space-y-2">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h3 id="vehicle-photo-existing" className="text-sm font-semibold text-foreground">
              {t('vehicles.photoLibrary.existing')}
            </h3>
            {draftId != null ? (
              <Button type="button" size="sm" variant="ghost" disabled={busy} onClick={() => setDraftId(null)}>
                {t('vehicles.removeMainPhoto')}
              </Button>
            ) : null}
          </div>

          {libraryQuery.isError ? (
            <EmptyState
              message={t('vehicles.photoLibrary.loadError')}
              actionLabel={t('common.retry')}
              onAction={() => void libraryQuery.refetch()}
            />
          ) : libraryQuery.isLoading ? (
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4">
              {Array.from({ length: 4 }).map((_, index) => (
                <Skeleton key={index} className="aspect-[4/3] w-full rounded-lg" />
              ))}
            </div>
          ) : libraryQuery.data?.length === 0 ? (
            <p className="rounded-lg border border-dashed border-border bg-surface-raised px-4 py-6 text-center text-sm text-muted-foreground">
              {t('vehicles.photoLibrary.empty')}
            </p>
          ) : (
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4" role="group" aria-label={t('vehicles.photoLibrary.existing')}>
              {libraryQuery.data?.map((asset) => {
                const selected = asset.id === draftId
                const label = localized(asset.label_ar, asset.label_en, i18n.language) || asset.original_name
                return (
                  <button
                    key={asset.id}
                    type="button"
                    aria-pressed={selected}
                    disabled={busy}
                    onClick={() => setDraftId(asset.id)}
                    className={cn(
                      'relative min-w-0 overflow-hidden rounded-lg border bg-surface text-start transition-colors',
                      'hover:border-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:ring-offset-background',
                      'disabled:cursor-not-allowed disabled:opacity-60 motion-reduce:transition-none',
                      selected ? 'border-primary ring-1 ring-primary' : 'border-border',
                    )}
                  >
                    <span className="grid aspect-[4/3] place-items-center bg-surface-raised p-1.5">
                      <img src={asset.thumbnail_url} alt="" loading="lazy" className="h-full w-full object-contain" />
                    </span>
                    <span className="flex items-center gap-1.5 border-t border-hairline px-2 py-1.5">
                      <span className="min-w-0 flex-1 truncate text-xs font-medium text-foreground" dir="auto">
                        {label}
                      </span>
                      {selected ? <Check className="h-3.5 w-3.5 shrink-0 text-primary" aria-hidden /> : null}
                    </span>
                    <span className="sr-only">
                      {t('vehicles.photoLibrary.usageCount', { count: asset.usage_count })}
                    </span>
                  </button>
                )
              })}
            </div>
          )}
        </section>

        <section aria-labelledby="vehicle-photo-upload" className="space-y-3 border-t border-hairline pt-4">
          <h3 id="vehicle-photo-upload" className="text-sm font-semibold text-foreground">
            {t('vehicles.photoLibrary.uploadNew')}
          </h3>
          <div className="grid grid-cols-1 gap-3.5 sm:grid-cols-2">
            <VehicleField id="vehicle-photo-label-ar" label={t('vehicles.photoLibrary.labelAr')} required>
              <Input id="vehicle-photo-label-ar" dir="rtl" value={labelAr} disabled={busy} onChange={(event) => setLabelAr(event.target.value)} />
            </VehicleField>
            <VehicleField id="vehicle-photo-label-en" label={t('vehicles.photoLibrary.labelEn')} required>
              <Input id="vehicle-photo-label-en" dir="ltr" value={labelEn} disabled={busy} onChange={(event) => setLabelEn(event.target.value)} />
            </VehicleField>
          </div>
          <UploadSlot
            label={t('vehicles.photoLibrary.file')}
            accept={IMAGE_ACCEPT}
            file={file}
            onFile={setFile}
            onClear={() => setFile(null)}
            clearLabel={t('common.remove')}
            hint={t('vehicles.photoLibrary.fileHint')}
            disabled={busy}
          />
          <div className="flex justify-end">
            <Button
              type="button"
              variant="secondary"
              disabled={busy || !file || !labelAr.trim() || !labelEn.trim()}
              onClick={() => upload.mutate()}
            >
              {upload.isPending ? <Loader2 className="h-4 w-4 animate-spin motion-reduce:animate-none" aria-hidden /> : <ImagePlus className="h-4 w-4" aria-hidden />}
              {upload.isPending ? t('vehicles.photoLibrary.uploading') : t('vehicles.photoLibrary.upload')}
            </Button>
          </div>
        </section>
      </VehicleDialogBody>

      <VehicleDialogFooter>
        <Button type="button" variant="ghost" disabled={busy} onClick={onCancel}>
          {t('vehicles.cancel')}
        </Button>
        <Button
          type="button"
          disabled={busy || (selectionChanged && draftId != null && !selectedAsset)}
          onClick={() => {
            if (!selectionChanged) {
              onCancel()
              return
            }
            save.mutate()
          }}
        >
          {save.isPending ? t('common.saving') : t('vehicles.photoLibrary.saveSelection')}
        </Button>
      </VehicleDialogFooter>
    </>
  )
}
