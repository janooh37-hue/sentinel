import { describe, expect, it } from 'vitest'

import type { EmployeeAttendanceDay } from '@/lib/api'

import { LEGEND_STATES, attendanceStats, exceptionCases, paperDays } from './attendancePaperModel'

const NOW = new Date('2026-11-18T12:00:00Z')

function day(overrides: Partial<EmployeeAttendanceDay> = {}): EmployeeAttendanceDay {
  return {
    corrected: false,
    operational_date: '2026-11-17',
    shift_code: 'morning',
    presence_state: 'excused_leave',
    leave_kind: 'national_service',
    punch_count: 0,
    punches: [],
    ...overrides,
  }
}

describe('National Service on attendance paper', () => {
  it('counts National Service and other leave as excused days, not scheduled or absent shifts', () => {
    const days = paperDays([
      day(),
      day({ operational_date: '2026-11-18', leave_kind: 'other', leave_label: 'Hajj Leave' }),
    ], '2026-11-16', '2026-11-18', NOW, true)
    expect(days.map((d) => d.state)).toEqual(['rest', 'national_service', 'leave'])
    expect(attendanceStats(days)).toMatchObject({ scheduled: 0, absent: 0, leaveDays: 2, restDays: 1, punctuality: null })
    expect(exceptionCases(days)).toEqual([])
    expect(LEGEND_STATES).toContain('national_service')
  })

  it('keeps the worked shift denominator on a two-shift day while excluding the excused shift', () => {
    const days = paperDays([
      day(),
      day({ shift_code: 'night', presence_state: 'completed', leave_kind: null, punch_count: 2 }),
    ], '2026-11-17', '2026-11-17', NOW, true)
    expect(days[0].state).toBe('verified')
    expect(attendanceStats(days)).toMatchObject({ scheduled: 1, onTime: 1, absent: 0, punctuality: 100 })
  })

  it('withholds National Service just like other leave without exposing it as a rest day', () => {
    const days = paperDays([day()], '2026-11-17', '2026-11-17', NOW, false)
    expect(days[0].state).toBe('withheld')
    expect(days[0].cases[0].state).toBe('withheld')
    expect(attendanceStats(days)).toMatchObject({ scheduled: 0, leaveDays: 0, restDays: 0, withheld: 1, punctuality: null })
  })
})
