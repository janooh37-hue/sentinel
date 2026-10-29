/**
 * Print setup state for the two statements, carried in the URL query so a
 * setup survives reload and Back. Query keys are a public contract: the
 * Activity tab and the Attendance tab link straight into them.
 *
 * Activity: `period` (month|last3|year|all|custom), `from`, `to` (custom only),
 * `cats` (comma list of categories; absent = all, empty = none), `lang` (ar|en),
 * `orient` (portrait|landscape), `summary` (1|0), `sign` (1|0).
 *
 * Attendance: `mode` (month|quarter|ytd|custom), `y` + `m` (month mode),
 * `y` + `q` (quarter mode), `from` + `to` (custom), `summary`, `calendar`,
 * `exceptions`, `daily`, `dailyEx`, `punches`, `sign` (1|0), `lang`, `orient`.
 */

import {
  ACTIVITY_PRESETS,
  STATEMENT_CATEGORIES,
  activityPeriod,
  monthPeriod,
  quarterPeriod,
  type ActivityPreset,
  type Period,
  type StatementCategory,
} from '../statementModel'

export type PaperLanguage = 'ar' | 'en'
export type Orientation = 'portrait' | 'landscape'

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/

function isoDate(value: string | null): string | null {
  return value !== null && ISO_DATE.test(value) ? value : null
}

function flag(params: URLSearchParams, key: string, fallback: boolean): boolean {
  const value = params.get(key)
  return value === null ? fallback : value === '1'
}

/** Default: the interface language. */
function language(params: URLSearchParams, uiLanguage: string): PaperLanguage {
  const value = params.get('lang')
  if (value === 'ar' || value === 'en') return value
  return uiLanguage.startsWith('ar') ? 'ar' : 'en'
}

/** Never print past today; a reversed range is put the right way round. */
function clampRange(from: string, to: string, today: string): { from: string; to: string } {
  const end = to > today ? today : to
  const start = from > today ? today : from
  return start <= end ? { from: start, to: end } : { from: end, to: start }
}

// ---------------------------------------------------------------- activity

export interface ActivitySettings {
  preset: ActivityPreset
  /** Inclusive; null = from the start of the record (`all`). */
  from: string | null
  to: string
  cats: StatementCategory[]
  lang: PaperLanguage
  orient: Orientation
  summary: boolean
  sign: boolean
}

export function parseActivitySettings(params: URLSearchParams, today: string, uiLanguage: string): ActivitySettings {
  const raw = params.get('period')
  const preset: ActivityPreset = ACTIVITY_PRESETS.includes(raw as ActivityPreset) ? (raw as ActivityPreset) : 'year'
  let period: Period
  if (preset === 'custom') {
    period = clampRange(
      isoDate(params.get('from')) ?? `${today.slice(0, 4)}-01-01`,
      isoDate(params.get('to')) ?? today,
      today,
    )
  } else {
    period = activityPeriod(preset, today) as Period
  }
  const catsRaw = params.get('cats')
  const cats =
    catsRaw === null
      ? [...STATEMENT_CATEGORIES]
      : STATEMENT_CATEGORIES.filter((c) => catsRaw.split(',').includes(c))
  return {
    preset,
    from: period.from,
    to: period.to,
    cats,
    lang: language(params, uiLanguage),
    orient: params.get('orient') === 'landscape' ? 'landscape' : 'portrait',
    summary: flag(params, 'summary', true),
    sign: flag(params, 'sign', true),
  }
}

export function activitySearch(settings: ActivitySettings): string {
  const params = new URLSearchParams({ period: settings.preset })
  if (settings.preset === 'custom') {
    if (settings.from) params.set('from', settings.from)
    params.set('to', settings.to)
  }
  if (settings.cats.length !== STATEMENT_CATEGORIES.length) {
    params.set('cats', STATEMENT_CATEGORIES.filter((c) => settings.cats.includes(c)).join(','))
  }
  params.set('lang', settings.lang)
  params.set('orient', settings.orient)
  params.set('summary', settings.summary ? '1' : '0')
  params.set('sign', settings.sign ? '1' : '0')
  return params.toString()
}

// -------------------------------------------------------------- attendance

export type AttendanceMode = 'month' | 'quarter' | 'ytd' | 'custom'
const ATTENDANCE_MODES: readonly AttendanceMode[] = ['month', 'quarter', 'ytd', 'custom']
export type Quarter = 1 | 2 | 3 | 4

export interface AttendanceSettings {
  mode: AttendanceMode
  /** Month and quarter modes read their year from here. */
  year: number
  month: number
  quarter: Quarter
  /** The resolved, clamped range, whatever the mode. */
  from: string
  to: string
  summary: boolean
  calendar: boolean
  exceptions: boolean
  daily: boolean
  dailyEx: boolean
  punches: boolean
  sign: boolean
  lang: PaperLanguage
  orient: Orientation
}

function intIn(value: string | null, min: number, max: number): number | null {
  if (value === null || !/^\d+$/.test(value)) return null
  const n = Number(value)
  return n >= min && n <= max ? n : null
}

/** The range a mode covers, clamped so nothing after today is printed. */
export function attendanceRange(
  settings: Pick<AttendanceSettings, 'mode' | 'year' | 'month' | 'quarter' | 'from' | 'to'>,
  today: string,
): { from: string; to: string } {
  switch (settings.mode) {
    case 'month': {
      const p = monthPeriod(settings.year, settings.month)
      return clampRange(p.from, p.to, today)
    }
    case 'quarter': {
      const p = quarterPeriod(settings.year, settings.quarter)
      return clampRange(p.from, p.to, today)
    }
    case 'ytd':
      return { from: `${today.slice(0, 4)}-01-01`, to: today }
    case 'custom':
      return clampRange(settings.from, settings.to, today)
  }
}

export function parseAttendanceSettings(params: URLSearchParams, today: string, uiLanguage: string): AttendanceSettings {
  const rawMode = params.get('mode')
  const mode = ATTENDANCE_MODES.includes(rawMode as AttendanceMode) ? (rawMode as AttendanceMode) : 'month'
  const thisYear = Number(today.slice(0, 4))
  const thisMonth = Number(today.slice(5, 7))
  const year = intIn(params.get('y'), 2000, thisYear) ?? thisYear
  const month = Math.min(intIn(params.get('m'), 1, 12) ?? thisMonth, year === thisYear ? thisMonth : 12)
  const quarter = (intIn(params.get('q'), 1, 4) ?? Math.ceil(thisMonth / 3)) as Quarter
  const base = {
    mode,
    year,
    month,
    quarter,
    from: isoDate(params.get('from')) ?? `${today.slice(0, 7)}-01`,
    to: isoDate(params.get('to')) ?? today,
  }
  return {
    ...base,
    ...attendanceRange(base, today),
    summary: flag(params, 'summary', true),
    calendar: flag(params, 'calendar', true),
    exceptions: flag(params, 'exceptions', true),
    daily: flag(params, 'daily', false),
    dailyEx: flag(params, 'dailyEx', false),
    punches: flag(params, 'punches', true),
    sign: flag(params, 'sign', true),
    lang: language(params, uiLanguage),
    orient: params.get('orient') === 'landscape' ? 'landscape' : 'portrait',
  }
}

export function attendanceSearch(settings: AttendanceSettings): string {
  const params = new URLSearchParams({ mode: settings.mode })
  if (settings.mode === 'month') {
    params.set('y', String(settings.year))
    params.set('m', String(settings.month))
  } else if (settings.mode === 'quarter') {
    params.set('y', String(settings.year))
    params.set('q', String(settings.quarter))
  } else if (settings.mode === 'custom') {
    params.set('from', settings.from)
    params.set('to', settings.to)
  }
  const flags = ['summary', 'calendar', 'exceptions', 'daily', 'dailyEx', 'punches', 'sign'] as const
  for (const key of flags) params.set(key, settings[key] ? '1' : '0')
  params.set('lang', settings.lang)
  params.set('orient', settings.orient)
  return params.toString()
}
