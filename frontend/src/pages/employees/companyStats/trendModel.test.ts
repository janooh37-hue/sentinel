import { describe, expect, it } from 'vitest'

import type { CompanyStatsBucket } from '@/lib/api'

import { fullBucketAverage, isPartialBucket, monthAxisLabels, trendValue, yAxisTop } from './trendModel'

const bucket: CompanyStatsBucket = {
  start: '2026-01-01', end: '2026-01-31',
  absence_days: 8, absence_episodes: 3, single_punch: 5,
  late_count: 6, late_minutes: 73, sick_days: 14, sick_count: 2,
}

describe('company statistics trend values', () => {
  it('switches absence and sick units without changing single-punch or late counts', () => {
    expect(trendValue(bucket, 'absence', 'days')).toBe(8)
    expect(trendValue(bucket, 'absence', 'count')).toBe(3)
    expect(trendValue(bucket, 'sick', 'days')).toBe(14)
    expect(trendValue(bucket, 'sick', 'count')).toBe(2)
    expect(trendValue(bucket, 'single_punch', 'days')).toBe(5)
    expect(trendValue(bucket, 'single_punch', 'count')).toBe(5)
    expect(trendValue(bucket, 'late', 'days')).toBe(6)
    expect(trendValue(bucket, 'late', 'count')).toBe(6)
  })

  it('averages only full buckets, including full buckets with zero values', () => {
    expect(fullBucketAverage([
      { value: 50, partial: true },
      { value: 9, partial: false },
      { value: 0, partial: false },
      { value: 5, partial: true },
    ])).toBe(4.5)
    expect(fullBucketAverage([{ value: 0, partial: false }])).toBe(0)
    expect(fullBucketAverage([{ value: 6, partial: true }])).toBeNull()
    expect(fullBucketAverage([])).toBeNull()
  })

  it('detects partial monthly buckets at either edge and recognizes leap days', () => {
    expect(isPartialBucket({ start: '2028-02-01', end: '2028-02-29' }, 'month')).toBe(false)
    expect(isPartialBucket({ start: '2028-02-01', end: '2028-02-28' }, 'month')).toBe(true)
    expect(isPartialBucket({ start: '2026-04-03', end: '2026-04-30' }, 'month')).toBe(true)
    expect(isPartialBucket({ start: '2026-04-01', end: '2026-05-31' }, 'month')).toBe(true)
  })

  it('checks the requested weekly interval rather than a fixed day of the week', () => {
    expect(isPartialBucket({ start: '2026-12-29', end: '2027-01-04' }, 'week')).toBe(false)
    expect(isPartialBucket({ start: '2026-12-29', end: '2027-01-03' }, 'week')).toBe(true)
  })

  it.each([[0, 4], [10, 12], [11, 20], [50, 60], [51, 100], [200, 200], [201, 300]])(
    'uses the reference axis top for a maximum of %d',
    (maximum, top) => expect(yAxisTop(maximum)).toBe(top),
  )

  it('distinguishes both instances of a month in a year-long range', () => {
    const months = Array.from({ length: 13 }, (_, i) => ({
      start: new Date(Date.UTC(2025, i + 9, 1)).toISOString().slice(0, 10),
    }))
    const labels = monthAxisLabels(months, 'en')
    expect(labels[0]).toBe('Oct 25')
    expect(labels[labels.length - 1]).toBe('Oct 26')
    expect(new Set(labels).size).toBe(13)
    expect(monthAxisLabels([{ start: '2026-05-01' }, { start: '2026-06-01' }], 'en')).toEqual(['May', 'June'])
  })
})
