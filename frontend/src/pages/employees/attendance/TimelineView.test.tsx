import { fireEvent, render, screen, within } from '@testing-library/react'
import i18n from 'i18next'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { AttendanceException } from '@/lib/api'
import ar from '@/locales/ar.json'

const { allowed, correctionTarget } = vi.hoisted(() => ({ allowed: { correct: true }, correctionTarget: vi.fn() }))

vi.mock('@/lib/useCapabilities', () => ({
  useCapabilities: () => ({ has: (cap: string) => cap !== 'workforce.attendance.correct' || allowed.correct }),
}))
vi.mock('./AttendanceCorrectionDrawer', () => ({ AttendanceCorrectionDrawer: () => null }))
vi.mock('./QuickCorrection', () => ({
  QuickCorrection: ({ target }: { target: { caseId: number } | null }) => {
    if (target) correctionTarget(target)
    return target ? <div role="dialog">Correction {target.caseId}</div> : null
  },
}))

import { AttendanceCorrectionProvider } from './AttendanceCorrectionEntry'
import { AttentionQueue } from './AttentionQueue'
import { TimelineView } from './TimelineView'
import type { AttendanceRow } from './attendanceModel'

const NOW = new Date('2026-11-18T07:40:00Z')
const DATE = '2026-11-18'
const openEmployee = vi.fn()

function row(overrides: Partial<AttendanceRow> = {}): AttendanceRow {
  return {
    case_id: 42,
    employee_id: 'G1042',
    name_en: 'Ahmed Ali',
    name_ar: 'أحمد علي',
    duty_unit: 'السرية الأولى',
    duty_post: 'البوابة الرئيسية',
    shift_code: 'morning',
    scheduled_start_at: '2026-11-18T03:00:00Z',
    scheduled_end_at: '2026-11-18T11:00:00Z',
    absence_due_at: '2026-11-18T04:00:00Z',
    judgment_due_at: '2026-11-18T13:00:00Z',
    first_punch_at: '2026-11-18T03:10:00Z',
    last_punch_at: '2026-11-18T03:10:00Z',
    punch_count: 1,
    presence_state: 'on_duty',
    on_leave: false,
    grace_minutes: 30,
    ...overrides,
  }
}

function timeline(rows: AttendanceRow[]) {
  return render(
    <AttendanceCorrectionProvider>
      <TimelineView rows={rows} now={NOW} operationalDate={DATE} onOpenEmployee={openEmployee} />
    </AttendanceCorrectionProvider>,
  )
}

beforeEach(async () => {
  allowed.correct = true
  correctionTarget.mockClear()
  openEmployee.mockClear()
  i18n.addResourceBundle('ar', 'translation', ar, true, true)
  await i18n.changeLanguage('en')
})
afterEach(async () => { await i18n.changeLanguage('en') })

describe('TimelineView', () => {
  it('draws actual In to Out, preferring final out, using only logical inline positions', () => {
    const { container } = timeline([row({ final_out_at: '2026-11-18T10:00:00Z' })])
    const bar = screen.getByTestId('attendance-timeline-bar')
    expect(parseFloat(bar.style.insetInlineStart)).toBeCloseTo(55 / 570 * 100)
    expect(parseFloat(bar.style.width)).toBeCloseTo(410 / 570 * 100)
    for (const positioned of container.querySelectorAll<HTMLElement>('[style]')) {
      expect(positioned.style.left).toBe('')
    }
    const person = screen.getByRole('button', { name: /Ahmed Ali.*Morning.*Left.*In 07:10.*Out 14:00/ })
    expect(person).toHaveClass('min-h-11')
    expect(person.querySelector('[data-on-site="true"]')).toBeNull()
    fireEvent.click(person)
    expect(openEmployee).toHaveBeenCalledWith('G1042')
  })

  it('extends only a currently on-site row to now and leaves missing Out as a dash', () => {
    timeline([row()])
    const bar = screen.getByTestId('attendance-timeline-bar')
    expect(parseFloat(bar.style.width)).toBeCloseTo(270 / 570 * 100)
    const person = screen.getByRole('button', { name: /Ahmed Ali.*On site.*In 07:10.*Out —/ })
    expect(person.querySelector('[data-on-site="true"]')).not.toBeNull()
  })

  it.each([
    ['en', '2026-11-18T03:10:00Z', '+10m'],
    ['ar', '2026-11-18T03:10:00Z', '+10 د'],
    ['ar', '2026-11-18T02:50:00Z', '−10 د'],
  ])('localizes the isolated median offset in %s at %s', async (language, first_punch_at, expected) => {
    await i18n.changeLanguage(language)
    timeline([row({ first_punch_at, last_punch_at: first_punch_at })])
    expect(screen.getByText(expected)).toHaveAttribute('dir', 'ltr')
  })

  it('keeps every named person, blue leave subtype and purple National Service visible without punches', () => {
    timeline([
      row({ punch_count: 0, first_punch_at: null, last_punch_at: null, on_leave: true, leave_kind: 'national_service' }),
      row({ case_id: 43, employee_id: 'G1043', name_en: 'Salem Obaid', punch_count: 0, first_punch_at: null, last_punch_at: null, on_leave: true, leave_kind: 'other', leave_label: 'Hajj Leave' }),
    ])
    const national = screen.getByRole('button', { name: /Ahmed Ali.*National Service/ })
    const leave = screen.getByRole('button', { name: /Salem Obaid.*On leave · Hajj Leave/ })
    expect(national.querySelector('[data-state="national_service"]')).toHaveClass('bg-smart')
    expect(leave.querySelector('[data-state="leave"]')).toHaveClass('bg-info')
    expect(screen.queryByTestId('attendance-timeline-bar')).toBeNull()
    expect(screen.getAllByRole('listitem')).toHaveLength(2)
    expect(screen.queryByTestId('attendance-legend')).toBeNull()
  })

  it('opens correction for the selected case and hides the trigger without the correction capability', () => {
    const { unmount } = timeline([row()])
    fireEvent.click(screen.getByTestId('attendance-correct-trigger'))
    expect(screen.getByRole('dialog')).toHaveTextContent('Correction 42')
    expect(correctionTarget).toHaveBeenLastCalledWith(expect.objectContaining({ caseId: 42, employeeId: 'G1042', operationalDate: DATE, shiftCode: 'morning' }))
    expect(openEmployee).not.toHaveBeenCalled()
    unmount()
    allowed.correct = false
    timeline([row()])
    expect(screen.queryByTestId('attendance-correct-trigger')).toBeNull()
  })

  it('keeps the mirrored axis logical and isolates times and identifiers in Arabic', async () => {
    await i18n.changeLanguage('ar')
    const { container } = timeline([row({ on_leave: true, leave_kind: 'other', leave_label: 'Hajj Leave', punch_count: 0, first_punch_at: null, last_punch_at: null })])
    expect(screen.getByRole('button', { name: /أحمد علي.*في إجازة حج/ })).toBeInTheDocument()
    expect(container.querySelector('bdi[dir="ltr"]')).toBeInTheDocument()
    expect(screen.getByTestId('attendance-timeline-grace-line').style.insetInlineStart).not.toBe('')
    expect(container.textContent).not.toContain('يسار')
  })
})

describe('AttentionQueue', () => {
  function queue(rows: AttendanceRow[], exceptionRows?: AttendanceException[], onReviewCase = vi.fn()) {
    render(
      <AttendanceCorrectionProvider>
        <AttentionQueue rows={rows} exceptionRows={exceptionRows} now={NOW} operationalDate={DATE} onOpenEmployee={openEmployee} onReviewCase={onReviewCase} />
      </AttendanceCorrectionProvider>,
    )
  }

  it('names the verdict beside its shared dot and keeps correction separate from file navigation', () => {
    queue([row({ late_minutes: 50 })])
    const item = screen.getByRole('listitem')
    expect(item).toHaveTextContent('Late past grace')
    expect(item.querySelector('[data-state="late"]')).toHaveClass('bg-warning')
    fireEvent.click(within(item).getByTestId('attendance-correct-trigger'))
    expect(correctionTarget).toHaveBeenLastCalledWith(expect.objectContaining({ caseId: 42, operationalDate: DATE }))
    expect(openEmployee).not.toHaveBeenCalled()
  })

  it('keeps the exception review callback and classifies using the matching day row', () => {
    const onReviewCase = vi.fn()
    queue([row({ late_minutes: 50 })], [{ case_id: 42, employee_id: 'G1042', name_en: 'Ahmed Ali', shift_code: 'morning', late_minutes: 20 }], onReviewCase)
    const item = screen.getByRole('listitem')
    expect(item).toHaveTextContent('Late past grace')
    expect(item.querySelector('[data-state="late"]')).not.toBeNull()
    fireEvent.click(within(item).getByRole('button', { name: 'Review Ahmed Ali' }))
    expect(onReviewCase).toHaveBeenCalledWith(42)
    expect(within(item).getByTestId('attendance-correct-trigger')).toBeInTheDocument()
  })

  it('hides all correction triggers without the capability, but still permits review', () => {
    allowed.correct = false
    queue([row({ late_minutes: 50 })], [{ case_id: 42, employee_id: 'G1042', name_en: 'Ahmed Ali' }])
    expect(screen.queryByTestId('attendance-correct-trigger')).toBeNull()
    expect(screen.getByRole('button', { name: 'Review Ahmed Ali' })).toBeInTheDocument()
  })
})
