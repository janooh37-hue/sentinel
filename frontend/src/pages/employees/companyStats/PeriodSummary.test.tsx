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
    expect(discipline.getByText(/^Up\s+from the previous period$/)).toHaveTextContent('Up 50% from the previous period')
    const drops = discipline.getAllByText(/^Down\s+from the previous period$/)
    expect(drops).toHaveLength(2)
    for (const drop of drops) expect(drop).toHaveTextContent('Down 100% from the previous period')
    expect(discipline.getByText('No change')).toBeInTheDocument()
    const leaves = within(screen.getByRole('article', { name: 'Leave and excused absences' }))
    expect(leaves.getByText(/^Up\s+from the previous period$/)).toHaveTextContent('Up 100% from the previous period')
  })

  it.each([true, false])('shows a new figure only for a comparable period (%s)', (previous_comparable) => {
    const previous = { ...data.summary.previous, single_punch: 0 }
    render(<PeriodSummary data={{ ...data, previous_comparable, summary: { current, previous } }} unit="days" />)

    const discipline = within(screen.getByRole('article', { name: 'Discipline' }))
    if (previous_comparable) {
      expect(discipline.getByText('New')).not.toHaveAttribute('style')
      expect(screen.queryByText('Not enough earlier data')).not.toBeInTheDocument()
    } else {
      expect(discipline.queryByText('New')).not.toBeInTheDocument()
      expect(screen.getByText('Not enough earlier data')).toBeInTheDocument()
    }
    const zeroTile = screen.getByText('Administrative leave').closest('div')!
    expect(within(zeroTile).queryByText('No change')).not.toBeInTheDocument()
  })

  it('compares time past grace separately from the late count', () => {
    const summary = { ...data.summary, current: { ...current, late: { count: 2, minutes: 60 } } }
    render(<PeriodSummary data={{ ...data, summary }} unit="days" />)

    const time = within(screen.getByRole('group', { name: 'Time past grace' }))
    expect(time.getByText(/^Up\s+from the previous period$/)).toHaveTextContent('Up 50% from the previous period')
  })

  it.each([{ hours: 7, with_hours: 2 }, { hours: null, with_hours: 0 }])(
    'compares only recorded permit hours (previous: $hours)',
    ({ hours, with_hours }) => {
      const previous = {
        ...data.summary.previous,
        leaves: { ...data.summary.previous.leaves, exit_permits: { count: 4, hours, with_hours } },
      }
      render(<PeriodSummary data={{ ...data, summary: { current, previous } }} unit="days" />)

      const duration = within(screen.getByRole('group', { name: 'Exit permit hours' }))
      expect(duration.getByText('3h 30m requested (from 2 with hours)')).toBeInTheDocument()
      const change = duration.queryByText(/^Down\s+from the previous period$/)
      if (hours === null) expect(change).not.toBeInTheDocument()
      else expect(change).toHaveTextContent('Down 50% from the previous period')
      expect(duration.queryByText('New')).not.toBeInTheDocument()
    },
  )

  it('reports occurrences without converting permit hours to days', () => {
    render(<PeriodSummary data={data} unit="count" />)

    expect(screen.getByText('12 days')).toBeInTheDocument()
    expect(screen.getByText('16 days')).toBeInTheDocument()
    expect(screen.getByText('3h 30m requested (from 2 with hours)').closest('p')).toHaveTextContent('4 permits · 3h 30m requested (from 2 with hours)')
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
