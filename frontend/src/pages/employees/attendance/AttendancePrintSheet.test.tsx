/**
 * AttendancePrintSheet — the duty register on paper.
 *
 * The original defect was a printout that carried names but neither the shift
 * nor its working window, because the only place they were rendered was a
 * `<header>` and the print stylesheet deletes every header. These are the facts
 * that must reach the paper, so they are pinned here:
 *
 *   1. Both layouts name the shift AND print its window, per section.
 *   2. The unit ("السرية …") prints at bold weight — it is the line a
 *      supervisor finds the sheet by.
 *   3. The crest is on every sheet, at the inline-start edge.
 *   4. The provenance line carries the link back to the screen and the instant
 *      the paper was produced, and re-stamps when the dialog opens.
 *   5. A filtered register says so, so paper can never look like a whole day.
 *   6. `shift` emits one sheet per shift; `sheet` emits one for the day.
 *   7. Every state reads as words, not colour alone — including the arrival
 *      inside the grace, which the screen leaves to a coloured bead.
 */
import { act, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { SessionUser } from '@/lib/api'
import { AuthContext } from '@/lib/authContext'

import { AttendancePrintSheet } from './AttendancePrintSheet'
import type { AttendanceRow } from './attendanceModel'

// 19 Aug 2026 is the rotation's double day: one company works the morning and
// another the night, which is the case a printed register must never collapse.
const MORNING_START = '2026-08-19T01:00:00'
const MORNING_END = '2026-08-19T09:00:00'
const NIGHT_START = '2026-08-19T17:00:00'
const NIGHT_END = '2026-08-20T01:00:00'

function row(overrides: Partial<AttendanceRow> = {}): AttendanceRow {
  return {
    employee_id: 'G9001',
    name_en: 'Ahmed Al Mansoori',
    name_ar: 'أحمد المنصوري',
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
    punch_count: 2,
    late_minutes: 0,
    grace_minutes: 30,
    absence_due_at: '2026-08-19T02:00:00',
    judgment_due_at: '2026-08-19T11:00:00',
    on_leave: false,
    ...overrides,
  } as AttendanceRow
}

const ROWS: AttendanceRow[] = [
  row(),
  // 22 minutes after a 05:00 start, inside the 30-minute grace: late on the
  // clock, but the policy costs it nothing. The screen says so with a coloured
  // bead; paper has to say it in words. The punch time has to agree with
  // `late_minutes` or the fixture describes a state that cannot happen.
  row({
    employee_id: 'G9002',
    name_en: 'Salem Obaid',
    late_minutes: 22,
    first_punch_at: '2026-08-19T01:22:00',
  }),
  row({
    employee_id: 'G9003',
    name_en: 'Faisal Hamad',
    duty_post: 'التفتيش',
    late_minutes: 47,
    first_punch_at: '2026-08-19T01:47:00',
  }),
  row({
    employee_id: 'G9004',
    name_en: 'Rashid Khalfan',
    duty_post: 'التفتيش',
    punch_count: 0,
    first_punch_at: null,
    last_punch_at: null,
    presence_state: 'absent',
  }),
  // One punch on a duty whose match window has already closed (the default
  // `judgment_due_at` is 11:00Z, the pinned clock is 12:00Z): a hole in the
  // record rather than a person who did not come.
  row({
    employee_id: 'G9006',
    name_en: 'Obaid Saif',
    duty_post: 'التفتيش',
    punch_count: 1,
    last_punch_at: null,
    presence_state: 'on_duty',
  }),
  // The night duty has not started at the pinned clock, so it is neither late
  // nor absent — it is not yet judged, and the sheet has to say so.
  row({
    employee_id: 'G9005',
    name_en: 'Night Person',
    shift_code: 'night',
    duty_unit: 'السرية الثالثة',
    scheduled_start_at: NIGHT_START,
    scheduled_end_at: NIGHT_END,
    absence_due_at: '2026-08-19T18:00:00',
    judgment_due_at: '2026-08-20T03:00:00',
    punch_count: 0,
    first_punch_at: null,
    last_punch_at: null,
    presence_state: 'scheduled',
  }),
]

const USER = {
  id: 1,
  email: 'ops@gssg.local',
  employee_id: 'G9100',
  name_en: 'A. Alhamadi',
  name_ar: 'أ. الحمادي',
  position: 'Operations',
  department: 'Operations',
  photo_url: null,
  role: 'manager',
  status: 'active',
  is_admin: false,
  is_manager: true,
  has_signature: false,
} as SessionUser

function renderSheet(props: Partial<React.ComponentProps<typeof AttendancePrintSheet>> = {}) {
  return render(
    <AuthContext.Provider
      value={{
        user: USER,
        status: 'authed',
        login: vi.fn(),
        logout: vi.fn(),
        refetch: vi.fn(),
        setUser: vi.fn(),
      }}
    >
      <AttendancePrintSheet
        layout="sheet"
        rows={ROWS}
        now={new Date('2026-08-19T12:00:00Z')}
        operationalDate="2026-08-19"
        shiftCode={null}
        search=""
        {...props}
      />
    </AuthContext.Provider>,
  )
}

beforeEach(() => {
  // The stamp is real wall-clock time, so it needs a pinned clock to assert.
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date('2026-08-19T12:00:00Z'))
})

afterEach(() => {
  vi.useRealTimers()
})

describe('AttendancePrintSheet', () => {
  it('prints the shift name and its working window for every shift', () => {
    renderSheet()

    // The defect: names printed, shift and window did not.
    expect(screen.getByText('Morning')).toBeInTheDocument()
    expect(screen.getByText('Night')).toBeInTheDocument()
    // Asia/Dubai (UTC+4): 01:00Z is 05:00 local, 17:00Z is 21:00.
    expect(screen.getByText('05:00 – 13:00')).toBeInTheDocument()
    expect(screen.getByText('21:00 – 05:00')).toBeInTheDocument()
  })

  it.each(['sheet', 'roster', 'shift'] as const)(
    'prints the unit bold, in a family that has Arabic, in the %s layout',
    (layout) => {
      renderSheet({ layout })
      const [unit] = screen.getAllByText('السرية الثانية')
      expect(unit.tagName).toBe('B')
      // 700, not 800: only 400/500/700 of Noto Sans Arabic are bundled, so an
      // 800 request has no real Arabic face and the browser fakes it.
      expect(unit.className).toContain('font-bold')
      expect(unit.className).not.toContain('font-extrabold')
      // Inter carries no Arabic and `--font-arabic` only applies under
      // [dir=rtl]/:lang(ar), which `dir="auto"` matches neither of — so the
      // family is named here or the English UI falls back to whatever the OS has.
      expect(unit.className).toContain("[font-family:'Noto_Sans_Arabic',var(--font-sans)]")
      // Isolated, or the bidi algorithm reorders the clock range beside it.
      expect(unit.className).toContain('isolate-bidi')
    },
  )

  it('carries the crest and the provenance line on the sheet', () => {
    const { container } = renderSheet()

    const logo = container.querySelector('img')
    expect(logo).toHaveAttribute('src', '/brand/gssg-logo.png')
    // Decorative: the title beside it already names the document.
    expect(logo).toHaveAttribute('alt', '')

    expect(screen.getByText(/\/employees\/attendance\?date=2026-08-19/)).toBeInTheDocument()
    expect(screen.getByTestId('attendance-print-stamp')).toHaveTextContent('19 Aug 2026, 16:00')
    expect(screen.getByText('A. Alhamadi')).toBeInTheDocument()
  })

  it('still prints the register when no operator is signed in', () => {
    // `useAuth` throws without a provider. The operator's name is one courtesy
    // line in the footer, so requiring the provider would make the whole
    // register unmountable for it — the line goes, the sheet stays.
    render(
      <AttendancePrintSheet
        layout="sheet"
        rows={ROWS}
        now={new Date('2026-08-19T12:00:00Z')}
        operationalDate="2026-08-19"
        shiftCode={null}
        search=""
      />,
    )

    expect(screen.getByText('Morning')).toBeInTheDocument()
    expect(screen.getByText('05:00 – 13:00')).toBeInTheDocument()
    expect(screen.queryByText('By')).not.toBeInTheDocument()
  })

  it('re-stamps the printed time when the dialog opens', () => {
    renderSheet()
    expect(screen.getByTestId('attendance-print-stamp')).toHaveTextContent('16:00')

    // The page is a wall-mounted dashboard on some desks: a stamp captured at
    // mount would put the wrong hour on paper printed later.
    vi.setSystemTime(new Date('2026-08-19T15:30:00Z'))
    act(() => window.dispatchEvent(new Event('beforeprint')))

    expect(screen.getByTestId('attendance-print-stamp')).toHaveTextContent('19:30')
  })

  it('declares the active filter and puts it in the source link', () => {
    renderSheet({ shiftCode: 'night', search: 'rashid', rows: ROWS.filter((r) => r.shift_code === 'night') })

    expect(screen.getByText(/Night · search "rashid"/)).toBeInTheDocument()
    expect(screen.getByText(/shift=night/)).toBeInTheDocument()
  })

  it('emits one sheet per shift in the shift layout and one for the day otherwise', () => {
    const { container, unmount } = renderSheet({ layout: 'shift' })
    // One masthead per sheet, one sign-off strip per sheet.
    expect(container.querySelectorAll('img').length).toBe(2)
    expect(screen.getAllByText('Shift supervisor').length).toBe(2)
    expect(screen.getByText('Sheet 1 / 2')).toBeInTheDocument()
    expect(screen.getByText('Sheet 2 / 2')).toBeInTheDocument()
    unmount()

    const day = renderSheet().container
    expect(day.querySelectorAll('img').length).toBe(1)
    expect(screen.getByText('Sheet 1 / 1')).toBeInTheDocument()
  })

  it('words every state in the time cell, including an arrival inside the grace', () => {
    renderSheet()

    const posts = screen.getAllByTestId('attendance-print-post')
    const text = posts.map((post) => post.textContent).join(' ')
    // 00:52Z = 04:52 local, two minutes before the 05:00 start.
    expect(text).toContain('04:52')
    // Inside the grace: a bare time would be indistinguishable from on-time.
    expect(text).toContain('05:22 (grace)')
    // Past the grace, counted from the grace and not from the start.
    expect(text).toContain('05:47 +17m')
    expect(text).toContain('no punch')
    // A hole in the record: one punch, match window closed.
    expect(text).toContain('04:52 only')
    // Not yet judged — the sheet says when it is due, not that anyone is absent.
    expect(text).toContain('due 21:00')
  })

  it('prints in and out only on the per-shift sheet, where there is room', () => {
    const { unmount } = renderSheet({ layout: 'shift' })
    const shiftText = screen
      .getAllByTestId('attendance-print-post')
      .map((post) => post.textContent)
      .join(' ')
    expect(shiftText).toContain('04:52 · 13:06')
    // With both punches on the line, repeating the arrival in the last cell is
    // noise; the verdict is the part in/out cannot tell you. Short labels: the
    // full "Late past grace" is a third of the column, and the name is what a
    // supervisor reads a duty sheet by.
    expect(shiftText).toContain('On time')
    expect(shiftText).toContain('Grace')
    expect(shiftText).toContain('Late +17')
    expect(shiftText).not.toContain('05:22 (grace)')
    unmount()

    renderSheet()
    const dayText = screen
      .getAllByTestId('attendance-print-post')
      .map((post) => post.textContent)
      .join(' ')
    expect(dayText).not.toContain('04:52 · 13:06')
    // The day sheet has no in/out column, so there the clock IS the verdict.
    expect(dayText).toContain('05:22 (grace)')
  })

  describe('roster layout', () => {
    it('carries total time worked instead of the scheduled window column', () => {
      renderSheet({ layout: 'roster' })

      const headers = screen.getAllByRole('columnheader').map((cell) => cell.textContent)
      expect(headers).toEqual([
        '#',
        'Name',
        'G-No',
        'Unit',
        'Post',
        'Shift',
        'In',
        'Out',
        'Total',
        'Late',
        'State',
      ])
      // The window was the column this replaced; it lives on the shift band now.
      expect(headers).not.toContain('Window')

      // 00:52Z to 09:06Z is 8h 14m on site. Punches carry no direction, so the
      // total is the span between the first and the last, nothing inferred.
      const line = screen.getByText('Ahmed Al Mansoori').closest('tr')
      expect(line).not.toBeNull()
      expect(line).toHaveTextContent('04:52')
      expect(line).toHaveTextContent('13:06')
      expect(line).toHaveTextContent('8h 14m')
    })

    it('gives a single punch no total rather than a zero', () => {
      renderSheet({ layout: 'roster' })

      // One punch is a hole in the record, not a duty of length nil.
      const line = screen.getByText('Obaid Saif').closest('tr')
      expect(line).toHaveTextContent('Single punch')
      expect(line?.textContent).not.toMatch(/\dh \d\dm/)
    })

    it('repeats the crest and the stamp on every sheet, and counts its lines', () => {
      const { container } = renderSheet({ layout: 'roster' })

      // thead/tfoot groups are the only thing a browser repeats across the
      // fragments of a broken table, so the masthead and provenance live there.
      expect(container.querySelector('thead img')).toHaveAttribute('src', '/brand/gssg-logo.png')
      expect(container.querySelector('tfoot [data-testid="attendance-print-stamp"]')).not.toBeNull()
      // A repeated foot cannot number its own page — Chrome implements no
      // `@page` margin boxes — so it asserts the figure that proves the run is
      // complete instead.
      expect(screen.getByText('6 lines in this printout')).toBeInTheDocument()
    })

    it('names the shift and its window once per band, above the lines', () => {
      renderSheet({ layout: 'roster' })

      const band = screen.getByText('05:00 – 13:00').closest('tr')
      expect(band).toHaveTextContent('Morning')
      expect(band).toHaveTextContent('السرية الثانية')
    })
  })
})
