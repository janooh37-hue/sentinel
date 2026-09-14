import { useTranslation } from 'react-i18next'

import { isolateBidi } from '@/lib/useCapabilityCatalog'

import type {
  VehicleImportImage,
  VehicleImportPreviewDraftRow,
  VehicleImportPreviewRow,
  VehicleProfileScan,
} from '@/lib/api'
import { api } from '@/lib/api'

import { ImportFileChoice } from './ImportFileChoice'
import { ImportOcrReview } from './ImportOcrReview'
import { roleForImage } from './importUtils'

interface ImportImageReviewProps {
  token: string
  images: VehicleImportImage[]
  draft: VehicleImportPreviewDraftRow
  previewRow?: VehicleImportPreviewRow
  scanResults: Record<string, VehicleProfileScan>
  scanningImageId: string | null
  previewIsCurrent: boolean
  onChange: (draft: VehicleImportPreviewDraftRow) => void
  onScan: (imageId: string) => void
}


export function ImportImageReview({
  token,
  images,
  draft,
  previewRow,
  scanResults,
  scanningImageId,
  previewIsCurrent,
  onChange,
  onScan,
}: ImportImageReviewProps): React.JSX.Element | null {
  const { t } = useTranslation()
  if (images.length === 0) return null

  const roles: Record<string, 'photo' | 'license' | ''> = {}
  for (const image of images) roles[image.image_id] = roleForImage(draft, image)
  const photoIds = images
    .filter((image) => roles[image.image_id] === 'photo')
    .map((image) => image.image_id)
  const licenseIds = images
    .filter((image) => roles[image.image_id] === 'license')
    .map((image) => image.image_id)

  const setRole = (imageId: string, role: 'photo' | 'license' | ''): void => {
    const imageRoles = { ...(draft.image_roles ?? {}) }
    if (role) imageRoles[imageId] = role
    else delete imageRoles[imageId]

    const nextPhotoIds: string[] = []
    const nextLicenseIds: string[] = []
    for (const image of images) {
      const nextRole =
        image.image_id === imageId ? role : imageRoles[image.image_id] ?? image.kind ?? ''
      if (nextRole === 'photo') nextPhotoIds.push(image.image_id)
      if (nextRole === 'license') nextLicenseIds.push(image.image_id)
    }

    onChange({
      ...draft,
      image_roles: imageRoles,
      photo_action: nextPhotoIds.length ? draft.photo_action : null,
      primary_image_id: nextPhotoIds.includes(draft.primary_image_id ?? '')
        ? draft.primary_image_id
        : null,
      license_action: nextLicenseIds.length ? draft.license_action : null,
      license_image_id: nextLicenseIds.includes(draft.license_image_id ?? '')
        ? draft.license_image_id
        : null,
      ocr_reviewed_image_ids: (draft.ocr_reviewed_image_ids ?? []).filter((id) =>
        nextLicenseIds.includes(id),
      ),
      ocr_manual_image_ids: (draft.ocr_manual_image_ids ?? []).filter((id) =>
        nextLicenseIds.includes(id),
      ),
      ocr_identity_confirmed_image_ids: (
        draft.ocr_identity_confirmed_image_ids ?? []
      ).filter((id) => nextLicenseIds.includes(id)),
    })
  }

  const setFileAction = (
    role: 'photo' | 'license',
    action: 'keep_current' | 'use_imported',
  ): void => {
    const ids = role === 'photo' ? photoIds : licenseIds
    if (role === 'photo') {
      onChange({
        ...draft,
        photo_action: action,
        primary_image_id:
          action === 'use_imported' ? draft.primary_image_id ?? ids[0] ?? null : null,
      })
      return
    }
    onChange({
      ...draft,
      license_action: action,
      license_image_id:
        action === 'use_imported' ? draft.license_image_id ?? ids[0] ?? null : null,
    })
  }

  return (
    <section
      className="mt-4 border-t border-hairline pt-4"
      aria-label={t('vehicles.import.imagesTitle')}
    >
      <h4 className="mb-3 text-[0.78em] font-semibold uppercase tracking-[0.06em] text-muted-foreground">
        {t('vehicles.import.imagesTitle')}
      </h4>
      <div className="grid gap-3 lg:grid-cols-2">
        {images.map((image) => {
          const role = roles[image.image_id]
          return (
            <article
              key={image.image_id}
              className="overflow-hidden rounded-lg border border-border bg-surface-raised"
            >
              <div className="grid grid-cols-[6.5rem_minmax(0,1fr)] gap-3 p-3">
                <img
                  src={api.vehicleImportImageUrl(token, image.image_id)}
                  alt={t('vehicles.import.imageAlt', { name: isolateBidi(image.original_name) })}
                  className="h-24 w-full rounded-md border border-border bg-surface object-contain"
                />
                <div className="min-w-0">
                  <p dir="auto" className="truncate text-sm font-medium text-foreground">
                    {image.original_name}
                  </p>
                  <label className="mt-2 block text-xs font-medium text-muted-foreground">
                    {t('vehicles.import.imageRole', { name: isolateBidi(image.original_name) })}
                    <select
                      className="mt-1 h-9 w-full rounded-md border border-input bg-surface px-2 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                      value={role}
                      onChange={(event) =>
                        setRole(
                          image.image_id,
                          event.target.value as 'photo' | 'license' | '',
                        )
                      }
                    >
                      <option value="">{t('vehicles.import.chooseRole')}</option>
                      <option value="photo">{t('vehicles.import.rolePhoto')}</option>
                      <option value="license">{t('vehicles.import.roleLicense')}</option>
                    </select>
                  </label>
                </div>
              </div>

              {role === 'license' ? (
                <ImportOcrReview
                  imageId={image.image_id}
                  draft={draft}
                  scan={scanResults[image.image_id]}
                  scanning={scanningImageId === image.image_id}
                  previewIsCurrent={previewIsCurrent}
                  onChange={onChange}
                  onScan={() => onScan(image.image_id)}
                />
              ) : null}
            </article>
          )
        })}
      </div>

      <div className="mt-3 grid gap-3 md:grid-cols-2">
        {photoIds.length ? (
          <ImportFileChoice
            kind="photo"
            imageIds={photoIds}
            currentUrl={previewRow?.current_photo_url}
            action={draft.photo_action}
            selectedId={draft.primary_image_id}
            onAction={(action) => setFileAction('photo', action)}
            onSelect={(imageId) => onChange({ ...draft, primary_image_id: imageId })}
          />
        ) : null}
        {licenseIds.length ? (
          <ImportFileChoice
            kind="license"
            imageIds={licenseIds}
            currentUrl={previewRow?.current_license_url}
            action={draft.license_action}
            selectedId={draft.license_image_id}
            onAction={(action) => setFileAction('license', action)}
            onSelect={(imageId) => onChange({ ...draft, license_image_id: imageId })}
          />
        ) : null}
      </div>
    </section>
  )
}

