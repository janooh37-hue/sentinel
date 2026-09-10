/**
 * The vehicle profile form — schema, defaults, and payload mapping shared by
 * `AddVehicleDialog` (create) and `VehicleEditPage` (edit), so the two
 * surfaces never drift into two field vocabularies.
 *
 * Numeric-looking inputs (`model_year`, the two capacities) are kept as form
 * strings and converted to integer-or-null only at the payload boundary —
 * RHF stays symmetric (string in, string out) and a blank field never
 * silently becomes zero.
 */

import { z } from 'zod'

import type { VehicleCreate, VehicleRead, VehicleSiteRead, VehicleUpdate } from '@/lib/api'

import {
  VEHICLE_CLASSES,
  VEHICLE_CLASS_ALIASES,
  licenseWindowEnd,
  normalizeDigits,
  parsePlate,
  plateLabel,
  todayIso,
} from './vehicleUtils'

/** Sentinel value of the "+ New site…" option (create mode only). */
export const NEW_SITE = 'new'
/** Sentinel value of the "Custom class…" option, alongside `VEHICLE_CLASSES`. */
export const CUSTOM_CLASS = 'custom'

const DIGITS_ONLY = /^\d+$/
const YEAR_ONLY = /^\d{4}$/

export const vehicleFormSchema = z
  .object({
    plate: z.string().trim().min(1),
    traffic_code: z.string().trim().min(1),
    vin: z.string().trim().max(32),
    type_ar: z.string().trim().min(1).max(128),
    type_en: z.string().trim().min(1).max(128),
    /** Index into `VEHICLE_CLASSES`, or `CUSTOM_CLASS`. */
    vehicle_class: z.string().min(1),
    custom_class_ar: z.string().trim().max(64),
    custom_class_en: z.string().trim().max(64),
    site: z.string().min(1),
    new_site_ar: z.string().trim().max(128),
    new_site_en: z.string().trim().max(128),
    contract_note_ar: z.string().trim().max(2048),
    contract_note_en: z.string().trim().max(2048),
    license_start: z.string().min(1),
    license_expiry: z.string().min(1),
    make: z.string().trim().max(128),
    model: z.string().trim().max(128),
    model_year: z.string().trim(),
    colour: z.string().trim().max(64),
    insurance_expiry: z.string(),
    inmate_capacity: z.string().trim(),
    passenger_capacity: z.string().trim(),
    accessories_ar: z.string().trim().max(2048),
    accessories_en: z.string().trim().max(2048),
    notes_ar: z.string().trim().max(2048),
    notes_en: z.string().trim().max(2048),
  })
  .superRefine((values, ctx) => {
    if (!parsePlate(values.plate)) {
      ctx.addIssue({ code: 'custom', path: ['plate'], message: 'plate' })
    }
    if (!/^\d{4,12}$/.test(normalizeDigits(values.traffic_code))) {
      ctx.addIssue({ code: 'custom', path: ['traffic_code'], message: 'trafficCode' })
    }
    if (values.license_expiry <= values.license_start) {
      ctx.addIssue({ code: 'custom', path: ['license_expiry'], message: 'expiry' })
    }
    if (values.site === NEW_SITE) {
      if (!values.new_site_ar) {
        ctx.addIssue({ code: 'custom', path: ['new_site_ar'], message: 'required' })
      }
      if (!values.new_site_en) {
        ctx.addIssue({ code: 'custom', path: ['new_site_en'], message: 'required' })
      }
    }
    if (values.vehicle_class === CUSTOM_CLASS) {
      if (!values.custom_class_ar) {
        ctx.addIssue({ code: 'custom', path: ['custom_class_ar'], message: 'required' })
      }
      if (!values.custom_class_en) {
        ctx.addIssue({ code: 'custom', path: ['custom_class_en'], message: 'required' })
      }
    }
    if (values.model_year && !YEAR_ONLY.test(values.model_year)) {
      ctx.addIssue({ code: 'custom', path: ['model_year'], message: 'modelYear' })
    }
    if (values.inmate_capacity && !DIGITS_ONLY.test(values.inmate_capacity)) {
      ctx.addIssue({ code: 'custom', path: ['inmate_capacity'], message: 'capacity' })
    }
    if (values.passenger_capacity && !DIGITS_ONLY.test(values.passenger_capacity)) {
      ctx.addIssue({ code: 'custom', path: ['passenger_capacity'], message: 'capacity' })
    }
  })

export type VehicleFormValues = z.output<typeof vehicleFormSchema>
/** RHF's input-side type (identical here — every field is a plain string —
 *  kept distinct so callers stay explicit about which side they mean). */
export type VehicleFormInput = z.input<typeof vehicleFormSchema>

const collapseSpace = (value: string): string => value.trim().replace(/\s+/g, ' ')

/**
 * Match a scanned/imported bilingual class pair onto an existing preset by
 * normalized exact name (plus the known legacy spelling aliases). `null`
 * when nothing matches confidently — the caller routes to the custom-class
 * path rather than guessing or discarding the source text.
 */
export function resolveVehicleClass(
  ar: string | null | undefined,
  en: string | null | undefined,
): { ar: string; en: string } | null {
  if (ar) {
    const normalized = collapseSpace(ar)
    const canonical = VEHICLE_CLASS_ALIASES.ar[normalized] ?? normalized
    const match = VEHICLE_CLASSES.find((option) => collapseSpace(option.ar) === canonical)
    if (match) return match
  }
  if (en) {
    const normalized = collapseSpace(en).toLowerCase()
    const canonical = (VEHICLE_CLASS_ALIASES.en[normalized] ?? normalized).toLowerCase()
    const match = VEHICLE_CLASSES.find(
      (option) => collapseSpace(option.en).toLowerCase() === canonical,
    )
    if (match) return match
  }
  return null
}

function classFromForm(values: VehicleFormValues): { ar: string; en: string } {
  if (values.vehicle_class === CUSTOM_CLASS) {
    return { ar: values.custom_class_ar, en: values.custom_class_en }
  }
  return VEHICLE_CLASSES[Number(values.vehicle_class)] ?? VEHICLE_CLASSES[0]
}

/** `null` vehicle → create-mode defaults (today's licence window, first active
 *  site). A record → edit-mode defaults hydrated field-for-field; the class
 *  select resolves to its preset index, or `CUSTOM_CLASS` with the record's
 *  own bilingual text preserved verbatim. */
export function vehicleFormDefaults(
  vehicle: VehicleRead | null,
  sites: readonly VehicleSiteRead[],
): VehicleFormValues {
  if (!vehicle) {
    const activeSites = sites.filter((site) => site.active)
    const start = todayIso()
    return {
      plate: '',
      traffic_code: '',
      vin: '',
      type_ar: '',
      type_en: '',
      vehicle_class: '0',
      custom_class_ar: '',
      custom_class_en: '',
      site: activeSites.length > 0 ? String(activeSites[0].id) : NEW_SITE,
      new_site_ar: '',
      new_site_en: '',
      contract_note_ar: '',
      contract_note_en: '',
      license_start: start,
      license_expiry: licenseWindowEnd(start),
      make: '',
      model: '',
      model_year: '',
      colour: '',
      insurance_expiry: '',
      inmate_capacity: '',
      passenger_capacity: '',
      accessories_ar: '',
      accessories_en: '',
      notes_ar: '',
      notes_en: '',
    }
  }

  const classIndex = VEHICLE_CLASSES.findIndex(
    (option) => option.ar === vehicle.class_ar && option.en === vehicle.class_en,
  )
  return {
    plate: plateLabel(vehicle),
    traffic_code: vehicle.traffic_code,
    vin: vehicle.vin ?? '',
    type_ar: vehicle.type_ar,
    type_en: vehicle.type_en,
    vehicle_class: classIndex >= 0 ? String(classIndex) : CUSTOM_CLASS,
    custom_class_ar: classIndex >= 0 ? '' : vehicle.class_ar,
    custom_class_en: classIndex >= 0 ? '' : vehicle.class_en,
    site: String(vehicle.site_id),
    new_site_ar: '',
    new_site_en: '',
    contract_note_ar: vehicle.contract_note_ar ?? '',
    contract_note_en: vehicle.contract_note_en ?? '',
    license_start: vehicle.license_start,
    license_expiry: vehicle.license_expiry,
    make: vehicle.make ?? '',
    model: vehicle.model ?? '',
    model_year: vehicle.model_year != null ? String(vehicle.model_year) : '',
    colour: vehicle.colour ?? '',
    insurance_expiry: vehicle.insurance_expiry ?? '',
    inmate_capacity: vehicle.inmate_capacity != null ? String(vehicle.inmate_capacity) : '',
    passenger_capacity:
      vehicle.passenger_capacity != null ? String(vehicle.passenger_capacity) : '',
    accessories_ar: vehicle.accessories_ar ?? '',
    accessories_en: vehicle.accessories_en ?? '',
    notes_ar: vehicle.notes_ar ?? '',
    notes_en: vehicle.notes_en ?? '',
  }
}

/** Validated values → `POST /vehicles` body. Assumes the resolver already
 *  rejected an unparseable plate. */
export function vehicleCreatePayload(values: VehicleFormValues): VehicleCreate {
  const plate = parsePlate(values.plate)
  if (!plate) throw new Error('vehicleCreatePayload: plate failed validation')
  const vehicleClass = classFromForm(values)
  return {
    plate_code: plate.plate_code,
    plate_number: plate.plate_number,
    traffic_code: normalizeDigits(values.traffic_code),
    type_ar: values.type_ar,
    type_en: values.type_en,
    class_ar: vehicleClass.ar,
    class_en: vehicleClass.en,
    vin: values.vin || null,
    site_id: values.site === NEW_SITE ? null : Number(values.site),
    new_site:
      values.site === NEW_SITE
        ? { name_ar: values.new_site_ar, name_en: values.new_site_en }
        : null,
    contract_note_ar: values.contract_note_ar || null,
    contract_note_en: values.contract_note_en || null,
    license_start: values.license_start,
    license_expiry: values.license_expiry,
    make: values.make || null,
    model: values.model || null,
    model_year: values.model_year !== '' ? Number(values.model_year) : null,
    colour: values.colour || null,
    insurance_expiry: values.insurance_expiry || null,
    inmate_capacity: values.inmate_capacity !== '' ? Number(values.inmate_capacity) : null,
    passenger_capacity:
      values.passenger_capacity !== '' ? Number(values.passenger_capacity) : null,
    accessories_ar: values.accessories_ar || null,
    accessories_en: values.accessories_en || null,
    notes_ar: values.notes_ar || null,
    notes_en: values.notes_en || null,
  }
}

/** Validated values, diffed against `original` → `PATCH /vehicles/{id}` body
 *  containing only the fields that actually changed. `new_site` is never sent
 *  (edit reassigns to an existing site only); a `site` value of `NEW_SITE`
 *  cannot occur in edit mode (the field never offers that option there). */
export function vehicleUpdatePayload(
  values: VehicleFormValues,
  original: VehicleRead,
): VehicleUpdate {
  const patch: VehicleUpdate = {}

  const plate = parsePlate(values.plate)
  if (plate) {
    if (plate.plate_code !== (original.plate_code ?? null)) patch.plate_code = plate.plate_code
    if (plate.plate_number !== original.plate_number) patch.plate_number = plate.plate_number
  }
  const traffic = normalizeDigits(values.traffic_code)
  if (traffic !== original.traffic_code) patch.traffic_code = traffic
  const vin = values.vin || null
  if (vin !== (original.vin ?? null)) patch.vin = vin
  if (values.type_ar !== original.type_ar) patch.type_ar = values.type_ar
  if (values.type_en !== original.type_en) patch.type_en = values.type_en

  const vehicleClass = classFromForm(values)
  if (vehicleClass.ar !== original.class_ar) patch.class_ar = vehicleClass.ar
  if (vehicleClass.en !== original.class_en) patch.class_en = vehicleClass.en

  if (values.site !== NEW_SITE) {
    const siteId = Number(values.site)
    if (siteId !== original.site_id) patch.site_id = siteId
  }

  const contractAr = values.contract_note_ar || null
  if (contractAr !== (original.contract_note_ar ?? null)) patch.contract_note_ar = contractAr
  const contractEn = values.contract_note_en || null
  if (contractEn !== (original.contract_note_en ?? null)) patch.contract_note_en = contractEn

  if (values.license_start !== original.license_start) patch.license_start = values.license_start
  if (values.license_expiry !== original.license_expiry) {
    patch.license_expiry = values.license_expiry
  }

  const make = values.make || null
  if (make !== (original.make ?? null)) patch.make = make
  const model = values.model || null
  if (model !== (original.model ?? null)) patch.model = model
  const modelYear = values.model_year !== '' ? Number(values.model_year) : null
  if (modelYear !== (original.model_year ?? null)) patch.model_year = modelYear
  const colour = values.colour || null
  if (colour !== (original.colour ?? null)) patch.colour = colour
  const insuranceExpiry = values.insurance_expiry || null
  if (insuranceExpiry !== (original.insurance_expiry ?? null)) {
    patch.insurance_expiry = insuranceExpiry
  }
  const inmateCapacity = values.inmate_capacity !== '' ? Number(values.inmate_capacity) : null
  if (inmateCapacity !== (original.inmate_capacity ?? null)) {
    patch.inmate_capacity = inmateCapacity
  }
  const passengerCapacity =
    values.passenger_capacity !== '' ? Number(values.passenger_capacity) : null
  if (passengerCapacity !== (original.passenger_capacity ?? null)) {
    patch.passenger_capacity = passengerCapacity
  }
  const accessoriesAr = values.accessories_ar || null
  if (accessoriesAr !== (original.accessories_ar ?? null)) patch.accessories_ar = accessoriesAr
  const accessoriesEn = values.accessories_en || null
  if (accessoriesEn !== (original.accessories_en ?? null)) patch.accessories_en = accessoriesEn
  const notesAr = values.notes_ar || null
  if (notesAr !== (original.notes_ar ?? null)) patch.notes_ar = notesAr
  const notesEn = values.notes_en || null
  if (notesEn !== (original.notes_en ?? null)) patch.notes_en = notesEn

  return patch
}
