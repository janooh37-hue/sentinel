import type {
  VehicleImportImage,
  VehicleImportInspection,
  VehicleImportIssue,
  VehicleImportPreviewDraftRow,
  VehicleImportPreviewRow,
  VehicleProfileScan,
  VehicleSiteRead,
} from '@/lib/api'

import {
  CUSTOM_CLASS,
  resolveVehicleClass,
  type VehicleFormValues,
  vehicleFormSchema,
} from '../vehicleForm'
import { parsePlate, VEHICLE_CLASSES } from '../vehicleUtils'

export type OcrField =
  | 'plate_code'
  | 'plate_number'
  | 'traffic_code'
  | 'vin'
  | 'make'
  | 'model'
  | 'model_year'
  | 'colour'
  | 'type_ar'
  | 'type_en'
  | 'class_ar'
  | 'class_en'
  | 'license_start'
  | 'license_expiry'
  | 'insurance_expiry'

export const OCR_FIELDS: readonly OcrField[] = [
  'plate_code',
  'plate_number',
  'traffic_code',
  'vin',
  'make',
  'model',
  'model_year',
  'colour',
  'type_ar',
  'type_en',
  'class_ar',
  'class_en',
  'license_start',
  'license_expiry',
  'insurance_expiry',
]

/** Codes, dates, VIN, and the model year read left-to-right regardless of
 *  language; every other import field (bilingual type/class/notes, site,
 *  make/model/colour free text) follows the ambient direction. */
const LTR_FIELDS: ReadonlySet<string> = new Set([
  'plate_code',
  'plate_number',
  'traffic_code',
  'vin',
  'model_year',
  'license_start',
  'license_expiry',
  'insurance_expiry',
])

export function importFieldDir(field: string): 'ltr' | 'auto' {
  return LTR_FIELDS.has(field) ? 'ltr' : 'auto'
}

export type DraftUpdater = (
  rowId: string,
  update: (draft: VehicleImportPreviewDraftRow) => VehicleImportPreviewDraftRow,
) => void

function stringValue(value: string | number | null | undefined): string {
  return value == null ? '' : String(value)
}

/** Hydrate the shared vehicle form from one workbook row. Empty import cells
 * stay empty: the backend interprets them as "keep the stored value" when the
 * row matches an existing vehicle. */
export function importDraftFormValues(
  draft: VehicleImportPreviewDraftRow,
  siteId: number | undefined,
): VehicleFormValues {
  const selectedClass = resolveVehicleClass(
    stringValue(draft.values.class_ar),
    stringValue(draft.values.class_en),
  )
  const classIndex = selectedClass
    ? VEHICLE_CLASSES.findIndex(
        (option) => option.ar === selectedClass.ar && option.en === selectedClass.en,
      )
    : -1
  const plate = [draft.values.plate_code, draft.values.plate_number].filter(Boolean).join(' \\ ')
  return {
    plate,
    traffic_code: stringValue(draft.values.traffic_code),
    vin: stringValue(draft.values.vin),
    type_ar: stringValue(draft.values.type_ar),
    type_en: stringValue(draft.values.type_en),
    vehicle_class: classIndex >= 0 ? String(classIndex) : CUSTOM_CLASS,
    custom_class_ar: classIndex >= 0 ? '' : stringValue(draft.values.class_ar),
    custom_class_en: classIndex >= 0 ? '' : stringValue(draft.values.class_en),
    site: siteId == null ? '' : String(siteId),
    new_site_ar: '',
    new_site_en: '',
    contract_note_ar: stringValue(draft.values.contract_note_ar),
    contract_note_en: stringValue(draft.values.contract_note_en),
    license_start: stringValue(draft.values.license_start),
    license_expiry: stringValue(draft.values.license_expiry),
    make: stringValue(draft.values.make),
    model: stringValue(draft.values.model),
    model_year: stringValue(draft.values.model_year),
    colour: stringValue(draft.values.colour),
    insurance_expiry: stringValue(draft.values.insurance_expiry),
    inmate_capacity: stringValue(draft.values.inmate_capacity),
    passenger_capacity: stringValue(draft.values.passenger_capacity),
    accessories_ar: stringValue(draft.values.accessories_ar),
    accessories_en: stringValue(draft.values.accessories_en),
    notes_ar: stringValue(draft.values.notes_ar),
    notes_en: stringValue(draft.values.notes_en),
  }
}

function nullableText(value: string): string | null {
  const trimmed = value.trim()
  return trimmed === '' ? null : trimmed
}

function nullableInteger(value: string): string | number | null {
  const trimmed = value.trim()
  if (trimmed === '') return null
  return /^\d+$/.test(trimmed) ? Number(trimmed) : trimmed
}

/** Convert shared-form strings back to the preview contract. Invalid integer
 * text is deliberately preserved for validation rather than truncated by
 * `parseInt`; blanks become null so updates preserve the stored field. */
export function importDraftValuesFromForm(
  values: VehicleFormValues,
): VehicleImportPreviewDraftRow['values'] {
  const plate = parsePlate(values.plate)
  const vehicleClass =
    values.vehicle_class === CUSTOM_CLASS
      ? { ar: values.custom_class_ar, en: values.custom_class_en }
      : VEHICLE_CLASSES[Number(values.vehicle_class)]
  return {
    plate_code: plate?.plate_code ?? null,
    plate_number: plate?.plate_number ?? nullableText(values.plate),
    traffic_code: nullableText(values.traffic_code),
    vin: nullableText(values.vin),
    type_ar: nullableText(values.type_ar),
    type_en: nullableText(values.type_en),
    class_ar: nullableText(vehicleClass?.ar ?? ''),
    class_en: nullableText(vehicleClass?.en ?? ''),
    contract_note_ar: nullableText(values.contract_note_ar),
    contract_note_en: nullableText(values.contract_note_en),
    license_start: nullableText(values.license_start),
    license_expiry: nullableText(values.license_expiry),
    make: nullableText(values.make),
    model: nullableText(values.model),
    model_year: nullableInteger(values.model_year),
    colour: nullableText(values.colour),
    insurance_expiry: nullableText(values.insurance_expiry),
    inmate_capacity: nullableInteger(values.inmate_capacity),
    passenger_capacity: nullableInteger(values.passenger_capacity),
    accessories_ar: nullableText(values.accessories_ar),
    accessories_en: nullableText(values.accessories_en),
    notes_ar: nullableText(values.notes_ar),
    notes_en: nullableText(values.notes_en),
  }
}

function blankFieldIssue(values: VehicleFormValues, path: PropertyKey[]): boolean {
  const field = path[0]
  if (typeof field !== 'string') return false
  const value = values[field as keyof VehicleFormValues]
  return typeof value === 'string' && value.trim() === ''
}

/** Import corrections reuse the shared form validation, except that an empty
 * cell is a meaningful "preserve existing" instruction. The backend still
 * reports required blanks for create rows after it resolves the row match. */
export function isImportCorrectionValid(values: VehicleFormValues): boolean {
  const result = vehicleFormSchema.safeParse(values)
  return result.success || result.error.issues.every((issue) => blankFieldIssue(values, issue.path))
}

export function createDraftRows(
  inspection: VehicleImportInspection,
): VehicleImportPreviewDraftRow[] {
  return inspection.rows.map((row) => ({
    row_id: row.row_id,
    excluded: false,
    values: { ...row.values },
    image_ids: [...(row.image_ids ?? [])],
    image_roles: {},
    photo_action: null,
    primary_image_id: null,
    license_action: null,
    license_image_id: null,
    ocr_reviewed_image_ids: [],
    ocr_manual_image_ids: [],
    ocr_identity_confirmed_image_ids: [],
  }))
}

function normalized(value: string): string {
  return value.trim().toLocaleLowerCase().replace(/\s+/g, ' ')
}

export function inferSiteMappings(
  inspection: VehicleImportInspection,
  sites: VehicleSiteRead[],
): Record<string, number> {
  const mappings: Record<string, number> = {}
  for (const section of inspection.sections) {
    const haystack = normalized(`${section.title} ${section.sheet}`)
    const matches = sites.filter((site) => {
      if (!site.active) return false
      return [site.name_ar, site.name_en].some((name) => {
        const needle = normalized(name)
        return needle.length > 1 && haystack.includes(needle)
      })
    })
    if (matches.length === 1) mappings[section.id] = matches[0].id
  }
  return mappings
}

export function roleForImage(
  draft: VehicleImportPreviewDraftRow,
  image: VehicleImportImage,
): 'photo' | 'license' | '' {
  return draft.image_roles?.[image.image_id] ?? image.kind ?? ''
}

export function isConfirmable(row: VehicleImportPreviewRow): boolean {
  return (
    (row.action === 'create' || row.action === 'update' || row.action === 'unchanged') &&
    !row.photo_choice_required &&
    !row.license_choice_required &&
    !row.ocr_review_required
  )
}

export function scanHasValues(scan: VehicleProfileScan): boolean {
  return OCR_FIELDS.some((field) => scan[field] != null)
}

export function scanIdentityConflicts(
  scan: VehicleProfileScan,
  values: VehicleImportPreviewDraftRow['values'],
): boolean {
  const plateNumber = values.plate_number
  const plateCode = values.plate_code
  if (scan.plate_number != null && typeof plateNumber === 'string') {
    if (scan.plate_number !== plateNumber) return true
    if (scan.plate_code != null && scan.plate_code !== plateCode) return true
  }
  const vin = values.vin
  return Boolean(
    scan.vin != null &&
      typeof vin === 'string' &&
      scan.vin.toLocaleLowerCase() !== vin.toLocaleLowerCase(),
  )
}

export function issueKey(issue: VehicleImportIssue): string {
  const byCode: Record<string, string> = {
    VEHICLE_IMPORT_INVALID_FIELD: 'invalidField',
    VEHICLE_IMPORT_SITE_REQUIRED: 'siteRequired',
    VEHICLE_IMPORT_REQUIRED_FIELD: 'requiredField',
    VEHICLE_IMPORT_DUPLICATE_PLATE: 'duplicatePlate',
    VEHICLE_IMPORT_IMAGE_ROLE_REQUIRED: 'imageRoleRequired',
    VEHICLE_IMPORT_PHOTO_CHOICE_REQUIRED: 'photoChoiceRequired',
    VEHICLE_IMPORT_LICENSE_CHOICE_REQUIRED: 'licenseChoiceRequired',
    VEHICLE_IMPORT_SCAN_IDENTITY_CONFLICT: 'identityConflict',
    VEHICLE_IMPORT_UNASSIGNED_IMAGE: 'unassignedImage',
    VEHICLE_IMPORT_ARCHIVED_MATCH: 'archivedMatch',
  }
  return byCode[issue.code] ?? 'serverIssue'
}
