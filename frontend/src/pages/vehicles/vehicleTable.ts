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

export type VehicleTableCells = [string, string, string, string, string]

export interface VehicleTableSnapshot {
  direction: 'ltr' | 'rtl'
  headers: VehicleTableCells
  rows: VehicleTableCells[]
}

const NAVY = '#0d2845'
const TEXT_CELL_STYLE = `${TD_STYLE};mso-number-format:'\\@'`
const TEXT_HEADER_STYLE = `${thStyle(NAVY)};mso-number-format:'\\@'`

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
      t('vehicles.licenseStart'),
      t('vehicles.licenseExpiry'),
      t('vehicles.insuranceExpiry'),
    ],
    rows: vehicles.map((vehicle) => [
      plateLabel(vehicle),
      localized(vehicle.type_ar, vehicle.type_en, language).replace(/\s+/gu, ' ').trim(),
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
            index === 0 || index >= 2 ? `<bdi dir="ltr">${value}</bdi>` : value
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
