import { fireEvent, render, screen, within } from '@testing-library/react'
import { expect, it, vi } from 'vitest'

import type { CompanyStats, CompanyStatsTotals } from '@/lib/api'

import { CompanyComparisonTable } from './CompanyComparisonTable'

const zero = { days: 0, count: 0 }
const totals: CompanyStatsTotals = {
  strength: 9, duties_scheduled: 35, duties_excused: 0, duties_due: 35, duties_pending: 0,
  absence: { days: 4, episodes: 2 }, single_punch: 8, late: { count: 6, minutes: 85 }, absence_rate: 11.4,
  leaves: {
    annual: { days: 7, count: 3 }, administrative: zero, sick: zero, duty: zero, national_service: zero, other: zero,
    exit_permits: { count: 4, hours: 2.5, with_hours: 2 },
  },
}
const period = { from_date: '2026-10-01', to_date: '2026-10-31', requested_to_date: '2026-10-31', days: 31, clamped: false }
const data: CompanyStats = {
  period, previous_period: period, closed_through: period.to_date, coverage_from: period.from_date, previous_comparable: false,
  duty_unit: 'Alpha', granularity: 'week', summary: { current: totals, previous: totals }, series: [],
  companies: [
    {
      key: 'Alpha', duty_unit: 'Alpha', shift_codes: ['night'], totals, small_sample: false,
      ratio: { absence: 0.6, single_punch: 1.1, late: 1.3 },
      status: { absence: 'good', single_punch: 'normal', late: 'warn', overall: 'warn' },
    },
    {
      key: '__unassigned__', duty_unit: null, shift_codes: [], small_sample: true,
      totals: { ...totals, duties_due: 8, absence: { days: 2, episodes: 1 }, absence_rate: 25, single_punch: 0 },
      ratio: { absence: 1.5, single_punch: 0, late: null },
      status: { absence: null, single_punch: null, late: null, overall: null },
    },
  ],
  overall: { ...totals, strength: 14, absence: { days: 81, episodes: 27 } },
  ranking: { total: 0, average_score: 0, order: { score: [], absence: [], late: [], single_punch: [] }, rows: [] },
  national_service: { enrolled: [], absence_days: 0 },
}

it('shows every row, keeps small-sample ratios neutral, and reads the Total from overall', () => {
  const onSelect = vi.fn()
  render(<CompanyComparisonTable data={data} unit="count" selected="Alpha" onSelect={onSelect} />)
  const alpha = screen.getByRole('button', { name: 'Alpha' })
  expect(alpha).toHaveAttribute('aria-pressed', 'true')
  fireEvent.click(alpha)
  expect(onSelect).toHaveBeenCalledWith(null)

  const rows = screen.getAllByRole('row')
  const ratedRow = rows.find((row) => within(row).queryByRole('button', { name: 'Alpha' }))!
  expect(within(ratedRow).getByText('Within average')).toBeInTheDocument()
  expect(within(ratedRow).getByText(/2h 30m requested \(from 2 with hours\)/)).toBeInTheDocument()
  const smallRow = rows.find((row) => within(row).queryByRole('button', { name: 'Unassigned' }))!
  expect(within(smallRow).getByText('Small sample')).toBeInTheDocument()
  const percentage = within(smallRow).getByText('50%')
  expect(percentage).toHaveAttribute('dir', 'ltr')
  expect(percentage.parentElement).toHaveTextContent('50% above')
  expect(within(smallRow).queryByText('100%')).not.toBeInTheDocument()
  expect(within(smallRow).queryByText('Above average')).not.toBeInTheDocument()
  fireEvent.click(within(smallRow).getByRole('button', { name: 'Unassigned' }))
  expect(onSelect).toHaveBeenLastCalledWith('__unassigned__')
  expect(within(rows[rows.length - 1]).getByText('27')).toBeInTheDocument()
})

it('presents discipline, rate and leave in that order on a small RTL screen', () => {
  const direction = document.documentElement.dir
  document.documentElement.dir = 'rtl'
  const media = vi.spyOn(window, 'matchMedia').mockImplementation((query) => ({
    matches: query === '(max-width: 767px)', media: query, onchange: null,
    addListener: vi.fn(), removeListener: vi.fn(), addEventListener: vi.fn(), removeEventListener: vi.fn(), dispatchEvent: vi.fn(),
  }))
  try {
    render(<CompanyComparisonTable data={data} unit="days" selected={null} onSelect={vi.fn()} />)
    const rows = screen.getAllByRole('row')
    expect(within(rows[0]).getByRole('columnheader', { name: 'Company' })).toHaveClass('sticky', 'start-0')
    const cells = within(rows[2]).getAllByRole('cell')
    expect(cells[0]).toHaveTextContent('40% below')
    expect(cells[3]).toHaveTextContent('11.4%')
    expect(cells[4]).toHaveTextContent('3 times')
  } finally {
    media.mockRestore()
    document.documentElement.dir = direction
  }
})
