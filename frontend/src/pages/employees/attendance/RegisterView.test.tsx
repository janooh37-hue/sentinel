import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import i18n from 'i18next'
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
import { RegisterView } from './RegisterView'

const now = new Date('2026-11-18T07:40:00Z')
function row(overrides: Partial<AttendanceRow> = {}): AttendanceRow {
  return {
    case_id: 42, employee_id: 'G-1042', name_en: 'Ahmed Ali', name_ar: 'أحمد علي',
    duty_unit: 'First Company', duty_post: 'Main Gate', shift_code: 'morning',
    scheduled_start_at: '2026-11-18T03:00:00Z', scheduled_end_at: '2026-11-18T11:00:00Z',
    judgment_due_at: '2026-11-18T13:00:00Z', absence_due_at: '2026-11-18T04:00:00Z',
    first_punch_at: '2026-11-18T02:58:00Z', last_punch_at: '2026-11-18T02:58:00Z',
    final_out_at: null, punch_count: 1, late_minutes: 0, grace_minutes: 30,
    presence_state: 'on_duty', on_leave: false, ...overrides,
  }
}
function renderRegister(rows: AttendanceRow[] = [row()]) {
  const onOpenEmployee = vi.fn()
  const result = render(<AttendanceCorrectionProvider><RegisterView rows={rows} now={now} operationalDate="2026-11-18" onOpenEmployee={onOpenEmployee} freshThrough="2026-11-18T07:35:00Z" /></AttendanceCorrectionProvider>)
  return { ...result, onOpenEmployee }
}
beforeEach(() => hasCapability.mockReturnValue(true))
afterEach(async () => { await i18n.changeLanguage('en') })

describe('RegisterView', () => {
  it('shows National Service and leave subtype as separate excused states', () => {
    const { container } = renderRegister([
      row({ on_leave: true, leave_kind: 'national_service', first_punch_at: null, punch_count: 0 }),
      row({ employee_id: 'G-1043', name_en: 'Hajj Person', on_leave: true, leave_kind: 'other', leave_label: 'Hajj Leave', first_punch_at: null, punch_count: 0 }),
    ])
    expect(container.querySelector('[data-state="national_service"]')).toBeInTheDocument()
    expect(screen.getAllByText('National Service').length).toBeGreaterThan(0)
    expect(screen.getByText('On leave · Hajj Leave')).toBeInTheDocument()
    const header = screen.getByTestId('attendance-register-unit').querySelector('header')!
    const national = within(header).getByText('National Service').parentElement!
    expect(national).toHaveTextContent('1')
    expect(screen.getByTestId('attendance-register-post')).toHaveTextContent('0/0 +2')
  })

  it('labels actual In and missing Out without substituting the schedule', () => {
    const { container } = renderRegister()
    const post = screen.getByTestId('attendance-register-post')
    expect(within(post).getByText('In').parentElement).toHaveTextContent('06:58')
    expect(within(post).getByText('Out').parentElement).toHaveTextContent('—')
    expect(screen.getByText('Scheduled shift').parentElement).toHaveTextContent('07:00 – 15:00')
    expect(container.querySelector('[data-on-site="true"]')).toBeInTheDocument()
    expect(screen.getByText('On site')).toBeInTheDocument()
    expect(container.querySelector('footer [data-on-site]')).not.toBeInTheDocument()
  })

  it('uses final Out over the latest punch and removes the halo for departure', () => {
    const { container } = renderRegister([row({ punch_count: 3, last_punch_at: '2026-11-18T07:20:00Z', final_out_at: '2026-11-18T07:30:00Z' })])
    expect(screen.getByText('Out').parentElement).toHaveTextContent('11:30')
    expect(screen.getByText('Left')).toBeInTheDocument()
    expect(container.querySelector('[data-on-site]')).not.toBeInTheDocument()
  })

  it('shows minutes past grace next to In', () => {
    renderRegister([row({ late_minutes: 44, first_punch_at: '2026-11-18T03:44:00Z' })])
    expect(screen.getByText('In').parentElement).toHaveTextContent(/07:44\s*\+14 min/)
    expect(screen.getByText('Late past grace')).toBeInTheDocument()
  })

  it('opens correction with the row target separately from the employee file', async () => {
    const user = userEvent.setup()
    const { onOpenEmployee } = renderRegister()
    await user.click(screen.getByTestId('attendance-correct-trigger'))
    expect(screen.getByRole('dialog')).toHaveTextContent('Ahmed Ali · 2026-11-18 · morning · 42')
    expect(onOpenEmployee).not.toHaveBeenCalled()
    await user.click(screen.getByRole('button', { name: /Open employee file.*Ahmed Ali/ }))
    expect(onOpenEmployee).toHaveBeenCalledWith('G-1042')
  })

  it('hides correction without the capability while keeping employee navigation', () => {
    hasCapability.mockImplementation((cap) => cap !== 'workforce.attendance.correct')
    renderRegister()
    expect(screen.queryByTestId('attendance-correct-trigger')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Open employee file.*Ahmed Ali/ })).toBeInTheDocument()
  })

  it('renders Arabic leave wording with isolated times and employee numbers', async () => {
    i18n.addResourceBundle('ar', 'translation', ar)
    await i18n.changeLanguage('ar')
    const { container } = renderRegister([row({ on_leave: true, leave_kind: 'other', leave_label: 'Hajj Leave', punch_count: 0, first_punch_at: null })])
    expect(screen.getByText('في إجازة حج')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /فتح ملف الموظف.*أحمد علي/ })).toBeInTheDocument()
    expect(container.querySelector('bdi[dir="ltr"]')).toHaveTextContent('07:00 – 15:00')
    expect(screen.getByText('G-1042')).toHaveAttribute('dir', 'ltr')
    expect(screen.getByText('دخول').parentElement).toHaveTextContent('—')
    expect(screen.getByText('خروج').parentElement).toHaveTextContent('—')
  })
})
