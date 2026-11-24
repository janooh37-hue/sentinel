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
import { act, render, screen, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import i18n from 'i18next'

import type { SessionUser } from '@/lib/api'
import { AuthContext } from '@/lib/authContext'
import ar from '@/locales/ar.json'

import { AttendancePrintSheet } from './AttendancePrintSheet'
import type { AttendanceRow } from './attendanceModel'
import { EMPTY_FILTER } from './attendanceModel'

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

function sheet(props: Partial<React.ComponentProps<typeof AttendancePrintSheet>> = {}) {
  return (
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
        filter={EMPTY_FILTER}
        company={null}
        totalRows={ROWS.length}
        {...props}
      />
    </AuthContext.Provider>
  )
}

function renderSheet(props: Partial<React.ComponentProps<typeof AttendancePrintSheet>> = {}) {
  return render(sheet(props))
}

beforeEach(() => {
  // The stamp is real wall-clock time, so it needs a pinned clock to assert.
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date('2026-08-19T12:00:00Z'))
})

afterEach(async () => {
  await act(() => i18n.changeLanguage('en'))
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
    // The G-number, not the name: it is what a query about the printout is filed
    // under, and two men on this roster can share a name.
    expect(screen.getByText('G9100')).toBeInTheDocument()
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
        filter={EMPTY_FILTER}
        company={null}
        totalRows={ROWS.length}
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

  it.each(['sheet', 'roster', 'shift'] as const)(
    'declares both tiers, scopes, row coverage and the snapshot time in the %s layout',
    (layout) => {
      renderSheet({
        layout,
        filter: { who: 'left', states: ['late', 'unpaired'], corrected: true },
        company: 'Alpha',
        shiftCode: 'morning',
        search: 'rashid',
        rows: [row({ late_minutes: 47, corrected: true, final_out_at: MORNING_END })],
      })
      const declaration = screen.getByTestId('attendance-print-declaration')
      expect(declaration).toHaveTextContent('Filtered: People: Left')
      expect(declaration).toHaveTextContent('Row status: Late past grace, Single punch')
      expect(declaration).toHaveTextContent('Corrected · Company: Alpha · Morning · search "rashid"')
      expect(declaration).toHaveTextContent('1 of 6 rows · as of 16:00')
      expect(declaration.querySelectorAll('bdi[dir="ltr"]')).toHaveLength(3)
      expect(within(declaration).getByText('rashid')).toHaveAttribute('dir', 'auto')
      const source = screen.getByText(/\/employees\/attendance\?date=/)
      expect(source).toHaveTextContent('who=left')
      expect(source).toHaveTextContent('state=late%2Cunpaired')
      expect(source).toHaveTextContent('corrected=1')
      expect(source).toHaveTextContent('company=Alpha')
      expect(source).toHaveTextContent('shift=morning')
    },
  )

  it.each(['sheet', 'roster', 'shift'] as const)('declares All rows when the %s is unfiltered', (layout) => {
    renderSheet({ layout })

    const declarations = screen.getAllByTestId('attendance-print-declaration')
    expect(declarations).toHaveLength(layout === 'shift' ? 2 : 1)
    for (const declaration of declarations) {
      expect(declaration).toHaveTextContent('All rows · Company: All companies · 6 of 6 rows · as of 16:00')
      expect(declaration.querySelectorAll('bdi[dir="ltr"]')).toHaveLength(3)
      expect(declaration).not.toHaveTextContent('Filtered')
    }
  })

  it.each([
    ['Alpha', 'Alpha'],
    ['__unassigned__', 'Unassigned'],
  ])('declares company-only scope %s as filtered without claiming a tier filter', (company, label) => {
    renderSheet({ company, rows: [row({ duty_unit: company === '__unassigned__' ? null : company })] })

    const declaration = screen.getByTestId('attendance-print-declaration')
    expect(declaration).toHaveTextContent(new RegExp(`^Filtered · Company: ${label} · 1 of 6 rows · as of 16:00$`))
    expect(declaration).not.toHaveTextContent('People:')
    expect(declaration).not.toHaveTextContent('Row status:')
  })

  it.each([
    ['company', { company: 'Alpha' }, 'Company: Alpha'],
    ['shift', { shiftCode: 'morning' }, 'Morning'],
    ['search', { search: 'Ahmed' }, 'search "Ahmed"'],
  ] as const)('declares an active %s filter even when every row matches', (_scope, props, clause) => {
    renderSheet({ rows: [row({ duty_unit: 'Alpha' })], totalRows: 1, ...props })

    const declaration = screen.getByTestId('attendance-print-declaration')
    expect(declaration).toHaveTextContent(/^Filtered ·/)
    expect(declaration).toHaveTextContent(`${clause} · 1 of 1 row`)
  })

  it('declares a partial register as filtered even with no active filter', () => {
    renderSheet({ rows: [row()] })

    expect(screen.getByTestId('attendance-print-declaration')).toHaveTextContent(
      /^Filtered · Company: All companies · 1 of 6 rows · as of 16:00$/,
    )
  })

  it('declares Arabic company-only scope as filtered', async () => {
    i18n.addResourceBundle('ar', 'translation', ar, true, true)
    await act(() => i18n.changeLanguage('ar'))
    renderSheet({ company: 'السرية الثانية', rows: [row()] })

    expect(screen.getByTestId('attendance-print-declaration')).toHaveTextContent(
      /^مُرشَّح · السرية: السرية الثانية · الصفوف: 1 من 6 · حتى 16:00$/,
    )
  })

  it('isolates Arabic declaration counts, time and the search query without English fallbacks', async () => {
    i18n.addResourceBundle('ar', 'translation', ar, true, true)
    await act(() => i18n.changeLanguage('ar'))
    renderSheet({
      filter: { who: 'left', states: ['late'], corrected: false },
      company: 'السرية الثانية',
      search: 'Salem',
      rows: [row()],
    })

    const declaration = screen.getByTestId('attendance-print-declaration')
    expect(declaration).toHaveTextContent('مُرشَّح: الموظفون: غادروا')
    expect(declaration).toHaveTextContent('حالة الصف: تأخر بعد السماح')
    expect(declaration).toHaveTextContent('السرية: السرية الثانية')
    expect(declaration).toHaveTextContent('الصفوف: 1 من 6')
    expect(declaration).toHaveTextContent('حتى 16:00')
    expect(Array.from(declaration.querySelectorAll('bdi[dir="ltr"]'), (value) => value.textContent)).toEqual(['1', '6', '16:00'])
    expect(within(declaration).getByText('Salem')).toHaveAttribute('dir', 'auto')
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

  it('prints each verdict in words beside explicit In and Out columns', () => {
    renderSheet()

    const text = screen.getAllByTestId('attendance-print-post').map((post) => post.textContent).join(' ')
    expect(text).toContain('04:52')
    expect(text).toContain('On time')
    expect(text).toContain('Grace')
    expect(text).toContain('Late +17')
    expect(text).toContain('Absent')
    expect(text).toContain('No exit')
    expect(text).toContain('Due')
    for (const person of screen.getAllByTestId('attendance-print-person')) {
      expect(within(person).getByText('In')).toBeInTheDocument()
      expect(within(person).getByText('Out')).toBeInTheDocument()
    }
  })

  it.each(['sheet', 'roster', 'shift'] as const)(
    'prints National Service, leave subtype and the effective Out in the %s layout',
    (layout) => {
      renderSheet({
        layout,
        rows: [
          row({ employee_id: 'G9101', name_en: 'Hamad Saif', on_leave: true, presence_state: 'excused_leave', leave_kind: 'national_service', punch_count: 0, first_punch_at: null, last_punch_at: null }),
          row({ employee_id: 'G9102', name_en: 'Ali Obaid', on_leave: true, presence_state: 'excused_leave', leave_kind: 'other', leave_label: 'Hajj Leave', punch_count: 0, first_punch_at: null, last_punch_at: null }),
          row({ employee_id: 'G9103', name_en: 'Khalid Hamad', final_out_at: '2026-08-19T08:30:00Z' }),
          row({ employee_id: 'G9104', name_en: 'Salem Saif', punch_count: 1, last_punch_at: '2026-08-19T00:52:00' }),
        ],
      })
      const person = (name: string): HTMLElement =>
        screen.getByText(name).closest(layout === 'roster' ? 'tr' : '[data-testid="attendance-print-person"]') as HTMLElement
      expect(person('Hamad Saif')).toHaveTextContent('National Service')
      expect(person('Hamad Saif').querySelector('.text-smart')).not.toBeNull()
      expect(person('Ali Obaid')).toHaveTextContent('On leave · Hajj Leave')
      expect(person('Khalid Hamad')).toHaveTextContent('12:30')
      expect(person('Khalid Hamad')).not.toHaveTextContent('13:06')
      expect(person('Salem Saif')).toHaveTextContent('—')
      expect(person('Salem Saif')).not.toHaveTextContent('13:00')
      // One label on the row and one on the print-safe legend.
      expect(screen.getAllByText('National Service')).toHaveLength(2)
    },
  )

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

      // Directionless punches are evidence, not a worked span: only an
      // evaluated/corrected departure can establish Out and total time.
      const line = screen.getByText('Ahmed Al Mansoori').closest('tr')
      expect(line).not.toBeNull()
      expect(line).toHaveTextContent('04:52')
      expect(line).not.toHaveTextContent('13:06')
      expect(line).not.toHaveTextContent('8h 14m')
      const cells = within(line as HTMLElement).getAllByRole('cell')
      expect(cells[7]).toHaveTextContent(/^—$/)
      expect(cells[8]).toHaveTextContent(/^—$/)
    })

    it('calculates total time only once the evaluator publishes a departure', () => {
      renderSheet({
        layout: 'roster',
        rows: [row({ final_out_at: '2026-08-19T09:06:00' })],
      })
      const line = screen.getByText('Ahmed Al Mansoori').closest('tr')
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

  describe('save as pdf', () => {
    // The dialog takes its suggested filename from `document.title` and nowhere
    // else, so the swap has to happen on `beforeprint` and be undone after.
    it('suggests the Arabic register name while the dialog is open', () => {
      const original = document.title
      const morning = ROWS.filter((r) => r.shift_code === 'morning')
      renderSheet({ layout: 'roster', rows: morning, shiftCode: 'morning' })

      expect(document.title).toBe(original)

      act(() => window.dispatchEvent(new Event('beforeprint')))
      expect(document.title).toBe('كشف تدقيق الحضور_السرية الثانية_الأربعاء_صباحية_19-08-2026')

      act(() => window.dispatchEvent(new Event('afterprint')))
      expect(document.title).toBe(original)
    })

    it('puts the tab title back when the register unmounts mid-dialog', () => {
      const original = document.title
      const { unmount } = renderSheet()

      act(() => window.dispatchEvent(new Event('beforeprint')))
      expect(document.title).not.toBe(original)

      unmount()
      expect(document.title).toBe(original)
    })

    it('keeps the register name when the day refetches mid-dialog', () => {
      const original = document.title
      const morning = ROWS.filter((r) => r.shift_code === 'morning')
      const { rerender } = renderSheet({ rows: morning, shiftCode: 'morning' })

      act(() => window.dispatchEvent(new Event('beforeprint')))

      // The day is on a 30-second staleTime, so a payload can land while the
      // dialog is open and change the rows the name is built from. The dialog
      // already has the name it was given; what must never happen is the tab
      // reverting to the app title, which is the name the PDF would be saved
      // under. The next print picks up the new one.
      const day = [...morning, ...ROWS.filter((r) => r.shift_code === 'night')]
      act(() => rerender(sheet({ rows: day, shiftCode: null })))

      expect(document.title).toBe('كشف البصمة العام_السرية الثانية_الأربعاء_صباحية_19-08-2026')
      expect(document.title).not.toBe(original)

      act(() => window.dispatchEvent(new Event('beforeprint')))
      expect(document.title).toBe('كشف البصمة العام_كل السرايا_الأربعاء_كل الورديات_19-08-2026')

      act(() => window.dispatchEvent(new Event('afterprint')))
      expect(document.title).toBe(original)
    })
  })
})
