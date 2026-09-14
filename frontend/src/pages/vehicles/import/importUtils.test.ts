import { describe, expect, it } from 'vitest'

import type { VehicleImportPreviewDraftRow } from '@/lib/api'

import { CUSTOM_CLASS } from '../vehicleForm'
import { VEHICLE_CLASSES } from '../vehicleUtils'
import {
  importDraftFormValues,
  importDraftValuesFromForm,
  isImportCorrectionValid,
  issueKey,
} from './importUtils'

const DRAFT: VehicleImportPreviewDraftRow = {
  row_id: 'row-1',
  excluded: false,
  values: {
    plate_code: '14',
    plate_number: '58216',
    traffic_code: '123456',
    type_ar: 'حافلة',
    type_en: 'Bus',
    class_ar: 'بيك اب ثقيل',
    class_en: null,
    license_start: '2026-01-01',
    license_expiry: '2027-01-01',
    model_year: '2024',
    inmate_capacity: '12',
    passenger_capacity: null,
  },
}

describe('vehicle import correction fields', () => {
  it('normalizes a legacy class alias through the shared presets', () => {
    const form = importDraftFormValues(DRAFT, 7)
    const selectedClass = VEHICLE_CLASSES[Number(form.vehicle_class)]

    expect(form.vehicle_class).not.toBe(CUSTOM_CLASS)
    expect(selectedClass).toEqual({ ar: 'بيك أب ثقيل', en: 'Heavy pickup' })
    expect(importDraftValuesFromForm(form)).toMatchObject({
      class_ar: 'بيك أب ثقيل',
      class_en: 'Heavy pickup',
      model_year: 2024,
      inmate_capacity: 12,
      passenger_capacity: null,
    })
  })

  it('preserves blanks as null and never truncates invalid integer corrections', () => {
    const form = importDraftFormValues(DRAFT, 7)
    const blank = {
      ...form,
      model_year: '',
      inmate_capacity: '',
      passenger_capacity: '',
    }
    const invalid = { ...form, passenger_capacity: '12 seats' }

    expect(importDraftValuesFromForm(blank)).toMatchObject({
      model_year: null,
      inmate_capacity: null,
      passenger_capacity: null,
    })
    expect(isImportCorrectionValid(blank)).toBe(true)
    expect(isImportCorrectionValid(invalid)).toBe(false)
    expect(importDraftValuesFromForm(invalid).passenger_capacity).toBe('12 seats')
  })

  it('applies the shared date-order and bilingual length boundaries', () => {
    const form = importDraftFormValues(DRAFT, 7)

    expect(
      isImportCorrectionValid({
        ...form,
        license_start: '2027-01-01',
        license_expiry: '2026-12-31',
      }),
    ).toBe(false)
    expect(isImportCorrectionValid({ ...form, type_ar: 'ا'.repeat(129) })).toBe(false)
    expect(isImportCorrectionValid(form)).toBe(true)
  })

  it.each([
    'VEHICLE_IMPORT_INVALID_FIELD',
    'VEHICLE_IMPORT_SITE_REQUIRED',
    'VEHICLE_IMPORT_REQUIRED_FIELD',
    'VEHICLE_IMPORT_DUPLICATE_PLATE',
    'VEHICLE_IMPORT_IMAGE_ROLE_REQUIRED',
    'VEHICLE_IMPORT_PHOTO_CHOICE_REQUIRED',
    'VEHICLE_IMPORT_LICENSE_CHOICE_REQUIRED',
    'VEHICLE_IMPORT_SCAN_IDENTITY_CONFLICT',
    'VEHICLE_IMPORT_UNASSIGNED_IMAGE',
    'VEHICLE_IMPORT_ARCHIVED_MATCH',
  ])('localizes the backend-emitted row issue %s', (code) => {
    expect(issueKey({ code, message: 'backend message' })).not.toBe('serverIssue')
  })
})
