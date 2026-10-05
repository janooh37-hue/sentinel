import type { VehicleListItem } from '@/lib/api'
import { esc, TD_STYLE, thStyle } from '@/lib/basketEmail'
import type { CopyTableOptions } from '@/lib/copyTable'

import {
  formatLetterDate,
  isArabic,
  localized,
  plateLabel,
  type Translate,
} from './vehicleUtils'

export type VehicleTableCells = string[]

export interface VehicleTableSnapshot {
  direction: 'ltr' | 'rtl'
  headers: VehicleTableCells
  rows: VehicleTableCells[]
}

const NAVY = '#0d2845'
const TEXT_CELL_STYLE = `${TD_STYLE};mso-number-format:'\\@'`
const TEXT_HEADER_STYLE = `${thStyle(NAVY)};mso-number-format:'\\@'`
/** Columns whose cells are codes/numbers/dates: isolated LTR inside RTL HTML. */
const LTR_COLUMNS = new Set([0, 2, 3, 7, 9, 10, 11])

const clean = (value: string | number | null | undefined) =>
  value == null ? '' : String(value).replace(/\s+/gu, ' ').trim()

/** Every useful field, so the operator deletes unwanted columns after pasting
 *  instead of hunting for missing ones. */
export function buildVehicleTable(
  vehicles: readonly VehicleListItem[],
  language: string,
  t: Translate,
): VehicleTableSnapshot {
  return {
    direction: isArabic(language) ? 'rtl' : 'ltr',
    headers: [
      t('vehicles.plate'),
      t('vehicles.type'),
      t('vehicles.vin'),
      t('vehicles.trafficCode'),
      t('vehicles.class'),
      t('vehicles.make'),
      t('vehicles.model'),
      t('vehicles.modelYear'),
      t('vehicles.colour'),
      t('vehicles.licenseStart'),
      t('vehicles.licenseExpiry'),
      t('vehicles.insuranceExpiry'),
    ],
    rows: vehicles.map((vehicle) => [
      plateLabel(vehicle),
      clean(localized(vehicle.type_ar, vehicle.type_en, language)),
      clean(vehicle.vin),
      clean(vehicle.traffic_code),
      clean(localized(vehicle.class_ar, vehicle.class_en, language)),
      clean(vehicle.make),
      clean(vehicle.model),
      clean(vehicle.model_year),
      clean(vehicle.colour),
      formatLetterDate(vehicle.license_start),
      formatLetterDate(vehicle.license_expiry),
      vehicle.insurance_expiry ? formatLetterDate(vehicle.insurance_expiry) : '',
    ]),
  }
}

export function vehicleTableClipboard(table: VehicleTableSnapshot): CopyTableOptions {
  const headers = table.headers
    .map((header) => `<th style="${TEXT_HEADER_STYLE}">${esc(header)}</th>`)
    .join('')
  const rows = table.rows
    .map((row) => {
      const cells = row
        .map((cell, index) => {
          const value = esc(cell)
          const content =
            LTR_COLUMNS.has(index) ? `<bdi dir="ltr">${value}</bdi>` : value
          return `<td style="${TEXT_CELL_STYLE}">${content}</td>`
        })
        .join('')
      return `<tr>${cells}</tr>`
    })
    .join('')

  return {
    html:
      `<table dir="${table.direction}" style="border-collapse:collapse;font-family:Arial,sans-serif;font-size:11pt">` +
      `<thead><tr>${headers}</tr></thead><tbody>${rows}</tbody></table>`,
    text: [table.headers, ...table.rows]
      .map((row) =>
        row
          .map((value) => (/^[=+@-]/u.test(value) ? `'${value}` : value))
          .join('\t'),
      )
      .join('\n'),
  }
}
