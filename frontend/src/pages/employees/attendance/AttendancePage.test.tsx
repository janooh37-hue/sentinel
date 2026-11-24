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
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import i18n from 'i18next'
import { createMemoryRouter, Route, RouterProvider, Routes, useLocation } from 'react-router-dom'
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
    punch_count: 2,
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

// A double-shift person belongs to one people bucket but contributes two rows.
const FILTER_ROWS = [
  ...DAY_ROWS.map((entry, index) => ({
    ...entry,
    duty_unit: index === 2 ? 'Bravo' : index === 3 ? null : 'Alpha',
    corrected: index === 1 || index === 2,
    first_in_at: entry.first_punch_at,
    final_out_at: index < 2 ? MORNING_END : null,
  })),
  row({
    employee_id: 'G-9002',
    name_en: 'Salem Obaid',
    duty_unit: 'Alpha',
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

function RouteLocation(): React.JSX.Element {
  const location = useLocation()
  return <output data-testid="attendance-route">{location.pathname}{location.search}</output>
}

function renderPage(initialEntry = '/employees/attendance') {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const router = createMemoryRouter([{
    path: '*',
    element: <>
      <RouteLocation />
      <Routes>
        <Route path="/employees/attendance" element={<AttendancePage />} />
        <Route path="/employees/:id" element={<div>employee file</div>} />
      </Routes>
    </>,
  }], { initialEntries: [initialEntry] })
  return render(
    <QueryClientProvider client={client}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  )
}

function routeParams(): URLSearchParams {
  return new URL(screen.getByTestId('attendance-route').textContent ?? '', 'https://sentinel.test').searchParams
}

function registerText(): string {
  return screen.getAllByTestId('attendance-register-unit').map((unit) => unit.textContent).join(' ')
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

  it('names the page once in Arabic and keeps the Arabic subtitle in English', async () => {
    const heading = async (): Promise<HTMLElement> => screen.findByRole('heading', { level: 1 })
    const { unmount } = renderPage()
    expect(within(await heading()).getByText('الحضور')).toBeInTheDocument()
    unmount()

    await i18n.changeLanguage('ar')
    try {
      renderPage()
      // The test setup loads EN resources only, so the title falls back to
      // English; what matters is that the Arabic echo is gone.
      const title = await heading()
      expect(title).toHaveTextContent(/^Attendance$/)
      expect(within(title).queryByText('الحضور')).not.toBeInTheDocument()
    } finally {
      await i18n.changeLanguage('en')
    }
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

  it.each(['next-day button', 'ArrowRight'])('returns to the default date and stops at today with %s', async (method) => {
    const user = userEvent.setup()
    renderPage('/employees/attendance?date=2026-08-18')
    await waitFor(() => expect(listAttendanceDay).toHaveBeenCalledWith({ operational_date: '2026-08-18', limit: 500 }))
    const nextDay = screen.getByRole('button', { name: 'Next day' })
    const stepForward = () => method === 'ArrowRight' ? user.keyboard('{ArrowRight}') : user.click(nextDay)

    await stepForward()
    await waitFor(() => expect(listAttendanceDay).toHaveBeenCalledWith({ operational_date: '2026-08-19', limit: 500 }))
    expect(routeParams().has('date')).toBe(false)

    await stepForward()
    expect(screen.getByLabelText('Choose day')).toHaveValue('2026-08-19')
    expect(routeParams().has('date')).toBe(false)
    expect(listAttendanceDay).toHaveBeenCalledTimes(2)
    expect(nextDay).toBeDisabled()
  })

  it('suspends all page shortcuts while the correction evidence overlay is open', async () => {
    const user = userEvent.setup()
    renderPage()
    await user.click(await screen.findByRole('button', { name: /Review Ahmed Ali/i }))
    await waitFor(() => expect(getAttendanceCase).toHaveBeenCalledWith(42))

    await user.keyboard('{ArrowLeft}{ArrowRight}1/')

    expect(listAttendanceDay).toHaveBeenCalledTimes(1)
    expect(screen.getByRole('searchbox', { hidden: true })).not.toHaveFocus()
    await user.click(screen.getByRole('button', { name: /close/i }))
    await user.keyboard('{ArrowLeft}')
    await waitFor(() => expect(listAttendanceDay).toHaveBeenCalledTimes(2))
  })

  it('suspends shortcuts under another open dialog', async () => {
    const user = userEvent.setup()
    render(
      <div role="dialog" aria-label="Other workflow">
        Other workflow
      </div>,
    )
    renderPage()
    await waitFor(() => expect(listAttendanceDay).toHaveBeenCalledTimes(1))

    await user.keyboard('{ArrowLeft}{ArrowRight}2/')

    expect(listAttendanceDay).toHaveBeenCalledTimes(1)
    expect(screen.getByRole('searchbox')).not.toHaveFocus()
  })

  it('summarizes only the shift and search results on screen', async () => {
    const user = userEvent.setup()
    renderPage()
    const summary = await screen.findByRole('region', { name: 'On site now' })
    expect(summary).toHaveTextContent('4 people')

    await user.click(screen.getByRole('button', { name: /^Morning/ }))
    expect(summary).toHaveTextContent('3 people')
    await user.type(screen.getByRole('searchbox'), 'Ahmed')
    expect(summary).toHaveTextContent('1 person')
  })

  it.each(['register', 'board', 'timeline'] as const)(
    'applies URL people, row-state and company filters to the %s and paper',
    async (view) => {
      listAttendanceDay.mockResolvedValue({ items: FILTER_ROWS, next_cursor: null })
      renderPage(`/employees/attendance?view=${view}&who=left&state=pending&company=Alpha`)
      const testId = view === 'register' ? 'attendance-register-unit'
        : view === 'board' ? 'attendance-board' : 'attendance-timeline-unit'
      const surfaces = await screen.findAllByTestId(testId)
      const text = surfaces.map((surface) => surface.textContent).join(' ')
      expect(text).toContain('Salem Obaid')
      expect(text).not.toContain('Ahmed Ali')
      expect(text).not.toContain('Faisal Hamad')
      expect(text).not.toContain('Night Person')
      const peopleOnPaper = screen.getAllByTestId('attendance-print-person')
      expect(peopleOnPaper).toHaveLength(1)
      expect(peopleOnPaper[0]).toHaveTextContent('Salem Obaid')
      expect(screen.getByRole('status', { name: 'Filter results' })).toHaveTextContent('1 person · 1 row shown')
    },
  )

  it('ORs row states, intersects Corrected, and counts distinct people rather than assignments', async () => {
    listAttendanceDay.mockResolvedValue({ items: FILTER_ROWS, next_cursor: null })
    renderPage('/employees/attendance?state=late,pending')
    await screen.findAllByTestId('attendance-register-unit')
    expect(registerText()).toContain('Salem Obaid')
    expect(registerText()).toContain('Night Person')
    expect(registerText()).not.toContain('Ahmed Ali')
    const live = screen.getByRole('status', { name: 'Filter results' })
    expect(live).toHaveTextContent('2 people · 3 rows shown')
    expect(live).toHaveAttribute('aria-live', 'polite')
    expect(live.querySelectorAll('bdi[dir="ltr"]')).toHaveLength(2)

    await userEvent.setup().click(screen.getByRole('button', { name: /^Corrected 1$/ }))
    expect(registerText()).toContain('Salem Obaid')
    expect(registerText()).not.toContain('Night Person')
    expect(live).toHaveTextContent('1 person · 1 row shown')
    expect(routeParams().get('corrected')).toBe('1')
  })

  it('keeps summary and chip totals under state filters but recounts the company scope', async () => {
    const user = userEvent.setup()
    listAttendanceDay.mockResolvedValue({ items: FILTER_ROWS, next_cursor: null })
    renderPage()
    const summary = await screen.findByRole('region', { name: 'On site now' })
    const states = screen.getByRole('group', { name: 'Row status' })
    const left = within(summary).getByRole('button', { name: /Left$/ })
    expect(summary).toHaveTextContent('4 people')
    expect(left).toHaveTextContent('2')

    await user.click(within(states).getByRole('button', { name: /^Late past grace/ }))
    expect(summary).toHaveTextContent('4 people')
    expect(left).toHaveTextContent('2')
    expect(within(states).getByRole('button', { name: /^Not due yet/ })).toHaveTextContent('2')
    expect(registerText()).toContain('Salem Obaid')
    expect(registerText()).not.toContain('Ahmed Ali')

    await user.selectOptions(screen.getByRole('combobox', { name: 'Company' }), 'Alpha')
    expect(summary).toHaveTextContent('2 people')
    expect(within(states).getByRole('button', { name: /^Not due yet/ })).toHaveTextContent('1')
    expect(routeParams().get('company')).toBe('Alpha')
    expect(routeParams().get('state')).toBe('late')
  })

  it('recounts shift buttons for company and search without narrowing them to the selected shift', async () => {
    const user = userEvent.setup()
    listAttendanceDay.mockResolvedValue({ items: FILTER_ROWS, next_cursor: null })
    renderPage()

    const morning = await screen.findByRole('button', { name: /^Morning/ })
    const night = screen.getByRole('button', { name: /^Night/ })
    expect(morning).toHaveTextContent('2/3')
    expect(night).toHaveTextContent('0/2')

    await user.selectOptions(screen.getByRole('combobox', { name: 'Company' }), 'Alpha')
    expect(morning).toHaveTextContent('2/2')
    expect(night).toHaveTextContent('0/1')

    await user.click(morning)
    expect(morning).toHaveAttribute('aria-pressed', 'true')
    expect(night).toHaveTextContent('0/1')
    await user.type(screen.getByRole('searchbox'), 'Ahmed')
    expect(morning).toHaveTextContent('1/1')
    expect(night).toHaveTextContent('—')
  })

  it('shows people and row totals for the unfiltered day without a Clear filters action', async () => {
    listAttendanceDay.mockResolvedValue({ items: FILTER_ROWS, next_cursor: null })
    renderPage()
    await screen.findAllByTestId('attendance-register-unit')

    expect(screen.getByRole('status', { name: 'Filter results' })).toHaveTextContent('4 people · 5 rows shown')
    expect(screen.queryByRole('button', { name: 'Clear filters' })).not.toBeInTheDocument()
  })

  it('clears only attendance filters, preserving company, shift, search and the live region', async () => {
    const user = userEvent.setup()
    listAttendanceDay.mockResolvedValue({ items: FILTER_ROWS, next_cursor: null })
    renderPage('/employees/attendance?who=left&state=late&corrected=1&company=Alpha&shift=morning')
    await screen.findAllByTestId('attendance-register-unit')
    await user.type(screen.getByRole('searchbox'), 'Salem')
    const live = screen.getByRole('status', { name: 'Filter results' })

    await user.click(screen.getByRole('button', { name: 'Clear filters' }))

    expect(routeParams().has('who')).toBe(false)
    expect(routeParams().has('state')).toBe(false)
    expect(routeParams().has('corrected')).toBe(false)
    expect(routeParams().get('company')).toBe('Alpha')
    expect(routeParams().get('shift')).toBe('morning')
    expect(screen.getByRole('searchbox')).toHaveValue('Salem')
    expect(registerText()).toContain('Salem Obaid')
    expect(registerText()).not.toContain('Ahmed Ali')
    expect(screen.getByRole('status', { name: 'Filter results' })).toBe(live)
    expect(live).toHaveTextContent('1 person · 1 row shown')
    expect(screen.queryByRole('button', { name: 'Clear filters' })).not.toBeInTheDocument()
  })

  it('uses Escape to clear filters, but never while editing scope fields or editable content', async () => {
    const user = userEvent.setup()
    listAttendanceDay.mockResolvedValue({ items: FILTER_ROWS, next_cursor: null })
    render(
      <>
        <textarea aria-label="Other notes" />
        <div contentEditable suppressContentEditableWarning><span>Editable notes</span></div>
      </>,
    )
    renderPage('/employees/attendance?who=left&state=late&corrected=1&company=Alpha&shift=morning')
    await screen.findAllByTestId('attendance-register-unit')
    await user.type(screen.getByRole('searchbox'), 'Salem')
    for (const field of [
      screen.getByRole('searchbox'),
      screen.getByRole('combobox', { name: 'Company' }),
      screen.getByRole('textbox', { name: 'Other notes' }),
      screen.getByText('Editable notes'),
    ]) {
      fireEvent.keyDown(field, { key: 'Escape' })
      expect(routeParams().get('state')).toBe('late')
    }

    await user.click(screen.getByRole('button', { name: 'Register' }))
    await user.keyboard('{Escape}')

    expect(routeParams().has('who')).toBe(false)
    expect(routeParams().has('state')).toBe(false)
    expect(routeParams().has('corrected')).toBe(false)
    expect(routeParams().get('company')).toBe('Alpha')
    expect(routeParams().get('shift')).toBe('morning')
    expect(screen.getByRole('searchbox')).toHaveValue('Salem')
  })

  it('leaves filters intact when Escape belongs to an open dialog', async () => {
    render(<div role="dialog" aria-label="Other workflow">Other workflow</div>)
    renderPage('/employees/attendance?state=late')
    await screen.findAllByTestId('attendance-register-unit')

    fireEvent.keyDown(document.body, { key: 'Escape' })

    expect(routeParams().get('state')).toBe('late')
  })

  it('canonicalizes dropped URL values without losing company or view on a past day', async () => {
    listAttendanceDay.mockResolvedValue({ items: FILTER_ROWS, next_cursor: null })
    renderPage('/employees/attendance?date=2026-08-18&who=onSite&state=late,unknown,late&corrected=0&company=Alpha&view=board')
    const board = await screen.findByTestId('attendance-board')

    await waitFor(() => expect(routeParams().has('who')).toBe(false))
    expect(routeParams().get('state')).toBe('late')
    expect(routeParams().has('corrected')).toBe(false)
    expect(routeParams().get('company')).toBe('Alpha')
    expect(routeParams().get('view')).toBe('board')
    expect(routeParams().get('date')).toBe('2026-08-18')
    expect(within(board).getByText('Salem Obaid')).toBeInTheDocument()
    const summary = screen.getByRole('region', { name: 'Day summary' })
    expect(within(summary).queryByRole('button', { name: /On site$/ })).not.toBeInTheDocument()
  })

  it('preserves the filter and company through day and view switches', async () => {
    const user = userEvent.setup()
    listAttendanceDay.mockResolvedValue({ items: FILTER_ROWS, next_cursor: null })
    renderPage('/employees/attendance?who=left&state=late&company=Alpha')
    await screen.findAllByTestId('attendance-register-unit')

    await user.click(screen.getByRole('button', { name: 'Board' }))
    await screen.findByTestId('attendance-board')
    await user.click(screen.getByRole('button', { name: 'Previous day' }))
    await waitFor(() => expect(listAttendanceDay).toHaveBeenCalledTimes(2))

    expect(routeParams().get('who')).toBe('left')
    expect(routeParams().get('state')).toBe('late')
    expect(routeParams().get('company')).toBe('Alpha')
    expect(routeParams().get('view')).toBe('board')
  })

  it('jumps straight to a picked day, keeping filters, and drops the date param for today', async () => {
    listAttendanceDay.mockResolvedValue({ items: FILTER_ROWS, next_cursor: null })
    renderPage('/employees/attendance?who=left&state=late&company=Alpha&shift=morning')
    await screen.findAllByTestId('attendance-register-unit')
    const picker = screen.getByLabelText('Choose day')
    expect(picker).toHaveValue('2026-08-19')
    expect(picker).toHaveAttribute('max', '2026-08-19')
    expect(picker).not.toHaveAttribute('min')

    fireEvent.change(picker, { target: { value: '2026-07-03' } })

    await waitFor(() => expect(routeParams().get('date')).toBe('2026-07-03'))
    expect(routeParams().get('who')).toBe('left')
    expect(routeParams().get('state')).toBe('late')
    expect(routeParams().get('company')).toBe('Alpha')
    expect(routeParams().get('shift')).toBe('morning')
    expect(screen.getByLabelText('Choose day')).toHaveValue('2026-07-03')

    fireEvent.change(screen.getByLabelText('Choose day'), { target: { value: '2026-08-19' } })

    await waitFor(() => expect(routeParams().has('date')).toBe(false))
    expect(routeParams().get('who')).toBe('left')
    expect(routeParams().get('state')).toBe('late')
    expect(routeParams().get('company')).toBe('Alpha')
  })

  it('offers Clear filters for an empty intersection, restoring the scoped rows', async () => {
    const user = userEvent.setup()
    listAttendanceDay.mockResolvedValue({ items: FILTER_ROWS, next_cursor: null })
    renderPage('/employees/attendance?who=left&state=absent&company=Alpha')
    const empty = await screen.findByText('No rows match these filters')
    expect(screen.queryByTestId('attendance-register-unit')).not.toBeInTheDocument()
    expect(screen.getByRole('status', { name: 'Filter results' })).toHaveTextContent('0 people · 0 rows shown')

    await user.click(within(empty.parentElement!).getByRole('button', { name: 'Clear filters' }))

    await screen.findAllByTestId('attendance-register-unit')
    expect(registerText()).toContain('Ahmed Ali')
    expect(registerText()).toContain('Salem Obaid')
    expect(registerText()).not.toContain('Faisal Hamad')
    expect(routeParams().get('company')).toBe('Alpha')
  })

  it('offers Clear search, not a misleading filter-empty message, when search emptied the scope', async () => {
    const user = userEvent.setup()
    listAttendanceDay.mockResolvedValue({ items: FILTER_ROWS, next_cursor: null })
    renderPage('/employees/attendance?state=late&company=Alpha')
    await screen.findAllByTestId('attendance-register-unit')

    await user.type(screen.getByRole('searchbox'), 'no matching employee')

    expect(screen.getByText(/No attendance rows/i)).toBeInTheDocument()
    expect(screen.queryByText('No rows match these filters')).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Clear search' }))
    expect(screen.getByRole('searchbox')).toHaveValue('')
    expect(registerText()).toContain('Salem Obaid')
    expect(routeParams().get('state')).toBe('late')
    expect(routeParams().get('company')).toBe('Alpha')
  })

  it('keeps the date-wide attention queue outside all scope and attendance filters', async () => {
    const user = userEvent.setup()
    listAttendanceDay.mockResolvedValue({ items: FILTER_ROWS, next_cursor: null })
    listAttendanceExceptions.mockRejectedValue(new Error('network unavailable'))
    renderPage('/employees/attendance?company=Alpha&shift=morning&state=absent&corrected=1')
    const summary = await screen.findByRole('region', { name: 'On site now' })
    const queue = screen.getByTestId('attendance-attention-queue')
    await user.type(screen.getByRole('searchbox'), 'Ahmed')

    expect(within(queue).getByText('Faisal Hamad')).toBeInTheDocument()
    expect(within(queue).getByText('Salem Obaid')).toBeInTheDocument()
    expect(within(queue).getAllByRole('listitem')).toHaveLength(2)
    const anchor = within(summary).getByRole('link')
    expect(anchor).toHaveAttribute('href', `#${queue.id}`)
    expect(anchor.id).not.toBe('')
  })

  it('lists seed companies in Leaves report order, then extras and the selected missing company', async () => {
    listAttendanceDay.mockResolvedValue({
      items: [
        row({ duty_unit: 'السرية الثالثة' }),
        row({ duty_unit: 'السرية الثانية' }),
        row({ duty_unit: 'Bravo' }),
        row({ duty_unit: 'Alpha' }),
        row({ duty_unit: 'Bravo' }),
        row({ duty_unit: null }),
      ],
      next_cursor: null,
    })
    renderPage('/employees/attendance?company=Zeta')
    await screen.findByRole('region', { name: 'On site now' })
    const select = screen.getByRole('combobox', { name: 'Company' })
    expect(select).toHaveValue('Zeta')
    const companies = within(select).getAllByRole('option').map((option) => option.getAttribute('value'))
    expect(companies).toEqual([
      '',
      'الدوام الرسمي',
      'السرية الأولى',
      'السرية الثانية',
      'السرية الثالثة',
      'السرية الرابعة',
      'السرية الخامسة',
      'Bravo',
      'Alpha',
      'Zeta',
      '__unassigned__',
    ])
  })

  it('offers one trimmed company option and keeps its employees visible when selected', async () => {
    const user = userEvent.setup()
    listAttendanceDay.mockResolvedValue({
      items: [
        row({ duty_unit: ' Alpha ' }),
        row({ employee_id: 'G-9002', name_en: 'Salem Obaid', duty_unit: 'Alpha' }),
        row({ employee_id: 'G-9003', name_en: 'Faisal Hamad', duty_unit: 'Bravo' }),
      ],
      next_cursor: null,
    })
    renderPage()
    await screen.findAllByTestId('attendance-register-unit')

    const select = screen.getByRole('combobox', { name: 'Company' })
    await user.selectOptions(select, 'Alpha')

    expect(registerText()).toContain('Ahmed Ali')
    expect(registerText()).toContain('Salem Obaid')
    expect(registerText()).not.toContain('Faisal Hamad')
    expect(routeParams().get('company')).toBe('Alpha')
    const alpha = within(select).getByRole('option', { name: 'Alpha' })
    expect(alpha).toHaveValue('Alpha')
  })

  it('scopes Unassigned to rows without a company', async () => {
    listAttendanceDay.mockResolvedValue({ items: FILTER_ROWS, next_cursor: null })
    renderPage('/employees/attendance?company=__unassigned__')
    await screen.findAllByTestId('attendance-register-unit')

    expect(registerText()).toContain('Night Person')
    expect(registerText()).not.toContain('Salem Obaid')
    expect(screen.getByRole('region', { name: 'On site now' })).toHaveTextContent('1 person')
    expect(screen.getByRole('status', { name: 'Filter results' })).toHaveTextContent('1 person · 1 row shown')
  })

  it('deep-links a name to that employee attendance tab', async () => {
    const user = userEvent.setup()
    renderPage()

    await waitFor(() => expect(screen.getAllByTestId('attendance-register-unit').length).toBe(2))
    const [morning] = screen.getAllByTestId('attendance-register-unit')
    await user.click(within(morning).getByText('Faisal Hamad'))

    expect(await screen.findByText('employee file')).toBeInTheDocument()
  })

  it.each(['register', 'board', 'timeline'] as const)('guards employee navigation from a dirty %s correction until Discard', async (view) => {
    getAttendanceCase.mockResolvedValue({
      data: {
        id: 42,
        employee_id: 'G-9001',
        name_en: 'Ahmed Ali',
        operational_date: '2026-08-19',
        scheduled_start_at: MORNING_START,
        scheduled_end_at: MORNING_END,
        shift_code_snapshot: 'morning',
        organization_snapshot_state: 'assigned',
        effective: { presence_state: 'completed', first_in_at: '2026-08-19T01:10:00Z' },
      },
      etag: 'case-v1',
    })
    const user = userEvent.setup()
    const route = `/employees/attendance?view=${view}`
    renderPage(route)
    const [surface] = await screen.findAllByTestId(view === 'board' ? 'attendance-board'
      : view === 'timeline' ? 'attendance-timeline-unit' : 'attendance-register-unit')
    await user.click(within(surface).getByRole('button', { name: /Correct attendance: Ahmed Ali/ }))
    await screen.findByLabelText('In time (24h)')
    await user.type(screen.getByLabelText('Reason details'), 'Confirmed against gate register')
    await user.click(within(surface).getByText('Ahmed Ali'))
    const confirmation = await screen.findByRole('alertdialog')
    expect(screen.getByTestId('attendance-route')).toHaveTextContent(route)
    expect(screen.queryByText('employee file')).not.toBeInTheDocument()
    await user.click(within(confirmation).getByRole('button', { name: 'Keep editing' }))
    expect(screen.getByTestId('attendance-route')).toHaveTextContent(route)
    expect(screen.getByLabelText('Reason details')).toHaveValue('Confirmed against gate register')
    await user.click(within(surface).getByText('Ahmed Ali'))
    await user.click(within(await screen.findByRole('alertdialog')).getByRole('button', { name: 'Discard' }))
    expect(await screen.findByText('employee file')).toBeInTheDocument()
    expect(screen.getByTestId('attendance-route')).toHaveTextContent('/employees/G-9001?tab=attendance')
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('shows the derived attention queue ordered worst first', async () => {
    listAttendanceExceptions.mockRejectedValue(new Error('network unavailable'))
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

  it('keeps the derived attention queue visible when review exceptions fail', async () => {
    listAttendanceExceptions.mockRejectedValue(new Error('network unavailable'))
    renderPage()

    expect(await screen.findByRole('alert')).toHaveTextContent('Review exceptions unavailable')
    const queue = screen.getByTestId('attendance-attention-queue')
    expect(within(queue).getByText('Faisal Hamad')).toBeInTheDocument()
    expect(within(queue).queryByRole('button', { name: /Review Ahmed Ali/i })).not.toBeInTheDocument()
  })

  it('uses the desktop queue’s own heading when the day fails but exceptions load', async () => {
    const matchMedia = vi.spyOn(window, 'matchMedia').mockImplementation((query) => ({
      matches: query === '(min-width: 64rem)', media: query, onchange: null,
      addListener: vi.fn(), removeListener: vi.fn(), addEventListener: vi.fn(), removeEventListener: vi.fn(),
      dispatchEvent: () => false,
    }))
    try {
      listAttendanceDay.mockRejectedValue(new Error('day unavailable'))
      renderPage()

      expect(await screen.findByRole('alert')).toHaveTextContent('Attendance could not be loaded')
      await screen.findByRole('button', { name: /Review Ahmed Ali/i })
      const queue = screen.getByRole('complementary', { name: 'Needs a decision' })
      const heading = within(queue).getByRole('heading', { name: 'Needs a decision' })
      expect(heading).toBeVisible()
      // jsdom does not apply the Tailwind desktop media query.
      expect(heading.parentElement).not.toHaveClass('lg:hidden')
    } finally {
      matchMedia.mockRestore()
    }
  })

  it.each(['workforce.people.view', 'workforce.attendance.review'])(
    'does not render the roster or request day data without %s',
    async (denied) => {
      hasCapability.mockImplementation((cap) => cap !== denied)
      renderPage()

      expect(screen.queryByTestId('attendance-register-unit')).not.toBeInTheDocument()
      expect(screen.queryByTestId('attendance-attention-badge')).not.toBeInTheDocument()
      expect(screen.queryByRole('heading', { name: /Attendance/i })).not.toBeInTheDocument()
      expect(listAttendanceDay).not.toHaveBeenCalled()
      expect(listAttendanceExceptions).not.toHaveBeenCalled()
    },
  )

  it('renders the empty state for a day with no rows', async () => {
    listAttendanceDay.mockResolvedValue({ items: [], next_cursor: null })

    renderPage()

    expect(await screen.findByText(/No attendance rows/i)).toBeInTheDocument()
  })
})
