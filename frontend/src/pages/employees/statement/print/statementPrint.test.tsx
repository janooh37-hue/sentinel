import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import i18n from 'i18next'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

import ar from '@/locales/ar.json'

const { getEmployeeDetail, getActivityStatement, createStatementPrint, getEmployeeAttendance } = vi.hoisted(() => ({
  getEmployeeDetail: vi.fn(),
  getActivityStatement: vi.fn(),
  createStatementPrint: vi.fn(),
  getEmployeeAttendance: vi.fn(),
}))

vi.mock('@/lib/api', async (orig) => {
  const real = await orig<typeof import('@/lib/api')>()
  return {
    ...real,
    api: { ...real.api, getEmployeeDetail, getActivityStatement, createStatementPrint, getEmployeeAttendance },
  }
})

vi.mock('@/lib/useCapabilities', () => ({
  useCapabilities: () => ({ capabilities: new Set<string>(), isLoading: false, has: () => true }),
}))

vi.mock('@/components/employees/useAttendanceAttention', () => ({ siteToday: () => '2026-10-27' }))

import { ActivityPrintPage } from './ActivityPrintPage'
import { AttendancePrintPage } from './AttendancePrintPage'

const EMPLOYEE = {
  id: 'G3190',
  name_en: 'Ahmed Mansour',
  name_ar: 'أحمد منصور',
  position: 'Security Guard',
  position_ar: 'حارس أمن',
  department: 'Operations',
  duty_unit: 'Al Wathba Site',
  duty_post: 'Main Gate',
  doj: '2019-03-14',
}

function item(kind: string, sourceId: number, extra: Record<string, unknown> = {}) {
  return {
    kind,
    source_id: sourceId,
    occurred_at: '2026-09-12T00:00:00',
    date_only: true,
    actor_name: 'Mariam Al Kaabi',
    reference: null,
    linked_documents: [],
    ...extra,
  }
}

const ITEMS = [
  item('leave', 1, { leave_type: 'Annual', start_date: '2026-09-01', end_date: '2026-09-28', days: 28, leave_status: 'Approved' }),
  item('violation', 2, { violation_type: 'Late arrival', action_taken: 'Written warning', deduction_days: 1 }),
  item('document', 3, { template_name_en: 'Salary certificate', template_name_ar: 'شهادة راتب', reference: 'HR/77' }),
  item('ledger', 4, { subject: 'Transfer request', direction: 'incoming', counterparty: 'Employee' }),
]

function LocationProbe() {
  const location = useLocation()
  return <output data-testid="location">{location.search}</output>
}

function renderAt(path: string) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route path="/employees/:id/activity/print" element={<ActivityPrintPage />} />
          <Route path="/employees/:id/attendance/print" element={<AttendancePrintPage />} />
        </Routes>
        <LocationProbe />
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

const sheet = (): HTMLElement => document.querySelector('table.statement-sheet') as HTMLElement

beforeAll(() => {
  i18n.addResourceBundle('ar', 'translation', ar, true, true)
})

beforeEach(() => {
  getEmployeeDetail.mockResolvedValue({ employee: EMPLOYEE })
  getActivityStatement.mockResolvedValue({ employee_id: 'G3190', from_date: '2026-01-01', to_date: '2026-10-27', items: ITEMS, truncated: false })
  getEmployeeAttendance.mockImplementation((_id: string, params: { from_date: string; to_date: string }) =>
    Promise.resolve({ employee_id: 'G3190', from_date: params.from_date, to_date: params.to_date, days: [] }),
  )
  vi.spyOn(window, 'print').mockImplementation(() => undefined)
})

afterEach(() => {
  vi.clearAllMocks()
  vi.restoreAllMocks()
})

describe('activity print setup', () => {
  it('prints no scope line when every section is in, and names only the exclusions otherwise', async () => {
    const user = userEvent.setup()
    renderAt('/employees/G3190/activity/print?period=year&lang=en')
    await waitFor(() => expect(sheet()).toBeInTheDocument())

    expect(within(sheet()).queryByTestId('statement-scope')).toBeNull()
    expect(sheet().querySelector('[data-section="violation"]')).not.toBeNull()

    await user.click(screen.getByRole('checkbox', { name: /^Violations/ }))
    await user.click(screen.getByRole('checkbox', { name: /^Correspondence/ }))

    expect(within(sheet()).getByTestId('statement-scope')).toHaveTextContent('Not included: Violations, Correspondence.')
    expect(sheet().querySelector('[data-section="violation"]')).toBeNull()
    expect(sheet().querySelector('[data-section="ledger"]')).toBeNull()
    expect(sheet().querySelector('[data-section="leave"]')).not.toBeNull()
    // The toggle is in the URL, so a reload keeps it.
    expect(screen.getByTestId('location').textContent).toContain('cats=leave%2Cabsence%2Cdocument%2Cplacement')
  })

  it('carries one signature box, Prepared by, and no reviewer', async () => {
    renderAt('/employees/G3190/activity/print?period=year&lang=en')
    await waitFor(() => expect(sheet()).toBeInTheDocument())
    const boxes = within(sheet()).getAllByTestId('statement-signature')
    expect(boxes).toHaveLength(1)
    expect(boxes[0]).toHaveTextContent('Prepared by')
    expect(sheet()).not.toHaveTextContent(/review/i)
  })

  it('issues a reference, puts it on the paper, then prints', async () => {
    const user = userEvent.setup()
    createStatementPrint.mockImplementation(async () => {
      // The dialog must not open before the reference is issued.
      expect(window.print).not.toHaveBeenCalled()
      return {
        id: 7,
        employee_id: 'G3190',
        kind: 'activity',
        serial: 7,
        reference: 'G3190/1/12/7',
        from_date: '2026-01-01',
        to_date: '2026-10-27',
        language: 'en',
        printed_at: '2026-10-27T11:20:00',
        printed_by_name: 'Mariam Al Kaabi',
      }
    })
    vi.mocked(window.print).mockImplementation(() => {
      // What the dialog snapshots: the issued reference is already on the paper.
      expect(within(sheet()).getByTestId('statement-reference')).toHaveTextContent('G3190/1/12/7')
    })
    renderAt('/employees/G3190/activity/print?period=year&lang=en&cats=leave,document&summary=0')
    await waitFor(() => expect(sheet()).toBeInTheDocument())
    expect(within(sheet()).getByTestId('statement-reference')).toHaveTextContent('Assigned when printed')

    await user.click(screen.getByRole('button', { name: 'Print' }))

    await waitFor(() => expect(window.print).toHaveBeenCalledTimes(1))
    expect(createStatementPrint).toHaveBeenCalledWith('G3190', {
      kind: 'activity',
      from_date: '2026-01-01',
      to_date: '2026-10-27',
      language: 'en',
      options: { categories: ['leave', 'document'], summary: false, signature: true, orientation: 'portrait' },
    })
    expect(within(sheet()).getByTestId('statement-reference')).toHaveTextContent('G3190/1/12/7')
  })

  it('does not print when the reference cannot be issued', async () => {
    const user = userEvent.setup()
    createStatementPrint.mockRejectedValue(new Error('Server unavailable'))
    renderAt('/employees/G3190/activity/print?period=year&lang=en')
    await waitFor(() => expect(sheet()).toBeInTheDocument())

    await user.click(screen.getByRole('button', { name: 'Print' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('The statement was not printed.')
    expect(window.print).not.toHaveBeenCalled()
    expect(within(sheet()).getByTestId('statement-reference')).toHaveTextContent('Assigned when printed')
  })

  it('prints Western digits only on the Arabic paper', async () => {
    renderAt('/employees/G3190/activity/print?period=year&lang=ar')
    await waitFor(() => expect(sheet()).toBeInTheDocument())
    expect(sheet()).toHaveAttribute('dir', 'rtl')
    expect(sheet().textContent).toMatch(/2026/)
    expect(sheet().textContent).toContain('28')
    expect(sheet().textContent).not.toMatch(/[\u0660-\u0669\u06F0-\u06F9]/)
  })
})

describe('attendance print setup', () => {
  it('fetches one request per calendar month', async () => {
    renderAt('/employees/G3190/attendance/print?mode=custom&from=2026-06-15&to=2026-09-10&lang=en')
    await waitFor(() => expect(sheet()).toBeInTheDocument())
    const ranges = getEmployeeAttendance.mock.calls.map(([, params]) => `${params.from_date}..${params.to_date}`)
    expect(ranges.sort()).toEqual([
      '2026-06-15..2026-06-30',
      '2026-07-01..2026-07-31',
      '2026-08-01..2026-08-31',
      '2026-09-01..2026-09-10',
    ])
  })

  it('carries two signature boxes: Prepared by and the employee, no reviewer', async () => {
    renderAt('/employees/G3190/attendance/print?mode=month&y=2026&m=9&lang=en')
    await waitFor(() => expect(sheet()).toBeInTheDocument())
    const boxes = within(sheet()).getAllByTestId('statement-signature')
    expect(boxes.map((b) => b.firstChild?.textContent)).toEqual(['Prepared by', 'Employee acknowledgement'])
    expect(sheet()).not.toHaveTextContent(/review/i)
  })

  it('orders weekdays by paper language and closes the last week', async () => {
    const { unmount } = renderAt('/employees/G3190/attendance/print?mode=month&y=2026&m=10&lang=en')
    await waitFor(() => expect(sheet()).toBeInTheDocument())
    const headers = (): string[] => within(sheet()).getAllByTestId('calendar-weekday').map((h) => h.textContent ?? '')
    expect(headers()[0]).toBe('Sun')
    let cells = within(sheet()).getAllByTestId(/calendar-(day|blank)/)
    expect(cells.length % 7).toBe(0)
    unmount()

    renderAt('/employees/G3190/attendance/print?mode=month&y=2026&m=10&lang=ar')
    await waitFor(() => expect(sheet()).toBeInTheDocument())
    expect(headers()[0]).toBe('السبت')
    cells = within(sheet()).getAllByTestId(/calendar-(day|blank)/)
    expect(cells.length % 7).toBe(0)
    expect(cells.slice(-6).every((c) => c.dataset.testid === 'calendar-blank')).toBe(true)
    expect(sheet().textContent).not.toMatch(/[\u0660-\u0669\u06F0-\u06F9]/)
  })

  it('shows an explicit error and refuses to print when a month fails to load', async () => {
    getEmployeeAttendance.mockImplementation((_id: string, params: { from_date: string; to_date: string }) =>
      params.from_date.startsWith('2026-08')
        ? Promise.reject(new Error('timeout'))
        : Promise.resolve({ employee_id: 'G3190', from_date: params.from_date, to_date: params.to_date, days: [] }),
    )
    renderAt('/employees/G3190/attendance/print?mode=quarter&y=2026&q=3&lang=en')
    expect(await screen.findByText(/Attendance for August 2026 could not be loaded/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Print' })).toBeDisabled()
    expect(sheet()).toBeNull()
  })
})
