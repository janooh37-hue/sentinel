import { useEffect, useRef } from 'react'
import { useSearchParams } from 'react-router-dom'

import { siteToday } from '@/components/employees/useAttendanceAttention'

import {
  addDays, COUNT_UNITS, PERIOD_PRESETS, presetRange, RANKING_SORTS, TREND_METRICS,
  type CountUnit, type PeriodPreset, type RankingSort, type TrendMetric,
} from './companyStatsModel'

interface DateRange {
  from: string
  to: string
}

interface Filters {
  preset: PeriodPreset
  company: string | null
  unit: CountUnit
  trend: TrendMetric
  sort: RankingSort
}

type FiltersPatch = Partial<Filters & DateRange>
export type CompanyStatsFilters = Filters & { range: DateRange; update(patch: FiltersPatch): void }

type DateError = 'missingDates' | 'reversedDates' | 'longRange'

const DAY_MS = 86_400_000
const DEFAULT_PRESET = '3m'
const DEFAULT_UNIT = 'days'
const DEFAULT_TREND = 'absence'
const DEFAULT_SORT = 'score'
const REPLACE = { replace: true, preventScrollReset: true } as const

function dateMilliseconds(iso: string): number {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(iso) || iso.startsWith('0000')) return NaN
  const value = Date.parse(`${iso}T00:00:00Z`)
  return Number.isFinite(value) && new Date(value).toISOString().slice(0, 10) === iso ? value : NaN
}

/** The API may clamp a deep link's requested end, but it needs at least one closed day. */
export function customRangeError({ from, to }: DateRange, closed: string): DateError | null {
  const start = dateMilliseconds(from)
  const requestedEnd = dateMilliseconds(to)
  if (!Number.isFinite(start) || !Number.isFinite(requestedEnd)) return 'missingDates'
  const end = Math.min(requestedEnd, dateMilliseconds(closed))
  if (start > end) return 'reversedDates'
  if ((end - start) / DAY_MS + 1 > 366) return 'longRange'
  return null
}

function choice<T extends string>(options: readonly T[], value: string | null, fallback: T): T {
  return options.find((option) => option === value) ?? fallback
}

function readParams(params: URLSearchParams, today: string): Omit<CompanyStatsFilters, 'update'> {
  const preset = choice(PERIOD_PRESETS, params.get('period'), DEFAULT_PRESET)
  let range: DateRange
  if (preset === 'custom') {
    const custom = { from: params.get('from') ?? '', to: params.get('to') ?? '' }
    range = customRangeError(custom, addDays(today, -1)) === null ? custom : presetRange(DEFAULT_PRESET, today)
  } else {
    range = presetRange(preset, today)
  }
  const company = params.get('company')
  return {
    preset,
    range,
    company: company?.trim() ? company : null,
    unit: choice(COUNT_UNITS, params.get('unit'), DEFAULT_UNIT),
    trend: choice(TREND_METRICS, params.get('trend'), DEFAULT_TREND),
    sort: choice(RANKING_SORTS, params.get('sort'), DEFAULT_SORT),
  }
}

function writeParams(base: URLSearchParams, filters: Filters, range: DateRange): URLSearchParams {
  const next = new URLSearchParams(base)
  const write = (key: string, value: string | null, fallback?: string): void => {
    if (value === null || value === fallback) next.delete(key)
    else next.set(key, value)
  }
  write('period', filters.preset, DEFAULT_PRESET)
  write('company', filters.company)
  write('unit', filters.unit, DEFAULT_UNIT)
  write('trend', filters.trend, DEFAULT_TREND)
  write('sort', filters.sort, DEFAULT_SORT)
  write('from', filters.preset === 'custom' ? range.from : null)
  write('to', filters.preset === 'custom' ? range.to : null)
  return next
}

export function useCompanyStatsParams(today = siteToday()): CompanyStatsFilters {
  const [params, setParams] = useSearchParams()
  const pendingParams = useRef<URLSearchParams | null>(null)
  const state = readParams(params, today)

  useEffect(() => {
    pendingParams.current = null
    const canonical = readParams(params, today)
    const next = writeParams(params, canonical, canonical.range)
    if (next.toString() !== params.toString()) {
      pendingParams.current = next
      setParams(next, REPLACE)
    }
  }, [params, setParams, today])

  function update({ from, to, ...patch }: FiltersPatch): void {
    // Two controls can fire before the router commits either navigation. Use
    // the last requested URL, not the last render, as the base for both edits.
    const base = pendingParams.current ?? params
    const current = readParams(base, today)
    const filters = { ...current, ...patch }
    const range = { from: from ?? current.range.from, to: to ?? current.range.to }
    if (filters.preset === 'custom' && customRangeError(range, addDays(today, -1)) !== null) return
    const next = writeParams(base, filters, range)
    if (next.toString() === base.toString()) return
    pendingParams.current = next
    setParams(next, REPLACE)
  }

  return { ...state, update }
}
