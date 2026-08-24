/**
 * AttendancePage — one day, one toolbar, three views.
 *
 * Behaviours pinned here:
 *   1. The register renders every post section and every name for the day.
 *   2. The shift filter narrows the day (19 Aug is the rotation's double day, so
 *      unfiltered shows morning AND night).
 *   3. The view switch reaches Board and Timeline without another request.
 *   4. ArrowLeft/ArrowRight change the day and refetch.
 *   5. Clicking a name deep-links to that employee's attendance tab.
 *   6. An empty day renders the empty state, and an unopened window says so
 *      rather than implying absence.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const { listAttendanceDay, listAttendanceExceptions, getAttendanceCase, hasCapability } = vi.hoisted(() => ({
  listAttendanceDay: vi.fn(),
  listAttendanceExceptions: vi.fn(),
  getAttendanceCase: vi.fn(),
  hasCapability: vi.fn<(cap: string) => boolean>(),
}))

vi.mock('@/lib/api', async (orig) => {
  const real = await orig<typeof import('@/lib/api')>()
  return { ...real, api: { ...real.api, listAttendanceDay, listAttendanceExceptions, getAttendanceCase } }
})

vi.mock('@/lib/useCapabilities', () => ({
  useCapabilities: () => ({ capabilities: new Set<string>(), isLoading: false, has: hasCapability }),
}))

import { AttendancePage } from './AttendancePage'

const MORNING_START = '2026-08-19T01:00:00'
const MORNING_END = '2026-08-19T09:00:00'
// Two boundaries arrive on every row. `absence_due_at` is twice the grace past
// the start, when a start with no punch becomes an absence; `judgment_due_at` is
// when the match window closes and a lone punch may be called unpaired.
const MORNING_ABSENCE_DUE = '2026-08-19T02:00:00'
const MORNING_DUE = '2026-08-19T11:00:00'
const NIGHT_START = '2026-08-19T17:00:00'
const NIGHT_END = '2026-08-20T01:00:00'
const NIGHT_ABSENCE_DUE = '2026-08-19T18:00:00'
const NIGHT_DUE = '2026-08-20T03:00:00'

function row(overrides: Record<string, unknown> = {}) {
  return {
    employee_id: 'G-9001',
    name_en: 'Ahmed Ali',
    name_ar: null,
    department: 'الأمن',
    duty_unit: 'السرية الثانية',
    duty_post: 'البوابة الرئيسية',
    crew_code: 'crew_2',
    shift_code: 'morning',
    presence_state: 'completed',
    reason_code: null,
    scheduled_start_at: MORNING_START,
    scheduled_end_at: MORNING_END,
    first_punch_at: '2026-08-19T00:52:00',
    last_punch_at: '2026-08-19T09:06:00',
    case_id: 42,
    late_minutes: 0,
    grace_minutes: 30,
    absence_due_at: MORNING_ABSENCE_DUE,
    judgment_due_at: MORNING_DUE,
    on_leave: false,
    ...overrides,
  }
}

const DAY_ROWS = [
  row(),
  row({ employee_id: 'G-9002', name_en: 'Salem Obaid', duty_post: 'التفتيش', late_minutes: 47 }),
  row({
    employee_id: 'G-9003',
    name_en: 'Faisal Hamad',
    duty_post: 'التفتيش',
    punch_count: 0,
    first_punch_at: null,
    last_punch_at: null,
    presence_state: 'absent',
  }),
  row({
    employee_id: 'G-9004',
    name_en: 'Night Person',
    shift_code: 'night',
    scheduled_start_at: NIGHT_START,
    scheduled_end_at: NIGHT_END,
    absence_due_at: NIGHT_ABSENCE_DUE,
    judgment_due_at: NIGHT_DUE,
    punch_count: 0,
    first_punch_at: null,
    last_punch_at: null,
    presence_state: 'scheduled',
  }),
]

function renderPage(initialEntry = '/employees/attendance') {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[initialEntry]}>
        <Routes>
          <Route path="/employees/attendance" element={<AttendancePage />} />
          <Route path="/employees/:id" element={<div>employee file</div>} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

beforeEach(() => {
  // 16:00 Dubai on the double day: the morning verdict is due, the night duty
  // has not started. Without a pinned clock these rows change meaning daily.
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date('2026-08-19T12:00:00Z'))
  vi.clearAllMocks()
  hasCapability.mockReturnValue(true)
  listAttendanceDay.mockResolvedValue({ items: DAY_ROWS, next_cursor: null })
  listAttendanceExceptions.mockResolvedValue({
    items: [
      {
        employee_id: 'G-9001',
        name_en: 'Ahmed Ali',
        name_ar: null,
        department: 'Security',
        duty_unit: 'Main Gate',
        duty_post: 'Gate 1',
        crew_code: 'A',
        shift_code: 'morning',
        presence_state: 'late',
        reason_code: 'late_arrival',
        scheduled_start_at: MORNING_START,
        scheduled_end_at: MORNING_END,
        case_id: 42,
        late_minutes: 12,
        early_exit_minutes: null,
        missing_checkout: false,
      },
    ],
    next_cursor: null,
  })
  getAttendanceCase.mockResolvedValue({ data: null, etag: 'case-v1' })
})

afterEach(() => {
  vi.useRealTimers()
})

describe('AttendancePage', () => {
  it('renders the register with a section per post and every name', async () => {
    renderPage()

    await waitFor(() => expect(screen.getAllByTestId('attendance-register-post').length).toBeGreaterThan(0))
    // Names deliberately appear twice — once in the register, once in the
    // attention queue — so every assertion is scoped to its region.
    const [morning] = screen.getAllByTestId('attendance-register-unit')
    expect(within(morning).getByText('Ahmed Ali')).toBeInTheDocument()
    expect(within(morning).getByText('Salem Obaid')).toBeInTheDocument()
    expect(within(morning).getByText('Faisal Hamad')).toBeInTheDocument()
    expect(within(morning).getAllByTestId('attendance-register-post')).toHaveLength(2)
    // Morning and night are separate register sections for the same unit.
    expect(screen.getAllByTestId('attendance-register-unit')).toHaveLength(2)
  })

  it('prints the G-number beside every name it lists', async () => {
    // Two guards on one post can share a first and a family name; the G-number
    // is what a supervisor reads out on the radio and types into a report, so
    // it travels with the name wherever the name is printed.
    renderPage()

    await waitFor(() =>
      expect(screen.getAllByTestId('attendance-register-post').length).toBeGreaterThan(0),
    )
    const [morning] = screen.getAllByTestId('attendance-register-unit')
    const row = within(morning).getByText('Ahmed Ali').closest('button')
    expect(row).not.toBeNull()
    expect(row).toHaveTextContent('G-9001')
  })

  // The buttons carry the report names the saved PDFs are filed under, so the
  // operator picks the same words on screen that end up on the file.
  it.each([
    ['Biometric register', 1],
    ['Attendance audit', 1],
    // One sheet per shift, and 19 Aug is the rotation's double day.
    ['Duty attendance', 2],
  ] as const)('the %s button prints that layout', async (label, crests) => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
    const print = vi.spyOn(window, 'print').mockImplementation(() => undefined)
    renderPage()
    await waitFor(() =>
      expect(screen.getAllByTestId('attendance-register-post').length).toBeGreaterThan(0),
    )

    await user.click(screen.getByRole('button', { name: label }))

    expect(print).toHaveBeenCalledTimes(1)
    // `flushSync` has to commit the chosen layout BEFORE `window.print()` blocks,
    // so by the time it is called the right sheet is already in the DOM — one
    // crest for a single-sheet layout, one per sheet for the per-shift one.
    const sheet = document.querySelector('.print-attendance')
    expect(sheet).not.toBeNull()
    expect(sheet?.querySelectorAll('img')).toHaveLength(crests)
    print.mockRestore()
  })

  it('filters to one shift and keeps the request count at one', async () => {
    const user = userEvent.setup()
    renderPage()

    await waitFor(() => expect(screen.getAllByTestId('attendance-register-unit')).toHaveLength(2))
    await user.click(screen.getByRole('button', { name: /^Morning/ }))

    await waitFor(() => expect(screen.getAllByTestId('attendance-register-unit')).toHaveLength(1))
    const [unit] = screen.getAllByTestId('attendance-register-unit')
    expect(within(unit).queryByText('Night Person')).not.toBeInTheDocument()
    expect(listAttendanceDay).toHaveBeenCalledTimes(1)
  })

  it('switches to Board and Timeline without another request', async () => {
    const user = userEvent.setup()
    renderPage()

    await waitFor(() => expect(screen.getAllByTestId('attendance-register-unit')).toHaveLength(2))

    await user.click(screen.getByRole('button', { name: 'Board' }))
    expect(await screen.findByTestId('attendance-board')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Timeline' }))
    await waitFor(() => expect(screen.getAllByTestId('attendance-timeline-unit').length).toBe(2))
    expect(screen.getAllByTestId('attendance-timeline-grace-line').length).toBeGreaterThan(0)

    expect(listAttendanceDay).toHaveBeenCalledTimes(1)
  })

  it('changes the day with the arrow keys', async () => {
    const user = userEvent.setup()
    renderPage()

    await waitFor(() => expect(listAttendanceDay).toHaveBeenCalledTimes(1))
    const firstDate = listAttendanceDay.mock.calls[0][0].operational_date

    await user.keyboard('{ArrowLeft}')

    await waitFor(() => expect(listAttendanceDay).toHaveBeenCalledTimes(2))
    const secondDate = listAttendanceDay.mock.calls[1][0].operational_date
    expect(new Date(secondDate).getTime()).toBeLessThan(new Date(firstDate).getTime())
  })

  it('deep-links a name to that employee attendance tab', async () => {
    const user = userEvent.setup()
    renderPage()

    await waitFor(() => expect(screen.getAllByTestId('attendance-register-unit').length).toBe(2))
    const [morning] = screen.getAllByTestId('attendance-register-unit')
    await user.click(within(morning).getByText('Faisal Hamad'))

    expect(await screen.findByText('employee file')).toBeInTheDocument()
  })

  it('shows the attention queue ordered worst first', async () => {
    hasCapability.mockImplementation((cap) => cap !== 'workforce.attendance.review')
    renderPage()

    const queue = await screen.findByTestId('attendance-attention-queue')
    await waitFor(() => expect(within(queue).getAllByRole('listitem').length).toBeGreaterThan(0))
    const names = within(queue)
      .getAllByRole('listitem')
      .map((item) => item.textContent ?? '')
    // No punch outranks late; the night row has not started so it is not listed.
    expect(names[0]).toContain('Faisal Hamad')
    expect(names.join(' ')).toContain('Salem Obaid')
    expect(names.join(' ')).not.toContain('Night Person')
  })

  it('opens the exact selected exception case for reviewers', async () => {
    const user = userEvent.setup()
    renderPage()

    const reviewButton = await screen.findByRole('button', { name: /Review Ahmed Ali/i })
    await user.click(reviewButton)

    await waitFor(() => expect(getAttendanceCase).toHaveBeenCalledWith(42))
    await user.click(screen.getByRole('button', { name: /close/i }))
    await waitFor(() => expect(reviewButton).toHaveFocus())

  })

  it('does not request review exceptions for non-reviewers', async () => {
    hasCapability.mockImplementation((cap) => cap !== 'workforce.attendance.review')
    renderPage()

    await waitFor(() => expect(listAttendanceDay).toHaveBeenCalledOnce())
    expect(listAttendanceExceptions).not.toHaveBeenCalled()
    expect(screen.queryByRole('button', { name: /Review Ahmed Ali/i })).not.toBeInTheDocument()
  })

  it('renders the empty state for a day with no rows', async () => {
    listAttendanceDay.mockResolvedValue({ items: [], next_cursor: null })

    renderPage()

    expect(await screen.findByText(/No attendance rows/i)).toBeInTheDocument()
  })
})
