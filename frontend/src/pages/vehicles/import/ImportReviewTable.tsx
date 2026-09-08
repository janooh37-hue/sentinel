import { AlertTriangle, ImagePlus, Loader2, RefreshCw } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import type {
  VehicleImportInspection,
  VehicleImportPreview,
  VehicleImportPreviewDraftRow,
  VehicleProfileScan,
  VehicleSiteRead,
} from '@/lib/api'
import { api } from '@/lib/api'

import { isolateBidi } from '@/lib/useCapabilityCatalog'

import { formatNumber, localized } from '../vehicleUtils'
import { ImportPreviewCounts } from './ImportResultSummary'
import { ImportRowDetail } from './ImportRowDetail'
import { issueKey } from './importUtils'
import type { DraftUpdater } from './importUtils'

interface ImportReviewTableProps {
  inspection: VehicleImportInspection
  drafts: VehicleImportPreviewDraftRow[]
  sites: VehicleSiteRead[]
  siteMappings: Record<string, number>
  unassignedDestinations: Record<string, string>
  preview: VehicleImportPreview | null
  scanResults: Record<string, VehicleProfileScan>
  scanningImageId: string | null
  selectedRowIds: Set<string>
  previewDirty: boolean
  canPreview: boolean
  isPreviewing: boolean
  isConfirming: boolean
  previewError: string | null
  confirmError: string | null
  stale: boolean
  onSiteMappingChange: (sectionId: string, siteId: number) => void
  onUnassignedDestinationChange: (imageId: string, destination: string) => void
  onDraftChange: DraftUpdater
  onSelectedChange: (rowId: string, selected: boolean) => void
  onScan: (imageId: string) => void
  onPreview: () => void
  onConfirm: () => void
}

export function ImportReviewTable({
  inspection,
  drafts,
  sites,
  siteMappings,
  unassignedDestinations,
  preview,
  scanResults,
  scanningImageId,
  selectedRowIds,
  previewDirty,
  canPreview,
  isPreviewing,
  isConfirming,
  previewError,
  confirmError,
  stale,
  onSiteMappingChange,
  onUnassignedDestinationChange,
  onDraftChange,
  onSelectedChange,
  onScan,
  onPreview,
  onConfirm,
}: ImportReviewTableProps): React.JSX.Element {
  const { t, i18n } = useTranslation()
  const draftById = new Map(drafts.map((draft) => [draft.row_id, draft]))
  const previewById = new Map(preview?.rows.map((row) => [row.row_id, row]) ?? [])
  const imageById = new Map(inspection.images.map((image) => [image.image_id, image]))
  const unassignedImages = inspection.images.filter((image) => image.row_id == null)
  const previewIsCurrent = Boolean(preview && !previewDirty)

  return (
    <div className="mx-auto w-full max-w-[1480px] space-y-4 px-4 pb-24 md:px-6">
      <Card>
        <CardHeader className="items-start gap-3 md:flex-row md:items-center">
          <div>
            <CardTitle className="text-[1em]">{t('vehicles.import.reviewTitle')}</CardTitle>
            <p dir="auto" className="mt-1 text-xs text-muted-foreground">
              {t('vehicles.import.fileSummary', {
                filename: isolateBidi(inspection.filename),
                count: isolateBidi(formatNumber(inspection.rows.length, i18n.language)),
              })}
            </p>
          </div>
          {preview ? <ImportPreviewCounts counts={preview.counts} /> : null}
        </CardHeader>
        <CardContent className="space-y-4">
          <section>
            <h3 className="text-sm font-semibold text-foreground">
              {t('vehicles.import.siteMappingTitle')}
            </h3>
            <p className="mt-0.5 text-xs text-muted-foreground">
              {t('vehicles.import.siteMappingDescription')}
            </p>
            <div className="mt-3 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
              {inspection.sections.map((section) => (
                <label key={section.id} className="text-xs font-medium text-muted-foreground">
                  {t('vehicles.import.siteForSection', { section: isolateBidi(section.title) })}
                  <select
                    className="mt-1 h-9 w-full rounded-md border border-input bg-surface px-3 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    value={siteMappings[section.id] ?? ''}
                    onChange={(event) =>
                      onSiteMappingChange(section.id, Number(event.target.value))
                    }
                  >
                    <option value="">{t('vehicles.import.chooseSite')}</option>
                    {sites
                      .filter((site) => site.active)
                      .map((site) => (
                        <option key={site.id} value={site.id} dir="auto">
                          {localized(site.name_ar, site.name_en, i18n.language)}
                        </option>
                      ))}
                  </select>
                </label>
              ))}
            </div>
          </section>

          {unassignedImages.length ? (
            <section className="border-t border-hairline pt-4">
              <h3 className="flex items-center gap-2 text-sm font-semibold text-foreground">
                <ImagePlus className="h-4 w-4" aria-hidden />
                {t('vehicles.import.unassignedImagesTitle')}
              </h3>
              <p className="mt-0.5 text-xs text-muted-foreground">
                {t('vehicles.import.unassignedImagesDescription')}
              </p>
              <div className="mt-3 grid gap-3 lg:grid-cols-2">
                {unassignedImages.map((image) => (
                  <div
                    key={image.image_id}
                    className="grid grid-cols-[5rem_minmax(0,1fr)] gap-3 rounded-lg border border-border bg-surface-raised p-3"
                  >
                    <img
                      src={api.vehicleImportImageUrl(inspection.token, image.image_id)}
                      alt={t('vehicles.import.imageAlt', { name: isolateBidi(image.original_name) })}
                      className="h-16 w-20 rounded border border-border bg-surface object-contain"
                    />
                    <label className="min-w-0 text-xs font-medium text-muted-foreground">
                      <span dir="auto" className="block truncate text-foreground">
                        {image.original_name}
                      </span>
                      <span className="sr-only">
                        {t('vehicles.import.assignImage', { name: isolateBidi(image.original_name) })}
                      </span>
                      <select
                        aria-label={t('vehicles.import.assignImage', {
                          name: isolateBidi(image.original_name),
                        })}
                        className="mt-1 h-9 w-full rounded-md border border-input bg-surface px-2 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                        value={unassignedDestinations[image.image_id] ?? ''}
                        onChange={(event) =>
                          onUnassignedDestinationChange(image.image_id, event.target.value)
                        }
                      >
                        <option value="">{t('vehicles.import.chooseDestination')}</option>
                        <option value="exclude">{t('vehicles.import.excludeImage')}</option>
                        {inspection.rows.map((row) => (
                          <option key={row.row_id} value={row.row_id}>
                            {t('vehicles.import.rowLabel', { row: isolateBidi(String(row.row_number)) })}
                          </option>
                        ))}
                      </select>
                    </label>
                  </div>
                ))}
              </div>
            </section>
          ) : null}

          {inspection.warnings?.length ? (
            <div className="flex items-start gap-2 rounded-lg border border-warning/30 bg-warning-soft px-3 py-2 text-xs text-warning">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
              <div>
                <p className="font-semibold">{t('vehicles.import.workbookWarningsTitle')}</p>
                <ul className="mt-1 list-disc space-y-0.5 ps-4">
                  {inspection.warnings.map((warning, index) => (
                    <li key={`${warning.code}-${warning.field ?? index}`} dir="auto">
                      {t(`vehicles.import.errors.${issueKey(warning)}`, {
                        message: warning.message,
                      })}
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          ) : null}
        </CardContent>
      </Card>

      {previewDirty && preview ? (
        <div className="rounded-lg border border-info/30 bg-info-soft px-3 py-2 text-sm text-info">
          {t('vehicles.import.previewStale')}
        </div>
      ) : null}
      {previewError ? (
        <p role="alert" dir="auto" className="rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {previewError}
        </p>
      ) : null}
      {confirmError ? (
        <div role="alert" className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
          <span dir="auto">{confirmError}</span>
          {stale ? (
            <Button type="button" variant="outline" size="sm" onClick={onPreview} disabled={isPreviewing}>
              <RefreshCw className="h-3.5 w-3.5" aria-hidden />
              {t('vehicles.import.previewAgain')}
            </Button>
          ) : null}
        </div>
      ) : null}

      {inspection.sections.map((section) => {
        const rows = inspection.rows.filter((row) => row.section_id === section.id)
        if (rows.length === 0) return null
        return (
          <section key={section.id} aria-labelledby={`import-section-${section.id}`}>
            <h2 id={`import-section-${section.id}`} className="mb-2 text-sm font-semibold text-foreground">
              {t('vehicles.import.sectionTitle', {
                title: isolateBidi(section.title),
                sheet: isolateBidi(section.sheet),
              })}
            </h2>
            <div className="space-y-3">
              {rows.map((source) => {
                const draft = draftById.get(source.row_id)
                if (!draft) return null
                const rowImages = (draft.image_ids ?? []).flatMap((imageId) => {
                  const image = imageById.get(imageId)
                  return image ? [image] : []
                })
                return (
                  <ImportRowDetail
                    key={source.row_id}
                    token={inspection.token}
                    source={source}
                    draft={draft}
                    previewRow={previewById.get(source.row_id)}
                    images={rowImages}
                    scanResults={scanResults}
                    scanningImageId={scanningImageId}
                    previewIsCurrent={previewIsCurrent}
                    selected={selectedRowIds.has(source.row_id)}
                    onDraftChange={(next) => onDraftChange(source.row_id, () => next)}
                    onSelectedChange={(selected) => onSelectedChange(source.row_id, selected)}
                    onScan={onScan}
                  />
                )
              })}
            </div>
          </section>
        )
      })}

      <div className="sticky bottom-0 z-10 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border bg-surface/95 px-4 py-3 shadow-lg backdrop-blur-sm">
        <p className="text-xs text-muted-foreground">
          {previewIsCurrent
            ? t('vehicles.import.selectedRows', {
                count: isolateBidi(String(selectedRowIds.size)),
              })
            : t('vehicles.import.previewRequired')}
        </p>
        <div className="flex flex-wrap gap-2">
          <Button type="button" variant="secondary" onClick={onPreview} disabled={!canPreview || isPreviewing || isConfirming}>
            {isPreviewing ? (
              <Loader2 className="h-4 w-4 animate-spin motion-reduce:animate-none" aria-hidden />
            ) : (
              <RefreshCw className="h-4 w-4" aria-hidden />
            )}
            {isPreviewing ? t('vehicles.import.previewing') : t('vehicles.import.previewChanges')}
          </Button>
          <Button
            type="button"
            onClick={onConfirm}
            disabled={!previewIsCurrent || selectedRowIds.size === 0 || isPreviewing || isConfirming}
          >
            {isConfirming ? (
              <Loader2 className="h-4 w-4 animate-spin motion-reduce:animate-none" aria-hidden />
            ) : null}
            {isConfirming
              ? t('vehicles.import.importing')
              : t('vehicles.import.importSelected', {
                  count: isolateBidi(String(selectedRowIds.size)),
                })}
          </Button>
        </div>
      </div>
    </div>
  )
}
