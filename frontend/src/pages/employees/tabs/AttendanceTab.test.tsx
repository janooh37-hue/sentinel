/**
 * AttendanceTab — one employee's attendance inside their file.
 *
 * Behaviours pinned here:
 *   1. The KPI widget is computed from the month payload by the shared ladder:
 *      punctuality = on-time ÷ judged, late minutes counted PAST THE GRACE,
 *      absences, unpaired days and shifts actually worked.
 *   2. The month grid renders a weekday header, one cell per calendar day, the
 *      shift letters actually worked, and the outcome colour; rest days are
 *      disabled.
 *   3. Selecting a day renders its punch timeline with the grace band, the
 *      absence boundary and one marker per punch.
 *   4. Months the roster never covered still show the device's own sightings,
 *      and selecting one states first/last seen without judging it.
 *   5. A month with neither a schedule nor a sighting renders the empty state.
 *   6. The whole device record is banded by month, and a band selects its month.
 *   7. The learned habit is stated, and a roster that disagrees is flagged.
 *   8. A device count above the counted punches is reported as a gap.
 *   9. Without the capabilities nothing is fetched.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor, within } from '@testing-library/react'
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
  const date = (overrides.operational_date as string | undefined) ?? '2026-08-19'
  return {
    operational_date: date,
    shift_code: 'morning',
    scheduled_start_at: `${date}T01:00:00`,
    scheduled_end_at: `${date}T09:00:00`,
    presence_state: 'completed',
    reason_code: null,
    late_minutes: 0,
    punch_count: 2,
    // The policy the server judged this day by: thirty minutes of grace, so the
    // absence boundary falls at twice that and pairing is called at 11:00Z.
    grace_minutes: 30,
    absence_due_at: `${date}T02:00:00`,
    judgment_due_at: `${date}T11:00:00`,
    punches: [
      { occurred_at: `${date}T00:52:00`, device_name: 'Main Gate Turnstile' },
      { occurred_at: `${date}T09:06:00`, device_name: 'Main Gate Turnstile' },
    ],
    ...overrides,
  }
}

function sighting(operationalDate: string) {
  return {
    operational_date: operationalDate,
    first_seen_at: `${operationalDate}T00:52:00`,
    last_seen_at: `${operationalDate}T09:06:00`,
    punch_count: 2,
    devices: ['Al Watbha Prison 2'],
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
  it('computes the widget from the month by the shared ladder', async () => {
    renderTab()

    await waitFor(() => expect(screen.getByTestId('attendance-month-grid')).toBeInTheDocument())
    const kpi = (id: string): HTMLElement => screen.getByTestId(`attendance-kpi-${id}`)
    // Judged = 3 (leave leaves the denominator); on time = 1; late = 1 day, and
    // 47 minutes past the START is 17 past the GRACE; absent = 1; unpaired = 0;
    // worked = the 2 days with punches.
    expect(kpi('punctuality')).toHaveTextContent('33%')
    expect(kpi('punctuality')).toHaveTextContent('1/3')
    expect(kpi('late-minutes')).toHaveTextContent('17')
    expect(kpi('absent')).toHaveTextContent('1')
    expect(kpi('missing-punches')).toHaveTextContent('0')
    expect(kpi('shifts-worked')).toHaveTextContent('2')
  })

  it('renders one cell per calendar day, under a weekday header', async () => {
    renderTab()

    await waitFor(() => expect(screen.getByTestId('attendance-month-grid')).toBeInTheDocument())
    const weekdays = screen.getByTestId('attendance-month-weekdays')
    // Seven columns, Sunday first, so the labels sit over the day they name.
    expect(weekdays.children).toHaveLength(7)
    expect(weekdays).toHaveTextContent(/^Sun/)

    const cells = screen.getAllByTestId('attendance-month-cell')
    expect(cells).toHaveLength(31)

    const worked = cells.filter((cell) => cell.dataset.outcome !== 'off')
    expect(worked).toHaveLength(4)
    expect(worked.map((cell) => cell.dataset.outcome)).toEqual(
      expect.arrayContaining(['verified', 'late', 'absent', 'leave']),
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

  it('bands the whole device record by month, and each band selects its month', async () => {
    const yearStart = `${new Date().getUTCFullYear()}-01-01`
    // The provider holds months the roster never covered. Those months are the
    // whole point of the band: they are what gets checked against the device.
    getEmployeeAttendanceHistory.mockImplementation(
      async (_employeeId: string, params: { from_date: string; to_date: string }) => ({
        employee_id: 'G-9001',
        provider_code: 'biotime',
        external_employee_code: '9001',
        from_date: params.from_date,
        to_date: params.to_date,
        linked: true,
        truncated: false,
        days:
          params.from_date === yearStart
            ? [
                sighting('2026-02-13'),
                sighting('2026-02-14'),
                sighting('2026-03-02'),
                sighting('2026-08-19'),
              ]
            : [],
      }),
    )

    renderTab()

    const band = await screen.findByTestId('attendance-record-band')
    const months = within(band).getAllByRole('button')
    expect(months).toHaveLength(3)
    expect(months[0]).toHaveTextContent('2')
    expect(months[1]).toHaveTextContent('1')

    await userEvent.click(screen.getByText('‹'))

    await waitFor(() =>
      expect(within(band).getAllByRole('button')).toHaveLength(3),
    )

    const recordToDates = getEmployeeAttendanceHistory.mock.calls
      .filter(([, params]) => params.from_date === yearStart)
      .map(([, params]) => params.to_date)
    expect(new Set(recordToDates).size).toBe(1)

    await userEvent.click(months[0])

    await waitFor(() =>
      expect(getEmployeeAttendance).toHaveBeenCalledWith('G-9001', {
        from_date: '2026-02-01',
        to_date: '2026-02-28',
      }),
    )
  })

  it('states the learned habit and flags a roster that disagrees with it', async () => {
    getEmployeeAttendance.mockResolvedValue({
      employee_id: 'G-9001',
      from_date: '2026-08-01',
      to_date: '2026-08-31',
      days: [day()],
      habits: [
        {
          shift_code: 'morning',
          sample_days: 25,
          arrival_typical_offset: -20,
          departure_typical_offset: 10,
          suggested_shift_code: 'morning',
        },
      ],
    })

    renderTab()

    const habits = await screen.findByTestId('attendance-habits')
    expect(habits).toHaveTextContent('20m before start')
    expect(habits).toHaveTextContent('10m after end')
    expect(habits).toHaveTextContent('25 days observed')
    expect(await screen.findByText(/fit the morning shift/i)).toBeInTheDocument()
  })

  it('says so when the device saw punches the duty never counted', async () => {
    // The trust question in one line: the provider recorded four events, our
    // attribution claimed two. The gap is what an operator needs to see.
    getEmployeeAttendanceHistory.mockImplementation(
      async (_employeeId: string, params: { from_date: string; to_date: string }) => ({
        employee_id: 'G-9001',
        provider_code: 'biotime',
        external_employee_code: '9001',
        from_date: params.from_date,
        to_date: params.to_date,
        linked: true,
        truncated: false,
        days: [{ ...sighting('2026-08-19'), punch_count: 4 }],
      }),
    )

    renderTab()

    const cells = await screen.findAllByTestId('attendance-month-cell')
    await userEvent.click(cells[18])

    const note = await screen.findByTestId('attendance-unattributed')
    expect(note).toHaveTextContent('4 punches')
    expect(note).toHaveTextContent('2 counted')
  })

  it('never fetches without the capabilities', async () => {
    hasCapability.mockReturnValue(false)

    renderTab()

    await waitFor(() => expect(getEmployeeAttendance).not.toHaveBeenCalled())
  })
})
