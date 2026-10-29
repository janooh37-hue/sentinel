/**
 * Shared vocabulary for the employee-file statements: the six categories the
 * screen filters and the paper sections use, the period presets, the print
 * routes, and Western-digit formatting (Arabic uses 0-9, never Arabic-Indic).
 */

import type { StatementKind } from './statementTypes'

export type StatementCategory = 'leave' | 'violation' | 'absence' | 'document' | 'ledger' | 'placement'

/** Display and paper order. Labels: `statement.category.*` / `statement.section.*`. */
export const STATEMENT_CATEGORIES: readonly StatementCategory[] = [
  'leave',
  'violation',
  'absence',
  'document',
  'ledger',
  'placement',
]

/** Placement and status read as one history; every other kind is its own category. */
export function categoryOf(kind: StatementKind): StatementCategory {
  return kind === 'duty_location' || kind === 'status' ? 'placement' : kind
}

export type ActivityPreset = 'month' | 'last3' | 'year' | 'all' | 'custom'
export const ACTIVITY_PRESETS: readonly ActivityPreset[] = ['month', 'last3', 'year', 'all', 'custom']

/**
 * Query-key prefix for `api.getActivityStatement`, shared by the Activity tab
 * and the print setup: `[ACTIVITY_STATEMENT_QUERY, employeeId, from, to]`.
 * Invalidate `[ACTIVITY_STATEMENT_QUERY]` wherever `employee-detail` is
 * invalidated, since both read the same sources.
 */
export const ACTIVITY_STATEMENT_QUERY = 'employee-activity-statement'

/** A real Gregorian `YYYY-MM-DD` (rejects shapes like `2026-02-30`). */
export function isIsoDate(value: string | null | undefined): value is string {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false
  const [y, m, d] = value.split('-').map(Number)
  const date = new Date(Date.UTC(y, m - 1, d))
  return date.getUTCFullYear() === y && date.getUTCMonth() === m - 1 && date.getUTCDate() === d
}

export interface Period {
  /** Inclusive ISO date; null means from the start of the record. */
  from: string | null
  /** Inclusive ISO date. */
  to: string
}

function isoAddMonths(iso: string, months: number): string {
  const [y, m, d] = iso.split('-').map(Number)
  const date = new Date(Date.UTC(y, m - 1 + months, 1))
  const last = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 0)).getUTCDate()
  date.setUTCDate(Math.min(d, last))
  return date.toISOString().slice(0, 10)
}

/** The period a preset covers, ending today (site date). `custom` returns null. */
export function activityPeriod(preset: ActivityPreset, today: string): Period | null {
  switch (preset) {
    case 'month':
      return { from: `${today.slice(0, 7)}-01`, to: today }
    case 'last3':
      return { from: isoAddMonths(today, -3), to: today }
    case 'year':
      return { from: `${today.slice(0, 4)}-01-01`, to: today }
    case 'all':
      return { from: null, to: today }
    case 'custom':
      return null
  }
}

/** First and last day of a month, `month` 1-12. */
export function monthPeriod(year: number, month: number): { from: string; to: string } {
  const last = new Date(Date.UTC(year, month, 0)).getUTCDate()
  const mm = String(month).padStart(2, '0')
  return { from: `${year}-${mm}-01`, to: `${year}-${mm}-${String(last).padStart(2, '0')}` }
}

/** Calendar quarter 1-4 of `year`. */
export function quarterPeriod(year: number, quarter: 1 | 2 | 3 | 4): { from: string; to: string } {
  const first = monthPeriod(year, quarter * 3 - 2)
  const last = monthPeriod(year, quarter * 3)
  return { from: first.from, to: last.to }
}

/** Split an inclusive range into calendar-month chunks (the attendance API caps one call at 92 days). */
export function monthChunks(from: string, to: string): { from: string; to: string }[] {
  const chunks: { from: string; to: string }[] = []
  let cursor = from
  while (cursor <= to) {
    const [y, m] = cursor.split('-').map(Number)
    const month = monthPeriod(y, m)
    chunks.push({ from: cursor, to: month.to < to ? month.to : to })
    cursor = isoAddMonths(`${month.from}`, 1)
  }
  return chunks
}

/** Locale for statement dates: day-first English, Arabic month names with Western digits. */
export function statementLocale(language: string): string {
  return language.startsWith('ar') ? 'ar-AE-u-nu-latn' : 'en-GB'
}

const formatters = new Map<string, Intl.DateTimeFormat>()

function formatter(locale: string, options: Intl.DateTimeFormatOptions): Intl.DateTimeFormat {
  const key = `${locale}|${JSON.stringify(options)}`
  let found = formatters.get(key)
  if (!found) {
    found = new Intl.DateTimeFormat(locale, { timeZone: 'UTC', ...options })
    formatters.set(key, found)
  }
  return found
}

function isoToUtc(iso: string): Date {
  const [y, m, d] = iso.slice(0, 10).split('-').map(Number)
  return new Date(Date.UTC(y, m - 1, d))
}

/** "27 Oct 2026" / "27 أكتوبر 2026". `withYear: false` drops the year. */
export function formatStatementDate(iso: string, language: string, withYear = true): string {
  return formatter(statementLocale(language), {
    day: 'numeric',
    month: language.startsWith('ar') ? 'long' : 'short',
    ...(withYear ? { year: 'numeric' } : {}),
  }).format(isoToUtc(iso))
}

/** "October 2026" / "أكتوبر 2026". */
export function formatStatementMonth(iso: string, language: string): string {
  return formatter(statementLocale(language), { month: 'long', year: 'numeric' }).format(isoToUtc(iso))
}

/** "1 Jan to 27 Oct 2026": the year is printed once when both ends share it. */
export function formatStatementRange(from: string | null, to: string, language: string, startLabel: string): string {
  if (from === null) return `${startLabel} ${language.startsWith('ar') ? 'إلى' : 'to'} ${formatStatementDate(to, language)}`
  const sameYear = from.slice(0, 4) === to.slice(0, 4)
  const joiner = language.startsWith('ar') ? 'إلى' : 'to'
  return `${formatStatementDate(from, language, !sameYear)} ${joiner} ${formatStatementDate(to, language)}`
}

/** "10:42" from a naive ISO datetime, always Western digits. */
export function formatStatementTime(isoDateTime: string): string {
  return isoDateTime.slice(11, 16)
}

/** Print setup routes. Settings ride in the query string so a setup reloads intact. */
export function activityPrintPath(employeeId: string, search = ''): string {
  return `/employees/${encodeURIComponent(employeeId)}/activity/print${search ? `?${search}` : ''}`
}

export function attendancePrintPath(employeeId: string, search = ''): string {
  return `/employees/${encodeURIComponent(employeeId)}/attendance/print${search ? `?${search}` : ''}`
}
