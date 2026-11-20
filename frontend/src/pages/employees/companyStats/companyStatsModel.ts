import type { CompanyStatsStatus, CompanyStatsTotals } from '@/lib/api'

/** Query key for the employees whose duty unit is blank (the API's sentinel). */
export const UNASSIGNED_KEY = '__unassigned__'

export const PERIOD_PRESETS = ['1m', '3m', '6m', '1y', 'custom'] as const
export type PeriodPreset = (typeof PERIOD_PRESETS)[number]

export const COUNT_UNITS = ['days', 'count'] as const
export type CountUnit = (typeof COUNT_UNITS)[number]

export const TREND_METRICS = ['absence', 'single_punch', 'late', 'sick'] as const
export type TrendMetric = (typeof TREND_METRICS)[number]

export const DISCIPLINE_METRICS = ['absence', 'single_punch', 'late'] as const
export type DisciplineMetric = (typeof DISCIPLINE_METRICS)[number]

/** Absence follows the unit (days or episodes); single punch and late are always counts. */
export function disciplineValue(
  totals: Pick<CompanyStatsTotals, 'absence' | 'single_punch' | 'late'>,
  metric: DisciplineMetric,
  unit: CountUnit,
): number {
  if (metric === 'absence') return unit === 'days' ? totals.absence.days : totals.absence.episodes
  if (metric === 'single_punch') return totals.single_punch
  return totals.late.count
}

export const RANKING_SORTS = ['score', 'absence', 'late', 'single_punch'] as const
export type RankingSort = (typeof RANKING_SORTS)[number]

const PRESET_MONTHS: Record<Exclude<PeriodPreset, 'custom'>, number> = {
  '1m': 1,
  '3m': 3,
  '6m': 6,
  '1y': 12,
}

function parseIsoDate(value: string): Date {
  const [y, m, d] = value.split('-').map(Number)
  return new Date(Date.UTC(y, m - 1, d))
}

function isoDate(value: Date): string {
  return value.toISOString().slice(0, 10)
}

export function addDays(value: string, days: number): string {
  const date = parseIsoDate(value)
  date.setUTCDate(date.getUTCDate() + days)
  return isoDate(date)
}

function addMonthsClamped(value: string, months: number): string {
  const date = parseIsoDate(value)
  const day = date.getUTCDate()
  date.setUTCDate(1)
  date.setUTCMonth(date.getUTCMonth() + months)
  const lastDay = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 0)).getUTCDate()
  date.setUTCDate(Math.min(day, lastDay))
  return isoDate(date)
}

/**
 * The requested range for a preset, as of the site's `today` (YYYY-MM-DD).
 * Only closed days count, so a preset ends yesterday; it starts the day after
 * the same date N months back (3 months on 19 Nov = 20 Aug – 18 Nov).
 */
export function presetRange(
  preset: Exclude<PeriodPreset, 'custom'>,
  today: string,
): { from: string; to: string } {
  return {
    from: addDays(addMonthsClamped(today, -PRESET_MONTHS[preset]), 1),
    to: addDays(today, -1),
  }
}

/** Period-over-period change in whole percent; null when there is no base to compare. */
export function deltaPercent(current: number, previous: number): number | null {
  if (previous === 0) return null
  return Math.round(((current - previous) / previous) * 100)
}

export type DeltaTone = 'good' | 'bad' | 'neutral'

/** Discipline metrics: up is bad, down is good. Leaves carry no judgement. */
export function deltaTone(kind: 'discipline' | 'leave', delta: number | null): DeltaTone {
  if (kind === 'leave' || delta === null || delta === 0) return 'neutral'
  return delta > 0 ? 'bad' : 'good'
}

export type StatusTone = CompanyStatsStatus | 'small'

/** Sentinel tokens per status (contract legend). `small` = neutral, never coloured. */
export const STATUS_TOKENS: Record<StatusTone, { fg: string; soft: string; bar: string }> = {
  good: { fg: 'var(--success)', soft: 'var(--success-soft)', bar: 'var(--success)' },
  normal: { fg: 'var(--text-muted)', soft: 'var(--surface-tinted)', bar: 'var(--text-muted)' },
  warn: { fg: 'var(--warning)', soft: 'var(--warning-soft)', bar: 'var(--warning)' },
  bad: { fg: 'var(--accent)', soft: 'var(--accent-soft)', bar: 'var(--accent)' },
  small: { fg: 'var(--text-muted)', soft: 'var(--surface-tinted)', bar: 'var(--text-muted)' },
}

/** Metric colours, matching AttendanceStatusDot tones (absent, unpaired, late, leave). */
export const METRIC_TOKENS: Record<TrendMetric, string> = {
  absence: 'var(--accent)',
  single_punch: 'var(--destructive)',
  late: 'var(--warning)',
  sick: 'var(--info)',
}

export function splitMinutes(total: number): { hours: number; minutes: number } {
  return { hours: Math.floor(total / 60), minutes: total % 60 }
}
