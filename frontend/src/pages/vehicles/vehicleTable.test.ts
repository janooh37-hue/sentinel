import { describe, expect, it } from 'vitest'

import type { VehicleListItem } from '@/lib/api'

import { EMPTY_VALUE, type Translate } from './vehicleUtils'
import { buildVehicleTable, vehicleTableClipboard } from './vehicleTable'

const t: Translate = (key) => ({
  'vehicles.plate': 'Plate',
  'vehicles.type': 'Type',
  'vehicles.licenseStart': 'License start',
  'vehicles.licenseExpiry': 'License expiry',
  'vehicles.insuranceExpiry': 'Insurance expiry',
})[key] ?? key

function vehicle(overrides: Partial<VehicleListItem> = {}): VehicleListItem {
  return {
    id: 1,
    plate_code: '14',
    plate_number: '005821',
    plate_label: '14 \\ 005821',
    traffic_code: '1180021637',
    type_ar: 'تويوتا كوستر',
    type_en: 'Toyota Coaster',
    class_ar: 'باص خفيف',
    class_en: 'Light bus',
    vin: 'JT123456789000101',
    site_id: 1,
    license_start: '2026-01-02',
    license_expiry: '2026-12-31',
    expiry_status: 'valid',
    days_to_expiry: 100,
    fines_count: 0,
    fines_amount: 0,
    black_points: 0,
    photo_url: null,
    insurance_expiry: '2027-01-03',
    archived_at: null,
    ...overrides,
  }
}

describe('buildVehicleTable', () => {
  it('builds exactly five cells and leaves a missing insurance date blank', () => {
    const table = buildVehicleTable(
      [vehicle({ insurance_expiry: null, type_en: 'Toyota\n\t  Coaster' })],
      'en',
      t,
    )

    expect(table.direction).toBe('ltr')
    expect(table.headers).toEqual([
      'Plate',
      'Type',
      'License start',
      'License expiry',
      'Insurance expiry',
    ])
    expect(table.headers).toHaveLength(5)
    expect(table.rows[0]).toHaveLength(5)
    expect(table.rows[0]).toEqual([
      '14 \\ 005821',
      'Toyota Coaster',
      '02/01/2026',
      '31/12/2026',
      '',
    ])
    expect(table.rows[0][4]).not.toBe(EMPTY_VALUE)
    expect(table.rows[0][4]).not.toMatch(/\d/u)
  })

  it('uses RTL direction and the Arabic type for an Arabic locale', () => {
    const table = buildVehicleTable([vehicle()], 'ar-AE', t)

    expect(table.direction).toBe('rtl')
    expect(table.rows[0][1]).toBe('تويوتا كوستر')
  })
})

describe('vehicleTableClipboard', () => {
  it('escapes formula-leading text in TSV only', () => {
    const table = buildVehicleTable(
      [
        vehicle({ id: 1, type_en: '=cmd' }),
        vehicle({ id: 2, type_en: '+1' }),
        vehicle({ id: 3, type_en: '-1' }),
        vehicle({ id: 4, type_en: '@sum' }),
      ],
      'en',
      t,
    )
    const clipboard = vehicleTableClipboard(table)
    const typeCells = clipboard.text.split('\n').slice(1).map((row) => row.split('\t')[1])

    expect(typeCells).toEqual(["'=cmd", "'+1", "'-1", "'@sum"])
    for (const value of ['=cmd', '+1', '-1', '@sum']) {
      expect(clipboard.html).toContain(`>${value}</td>`)
      expect(clipboard.html).not.toContain(`>'${value}</td>`)
    }
  })

  it('isolates plate and date cells as LTR in RTL HTML', () => {
    const clipboard = vehicleTableClipboard(buildVehicleTable([vehicle()], 'ar', t))

    expect(clipboard.html).toContain('<table dir="rtl"')
    expect(clipboard.html).toContain('<bdi dir="ltr">14 \\ 005821</bdi>')
    expect(clipboard.html).toContain('<bdi dir="ltr">02/01/2026</bdi>')
    expect(clipboard.html).toContain('<bdi dir="ltr">31/12/2026</bdi>')
    expect(clipboard.html).toContain('<bdi dir="ltr">03/01/2027</bdi>')
  })
})
