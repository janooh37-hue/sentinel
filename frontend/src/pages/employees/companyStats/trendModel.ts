import type { CompanyStats, CompanyStatsBucket } from '@/lib/api'

import { statementLocale } from '../statement/statementModel'
import { addDays, type CountUnit, type TrendMetric } from './companyStatsModel'

type BucketDates = Pick<CompanyStatsBucket, 'start' | 'end'>

export function isPartialBucket({ start, end }: BucketDates, granularity: CompanyStats['granularity']): boolean {
  if (granularity === 'week') return addDays(start, 6) !== end
  return !start.endsWith('-01') || start.slice(0, 7) !== end.slice(0, 7) || !addDays(end, 1).endsWith('-01')
}

export function trendValue(bucket: CompanyStatsBucket, metric: TrendMetric, unit: CountUnit): number {
  switch (metric) {
    case 'absence': return unit === 'days' ? bucket.absence_days : bucket.absence_episodes
    case 'sick': return unit === 'days' ? bucket.sick_days : bucket.sick_count
    case 'single_punch': return bucket.single_punch
    case 'late': return bucket.late_count
  }
}

export function fullBucketAverage(buckets: readonly { value: number; partial: boolean }[]): number | null {
  let total = 0
  let complete = 0
  for (const { value, partial } of buckets) {
    if (partial) continue
    total += value
    complete += 1
  }
  return complete === 0 ? null : total / complete
}

export function yAxisTop(maximum: number): number {
  const step = maximum <= 10 ? 2 : maximum <= 50 ? 10 : maximum <= 200 ? 25 : 50
  const span = 2 * step
  return Math.max(span, Math.ceil(maximum / span) * span)
}

export function monthAxisLabels(buckets: readonly Pick<CompanyStatsBucket, 'start'>[], language: string): string[] {
  const monthCounts = new Map<string, number>()
  for (const { start } of buckets) {
    const month = start.slice(5, 7)
    monthCounts.set(month, (monthCounts.get(month) ?? 0) + 1)
  }
  const format = new Intl.DateTimeFormat(statementLocale(language), {
    month: buckets.length > 6 ? 'short' : 'long', timeZone: 'UTC',
  })
  const spansYears = buckets[0]?.start.slice(0, 4) !== buckets.at(-1)?.start.slice(0, 4)
  return buckets.map(({ start }, index) => {
    const month = start.slice(5, 7)
    const label = format.format(new Date(`${start}T00:00:00Z`))
    const includeYear = (monthCounts.get(month) ?? 0) > 1 || (spansYears && (index === 0 || month === '01'))
    return includeYear ? `${label} ${start.slice(2, 4)}` : label
  })
}
