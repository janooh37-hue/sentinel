import { render, screen, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import i18n from '@/lib/i18n'

import type { AttendanceRow } from './attendanceModel'
import { OnSiteNowSummary } from './OnSiteNowSummary'

const now = new Date('2026-11-18T07:40:00Z')

function row(overrides: Partial<AttendanceRow> = {}): AttendanceRow {
  return {
    employee_id: 'G-1', name_en: 'Ahmed', name_ar: null,
    department: 'Security', duty_unit: 'A', duty_post: 'Gate', crew_code: 'A',
    shift_code: 'morning', presence_state: 'on_duty', reason_code: null,
    scheduled_start_at: '2026-11-18T03:00:00Z', scheduled_end_at: '2026-11-18T11:00:00Z',
    absence_due_at: '2026-11-18T04:00:00Z', judgment_due_at: '2026-11-18T13:00:00Z',
    first_punch_at: '2026-11-18T02:55:00Z', last_punch_at: '2026-11-18T02:55:00Z',
    final_out_at: null, punch_count: 1, case_id: 1, late_minutes: 0, grace_minutes: 30,
    on_leave: false, leave_kind: null, leave_label: null,
    ...overrides,
  }
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(now)
})

afterEach(async () => {
  vi.useRealTimers()
  await i18n.changeLanguage('en')
})

function countFor(label: string): HTMLElement {
  const term = screen.getByText(label, { selector: 'dt' })
  return within(term.parentElement!).getByRole('definition')
}

describe('OnSiteNowSummary', () => {
  it('counts people once across shifts, with separate leave and National Service totals', () => {
    render(<OnSiteNowSummary operationalDate="2026-11-18" now={now} rows={[
      row(),
      row({ shift_code: 'night' }),
      row({ employee_id: 'G-2', punch_count: 2, final_out_at: '2026-11-18T07:00:00Z' }),
      row({ employee_id: 'G-3', punch_count: 0, first_punch_at: null, last_punch_at: null, presence_state: 'absent' }),
      row({ employee_id: 'G-4', on_leave: true, leave_kind: 'annual', leave_label: 'Annual Leave' }),
      row({ employee_id: 'G-5', on_leave: true, leave_kind: 'national_service' }),
    ]} />)

    expect(screen.getByRole('region', { name: 'On site now' })).toHaveTextContent('5 people')
    for (const label of ['On site', 'Left', 'Not arrived', 'On leave', 'National Service']) {
      expect(countFor(label)).toHaveTextContent('1')
    }
    expect(screen.getByText('11:40').closest('bdi')).toHaveAttribute('dir', 'ltr')
    expect(countFor('On site').querySelector('bdi')).toHaveAttribute('dir', 'ltr')
  })

  it('uses a day record without any on-site-now claim for a past date', () => {
    render(<OnSiteNowSummary operationalDate="2026-11-17" now={now} rows={[row()]} />)
    expect(screen.getByRole('region', { name: 'Day summary' })).toBeInTheDocument()
    expect(screen.queryByText('On site now')).not.toBeInTheDocument()
    expect(screen.queryByText('On site', { selector: 'dt' })).not.toBeInTheDocument()
  })

  it('renders truthful zero totals for an empty filtered result', () => {
    render(<OnSiteNowSummary operationalDate="2026-11-18" now={now} rows={[]} />)
    expect(screen.getByRole('region', { name: 'On site now' })).toHaveTextContent('0 people')
    expect(countFor('On site')).toHaveTextContent('0')
  })

  it('provides Arabic labels and isolates the payload time and numbers', async () => {
    await i18n.changeLanguage('ar')
    render(<OnSiteNowSummary operationalDate="2026-11-18" now={now} rows={[row()]} />)
    expect(screen.getByRole('region', { name: 'الموجودون في الموقع الآن' })).toHaveTextContent('الموظفون: 1')
    expect(countFor('في الموقع')).toHaveTextContent('1')
    expect(screen.getByText('11:40').closest('bdi')).toHaveAttribute('dir', 'ltr')
  })
})
