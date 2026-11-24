import { fireEvent, render, screen, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { expect, it, vi } from 'vitest'

import type { CompanyStats, CompanyStatsBucket, CompanyStatsTotals } from '@/lib/api'

import { CompanyStatsTrend } from './CompanyStatsTrend'

const zero = { days: 0, count: 0 }
const totals: CompanyStatsTotals = {
  strength: 1, duties_scheduled: 5, duties_excused: 0, duties_due: 5, duties_pending: 0,
  absence: { days: 0, episodes: 0 }, single_punch: 0, late: { count: 0, minutes: 0 }, absence_rate: 0,
  leaves: {
    annual: zero, administrative: zero, sick: zero, duty: zero, national_service: zero, other: zero,
    exit_permits: { count: 0, hours: null, with_hours: 0 },
  },
}
const first: CompanyStatsBucket = {
  start: '2026-09-20', end: '2026-09-26',
  absence_days: 4, absence_episodes: 1, single_punch: 3, late_count: 5, late_minutes: 60,
  sick_days: 8, sick_count: 2,
}
const data: CompanyStats = {
  period: { from_date: first.start, to_date: '2026-09-29', requested_to_date: '2026-09-29', days: 10, clamped: false },
  previous_period: { from_date: '2026-09-10', to_date: '2026-09-19', requested_to_date: '2026-09-19', days: 10, clamped: false },
  closed_through: '2026-09-29', coverage_from: first.start, previous_comparable: false,
  duty_unit: null, granularity: 'week', summary: { current: totals, previous: totals }, companies: [], overall: totals,
  series: [first, { ...first, start: '2026-09-27', end: '2026-09-29', absence_days: 30, sick_count: 7 }],
  ranking: { total: 0, average_score: 0, order: { score: [], absence: [], late: [], single_punch: [] }, rows: [] },
  national_service: { enrolled: [], absence_days: 0 },
}

it('labels and links weekly buckets, excluding the hatched bucket from the average', () => {
  const direction = document.documentElement.dir
  document.documentElement.dir = 'rtl'
  const onMetricChange = vi.fn()
  try {
    const { rerender } = render(
      <CompanyStatsTrend data={data} metric="absence" unit="days" onMetricChange={onMetricChange} />,
      { wrapper: MemoryRouter },
    )
    const chips = screen.getByRole('group', { name: 'Trend metric' })
    expect(within(chips).getByRole('button', { name: 'Absence' })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByRole('region', { name: /Absence/ })).toHaveTextContent('Week 2')
    expect(screen.getByRole('region', { name: /Absence/ })).toHaveTextContent('27–29 Sept')
    expect(screen.getByText(/Average of full weeks/)).toHaveTextContent('4')
    expect(screen.getByRole('link', { name: /Absence · .*: 30 · Partial week · View attendance/ }))
      .toHaveAttribute('href', '/employees/attendance?date=2026-09-29')
    expect(screen.getByRole('region', { name: /Absence/ })).toHaveAttribute('dir', 'rtl')

    fireEvent.click(within(chips).getByRole('button', { name: 'Sick leave' }))
    expect(onMetricChange).toHaveBeenCalledWith('sick')
    rerender(<CompanyStatsTrend data={data} metric="sick" unit="count" onMetricChange={onMetricChange} />)
    expect(within(chips).getByRole('button', { name: 'Sick leave' })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByRole('link', { name: /Sick leave · .*: 2 · View attendance/ }))
      .toHaveAttribute('href', '/employees/attendance?date=2026-09-26')
  } finally {
    document.documentElement.dir = direction
  }
})

it('keeps a custom range with only partial months visible without inventing a mean', () => {
  render(
    <CompanyStatsTrend
      data={{
        ...data,
        period: { from_date: '2026-09-16', to_date: '2026-10-26', requested_to_date: '2026-10-26', days: 41, clamped: false },
        granularity: 'month',
        series: [
          { ...first, start: '2026-09-16', end: '2026-09-30' },
          { ...first, start: '2026-10-01', end: '2026-10-26', absence_days: 8 },
        ],
      }}
      metric="absence"
      unit="days"
      onMetricChange={vi.fn()}
    />,
    { wrapper: MemoryRouter },
  )
  expect(screen.getByText('No full months to average')).toBeInTheDocument()
  expect(screen.queryByText('Below average')).not.toBeInTheDocument()
  expect(screen.getByRole('link', { name: /: 4 · Partial month/ })).toBeInTheDocument()
})
