import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import i18n from 'i18next'
import { bidi } from '@/lib/bidi'
import ar from '@/locales/ar.json'

import type { CorrectionTarget } from './attendanceCorrectionContext'

const { hasCapability } = vi.hoisted(() => ({ hasCapability: vi.fn<(cap: string) => boolean>() }))
vi.mock('@/lib/useCapabilities', () => ({ useCapabilities: () => ({ has: hasCapability }) }))
vi.mock('./QuickCorrection', () => ({
  QuickCorrection: ({ target }: { target: CorrectionTarget | null }) =>
    target ? <div role="dialog">{target.employeeName} · {target.operationalDate} · {target.shiftCode} · {target.caseId}</div> : null,
}))
vi.mock('./AttendanceCorrectionDrawer', () => ({ AttendanceCorrectionDrawer: () => null }))

import { AttendanceCorrectionProvider } from './AttendanceCorrectionEntry'
import type { AttendanceRow } from './attendanceModel'
import { BoardView } from './BoardView'

const now = new Date('2026-11-18T07:40:00Z')
function row(overrides: Partial<AttendanceRow> = {}): AttendanceRow {
  return {
    corrected: false,
    case_id: 42, employee_id: 'G-1042', name_en: 'Ahmed Ali', name_ar: 'أحمد علي',
    duty_unit: 'First Company', duty_post: 'Main Gate', shift_code: 'morning',
    scheduled_start_at: '2026-11-18T03:00:00Z', scheduled_end_at: '2026-11-18T11:00:00Z',
    judgment_due_at: '2026-11-18T13:00:00Z', absence_due_at: '2026-11-18T04:00:00Z',
    first_punch_at: '2026-11-18T02:58:00Z', last_punch_at: '2026-11-18T02:58:00Z',
    final_out_at: null, punch_count: 1, late_minutes: 0, grace_minutes: 30,
    presence_state: 'on_duty', on_leave: false, ...overrides,
  }
}
function renderBoard(rows: AttendanceRow[] = [row()]) {
  const onOpenEmployee = vi.fn()
  const result = render(<AttendanceCorrectionProvider><BoardView rows={rows} now={now} operationalDate="2026-11-18" onOpenEmployee={onOpenEmployee} /></AttendanceCorrectionProvider>)
  return { ...result, onOpenEmployee }
}
beforeEach(() => hasCapability.mockReturnValue(true))
afterEach(async () => { await i18n.changeLanguage('en') })

describe('BoardView', () => {
  it('gives every tile a visible verdict and a complete accessible name and tooltip', () => {
    const { container } = renderBoard()
    const tile = screen.getByRole('button', { name: /Open employee file.*Ahmed Ali/ })
    expect(tile).toHaveAccessibleName(`Open employee file · Ahmed Ali · ${bidi('G-1042')} · ${bidi('2026-11-18')} · Morning · On site · In 06:58 · Out —`)
    expect(tile).toHaveAttribute('title', `Ahmed Ali · ${bidi('G-1042')} · ${bidi('2026-11-18')} · Morning · On site · In 06:58 · Out —`)
    expect(tile).toHaveTextContent('On site')
    expect(tile).toHaveTextContent('In 06:58')
    expect(tile).toHaveTextContent('Out —')
    expect(tile).not.toHaveTextContent('15:00')
    expect(tile).toHaveClass('min-h-[44px]')
    expect(container.querySelector('[data-on-site="true"]')).toBeInTheDocument()
    expect(screen.queryByText('Colour marks only trouble')).not.toBeInTheDocument()
  })

  it('distinguishes National Service from leave subtype and excludes both from due', () => {
    const { container } = renderBoard([
      row({ on_leave: true, leave_kind: 'national_service', first_punch_at: null, punch_count: 0 }),
      row({ employee_id: 'G-1043', name_en: 'Hajj Person', on_leave: true, leave_kind: 'other', leave_label: 'Hajj Leave', first_punch_at: null, punch_count: 0 }),
    ])
    expect(container.querySelector('[data-state="national_service"]')).toBeInTheDocument()
    expect(screen.getByText('National Service')).toBeInTheDocument()
    expect(screen.getByText('On leave · Hajj Leave')).toBeInTheDocument()
    expect(screen.getByText('National Service: 1')).toBeInTheDocument()
    expect(screen.getByText('On leave: 1')).toBeInTheDocument()
    expect(screen.getByTestId('attendance-board-post')).toHaveTextContent('0/0 +2')
  })

  it.each([
    ['en', 'On leave'],
    ['ar', 'في إجازة'],
  ])('does not expose an untranslated leave subtype in %s', async (language, label) => {
    i18n.addResourceBundle('ar', 'translation', ar)
    await i18n.changeLanguage(language)
    const { container } = renderBoard([
      row({ on_leave: true, leave_kind: 'other', leave_label: 'Unknown Leave', punch_count: 0, first_punch_at: null }),
    ])
    expect(screen.getByText(label)).toBeInTheDocument()
    expect(container).not.toHaveTextContent('Unknown Leave')
    expect(screen.getByRole('button', { name: /^(Open employee file|فتح ملف الموظف)/ })).not.toHaveAttribute('title', expect.stringContaining('Unknown Leave'))
  })

  it('keeps two directionless punches on site without inventing a departure', () => {
    const { container } = renderBoard([row({ punch_count: 2, last_punch_at: '2026-11-18T07:30:00Z' })])
    expect(screen.getByRole('button', { name: /Open employee file/ })).toHaveAccessibleName(/On site · In 06:58 · Out —/)
    expect(container.querySelector('[data-on-site="true"]')).toBeInTheDocument()
  })

  it('shows the evaluated departure without an on-site halo', () => {
    const { container } = renderBoard([row({
      punch_count: 2,
      last_punch_at: '2026-11-18T07:30:00Z',
      final_out_at: '2026-11-18T07:30:00Z',
    })])
    expect(screen.getByRole('button', { name: /Open employee file/ })).toHaveAccessibleName(/Left · In 06:58 · Out 11:30/)
    expect(container.querySelector('[data-on-site]')).not.toBeInTheDocument()
  })

  it('shows minutes past grace beside In for a late arrival', () => {
    renderBoard([row({ late_minutes: 44, first_punch_at: '2026-11-18T03:44:00Z' })])
    expect(screen.getByRole('button', { name: /Open employee file/ })).toHaveTextContent(/In 07:44\s*\+14 min/)
    expect(screen.getByText('Late past grace')).toBeInTheDocument()
  })

  it('has a separate correction trigger with the full employee day target', async () => {
    const user = userEvent.setup()
    const { onOpenEmployee } = renderBoard()
    const correction = screen.getByTestId('attendance-correct-trigger')
    expect(correction).toHaveClass('h-[44px]', 'w-[44px]')
    await user.click(correction)
    expect(screen.getByRole('dialog')).toHaveTextContent('Ahmed Ali · 2026-11-18 · morning · 42')
    expect(onOpenEmployee).not.toHaveBeenCalled()
    await user.click(screen.getByRole('button', { name: /Open employee file/ }))
    expect(onOpenEmployee).toHaveBeenCalledWith('G-1042')
  })

  it('hides correction without its capability, not the employee tile', () => {
    hasCapability.mockImplementation((cap) => cap !== 'workforce.attendance.correct')
    renderBoard()
    expect(screen.queryByTestId('attendance-correct-trigger')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Open employee file/ })).toBeInTheDocument()
  })

  it('names Arabic tiles with the shift, state and both actual punch bounds', async () => {
    i18n.addResourceBundle('ar', 'translation', ar)
    await i18n.changeLanguage('ar')
    renderBoard([row({ on_leave: true, leave_kind: 'national_service', punch_count: 0, first_punch_at: null })])
    const tile = screen.getByRole('button', { name: /فتح ملف الموظف.*أحمد علي/ })
    expect(tile).toHaveAccessibleName(/الخدمة الوطنية · دخول — · خروج —/)
    expect(screen.getByText('الخدمة الوطنية: 1')).toBeInTheDocument()
    expect(screen.getByText('G-1042')).toHaveAttribute('dir', 'ltr')
  })
})
