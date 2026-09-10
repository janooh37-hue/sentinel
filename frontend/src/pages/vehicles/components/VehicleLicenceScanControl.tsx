import { useEffect, useId, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { Button } from '@/components/ui/button'
import { api } from '@/lib/api'
import type { VehicleProfileScan } from '@/lib/api'

import { CUSTOM_CLASS, resolveVehicleClass, type VehicleFormValues } from '../vehicleForm'
import {
  DOCUMENT_ACCEPT,
  EMPTY_VALUE,
  VEHICLE_CLASSES,
  localized,
  plateLabel,
  vehicleErrorMessage,
} from '../vehicleUtils'
import { UploadSlot } from './VehicleDialogShell'

export interface VehicleLicenceScanControlProps {
  currentValues: Partial<VehicleFormValues>
  onApply: (fields: Partial<VehicleFormValues>) => void
  onFileRetained: (file: File | null) => void
  disabled?: boolean
}

type FormField = keyof VehicleFormValues

type ScanSuggestion = {
  id: string
  labelKey: string
  fields: Partial<VehicleFormValues>
  currentField: FormField
  suggestedValue: string
  dir?: 'auto' | 'ltr' | 'rtl'
  classNames?: { ar: string | null; en: string | null }
}

type DirectScanField = Exclude<
  keyof VehicleProfileScan,
  'plate_code' | 'plate_number' | 'class_ar' | 'class_en' | 'unmapped' | 'warnings'
>

type OcrWarning = NonNullable<VehicleProfileScan['warnings']>[number]

const DIRECT_FIELDS: ReadonlyArray<
  readonly [source: DirectScanField, target: FormField, labelKey: string, dir?: 'auto' | 'ltr' | 'rtl']
> = [
  ['traffic_code', 'traffic_code', 'vehicles.trafficCode', 'ltr'],
  ['vin', 'vin', 'vehicles.vin', 'ltr'],
  ['make', 'make', 'vehicles.make', 'auto'],
  ['model', 'model', 'vehicles.model', 'auto'],
  ['model_year', 'model_year', 'vehicles.modelYear', 'ltr'],
  ['colour', 'colour', 'vehicles.colour', 'auto'],
  ['type_ar', 'type_ar', 'vehicles.typeAr', 'rtl'],
  ['type_en', 'type_en', 'vehicles.typeEn', 'ltr'],
  ['license_start', 'license_start', 'vehicles.licenseStart', 'ltr'],
  ['license_expiry', 'license_expiry', 'vehicles.licenseExpiry', 'ltr'],
  ['insurance_expiry', 'insurance_expiry', 'vehicles.insuranceExpiry', 'ltr'],
]

function buildSuggestions(scan: VehicleProfileScan): ScanSuggestion[] {
  const suggestions: ScanSuggestion[] = []

  if (scan.plate_number != null) {
    const value = plateLabel({
      plate_code: scan.plate_code,
      plate_number: scan.plate_number,
    })
    suggestions.push({
      id: 'plate',
      labelKey: 'vehicles.plate',
      fields: { plate: value },
      currentField: 'plate',
      suggestedValue: value,
      dir: 'ltr',
    })
  }

  for (const [source, target, labelKey, dir] of DIRECT_FIELDS) {
    const scannedValue = scan[source]
    if (scannedValue == null) continue
    const value = String(scannedValue)
    suggestions.push({
      id: target,
      labelKey,
      fields: { [target]: value } as Partial<VehicleFormValues>,
      currentField: target,
      suggestedValue: value,
      dir,
    })
  }

  if (scan.class_ar != null || scan.class_en != null) {
    const matchedClass = resolveVehicleClass(scan.class_ar, scan.class_en)
    const classIndex = matchedClass
      ? VEHICLE_CLASSES.findIndex(
          (option) => option.ar === matchedClass.ar && option.en === matchedClass.en,
        )
      : -1
    const fields: Partial<VehicleFormValues> =
      classIndex >= 0
        ? {
            vehicle_class: String(classIndex),
            custom_class_ar: '',
            custom_class_en: '',
          }
        : {
            vehicle_class: CUSTOM_CLASS,
            ...(scan.class_ar != null ? { custom_class_ar: scan.class_ar } : {}),
            ...(scan.class_en != null ? { custom_class_en: scan.class_en } : {}),
          }
    suggestions.push({
      id: 'vehicle-class',
      labelKey: 'vehicles.class',
      fields,
      currentField: 'vehicle_class',
      suggestedValue: '',
      classNames: {
        ar: matchedClass?.ar ?? scan.class_ar ?? null,
        en: matchedClass?.en ?? scan.class_en ?? null,
      },
    })
  }

  return suggestions
}

function currentClassLabel(
  values: Partial<VehicleFormValues>,
  language: string,
): string {
  if (values.vehicle_class === CUSTOM_CLASS) {
    return localized(values.custom_class_ar, values.custom_class_en, language)
  }
  const option = VEHICLE_CLASSES[Number(values.vehicle_class)]
  return option ? localized(option.ar, option.en, language) : ''
}

function currentSuggestionValue(
  suggestion: ScanSuggestion,
  values: Partial<VehicleFormValues>,
  language: string,
): string {
  if (suggestion.id === 'vehicle-class') return currentClassLabel(values, language)
  const value = values[suggestion.currentField]
  return value == null ? '' : String(value)
}

export function VehicleLicenceScanControl({
  currentValues,
  onApply,
  onFileRetained,
  disabled = false,
}: VehicleLicenceScanControlProps): React.JSX.Element {
  const { t, i18n } = useTranslation()
  const inputId = useId()
  const requestFileRef = useRef<File | null>(null)
  const retainedFileRef = useRef<File | null>(null)
  const [file, setFile] = useState<File | null>(null)
  const [suggestions, setSuggestions] = useState<ScanSuggestion[]>([])
  const [checked, setChecked] = useState<Record<string, boolean>>({})
  const [warnings, setWarnings] = useState<OcrWarning[]>([])
  const [error, setError] = useState<string | null>(null)
  const [scanning, setScanning] = useState(false)

  useEffect(
    () => () => {
      requestFileRef.current = null
    },
    [],
  )

  const clear = (): void => {
    requestFileRef.current = null
    setFile(null)
    setSuggestions([])
    setChecked({})
    setWarnings([])
    setError(null)
    setScanning(false)
    if (retainedFileRef.current === file) {
      retainedFileRef.current = null
      onFileRetained(null)
    }
  }

  const scan = async (nextFile: File): Promise<void> => {
    requestFileRef.current = nextFile
    setFile(nextFile)
    setSuggestions([])
    setChecked({})
    setWarnings([])
    setError(null)
    setScanning(true)

    try {
      const result = await api.scanVehicleProfile(nextFile)
      if (requestFileRef.current !== nextFile) return
      setSuggestions(buildSuggestions(result))
      setWarnings(result.warnings ?? [])
    } catch (err) {
      if (requestFileRef.current !== nextFile) return
      setError(vehicleErrorMessage(err, t))
    } finally {
      if (requestFileRef.current === nextFile) setScanning(false)
    }
  }

  const apply = (): void => {
    if (!file || requestFileRef.current !== file) return
    const fields: Partial<VehicleFormValues> = {}
    for (const suggestion of suggestions) {
      const currentValue = currentSuggestionValue(
        suggestion,
        currentValues,
        i18n.language,
      )
      const hasOverride = Object.prototype.hasOwnProperty.call(checked, suggestion.id)
      const shouldUseSuggested = hasOverride
        ? (checked[suggestion.id] ?? false)
        : currentValue.trim() === ''
      if (shouldUseSuggested) Object.assign(fields, suggestion.fields)
    }
    onApply(fields)
    retainedFileRef.current = file
    onFileRetained(file)
  }

  const hasReview = suggestions.length > 0

  return (
    <div className="space-y-3 rounded-lg border border-border bg-surface-raised p-3">
      <UploadSlot
        label={scanning ? t('vehicles.readingLicence') : t('vehicles.readLicence')}
        accept={DOCUMENT_ACCEPT}
        file={file}
        onFile={(nextFile) => void scan(nextFile)}
        onClear={clear}
        disabled={disabled}
        clearLabel={t('common.remove')}
      />

      {scanning && (
        <p role="status" className="text-xs text-muted-foreground">
          {t('vehicles.readingLicence')}
        </p>
      )}
      {error && (
        <p role="alert" className="text-xs text-destructive" dir="auto">
          {error}
        </p>
      )}
      {warnings.includes('OCR_UNAVAILABLE') && (
        <p role="status" className="rounded-md bg-warning-soft px-3 py-2 text-xs text-warning">
          {t('vehicles.ocrUnavailable')}
        </p>
      )}
      {warnings.includes('OCR_NO_FIELDS') && (
        <p role="status" className="rounded-md bg-warning-soft px-3 py-2 text-xs text-warning">
          {t('vehicles.ocrNoFields')}
        </p>
      )}
      {warnings.includes('OCR_REVIEW_REQUIRED') && (
        <p role="status" className="rounded-md bg-warning-soft px-3 py-2 text-xs text-warning">
          {t('vehicles.ocrReviewRequired')}
        </p>
      )}

      {hasReview && (
        <div className="space-y-3" aria-labelledby={`${inputId}-review-title`}>
          <div>
            <h4 id={`${inputId}-review-title`} className="text-sm font-semibold text-foreground">
              {t('vehicles.ocrReviewTitle')}
            </h4>
            <p className="mt-0.5 text-xs text-muted-foreground">
              {t('vehicles.ocrReviewDesc')}
            </p>
          </div>

          <div className="divide-y divide-hairline overflow-hidden rounded-lg border border-border bg-surface">
            {suggestions.map((suggestion) => {
              const currentValue = currentSuggestionValue(
                suggestion,
                currentValues,
                i18n.language,
              )
              const suggestedValue = suggestion.classNames
                ? localized(
                    suggestion.classNames.ar,
                    suggestion.classNames.en,
                    i18n.language,
                  )
                : suggestion.suggestedValue
              const hasOverride = Object.prototype.hasOwnProperty.call(checked, suggestion.id)
              const shouldUseSuggested = hasOverride
                ? (checked[suggestion.id] ?? false)
                : currentValue.trim() === ''
              const checkboxId = `${inputId}-${suggestion.id}`
              return (
                <div
                  key={suggestion.id}
                  className="grid gap-2 p-3 sm:grid-cols-[minmax(7rem,0.7fr)_1fr_1fr]"
                >
                  <label
                    htmlFor={checkboxId}
                    className="flex cursor-pointer items-start gap-2 text-xs font-semibold text-foreground"
                  >
                    <input
                      id={checkboxId}
                      type="checkbox"
                      checked={shouldUseSuggested}
                      disabled={disabled}
                      className="mt-0.5 h-4 w-4 rounded border-border accent-primary"
                      onChange={(event) => {
                        setChecked((current) => ({
                          ...current,
                          [suggestion.id]: event.target.checked,
                        }))
                      }}
                      aria-label={`${t('vehicles.ocrUseSuggested')}: ${t(suggestion.labelKey)}`}
                    />
                    <span>{t(suggestion.labelKey)}</span>
                  </label>
                  <span className="min-w-0 text-xs text-muted-foreground">
                    <span className="block font-medium">{t('vehicles.ocrCurrent')}</span>
                    <span className="block truncate" dir={suggestion.dir ?? 'auto'}>
                      {currentValue || EMPTY_VALUE}
                    </span>
                  </span>
                  <span className="min-w-0 text-xs text-foreground">
                    <span className="block font-medium">{t('vehicles.ocrSuggested')}</span>
                    <span className="block truncate" dir={suggestion.dir ?? 'auto'}>
                      {suggestedValue || EMPTY_VALUE}
                    </span>
                  </span>
                </div>
              )
            })}
          </div>
        </div>
      )}

      {!scanning && file && !error && (hasReview || warnings.length > 0) && (
        <Button type="button" size="sm" disabled={disabled} onClick={apply}>
          {t('vehicles.ocrApply')}
        </Button>
      )}
    </div>
  )
}
