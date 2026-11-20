import { render, screen, within } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import type { CompanyStats, CompanyStatsTotals } from '@/lib/api'

import { PeriodSummary } from './PeriodSummary'

const zero = { days: 0, count: 0 }
const current: CompanyStatsTotals = {
  strength: 15,
  duties_scheduled: 400,
  duties_due: 390,
  duties_excused: 10,
  duties_pending: 0,
  absence: { days: 12, episodes: 3 },
  single_punch: 5,
  late: { count: 0, minutes: 0 },
  absence_rate: 3.1,
  leaves: {
    annual: { days: 16, count: 4 }, administrative: zero, sick: { days: 3, count: 2 },
    duty: zero, national_service: zero, other: { days: 2, count: 1 },
    exit_permits: { count: 4, hours: 3.5, with_hours: 2 },
  },
}
const data: Pick<CompanyStats, 'summary' | 'previous_period' | 'previous_comparable' | 'series' | 'granularity'> = {
  summary: {
    current,
    previous: {
      ...current,
      absence: { days: 8, episodes: 4 },
      late: { count: 2, minutes: 40 },
      leaves: { ...current.leaves, annual: { days: 8, count: 4 } },
    },
  },
  previous_period: { from_date: '2026-07-01', to_date: '2026-07-31', requested_to_date: '2026-07-31', days: 31, clamped: false },
  previous_comparable: true,
  series: [{ start: '2026-08-01', end: '2026-08-31', absence_days: 12, absence_episodes: 3, single_punch: 5, late_count: 0, late_minutes: 0, sick_days: 3, sick_count: 2 }],
  granularity: 'month',
}

describe('PeriodSummary', () => {
  it('shows signed changes against the previous period, including a drop to zero', () => {
    render(<PeriodSummary data={data} unit="days" />)

    const discipline = within(screen.getByRole('article', { name: 'Discipline' }))
    expect(discipline.getByText('Up 50% from the previous period')).toBeInTheDocument()
    expect(discipline.getByText('Down 100% from the previous period')).toBeInTheDocument()
    expect(discipline.getByText('No change')).toBeInTheDocument()
    const leaves = within(screen.getByRole('article', { name: 'Leave and excused absences' }))
    expect(leaves.getByText('Up 100% from the previous period')).toBeInTheDocument()
  })

  it('reports occurrences without converting permit hours to days', () => {
    render(<PeriodSummary data={data} unit="count" />)

    expect(screen.getByText('12 days')).toBeInTheDocument()
    expect(screen.getByText('16 days')).toBeInTheDocument()
    expect(screen.getByText('3h 30m requested (from 2 with hours)').parentElement).toHaveTextContent('4 permits · 3h 30m requested (from 2 with hours)')
    expect(screen.getByText(/Other leave \(compassionate, emergency, Hajj\)/)).toHaveTextContent('2 days · 1 record')
  })

  it('does not invent a duration for permits missing hours', () => {
    const withoutHours = {
      ...data,
      summary: {
        ...data.summary,
        current: { ...current, leaves: { ...current.leaves, exit_permits: { count: 4, hours: null, with_hours: 0 } } },
      },
    }
    render(<PeriodSummary data={withoutHours} unit="days" />)

    expect(screen.getByText('permits').parentElement).toHaveTextContent('4 permits')
    expect(screen.queryByText(/requested/)).not.toBeInTheDocument()
  })
})
