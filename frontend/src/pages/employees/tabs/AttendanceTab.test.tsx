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
 *   4. A month with no scheduled attendance renders the empty state.
 *   5. Without the capabilities nothing is fetched.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { getEmployeeAttendance, hasCapability } = vi.hoisted(() => ({
  getEmployeeAttendance: vi.fn(),
  hasCapability: vi.fn<(cap: string) => boolean>(),
}))

vi.mock('@/lib/api', async (orig) => {
  const real = await orig<typeof import('@/lib/api')>()
  return { ...real, api: { ...real.api, getEmployeeAttendance } }
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
