import type {
  VehicleImportImage,
  VehicleImportInspection,
  VehicleImportIssue,
  VehicleImportPreviewDraftRow,
  VehicleImportPreviewRow,
  VehicleProfileScan,
  VehicleSiteRead,
} from '@/lib/api'

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
