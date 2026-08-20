/**
 * AttendanceTab — one employee's attendance inside their file.
 *
 * Behaviours pinned here:
 *   1. KPIs are computed from the month payload (punctuality = on-time ÷
 *      scheduled, late minutes summed, unpaired days counted).
 *   2. The month grid renders one cell per calendar day, the shift letters
 *      actually worked, and the outcome colour; rest days are disabled.
 *   3. Selecting a day renders its punch timeline with the grace band and one
 *      marker per punch.
 *   4. Months the roster never covered still show the device's own sightings,
 *      and selecting one states first/last seen without judging it.
 *   5. A month with neither a schedule nor a sighting renders the empty state.
 *   6. Without the capabilities nothing is fetched.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { getEmployeeAttendance, getEmployeeAttendanceHistory, hasCapability } = vi.hoisted(() => ({
  getEmployeeAttendance: vi.fn(),
  getEmployeeAttendanceHistory: vi.fn(),
  hasCapability: vi.fn<(cap: string) => boolean>(),
}))

vi.mock('@/lib/api', async (orig) => {
  const real = await orig<typeof import('@/lib/api')>()
  return { ...real, api: { ...real.api, getEmployeeAttendance, getEmployeeAttendanceHistory } }
})

vi.mock('@/lib/useCapabilities', () => ({
  useCapabilities: () => ({ capabilities: new Set<string>(), isLoading: false, has: hasCapability }),
}))

import { AttendanceTab } from './AttendanceTab'

function day(overrides: Record<string, unknown> = {}) {
  return {
    operational_date: '2026-08-19',
    shift_code: 'morning',
    scheduled_start_at: '2026-08-19T01:00:00',
    scheduled_end_at: '2026-08-19T09:00:00',
    presence_state: 'completed',
    reason_code: null,
    late_minutes: 0,
    punch_count: 2,
    punches: [
      { occurred_at: '2026-08-19T00:52:00', device_name: 'Main Gate Turnstile' },
      { occurred_at: '2026-08-19T09:06:00', device_name: 'Main Gate Turnstile' },
    ],
    ...overrides,
  }
}

function renderTab() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={client}>
      {/* Pinned month: the grid must not depend on the wall clock. */}
      <AttendanceTab employeeId="G-9001" initialMonth="2026-08-19" />
    </QueryClientProvider>,
  )
}

beforeEach(() => {
  vi.clearAllMocks()
  hasCapability.mockReturnValue(true)
  getEmployeeAttendance.mockResolvedValue({
    employee_id: 'G-9001',
    from_date: '2026-08-01',
    to_date: '2026-08-31',
    days: [
      day(),
      day({ operational_date: '2026-08-18', shift_code: 'noon', late_minutes: 47 }),
      day({
        operational_date: '2026-08-14',
        punch_count: 0,
        punches: [],
        presence_state: 'absent',
        late_minutes: null,
      }),
      day({
        operational_date: '2026-08-13',
        presence_state: 'excused_leave',
        punch_count: 0,
        punches: [],
        late_minutes: null,
      }),
    ],
  })
  getEmployeeAttendanceHistory.mockResolvedValue({
    employee_id: 'G-9001',
    provider_code: 'biotime',
    external_employee_code: '9001',
    from_date: '2026-08-01',
    to_date: '2026-08-31',
    linked: true,
    truncated: false,
    days: [],
  })
})

describe('AttendanceTab', () => {
  it('computes punctuality, late minutes and unpaired days from the month', async () => {
    renderTab()

    await waitFor(() => expect(screen.getByTestId('attendance-month-grid')).toBeInTheDocument())
    // Scheduled = 3 (leave excluded); on time = 1; unpaired = 1; late = 47m.
    expect(screen.getByText('33%')).toBeInTheDocument()
    expect(screen.getByText('47')).toBeInTheDocument()
  })

  it('renders one cell per calendar day with the shifts worked', async () => {
    renderTab()

    await waitFor(() => expect(screen.getByTestId('attendance-month-grid')).toBeInTheDocument())
    const cells = screen.getAllByTestId('attendance-month-cell')
    expect(cells).toHaveLength(31)

    const worked = cells.filter((cell) => cell.dataset.outcome !== 'off')
    expect(worked).toHaveLength(4)
    expect(worked.map((cell) => cell.dataset.outcome)).toEqual(
      expect.arrayContaining(['verified', 'late', 'exception', 'leave']),
    )
    // A rest day cannot be selected: there is nothing to show.
    const off = cells.find((cell) => cell.dataset.outcome === 'off')
    expect(off).toBeDisabled()
  })

  it('renders the punch timeline for a selected day', async () => {
    const user = userEvent.setup()
    renderTab()

    await waitFor(() => expect(screen.getByTestId('attendance-month-grid')).toBeInTheDocument())
    const cells = screen.getAllByTestId('attendance-month-cell')
    await user.click(cells[18]) // 19 Aug

    const timeline = await screen.findByTestId('attendance-day-timeline')
    expect(timeline).toBeInTheDocument()
    expect(screen.getAllByTestId('attendance-day-punch')).toHaveLength(2)
    expect(screen.getByTestId('attendance-day-grace')).toBeInTheDocument()
    // Site wall time, not UTC: 00:52Z is 04:52 in Asia/Dubai.
    expect(screen.getByText('04:52')).toBeInTheDocument()
  })

  it('shows the device record for a month the roster never covered', async () => {
    // January: no schedule existed, but BioTime holds the punches. The month must
    // not read as an empty life, and nothing there may be called late or absent.
    const user = userEvent.setup()
    getEmployeeAttendance.mockResolvedValue({
      employee_id: 'G-9001',
      from_date: '2026-01-01',
      to_date: '2026-01-31',
      days: [],
    })
    getEmployeeAttendanceHistory.mockResolvedValue({
      employee_id: 'G-9001',
      provider_code: 'biotime',
      external_employee_code: '9001',
      from_date: '2026-01-01',
      to_date: '2026-01-31',
      linked: true,
      truncated: false,
      days: [
        {
          operational_date: '2026-01-05',
          first_seen_at: '2026-01-05T02:34:00Z',
          last_seen_at: '2026-01-05T11:12:00Z',
          punch_count: 3,
          devices: ['Main Gate'],
        },
      ],
    })

    render(
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <AttendanceTab employeeId="G-9001" initialMonth="2026-01-05" />
      </QueryClientProvider>,
    )

    await waitFor(() => expect(screen.getByTestId('attendance-month-grid')).toBeInTheDocument())
    const cells = screen.getAllByTestId('attendance-month-cell')
    const seen = cells.filter((cell) => cell.dataset.outcome === 'seen')
    expect(seen).toHaveLength(1)

    await user.click(seen[0])
    const panel = await screen.findByTestId('attendance-seen-only-day')
    // Site wall time: 02:34Z is 06:34 in Asia/Dubai.
    expect(panel).toHaveTextContent('06:34')
    expect(panel).toHaveTextContent('15:12')
    expect(panel).toHaveTextContent('Main Gate')
    // A sighting is never judged: no timeline, no lateness.
    expect(screen.queryByTestId('attendance-day-timeline')).not.toBeInTheDocument()
  })

  it('says so when the person is on no attendance device', async () => {
    getEmployeeAttendance.mockResolvedValue({
      employee_id: 'G-9001',
      from_date: '2026-08-01',
      to_date: '2026-08-31',
      days: [],
    })
    getEmployeeAttendanceHistory.mockResolvedValue({
      employee_id: 'G-9001',
      provider_code: 'biotime',
      external_employee_code: null,
      from_date: '2026-08-01',
      to_date: '2026-08-31',
      linked: false,
      truncated: false,
      days: [],
    })

    renderTab()

    await waitFor(() => expect(screen.getByText(/Not enrolled on any/i)).toBeInTheDocument())
  })

  it('renders the empty state for a month with no scheduled attendance', async () => {
    getEmployeeAttendance.mockResolvedValue({
      employee_id: 'G-9001',
      from_date: '2026-08-01',
      to_date: '2026-08-31',
      days: [],
    })

    renderTab()

    await waitFor(() =>
      expect(screen.getByText(/No scheduled attendance/i)).toBeInTheDocument(),
    )
  })

  it('never fetches without the capabilities', async () => {
    hasCapability.mockReturnValue(false)

    renderTab()

    await waitFor(() => expect(getEmployeeAttendance).not.toHaveBeenCalled())
  })
})
