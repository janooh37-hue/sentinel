import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { api, type CompanyStats, type CompanyStatsRow, type CompanyStatsTotals } from '@/lib/api'

import { CompanyStatsPage } from './CompanyStatsPage'

vi.mock('@/lib/useCapabilities', () => ({ useCapabilities: () => ({ has: () => true, isLoading: false }) }))

const zero = { days: 0, count: 0 }
const totals: CompanyStatsTotals = {
  strength: 15, duties_scheduled: 401, duties_due: 400, duties_excused: 1, duties_pending: 2,
  absence: { days: 8, episodes: 3 }, single_punch: 4, late: { count: 2, minutes: 20 }, absence_rate: 2,
  leaves: {
    annual: { days: 10, count: 5 }, administrative: zero, sick: zero, duty: zero, national_service: zero,
    other: { days: 1, count: 1 }, exit_permits: { count: 3, hours: 2.5, with_hours: 2 },
  },
}
const alpha: CompanyStatsRow = {
  key: 'Alpha', duty_unit: 'Alpha', totals, small_sample: false, shift_codes: ['morning'],
  status: { absence: 'normal', single_punch: 'normal', late: 'normal', overall: 'normal' },
  ratio: { absence: 1, single_punch: 1, late: 1 },
}
const data: CompanyStats = {
  duty_unit: null,
  closed_through: '2026-11-19',
  coverage_from: '2025-05-21',
  previous_comparable: true,
  period: { from_date: '2026-08-21', to_date: '2026-11-19', requested_to_date: '2026-11-19', clamped: false, days: 91 },
  previous_period: { from_date: '2026-05-22', to_date: '2026-08-20', requested_to_date: '2026-08-20', clamped: false, days: 91 },
  summary: {
    current: totals,
    previous: { ...totals, absence: { days: 4, episodes: 1 }, leaves: { ...totals.leaves, annual: { days: 5, count: 2 } } },
  },
  overall: totals,
  companies: [alpha, { ...alpha, key: '__unassigned__', duty_unit: null }],
  granularity: 'month',
  series: [
    { start: '2026-09-01', end: '2026-09-30', absence_days: 8, absence_episodes: 3, single_punch: 4, late_count: 2, late_minutes: 20, sick_count: 0, sick_days: 0 },
  ],
  ranking: { total: 0, average_score: 0, rows: [], order: { score: [], absence: [], single_punch: [], late: [] } },
  national_service: { enrolled: [], absence_days: 0 },
}

function renderPage(search = '') {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[`/employees/company-stats${search}`]}>
        <CompanyStatsPage />
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

beforeEach(() => {
  vi.setSystemTime(new Date('2026-11-19T21:00:00Z')) // Dubai is already on the 20th.
  vi.spyOn(api, 'getCompanyStats').mockImplementation(async (params) => ({ ...data, duty_unit: params.duty_unit ?? null }))
  vi.spyOn(api, 'listAttendanceDay').mockResolvedValue({ items: [] })
})
afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe('CompanyStatsPage', () => {
  it('renders all five report sections and the actual closed date', async () => {
    renderPage()

    expect(screen.getByRole('heading', { level: 1, name: 'All companies' })).toBeInTheDocument()
    expect(await screen.findByRole('heading', { name: 'Period summary' })).toBeInTheDocument()
    for (const name of ['Companies', 'Trend over time', 'Detailed comparison', 'Most frequent exceptions', 'National Service']) {
      expect(screen.getByRole('heading', { name })).toBeInTheDocument()
    }
    expect(screen.getByText(/^From\s+to$/)).toHaveTextContent('From 21 Aug to 19 Nov 2026')
    expect(screen.getAllByText('Up 100% from the previous period')).toHaveLength(2)
  })

  it('marks a clamped period and hides all discipline and leave deltas when coverage is insufficient', async () => {
    vi.mocked(api.getCompanyStats).mockResolvedValue({
      ...data, previous_comparable: false, coverage_from: '2026-08-01',
      period: { ...data.period, clamped: true, requested_to_date: '2027-01-03' },
    })
    renderPage('?period=custom&from=2026-08-21&to=2027-01-03')

    const summary = within(await screen.findByRole('region', { name: 'Period summary' }))
    expect(summary.getByText('Not enough earlier data')).toBeInTheDocument()
    expect(summary.queryByText(/from the previous period|No change/i)).not.toBeInTheDocument()
    expect(screen.getByText(/From\s+until/)).toHaveTextContent('From 21 Aug until 19 Nov 2026')
  })

  it('keeps options from every company while setting and clearing the API duty-unit filter', async () => {
    renderPage()

    const cards = within(await screen.findByRole('region', { name: 'Companies' }))
    const select = screen.getByRole('combobox', { name: 'Company' })
    fireEvent.click(cards.getByRole('button', { name: 'Alpha' }))
    expect(select).toHaveValue('Alpha')
    expect(within(select).getByRole('option', { name: 'Unassigned' })).toBeInTheDocument()
    await waitFor(() => expect(api.getCompanyStats).toHaveBeenLastCalledWith({
      from_date: '2026-08-21', to_date: '2026-11-19', duty_unit: 'Alpha',
    }))
    expect(await screen.findByRole('heading', { level: 1, name: 'Alpha' })).toBeInTheDocument()

    fireEvent.change(select, { target: { value: '__unassigned__' } })
    expect(cards.getByRole('button', { name: 'Unassigned' })).toHaveAttribute('aria-pressed', 'true')
    fireEvent.click(cards.getByRole('button', { name: 'Show all companies' }))
    expect(select).toHaveValue('')
    expect(cards.getByRole('button', { name: 'Unassigned' })).toHaveAttribute('aria-pressed', 'false')
  })

  it('switches units without requesting a different report', async () => {
    renderPage()
    const cards = within(await screen.findByRole('region', { name: 'Companies' }))
    const countUnit = within(screen.getByRole('group', { name: 'Count by' })).getByRole('button', { name: 'Occurrences' })
    fireEvent.click(countUnit)

    expect(countUnit).toHaveAttribute('aria-pressed', 'true')
    expect(within(cards.getByRole('button', { name: 'Alpha' })).getByText('3')).toBeInTheDocument()
    expect(api.getCompanyStats).toHaveBeenCalledOnce()
  })

  it('edits custom dates up to yesterday and retains the last applied range while a draft is invalid', async () => {
    renderPage('?period=custom&from=2026-11-01&to=2026-11-10')

    await screen.findByRole('heading', { name: 'Period summary' })
    const from = screen.getByLabelText('From')
    const to = screen.getByLabelText('To')
    expect(from).toHaveAttribute('max', '2026-11-19')
    expect(to).toHaveAttribute('max', '2026-11-19')
    fireEvent.change(from, { target: { value: '2026-11-16' } })
    expect(screen.getByRole('alert')).toHaveTextContent('Choose a start date on or before the end date')
    expect(api.getCompanyStats).toHaveBeenCalledTimes(1)

    fireEvent.change(to, { target: { value: '2026-11-18' } })
    await waitFor(() => expect(api.getCompanyStats).toHaveBeenLastCalledWith({ from_date: '2026-11-16', to_date: '2026-11-18' }))
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('offers recovery from a failed request and explains an empty closed period', async () => {
    vi.mocked(api.getCompanyStats).mockRejectedValueOnce(new Error('Offline')).mockResolvedValueOnce({
      ...data, companies: [],
      summary: {
        ...data.summary,
        current: {
          ...totals, duties_scheduled: 0,
          leaves: { annual: zero, administrative: zero, sick: zero, duty: zero, national_service: zero, other: zero, exit_permits: { count: 0, hours: null, with_hours: 0 } },
        },
      },
    })
    renderPage()

    expect(screen.getByRole('status')).toHaveTextContent('Loading company statistics')
    const error = await screen.findByRole('alert')
    expect(error).toHaveTextContent('Could not load company statistics.')
    fireEvent.click(within(error).getByRole('button', { name: 'Retry' }))
    expect(await screen.findByText('No attendance or leave records in this period.')).toBeInTheDocument()
  })

  it('downloads the workbook for the viewed scope using the server filename', async () => {
    const downloaded = vi.fn()
    vi.stubGlobal('URL', class extends URL {
      static createObjectURL = vi.fn(() => 'blob:statistics')
      static revokeObjectURL = vi.fn()
    })
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
      downloaded(this.download)
    })
    vi.spyOn(api, 'fetchCompanyStatsExport').mockResolvedValue({ blob: new Blob(['xlsx']), filename: 'company-stats.xlsx' })
    renderPage('?company=Alpha')

    await screen.findByRole('heading', { name: 'Period summary' })
    fireEvent.click(screen.getByRole('button', { name: 'Excel' }))
    await waitFor(() => expect(downloaded).toHaveBeenCalledWith('company-stats.xlsx'))
    expect(api.fetchCompanyStatsExport).toHaveBeenCalledWith({
      from_date: '2026-08-21', to_date: '2026-11-19', duty_unit: 'Alpha', language: 'en',
    }, expect.stringMatching(/\.xlsx$/))
    await waitFor(() => expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:statistics'))
  })

  it('commits the scoped print sheet before requesting the print dialog', async () => {
    const print = vi.spyOn(window, 'print').mockImplementation(() => {
      expect(document.querySelector('.print-company-stats')).toHaveTextContent('Alpha')
    })
    renderPage('?company=Alpha')

    await screen.findByRole('heading', { name: 'Period summary' })
    fireEvent.click(screen.getByRole('button', { name: 'PDF' }))
    expect(print).toHaveBeenCalledOnce()
  })
})
