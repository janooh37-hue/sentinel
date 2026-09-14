import { Loader2, ScanText } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import { Button } from '@/components/ui/button'
import type { VehicleImportPreviewDraftRow, VehicleProfileScan } from '@/lib/api'

import { OCR_FIELDS, importFieldDir, scanHasValues, scanIdentityConflicts, type OcrField } from './importUtils'

interface ImportOcrReviewProps {
  imageId: string
  draft: VehicleImportPreviewDraftRow
  scan?: VehicleProfileScan
  scanning: boolean
  previewIsCurrent: boolean
  onChange: (draft: VehicleImportPreviewDraftRow) => void
  onScan: () => void
}

function withId(values: string[] | undefined, imageId: string): string[] {
  return values?.includes(imageId) ? values : [...(values ?? []), imageId]
}

function withoutId(values: string[] | undefined, imageId: string): string[] {
  return (values ?? []).filter((value) => value !== imageId)
}

export function ImportOcrReview({
  imageId,
  draft,
  scan,
  scanning,
  previewIsCurrent,
  onChange,
  onScan,
}: ImportOcrReviewProps): React.JSX.Element {
  const { t } = useTranslation()
  const hasSuggestions = scan ? scanHasValues(scan) : false
  const reviewed = draft.ocr_reviewed_image_ids?.includes(imageId) ?? false
  const manual = draft.ocr_manual_image_ids?.includes(imageId) ?? false
  const identityConfirmed = draft.ocr_identity_confirmed_image_ids?.includes(imageId) ?? false
  const identityConflict = scan ? scanIdentityConflicts(scan, draft.values) : false

  return (
    <div className="border-t border-hairline px-3 py-3">
      <Button
        type="button"
        variant="secondary"
        size="sm"
        disabled={scanning || !previewIsCurrent}
        title={!previewIsCurrent ? t('vehicles.import.scanNeedsPreview') : undefined}
        onClick={onScan}
      >
        {scanning ? (
          <Loader2 className="h-3.5 w-3.5 animate-spin motion-reduce:animate-none" aria-hidden />
        ) : (
          <ScanText className="h-3.5 w-3.5" aria-hidden />
        )}
        {scanning ? t('vehicles.import.scanning') : t('vehicles.import.scanSuggestions')}
      </Button>

      {scan ? (
        <div className="mt-3 space-y-2">
          {scan.warnings?.includes('OCR_UNAVAILABLE') ? (
            <p role="alert" className="text-xs text-warning">
              {t('vehicles.import.ocrUnavailable')}
            </p>
          ) : null}
          {scan.warnings?.includes('OCR_NO_FIELDS') ? (
            <p role="alert" className="text-xs text-warning">
              {t('vehicles.import.ocrNoFields')}
            </p>
          ) : null}
          {scan.warnings?.includes('OCR_REVIEW_REQUIRED') ? (
            <p role="alert" className="text-xs text-warning">
              {t('vehicles.import.ocrReviewWarning')}
            </p>
          ) : null}

          {hasSuggestions ? (
            <div className="space-y-1.5" aria-label={t('vehicles.import.ocrSuggestions')}>
              {OCR_FIELDS.flatMap((field) => {
                const suggestion = scan[field]
                if (suggestion == null) return []
                return [
                  <SuggestionRow
                    key={field}
                    field={field}
                    current={draft.values[field]}
                    suggestion={suggestion}
                    onAccept={() =>
                      onChange({
                        ...draft,
                        values: { ...draft.values, [field]: suggestion },
                      })
                    }
                  />,
                ]
              })}
            </div>
          ) : null}

          {Object.keys(scan.unmapped ?? {}).length ? (
            <details className="text-xs text-muted-foreground">
              <summary className="cursor-pointer font-medium text-foreground">
                {t('vehicles.import.unmappedFields')}
              </summary>
              <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-2 gap-y-1">
                {Object.entries(scan.unmapped ?? {}).map(([field, value]) => (
                  <div key={field} className="col-span-2 grid grid-cols-subgrid">
                    <dt dir="auto" className="font-medium">{field}</dt>
                    <dd dir="auto">{value}</dd>
                  </div>
                ))}
              </dl>
            </details>
          ) : null}

          <div className="flex flex-wrap gap-2 pt-1">
            {hasSuggestions ? (
              <Button
                type="button"
                variant={reviewed ? 'secondary' : 'outline'}
                size="sm"
                onClick={() =>
                  onChange({
                    ...draft,
                    ocr_reviewed_image_ids: withId(draft.ocr_reviewed_image_ids, imageId),
                    ocr_manual_image_ids: withoutId(draft.ocr_manual_image_ids, imageId),
                  })
                }
              >
                {reviewed ? t('vehicles.import.reviewed') : t('vehicles.import.markReviewed')}
              </Button>
            ) : null}
            <Button
              type="button"
              variant={manual ? 'secondary' : 'outline'}
              size="sm"
              onClick={() =>
                onChange({
                  ...draft,
                  ocr_manual_image_ids: withId(draft.ocr_manual_image_ids, imageId),
                  ocr_reviewed_image_ids: withoutId(draft.ocr_reviewed_image_ids, imageId),
                  ocr_identity_confirmed_image_ids: withoutId(
                    draft.ocr_identity_confirmed_image_ids,
                    imageId,
                  ),
                })
              }
            >
              {manual ? t('vehicles.import.manual') : t('vehicles.import.markManual')}
            </Button>
          </div>

          {identityConflict ? (
            <label className="flex items-start gap-2 rounded-md border border-warning/30 bg-warning-soft px-2.5 py-2 text-xs text-warning">
              <input
                type="checkbox"
                className="mt-0.5 h-4 w-4 accent-primary"
                checked={identityConfirmed}
                onChange={(event) =>
                  onChange({
                    ...draft,
                    ocr_identity_confirmed_image_ids: event.target.checked
                      ? withId(draft.ocr_identity_confirmed_image_ids, imageId)
                      : withoutId(draft.ocr_identity_confirmed_image_ids, imageId),
                  })
                }
              />
              <span>{t('vehicles.import.confirmIdentity')}</span>
            </label>
          ) : null}
        </div>
      ) : null}
    </div>
  )
}

function SuggestionRow({
  field,
  current,
  suggestion,
  onAccept,
}: {
  field: OcrField
  current: string | number | null | undefined
  suggestion: string | number
  onAccept: () => void
}): React.JSX.Element {
  const { t } = useTranslation()
  return (
    <div className="rounded-md border border-border bg-surface p-2">
      <p className="text-xs font-semibold text-foreground">
        {t(`vehicles.import.fields.${field}`)}
      </p>
      <div className="mt-1 grid grid-cols-[1fr_auto] items-end gap-2">
        <dl className="min-w-0 text-[0.72em] text-muted-foreground">
          <div className="flex gap-1">
            <dt>{t('vehicles.import.currentValue')}:</dt>
            <dd dir={importFieldDir(field)} className="truncate text-foreground">
              {current ?? t('vehicles.import.emptyValue')}
            </dd>
          </div>
          <div className="flex gap-1">
            <dt>{t('vehicles.import.suggestedValue')}:</dt>
            <dd dir={importFieldDir(field)} className="truncate font-medium text-foreground">{suggestion}</dd>
          </div>
        </dl>
        <Button type="button" variant="ghost" size="sm" onClick={onAccept}>
          {t('vehicles.import.acceptSuggestion')}
        </Button>
      </div>
    </div>
  )
}
