/**
 * Shared helpers for the Vehicles module — badge tones, money/date formatting,
 * plate parsing, license-window defaults, the fixed vehicle-class list, upload
 * accept strings, the query-key map every mutation invalidates, and the
 * error-code → locale mapping the dialogs surface.
 *
 * Framework-free (no JSX) so the hub, the vehicle file, the registers, the
 * dialogs and the printable letters all apply exactly the same rules. Modeled
 * on `pages/permits/permitUtils.ts`.
 */

import type { QueryClient } from '@tanstack/react-query'
import vehicleClassCatalog from '../../../../backend/templates/vehicle_classes.json'

import type { BadgeProps } from '@/components/ui/badge'
import type { DocViewerItem } from '@/components/ui/document-viewer-dialog'
import { ApiError, apiErrorMessage } from '@/lib/api'
import type { VehicleFileRead } from '@/lib/api'
import { fileKindFromName } from '@/lib/fileTypes'
import { toBase64Url } from '@/lib/pdf'

/** The Badge tones this module may use — derived from the design system so a
 *  new token in `badge-variants.ts` is immediately available here. */
export type VehicleTone = NonNullable<BadgeProps['tone']>

export type ExpiryStatus = 'valid' | 'due' | 'expired'
export type DueState = 'overdue' | 'due' | 'scheduled'
export type AccidentStatus = 'open' | 'closed'
export type MaintenanceType = 'service' | 'repair' | 'tires' | 'other'
export type PaymentStatus = 'unknown' | 'unpaid' | 'paid'

/** The narrow `t` shape the helpers need — assignable from i18next's `t`. */
export type Translate = (key: string, options?: Record<string, unknown>) => string

/** The em-dash the module prints wherever a record has no value. Matches the
 *  DOCX templates, which print «—» for a withheld or absent field. */
export const EMPTY_VALUE = '—'

// ── Badge tones ─────────────────────────────────────────────────────────────
// One mapping per state family. Colour is never the only signal: every badge
// also carries its own translated label (see VehicleStatusBadge).

export function expiryTone(status: ExpiryStatus): VehicleTone {
  switch (status) {
    case 'valid':
      return 'active'
    case 'due':
      return 'warning'
    case 'expired':
      return 'danger'
  }
}

export function dueTone(state: DueState): VehicleTone {
  switch (state) {
    case 'overdue':
      return 'danger'
    case 'due':
      return 'warning'
    case 'scheduled':
      return 'info'
  }
}

export function accidentTone(status: AccidentStatus): VehicleTone {
  return status === 'open' ? 'warning' : 'active'
}

/** `unknown` (pre-migration history, not yet classified) reads as neutral,
 *  never as an alarm — it is a data gap, not an overdue debt. */
export function paymentTone(status: PaymentStatus): VehicleTone {
  switch (status) {
    case 'paid':
      return 'active'
    case 'unpaid':
      return 'warning'
    case 'unknown':
      return 'neutral'
  }
}

// ── Language ────────────────────────────────────────────────────────────────

/** True for `ar` and any Arabic regional tag (`ar-AE`). */
export function isArabic(language: string): boolean {
  return language.startsWith('ar')
}

/** Pick the language-appropriate half of a bilingual pair, falling back to the
 *  peer language rather than rendering an empty cell. */
export function localized(
  ar: string | null | undefined,
  en: string | null | undefined,
  language: string,
): string {
  const [first, second] = isArabic(language) ? [ar, en] : [en, ar]
  return first?.trim() || second?.trim() || ''
}

/** Label for an employee that may be unassigned (imported EVG fines have no
 *  driver): the localized name, else the caller's «Unassigned» copy. */
export function employeeLabel(
  row: { employee_id: string | null; employee_name_ar?: string | null; employee_name_en?: string | null },
  language: string,
  unassigned: string,
): string {
  if (!row.employee_id) return unassigned
  return localized(row.employee_name_ar, row.employee_name_en, language) || row.employee_id
}

// ── Numbers, money, dates ───────────────────────────────────────────────────

export function formatNumber(value: number, language: string): string {
  return new Intl.NumberFormat(isArabic(language) ? 'ar-AE' : 'en-AE', {
    maximumFractionDigits: 0,
  }).format(value)
}

/** Whole dirhams, with the currency word after the amount in both languages
 *  («17,975 AED» / «١٧٩٧٥ د.إ»). Wrap in `<bdi>` at the render site. */
export function formatAed(value: number, language: string): string {
  return `${formatNumber(value, language)} ${isArabic(language) ? 'د.إ' : 'AED'}`
}

/** Money exactly as the generated letters print it (`f"{amount} درهم"`), so the
 *  on-screen paper and the DOCX cannot disagree. Latin digits, Arabic word. */
export function formatLetterAed(value: number): string {
  return `${value} درهم`
}

// ── Fine money (fils) ───────────────────────────────────────────────────────
// Fine amounts are exact integer fils (1/100 AED) so a fractional fine (e.g.
// AED 349.50) is never rounded away. Every other cost on the module (accident
// damage, maintenance/renewal cost) stays whole AED via `formatAed`/
// `formatLetterAed` above — only fines carry fractions. Fine money is always
// rendered in Latin digits in both languages (isolated from the surrounding
// Arabic run), matching the signed-off mockup and `core/vehicle_letters.py`.

const FILS_GROUPED_WHOLE_FMT = new Intl.NumberFormat('en-AE', {
  numberingSystem: 'latn',
  useGrouping: true,
  minimumFractionDigits: 0,
  maximumFractionDigits: 0,
})
const FILS_GROUPED_FRAC_FMT = new Intl.NumberFormat('en-AE', {
  numberingSystem: 'latn',
  useGrouping: true,
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
})
const FILS_PLAIN_WHOLE_FMT = new Intl.NumberFormat('en-AE', {
  numberingSystem: 'latn',
  useGrouping: false,
  minimumFractionDigits: 0,
  maximumFractionDigits: 0,
})
const FILS_PLAIN_FRAC_FMT = new Intl.NumberFormat('en-AE', {
  numberingSystem: 'latn',
  useGrouping: false,
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
})

/** Fils → its exact display string: whole amounts print without cents,
 *  fractional amounts print exactly two digits. Never rounded, never
 *  truncated — the two Intl formatters only ever render a value already
 *  split into whole AED and whole cents. */
export function formatFilsNumber(fils: number, opts: { grouping?: boolean } = {}): string {
  const grouping = opts.grouping !== false
  const whole = fils % 100 === 0
  const value = fils / 100
  const fmt = grouping
    ? whole
      ? FILS_GROUPED_WHOLE_FMT
      : FILS_GROUPED_FRAC_FMT
    : whole
      ? FILS_PLAIN_WHOLE_FMT
      : FILS_PLAIN_FRAC_FMT
  return fmt.format(value)
}

/** A fine amount for on-screen display: the currency word after the amount in
 *  both languages, mirroring `formatAed` — but exact-fils and Latin-digit. */
export function formatFilsAed(fils: number, language: string): string {
  return `${formatFilsNumber(fils)} ${isArabic(language) ? 'د.إ' : 'AED'}`
}

/** A fine amount exactly as the generated letters print it (`349 درهم` /
 *  `349.50 درهم`), matching `core/vehicle_letters._format_letter_amount`. */
export function formatLetterFilsAed(fils: number): string {
  return `${formatFilsNumber(fils, { grouping: false })} درهم`
}

/** The fils amount as plain (ungrouped) editable text — what an amount text
 *  input shows for its current/default value. */
export function filsToEditableText(fils: number): string {
  return formatFilsNumber(fils, { grouping: false })
}

// U+066B (Arabic decimal separator) and U+060C (Arabic comma), either of
// which an Arabic keyboard may emit for a typed decimal point.
const ARABIC_DECIMAL_SEPARATORS = /[\u066B\u060C]/g

/**
 * Strict fine-amount parser: plain digits with zero to two decimal places,
 * no sign, no grouping, no exponent, in the domain's 1–9,999,999.99 AED
 * range. `null` for anything else — including zero, a sub-dirham amount, or
 * excess precision — so the caller marks the field invalid instead of
 * sending junk. Arabic-Indic/Extended-Arabic digits and the Arabic decimal
 * separator normalize first, so an amount typed on an Arabic keypad parses
 * identically to one typed in English. Computed by splitting the
 * whole/fraction strings — never `parseFloat() * 100`, which is not exact
 * for money.
 */
export function parseAmountToFils(raw: string): number | null {
  const sanitized = normalizeDigits(raw).replace(ARABIC_DECIMAL_SEPARATORS, '.').trim()
  const match = /^(\d{1,7})(?:\.(\d{1,2}))?$/.exec(sanitized)
  if (!match) return null
  const whole = Number(match[1])
  if (whole < 1 || whole > 9_999_999) return null
  const fraction = (match[2] ?? '').padEnd(2, '0')
  return whole * 100 + Number(fraction)
}

/** ISO date (or timestamp) → `yyyy-mm-dd`, the mono form every table uses. */
export function formatIsoDate(iso: string | null | undefined): string {
  return iso ? iso.slice(0, 10) : EMPTY_VALUE
}

/** `yyyy-mm-dd` → `dd/mm/yyyy`, the form the letters print. */
export function formatLetterDate(iso: string | null | undefined): string {
  if (!iso) return EMPTY_VALUE
  const [year, month, day] = iso.slice(0, 10).split('-')
  if (!year || !month || !day) return EMPTY_VALUE
  return `${day}/${month}/${year}`
}

/** `yyyy-mm-dd` + `HH:MM` → one mono run. Both halves are optional. */
export function formatDateTime(
  iso: string | null | undefined,
  time: string | null | undefined,
): string {
  const date = formatIsoDate(iso)
  const clock = time?.slice(0, 5)
  return clock ? `${date} ${clock}` : date
}

/**
 * Today as `yyyy-mm-dd` in the operator's own timezone. `toISOString()` alone
 * would answer with yesterday's date every day before 04:00 in Dubai, which
 * would date a fine or an accident report to the wrong day.
 */
export function todayIso(): string {
  const now = new Date()
  return new Date(now.getTime() - now.getTimezoneOffset() * 60_000).toISOString().slice(0, 10)
}

/** Current local wall-clock as `HH:MM`, the accident-time default. */
export function nowTime(): string {
  const now = new Date()
  return `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`
}

/** `yyyy-mm-dd` shifted by whole days (UTC arithmetic on a date-only value). */
export function addDaysIso(iso: string, days: number): string {
  const parsed = parseIso(iso)
  if (!parsed) return iso
  parsed.setUTCDate(parsed.getUTCDate() + days)
  return parsed.toISOString().slice(0, 10)
}

/**
 * The expiry a one-year license window ends on: start + 1 year − 1 day, which
 * is how the traffic department prints it (01/09/2026 → 31/08/2027).
 */
export function licenseWindowEnd(startIso: string): string {
  const parsed = parseIso(startIso)
  if (!parsed) return ''
  parsed.setUTCFullYear(parsed.getUTCFullYear() + 1)
  parsed.setUTCDate(parsed.getUTCDate() - 1)
  return parsed.toISOString().slice(0, 10)
}

function parseIso(iso: string): Date | null {
  const [year, month, day] = iso.slice(0, 10).split('-').map(Number)
  if (!year || !month || !day) return null
  return new Date(Date.UTC(year, month - 1, day))
}

// ── Plates ──────────────────────────────────────────────────────────────────

/** Arabic-Indic (٠١٢) and Extended-Arabic (۰۱۲) digits → ASCII, so a plate or
 *  a traffic code typed on an Arabic keypad validates. */
export function normalizeDigits(input: string): string {
  return input.replace(/[\u0660-\u0669\u06f0-\u06f9]/g, (char) => {
    const code = char.charCodeAt(0)
    return String(code - (code >= 0x06f0 ? 0x06f0 : 0x0660))
  })
}

/** The plate as the paperwork writes it: `14 \ 58216`, or the bare number when
 *  the vehicle carries no category code. */
export function plateLabel(vehicle: {
  plate_code?: string | null
  plate_number: string
}): string {
  const code = vehicle.plate_code?.trim()
  return code ? `${code} \\ ${vehicle.plate_number}` : vehicle.plate_number
}

/**
 * One typed plate → the two API fields. Accepts `58216`, `14 \ 58216`,
 * `14/58216` and `14-58216`, in either digit set. `null` when it is not a
 * plate, so the form can mark the field invalid instead of sending junk.
 */
export function parsePlate(
  input: string,
): { plate_code: string | null; plate_number: string } | null {
  const match = /^(?:(\d{1,3})\s*[\\/-]\s*)?(\d{1,6})$/.exec(
    normalizeDigits(input).replace(/\s+/g, ' ').trim(),
  )
  if (!match) return null
  return { plate_code: match[1] ?? null, plate_number: match[2] }
}

// ── Fixed option lists ──────────────────────────────────────────────────────

interface VehicleClassCatalog {
  readonly presets: ReadonlyArray<{ ar: string; en: string }>
  readonly aliases: {
    readonly ar: Readonly<Record<string, string>>
    readonly en: Readonly<Record<string, string>>
  }
}

const classCatalog: VehicleClassCatalog = vehicleClassCatalog

/** The fleet's seven vehicle classes, stored as the `class_ar`/`class_en` pair.
 *  The backend importer consumes this same catalog so preset wording cannot drift. */
export const VEHICLE_CLASSES: ReadonlyArray<{ ar: string; en: string }> = classCatalog.presets

/** Confident exact legacy spellings keyed to their canonical preset names. */
export const VEHICLE_CLASS_ALIASES = classCatalog.aliases

export const MAINTENANCE_TYPES: readonly MaintenanceType[] = [
  'service',
  'repair',
  'tires',
  'other',
]

/** `accept` for the image-only kinds (`photo`, `gallery`, `accident`) and for
 *  the kinds that also take a PDF (`license`, `receipt`). Both mirror
 *  `vehicle_service._ALLOWED_EXTENSIONS`, so the picker cannot offer a file the
 *  API will reject. */
export const IMAGE_ACCEPT = '.png,.jpg,.jpeg,.webp'
export const DOCUMENT_ACCEPT = '.pdf,.png,.jpg,.jpeg,.webp'

/** A fine receipt — PDF/PNG/JPEG only, no WebP. Narrower than
 *  `DOCUMENT_ACCEPT`: `vehicle_service._validate_fine_receipt` enforces this
 *  same set server-side (10 MiB cap), distinct from the generic 25 MiB/WebP
 *  receipt policy `VehicleMaintenance` still uses. */
export const FINE_RECEIPT_ACCEPT = '.pdf,.png,.jpg,.jpeg'

// ── Files ───────────────────────────────────────────────────────────────────

export function fileLabel(file: VehicleFileRead, language: string): string {
  return localized(file.label_ar, file.label_en, language) || file.original_name
}

/**
 * A stored vehicle file as `DocumentViewerDialog` wants it. PDFs go through
 * `?encoding=base64` (the WebView2/IDM handler hijacks a raw PDF response);
 * images are linked directly, which the API serves `Content-Disposition:
 * inline`.
 */
export function vehicleFileViewerItem(file: VehicleFileRead, url: string): DocViewerItem {
  const isPdf =
    file.media_type === 'application/pdf' || fileKindFromName(file.original_name) === 'pdf'
  return {
    name: file.original_name,
    kind: isPdf ? 'pdf' : fileKindFromName(file.original_name),
    imageUrl: isPdf ? undefined : url,
    pdfBase64Url: isPdf ? toBase64Url(url) : undefined,
    openUrl: url,
    downloadUrl: url,
  }
}

// ── Server state ────────────────────────────────────────────────────────────

/** Every query the module reads. Mutations invalidate through
 *  `invalidateVehicleQueries` so no surface is left stale. */
export const VEHICLE_QUERY_KEYS = {
  summary: ['vehicles-summary'] as const,
  list: ['vehicles'] as const,
  detail: (vehicleId: number) => ['vehicle', vehicleId] as const,
  photoLibrary: ['vehicle-photo-library'] as const,
  sites: ['vehicle-sites'] as const,
  fines: ['vehicle-fines'] as const,
  accidents: ['vehicle-accidents'] as const,
  maintenance: ['vehicle-maintenance'] as const,
}

export type VehicleRegister = 'fines' | 'accidents' | 'maintenance' | 'sites'

/**
 * The invalidation fan-out every vehicle mutation performs: the hub summary,
 * the fleet ledger, the touched vehicle file, and each register the change is
 * visible in.
 */
export function invalidateVehicleQueries(
  queryClient: QueryClient,
  options: { vehicleId?: number | null; registers?: readonly VehicleRegister[] } = {},
): void {
  void queryClient.invalidateQueries({ queryKey: VEHICLE_QUERY_KEYS.summary })
  void queryClient.invalidateQueries({ queryKey: VEHICLE_QUERY_KEYS.list })
  void queryClient.invalidateQueries({ queryKey: VEHICLE_QUERY_KEYS.photoLibrary })
  if (options.vehicleId != null) {
    void queryClient.invalidateQueries({ queryKey: VEHICLE_QUERY_KEYS.detail(options.vehicleId) })
  }
  for (const register of options.registers ?? []) {
    void queryClient.invalidateQueries({ queryKey: VEHICLE_QUERY_KEYS[register] })
  }
}

/** Server error codes that have their own translated sentence. Everything else
 *  falls through to the API's own message. */
const ERROR_MESSAGE_KEYS: Record<string, string> = {
  SITE_HAS_VEHICLES: 'vehicles.siteHasVehicles',
  VEHICLE_FILE_IN_USE: 'vehicles.vehicleFileInUse',
  VEHICLE_FILE_KIND_MISMATCH: 'vehicles.photoLibrary.errors.invalid',
  VEHICLE_PHOTO_INVALID: 'vehicles.photoLibrary.errors.invalid',
  VEHICLE_PHOTO_EMPTY: 'vehicles.photoLibrary.errors.invalid',
  VEHICLE_PHOTO_UNSUPPORTED_FORMAT: 'vehicles.photoLibrary.errors.invalid',
  VEHICLE_PHOTO_TOO_LARGE: 'vehicles.photoLibrary.errors.tooLarge',
  VEHICLE_PHOTO_DIMENSIONS_TOO_LARGE: 'vehicles.photoLibrary.errors.dimensionsTooLarge',
  VEHICLE_PHOTO_ANIMATED: 'vehicles.photoLibrary.errors.animated',
  VEHICLE_PHOTO_LABEL_REQUIRED: 'vehicles.photoLibrary.errors.labelRequired',
  VEHICLE_PHOTO_LABEL_TOO_LONG: 'vehicles.photoLibrary.errors.labelTooLong',
  VEHICLE_PHOTO_IN_USE: 'vehicles.photoLibrary.errors.inUse',
  VEHICLE_PHOTO_NOT_FOUND: 'vehicles.photoLibrary.selectionUnavailable',
  VEHICLE_PHOTO_INVALID_PATH: 'vehicles.photoLibrary.selectionUnavailable',
  VEHICLE_PHOTO_MISSING: 'vehicles.photoLibrary.selectionUnavailable',
  VEHICLE_PHOTO_SOURCE_MISSING: 'vehicles.photoLibrary.selectionUnavailable',
  VEHICLE_PHOTO_VARIANT_NOT_FOUND: 'vehicles.photoLibrary.selectionUnavailable',
  EVG_PREVIEW_JOB_NOT_FOUND: 'vehicles.evg.jobExpired',
  EVG_BUSY: 'vehicles.evg.busy',
  EVG_UNAVAILABLE: 'vehicles.evg.error',
  VEHICLE_FINE_VERSION_CONFLICT: 'vehicles.fines.errors.versionConflict',
  VEHICLE_FINE_ARCHIVED: 'vehicles.fines.errors.archived',
  VEHICLE_FINE_ALREADY_PAID: 'vehicles.fines.errors.alreadyPaid',
  VEHICLE_FINE_INVALID_TRANSITION: 'vehicles.fines.errors.invalidTransition',
  VEHICLE_FINE_RECEIPT_REQUIRES_PAID: 'vehicles.fines.errors.receiptRequiresPaid',
  VEHICLE_FINE_RECEIPT_ALREADY_ATTACHED: 'vehicles.fines.errors.receiptAlreadyAttached',
  VEHICLE_FINE_ARCHIVE_STATE_MISMATCH: 'vehicles.fines.errors.archiveStateMismatch',
  VEHICLE_FINE_RECEIPT_EMPTY: 'vehicles.fines.errors.receiptBadFormat',
  VEHICLE_FINE_RECEIPT_TOO_LARGE: 'vehicles.fines.errors.receiptTooLarge',
  VEHICLE_FINE_RECEIPT_BAD_FORMAT: 'vehicles.fines.errors.receiptBadFormat',
  VEHICLE_FINE_REQUIRED_FIELD: 'vehicles.fines.errors.requiredField',
  VEHICLE_FINE_NOT_FOUND: 'vehicles.fines.errors.notFound',
}

export function vehicleErrorMessage(err: unknown, t: Translate): string {
  if (err instanceof ApiError) {
    const key = ERROR_MESSAGE_KEYS[err.code]
    if (key) return t(key)
  }
  return apiErrorMessage(err)
}
