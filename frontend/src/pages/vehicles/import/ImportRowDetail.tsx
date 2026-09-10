import { useEffect, useMemo } from 'react'
import { zodResolver } from '@hookform/resolvers/zod'
import { AlertTriangle, Archive, ChevronDown } from 'lucide-react'
import { useForm, useWatch, type Resolver } from 'react-hook-form'
import { useTranslation } from 'react-i18next'
import { Link } from 'react-router-dom'

import { Badge } from '@/components/ui/badge'
import type {
  VehicleImportImage,
  VehicleImportInspectRow,
  VehicleImportPreviewDraftRow,
  VehicleImportPreviewRow,
  VehicleProfileScan,
  VehicleSiteRead,
} from '@/lib/api'
import { isolateBidi } from '@/lib/useCapabilityCatalog'

import {
  type VehicleFormInput,
  type VehicleFormValues,
  vehicleFormSchema,
} from '../vehicleForm'
import { VehicleFormAlert } from '../components/VehicleDialogShell'
import { VehicleFormFields } from '../components/VehicleFormFields'
import { ImportImageReview } from './ImportImageReview'
import {
  importDraftFormValues,
  importDraftValuesFromForm,
  importFieldDir,
  isConfirmable,
  issueKey,
} from './importUtils'

interface ImportRowDetailProps {
  token: string
  source: VehicleImportInspectRow
  draft: VehicleImportPreviewDraftRow
  previewRow?: VehicleImportPreviewRow
  images: VehicleImportImage[]
  sites: VehicleSiteRead[]
  siteId?: number
  scanResults: Record<string, VehicleProfileScan>
  scanningImageId: string | null
  previewIsCurrent: boolean
  selected: boolean
  onDraftChange: (draft: VehicleImportPreviewDraftRow) => void
  onSelectedChange: (selected: boolean) => void
  onScan: (imageId: string) => void
}

const ACTION_TONE: Record<
  VehicleImportPreviewRow['action'],
  'active' | 'info' | 'neutral' | 'danger' | 'warning' | 'outline'
> = {
  create: 'active',
  update: 'info',
  unchanged: 'neutral',
  invalid: 'danger',
  archived: 'warning',
  excluded: 'outline',
}

const sharedVehicleResolver = zodResolver(vehicleFormSchema)
const importCorrectionResolver: Resolver<
  VehicleFormInput,
  unknown,
  VehicleFormValues
> = async (values, context, options) => {
  const resolved = await sharedVehicleResolver(values, context, options)
  const errors = { ...resolved.errors }
  for (const field of Object.keys(errors) as Array<keyof VehicleFormInput>) {
    const value = values[field]
    if (typeof value === 'string' && value.trim() === '') delete errors[field]
  }
  return Object.keys(errors).length === 0
    ? { values: values as VehicleFormValues, errors: {} }
    : { values: {}, errors }
}

export function ImportRowDetail({
  token,
  source,
  draft,
  previewRow,
  images,
  sites,
  siteId,
  scanResults,
  scanningImageId,
  previewIsCurrent,
  selected,
  onDraftChange,
  onSelectedChange,
  onScan,
}: ImportRowDetailProps): React.JSX.Element {
  const { t } = useTranslation()
  const defaults = useMemo(() => importDraftFormValues(draft, siteId), [draft, siteId])
  const form = useForm<VehicleFormInput, unknown, VehicleFormValues>({
    resolver: importCorrectionResolver,
    defaultValues: defaults,
    mode: 'onChange',
  })
  const watchedValues = useWatch({ control: form.control })
  const formValues = useMemo(
    () => ({ ...defaults, ...watchedValues }) as VehicleFormValues,
    [defaults, watchedValues],
  )

  useEffect(() => {
    const current = form.getValues()
    const desiredDraft = importDraftValuesFromForm(defaults)
    const currentDraft = importDraftValuesFromForm(current)
    const draftChanged = Object.entries(desiredDraft).some(
      ([field, value]) => (currentDraft[field] ?? null) !== value,
    )
    if (draftChanged || current.site !== defaults.site) form.reset(defaults)
  }, [defaults, form])

  useEffect(() => {
    const values = importDraftValuesFromForm(formValues)
    const draftChanged = Object.entries(values).some(
      ([field, value]) => (draft.values[field] ?? null) !== value,
    )
    if (draftChanged) {
      onDraftChange({
        ...draft,
        values: { ...draft.values, ...values },
      })
    }
  }, [draft, formValues, onDraftChange])

  const alertId = `vehicle-import-${source.row_id}-errors`
  const invalidCorrection = Object.keys(form.formState.errors).length > 0
  const confirmable = Boolean(previewRow && isConfirmable(previewRow))
  const archived = previewRow?.action === 'archived'
  const plate = [draft.values.plate_code, draft.values.plate_number].filter(Boolean).join(' \\ ')
  const rowErrors = previewRow?.errors ?? []
  const rowWarnings = previewRow?.warnings ?? []

  return (
    <article className="rounded-xl border border-border bg-surface shadow-sm">
      <header className="flex flex-wrap items-center gap-3 border-b border-hairline px-4 py-3">
        {!archived ? (
          <input
            type="checkbox"
            className="h-4 w-4 shrink-0 accent-primary"
            aria-label={t('vehicles.import.selectRow', { row: isolateBidi(String(source.row_number)) })}
            checked={selected}
            disabled={!previewIsCurrent || !confirmable || draft.excluded}
            onChange={(event) => onSelectedChange(event.target.checked)}
          />
        ) : (
          <Archive className="h-4 w-4 shrink-0 text-warning" aria-hidden />
        )}
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold text-foreground">
            {t('vehicles.import.rowLabel', { row: isolateBidi(String(source.row_number)) })}
            {plate ? (
              <span dir="ltr" className="ms-2 font-mono font-medium text-muted-foreground">
                {plate}
              </span>
            ) : null}
          </p>
          <p dir="auto" className="truncate text-xs text-muted-foreground">
            {source.sheet}
          </p>
        </div>
        {previewRow ? (
          <Badge tone={ACTION_TONE[previewRow.action]} shape="square" withDot>
            {t(`vehicles.import.actions.${previewRow.action}`)}
          </Badge>
        ) : (
          <Badge tone="outline" shape="square">
            {t('vehicles.import.notPreviewed')}
          </Badge>
        )}
        <label className="flex items-center gap-2 text-xs font-medium text-muted-foreground">
          <input
            type="checkbox"
            className="h-4 w-4 accent-primary"
            checked={draft.excluded}
            onChange={(event) => onDraftChange({ ...draft, excluded: event.target.checked })}
          />
          {t('vehicles.import.excludeRow')}
        </label>
      </header>

      {archived ? (
        <div className="mx-4 mt-3 flex items-start gap-2 rounded-lg border border-warning/30 bg-warning-soft px-3 py-2 text-xs text-warning">
          <Archive className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
          <div>
            <p className="font-semibold">{t('vehicles.import.archivedTitle')}</p>
            <p className="mt-0.5">{t('vehicles.import.archivedGuidance')}</p>
            <Link
              to={previewRow.vehicle_id ? `/vehicles/${previewRow.vehicle_id}` : '/vehicles?state=archived'}
              className="mt-1 inline-block font-semibold underline underline-offset-2"
            >
              {t('vehicles.import.openArchivedVehicle')}
            </Link>
          </div>
        </div>
      ) : null}

      {rowErrors.length || rowWarnings.length ? (
        <div className="grid gap-2 px-4 pt-3 md:grid-cols-2">
          {rowErrors.length ? (
            <IssueList tone="error" title={t('vehicles.import.errorsTitle')} issues={rowErrors} />
          ) : null}
          {rowWarnings.length ? (
            <IssueList tone="warning" title={t('vehicles.import.warningsTitle')} issues={rowWarnings} />
          ) : null}
        </div>
      ) : null}
      {previewRow &&
      (previewRow.photo_choice_required ||
        previewRow.license_choice_required ||
        previewRow.ocr_review_required) ? (
        <div className="mx-4 mt-3 flex flex-wrap gap-2">
          {previewRow.photo_choice_required ? (
            <Badge tone="warning" shape="square">
              {t('vehicles.import.errors.photoChoiceRequired')}
            </Badge>
          ) : null}
          {previewRow.license_choice_required ? (
            <Badge tone="warning" shape="square">
              {t('vehicles.import.errors.licenseChoiceRequired')}
            </Badge>
          ) : null}
          {previewRow.ocr_review_required ? (
            <Badge tone="warning" shape="square">
              {t('vehicles.import.ocrReviewRequired')}
            </Badge>
          ) : null}
        </div>
      ) : null}

      {previewRow?.changes?.length ? (
        <section className="mx-4 mt-3 rounded-lg border border-info/20 bg-info-soft px-3 py-2">
          <h4 className="text-xs font-semibold text-info">{t('vehicles.import.changesTitle')}</h4>
          <ul className="mt-1 grid gap-1 text-xs text-foreground md:grid-cols-2">
            {previewRow.changes.map((change) => (
              <li key={`${change.field}-${String(change.after)}`}>
                <span className="font-medium">{t(`vehicles.import.fields.${change.field}`)}:</span>{' '}
                <bdi>{change.before ?? t('vehicles.import.emptyValue')}</bdi>
                <span aria-hidden> → </span>
                <bdi>{change.after ?? t('vehicles.import.emptyValue')}</bdi>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
      {previewRow ? (
        <details className="group mx-4 mt-3 rounded-lg border border-border bg-surface-raised px-3 py-2">
          <summary className="flex cursor-pointer list-none items-center justify-between gap-2 text-xs font-semibold text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
            {t('vehicles.import.resolvedValuesTitle')}
            <ChevronDown className="h-3.5 w-3.5 text-muted-foreground transition-transform group-open:rotate-180 motion-reduce:transition-none" aria-hidden />
          </summary>
          <dl className="mt-2 grid gap-x-4 gap-y-1 text-xs sm:grid-cols-2 lg:grid-cols-3">
            {Object.entries(previewRow.values).map(([field, value]) => (
              <div key={field} className="flex min-w-0 justify-between gap-2 border-b border-hairline py-1">
                <dt className="text-muted-foreground">{t(`vehicles.import.fields.${field}`)}</dt>
                <dd dir={importFieldDir(field)} className="truncate font-medium text-foreground">
                  {value ?? t('vehicles.import.emptyValue')}
                </dd>
              </div>
            ))}
          </dl>
        </details>
      ) : null}

      <details className="group px-4 py-3">
        <summary className="flex cursor-pointer list-none items-center justify-between gap-2 text-sm font-semibold text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
          {t('vehicles.import.fieldsTitle')}
          <ChevronDown className="h-4 w-4 text-muted-foreground transition-transform group-open:rotate-180 motion-reduce:transition-none" aria-hidden />
        </summary>
        <div className="mt-3 space-y-3">
          <VehicleFormAlert
            id={alertId}
            message={
              invalidCorrection ? t('vehicles.import.correctionInvalid') : null
            }
          />
          <VehicleFormFields
            form={form}
            sites={sites}
            mode="edit"
            vehicle={null}
            showSiteField={false}
            fieldIdPrefix={`vehicle-import-${source.row_id}`}
            alertId={alertId}
          />
        </div>
      </details>

      <div className="px-4 pb-4">
        <ImportImageReview
          token={token}
          images={images}
          draft={draft}
          previewRow={previewRow}
          scanResults={scanResults}
          scanningImageId={scanningImageId}
          previewIsCurrent={previewIsCurrent}
          onChange={onDraftChange}
          onScan={onScan}
        />
      </div>
    </article>
  )
}

function IssueList({
  tone,
  title,
  issues,
}: {
  tone: 'error' | 'warning'
  title: string
  issues: NonNullable<VehicleImportPreviewRow['errors']>
}): React.JSX.Element {
  const { t } = useTranslation()
  const className =
    tone === 'error'
      ? 'border-destructive/30 bg-destructive/10 text-destructive'
      : 'border-warning/30 bg-warning-soft text-warning'
  return (
    <section className={`rounded-lg border px-3 py-2 text-xs ${className}`}>
      <h4 className="flex items-center gap-1.5 font-semibold">
        <AlertTriangle className="h-3.5 w-3.5" aria-hidden />
        {title}
      </h4>
      <ul className="mt-1 list-disc space-y-0.5 ps-5">
        {issues.map((issue, index) => (
          <li key={`${issue.code}-${issue.field ?? index}`}>
            {issue.field ? (
              <span className="font-semibold">{t(`vehicles.import.fields.${issue.field}`)}: </span>
            ) : null}
            {t(`vehicles.import.errors.${issueKey(issue)}`, { message: issue.message })}
          </li>
        ))}
      </ul>
    </section>
  )
}
