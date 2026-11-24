import type { TFunction } from 'i18next'

import type { CompanyStatsTotals } from '@/lib/api'

import { formatStatementDate, statementLocale } from '../statement/statementModel'
import { splitMinutes, UNASSIGNED_KEY } from './companyStatsModel'

export function companyDisplayName(key: string | null, t: TFunction): string {
  return key === null || key === UNASSIGNED_KEY ? t('companyStats.company.unassigned') : key
}

const numbers = new Map<number, Intl.NumberFormat>()

/** Both report languages use Western digits, with a fixed precision per metric. */
export function formatStatsNumber(value: number, decimals = 0): string {
  let format = numbers.get(decimals)
  if (format === undefined) {
    format = new Intl.NumberFormat(statementLocale('en'), { minimumFractionDigits: decimals, maximumFractionDigits: decimals })
    numbers.set(decimals, format)
  }
  return format.format(value)
}

export function formatStatsPercent(value: number, decimals = 0): string {
  return `${formatStatsNumber(value, decimals)}%`
}

export function formatStatsDate(iso: string, language: string, withYear = true): string {
  return formatStatementDate(iso, language, withYear)
}

type Quantity = 'day' | 'person' | 'episode' | 'occurrence' | 'record' | 'permit' | 'duty'

export function formatStatsQuantity(kind: Quantity, count: number, t: TFunction): string {
  return t(`companyStats.unit.quantity.${kind}`, { count, n: formatStatsNumber(count) })
}

export function formatStatsDuration(totalMinutes: number, t: TFunction): string {
  const { hours, minutes } = splitMinutes(totalMinutes)
  return hours > 0
    ? t('attendance.print.duration', { hours: formatStatsNumber(hours), minutes: formatStatsNumber(minutes) })
    : t('companyStats.unit.minutesOnly', { minutes: formatStatsNumber(minutes) })
}

export function formatStatsHours(hours: number, t: TFunction): string {
  return formatStatsDuration(Math.round(hours * 60), t)
}

export function formatStatsPermitHours(
  permits: CompanyStatsTotals['leaves']['exit_permits'],
  t: TFunction,
): string | null {
  if (permits.hours === null) return null
  return t('companyStats.leaves.permitHours', {
    duration: formatStatsHours(permits.hours, t),
    n: formatStatsNumber(permits.with_hours),
  })
}
