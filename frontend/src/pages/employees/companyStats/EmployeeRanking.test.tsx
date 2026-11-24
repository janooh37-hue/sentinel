import { fireEvent, render, screen, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { expect, it, vi } from 'vitest'

import type { CompanyStats, CompanyStatsEmployee, CompanyStatsTotals } from '@/lib/api'

import { EmployeeRanking } from './EmployeeRanking'

const hasCapability = vi.hoisted(() => vi.fn<(cap: string) => boolean>())
vi.mock('@/lib/useCapabilities', () => ({ useCapabilities: () => ({ has: hasCapability }) }))

const zero = { days: 0, count: 0 }
const totals: CompanyStatsTotals = {
  strength: 2, duties_scheduled: 12, duties_excused: 0, duties_due: 12, duties_pending: 0,
  absence: { days: 3, episodes: 1 }, single_punch: 0, late: { count: 2, minutes: 39 }, absence_rate: 25,
  leaves: {
    annual: zero, administrative: zero, sick: zero, duty: zero, national_service: zero, other: zero,
    exit_permits: { count: 0, hours: null, with_hours: 0 },
  },
}
const period = { from_date: '2026-10-01', to_date: '2026-10-31', requested_to_date: '2026-10-31', days: 31, clamped: false }
const first: CompanyStatsEmployee = {
  employee_id: 'G032', name_en: 'Maryam Al Mansoori', name_ar: 'مريم المنصوري',
  position: 'Patrol', position_ar: null, duty_unit: 'Bravo', shift_code: 'night',
  absence_days: 3, absence_episodes: 1, single_punch: 0, late_count: 0, late_minutes: 0,
  sick_days: 1, leave_days: 5, leave_count: 2, score: 9, tier: 'above_average', small_sample: false, events: 3,
  transfer: { from_unit: 'Alpha', to_unit: 'Bravo', on_date: '2026-10-15' },
}
const second: CompanyStatsEmployee = {
  ...first, employee_id: 'G011', name_en: 'Ali Al Kaabi', name_ar: 'علي الكعبي',
  absence_days: 0, absence_episodes: 0, late_count: 2, late_minutes: 39,
  score: 2, tier: null, small_sample: true, events: 2, transfer: null,
}
const data: CompanyStats = {
  period, previous_period: period, closed_through: period.to_date, coverage_from: period.from_date, previous_comparable: false,
  duty_unit: null, granularity: 'week', summary: { current: totals, previous: totals }, companies: [], overall: totals, series: [],
  ranking: {
    total: 2, average_score: 5.5, rows: [second, first],
    order: { score: ['G032', 'G011'], absence: ['G032', 'G011'], late: ['G011', 'G032'], single_punch: ['G011', 'G032'] },
  },
  national_service: { enrolled: [], absence_days: 0 },
}

it('shows the supplied order, transfer context, tiers and only authorised employee links', () => {
  hasCapability.mockImplementation((cap) => cap === 'employees.view')
  const { rerender } = render(
    <EmployeeRanking data={data} sort="score" unit="count" onSortChange={vi.fn()} companyName={null} />,
    { wrapper: MemoryRouter },
  )
  const employees = screen.getAllByRole('rowheader')
  expect(within(employees[0]).getByRole('link', { name: 'Maryam Al Mansoori' }))
    .toHaveAttribute('href', '/employees/G032?tab=attendance')
  expect(within(employees[0]).getByText(/Transferred from/)).toHaveTextContent('Transferred from Alpha on 15 Oct')
  expect(screen.getByText('Above average')).toBeInTheDocument()
  expect(screen.getByText('Small sample')).toBeInTheDocument()
  expect(screen.getByRole('columnheader', { name: 'Score' })).toHaveAttribute('aria-sort', 'descending')

  hasCapability.mockReturnValue(false)
  rerender(<EmployeeRanking data={data} sort="score" unit="count" onSortChange={vi.fn()} companyName={null} />)
  expect(screen.queryByRole('link', { name: 'Maryam Al Mansoori' })).not.toBeInTheDocument()
  expect(screen.getByText('Maryam Al Mansoori')).toBeInTheDocument()
})

it('moves the sorted metric beside the sticky employee column on mobile RTL', () => {
  const direction = document.documentElement.dir
  document.documentElement.dir = 'rtl'
  hasCapability.mockReturnValue(false)
  const media = vi.spyOn(window, 'matchMedia').mockImplementation((query) => ({
    matches: query === '(max-width: 767px)', media: query, onchange: null,
    addListener: vi.fn(), removeListener: vi.fn(), addEventListener: vi.fn(), removeEventListener: vi.fn(), dispatchEvent: vi.fn(),
  }))
  const onSortChange = vi.fn()
  try {
    const { rerender } = render(
      <EmployeeRanking data={data} sort="score" unit="count" onSortChange={onSortChange} companyName="Bravo" />,
    )
    const sorters = screen.getByRole('group', { name: 'Sort by' })
    fireEvent.click(within(sorters).getByRole('button', { name: 'Late' }))
    expect(onSortChange).toHaveBeenCalledWith('late')
    rerender(<EmployeeRanking data={data} sort="late" unit="count" onSortChange={onSortChange} companyName="Bravo" />)
    expect(within(sorters).getByRole('button', { name: 'Late' })).toHaveAttribute('aria-pressed', 'true')
    const headers = screen.getAllByRole('columnheader')
    expect(headers[0]).toHaveTextContent('Employee')
    expect(headers[1]).toHaveTextContent('Late')
    expect(headers[1]).toHaveAttribute('aria-sort', 'descending')
    expect(screen.queryByRole('columnheader', { name: 'Company' })).not.toBeInTheDocument()
    expect(screen.getAllByRole('rowheader')[0]).toHaveTextContent('Ali Al Kaabi')
    expect(screen.getAllByRole('rowheader')[0]).toHaveTextContent('Bravo · Night')

    rerender(<EmployeeRanking data={data} sort="absence" unit="count" onSortChange={onSortChange} companyName="Bravo" />)
    const firstRanked = screen.getAllByRole('row')[1]
    const absence = within(firstRanked).getAllByRole('cell')[0]
    expect(within(absence).getByText('3')).toBeInTheDocument()
    expect(within(absence).getByText('1 episode')).toBeInTheDocument()
  } finally {
    media.mockRestore()
    document.documentElement.dir = direction
  }
})
