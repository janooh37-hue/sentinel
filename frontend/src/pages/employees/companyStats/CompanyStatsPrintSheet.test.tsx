import { act, render, screen, within } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import type { CompanyStats, CompanyStatsEmployee, CompanyStatsTotals } from '@/lib/api'

import { CompanyStatsPrintSheet } from './CompanyStatsPrintSheet'

const zero = { days: 0, count: 0 }
const totals: CompanyStatsTotals = {
  strength: 2, duties_scheduled: 16, duties_excused: 4, duties_due: 12, duties_pending: 0,
  absence: { days: 2, episodes: 1 }, single_punch: 1, late: { count: 2, minutes: 45 }, absence_rate: 16.7,
  leaves: {
    annual: zero, administrative: zero, sick: zero, duty: zero, national_service: { days: 4, count: 1 }, other: zero,
    exit_permits: { count: 2, hours: 2.5, with_hours: 1 },
  },
}
const employee: CompanyStatsEmployee = {
  employee_id: 'G-82', name_en: 'Ibrahim Salem', name_ar: null, position: null, position_ar: null,
  duty_unit: 'Alpha', shift_code: 'morning', absence_days: 2, absence_episodes: 1, single_punch: 0,
  late_count: 1, late_minutes: 35, sick_days: 0, leave_days: 0, leave_count: 0, score: 7,
  events: 3, small_sample: false, tier: null, transfer: null,
}
const data: CompanyStats = {
  duty_unit: 'Alpha', closed_through: '2026-11-19', coverage_from: '2026-11-01', previous_comparable: false, granularity: 'week',
  period: { from_date: '2026-11-01', to_date: '2026-11-19', requested_to_date: '2026-11-20', days: 19, clamped: true },
  previous_period: { from_date: '2026-10-13', to_date: '2026-10-31', requested_to_date: '2026-10-31', days: 19, clamped: false },
  summary: { current: totals, previous: totals },
  overall: totals,
  companies: [{ key: 'Alpha', duty_unit: 'Alpha', shift_codes: ['morning'], totals, small_sample: true, ratio: { absence: 1, single_punch: 1, late: 1 }, status: { overall: null, absence: null, single_punch: null, late: null } }],
  series: [{ start: '2026-11-01', end: '2026-11-07', absence_days: 2, absence_episodes: 1, single_punch: 1, late_count: 2, late_minutes: 45, sick_days: 0, sick_count: 0 }],
  ranking: {
    rows: [employee, { ...employee, employee_id: 'G-83', name_en: 'Salem Ali', absence_days: 0, absence_episodes: 0, score: 2, late_count: 2 }],
    total: 2, average_score: 4.5,
    order: { score: ['G-82', 'G-83'], absence: ['G-82', 'G-83'], single_punch: ['G-82', 'G-83'], late: ['G-83', 'G-82'] },
  },
  national_service: { enrolled: [], absence_days: 4 },
}

describe('CompanyStatsPrintSheet', () => {
  it('prints the loaded scope, closed period and ranking order without controls or unsupported comparisons', () => {
    render(<CompanyStatsPrintSheet data={data} unit="count" sort="late" />)

    expect(screen.getByRole('heading', { name: 'Company statistics', level: 1 })).toBeInTheDocument()
    expect(screen.getByText(/From\s+until/)).toHaveTextContent('From 1 Nov until 19 Nov 2026')
    expect(screen.getByText('Not enough earlier data')).toBeInTheDocument()
    expect(screen.getByText('Small sample')).toBeInTheDocument()
    expect(screen.getAllByText('2h 30m requested (from 1 with hours)').length).toBeGreaterThan(0)
    const ranking = within(screen.getByRole('table', { name: 'Most frequent exceptions' }))
    expect(ranking.getAllByRole('rowheader').map((header) => header.textContent?.trim())).toEqual(['Salem Ali', 'Ibrahim Salem'])
    expect(screen.queryByRole('button')).not.toBeInTheDocument()
  })

  it('suggests a scoped PDF filename only while printing', () => {
    const original = document.title
    const { unmount } = render(<CompanyStatsPrintSheet data={data} unit="days" sort="score" />)

    expect(document.title).toBe(original)
    act(() => window.dispatchEvent(new Event('beforeprint')))
    expect(document.title).toBe('Company statistics_Alpha_2026-11-01_2026-11-19')
    act(() => window.dispatchEvent(new Event('afterprint')))
    expect(document.title).toBe(original)

    act(() => window.dispatchEvent(new Event('beforeprint')))
    unmount()
    expect(document.title).toBe(original)
  })
})
