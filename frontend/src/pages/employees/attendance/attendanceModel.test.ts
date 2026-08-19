/**
 * attendanceModel — the rules every Attendance view shares.
 *
 * Each test pins a rule that is wrong by default if nobody writes it down:
 * an unopened window is not an absence, one punch is not a verified span,
 * approved leave leaves the denominator, and the attention order is
 * no-punch → single-punch → late-descending.
 */
import { describe, expect, it } from 'vitest'

import type { AttendanceRow } from './attendanceModel'
import {
  arrivalOffsetMinutes,
  groupByUnitAndPost,
  isWindowOpen,
  needsDecision,
  orderByAttention,
  postSummary,
  rowState,
  shiftCounts,
  shiftIsoDate,
  siteTime,
} from './attendanceModel'

// Morning starts 01:00Z (05:00 Dubai); judge from after it, and from before it.
const OPEN = { now: new Date('2026-08-19T06:00:00Z') }
const CLOSED = { now: new Date('2026-08-19T00:00:00Z') }

function row(overrides: Partial<AttendanceRow> = {}): AttendanceRow {
  return {
    employee_id: 'G-9001',
    name_en: 'Factory Person',
    name_ar: null,
    department: 'الأمن',
    duty_unit: 'السرية الثانية',
    duty_post: 'البوابة الرئيسية',
    crew_code: 'crew_2',
    shift_code: 'morning',
    presence_state: 'completed',
    reason_code: null,
    scheduled_start_at: '2026-08-19T01:00:00',
    scheduled_end_at: '2026-08-19T09:00:00',
    first_punch_at: '2026-08-19T00:52:00',
    last_punch_at: '2026-08-19T09:06:00',
    punch_count: 2,
    late_minutes: 0,
    on_leave: false,
    ...overrides,
  } as AttendanceRow
}

describe('rowState', () => {
  it('reads a paired, on-time day as verified', () => {
    expect(rowState(row(), OPEN)).toBe('verified')
  })

  it('reads a single punch as single, never as verified', () => {
    expect(rowState(row({ punch_count: 1, last_punch_at: null }), OPEN)).toBe('single')
  })

  it('reads late only past the grace window', () => {
    expect(rowState(row({ late_minutes: 20 }), OPEN)).toBe('verified')
    expect(rowState(row({ late_minutes: 44 }), OPEN)).toBe('late')
  })

  it('treats an unopened window as pending, not missing', () => {
    const notStarted = row({ punch_count: 0, first_punch_at: null, last_punch_at: null })
    expect(rowState(notStarted, CLOSED)).toBe('pending')
    expect(rowState(notStarted, OPEN)).toBe('missing')
  })

  it('judges each row against its OWN window on the double day', () => {
    // The rotation's double day: the same company works morning and night, and
    // at 06:00 Dubai the night window (21:00) has not opened. A whole-day flag
    // would call the night crew absent — the bug this test exists to prevent.
    const nowAt6amDubai = { now: new Date('2026-08-19T02:00:00Z') }
    const morning = row({ punch_count: 0, first_punch_at: null, last_punch_at: null })
    const night = row({
      shift_code: 'night',
      scheduled_start_at: '2026-08-19T17:00:00',
      scheduled_end_at: '2026-08-20T01:00:00',
      punch_count: 0,
      first_punch_at: null,
      last_punch_at: null,
    })

    expect(rowState(morning, nowAt6amDubai)).toBe('missing')
    expect(rowState(night, nowAt6amDubai)).toBe('pending')
  })

  it('reads approved leave as leave whichever way the flag arrives', () => {
    expect(rowState(row({ on_leave: true, punch_count: 0 }), OPEN)).toBe('leave')
    expect(
      rowState(row({ presence_state: 'excused_leave', punch_count: 0 }), OPEN),
    ).toBe('leave')
  })
})

describe('needsDecision', () => {
  it('flags only the three states a human must resolve', () => {
    expect(['missing', 'single', 'late'].map((s) => needsDecision(s as never))).toEqual([
      true,
      true,
      true,
    ])
    expect(['verified', 'leave', 'pending'].map((s) => needsDecision(s as never))).toEqual([
      false,
      false,
      false,
    ])
  })
})

describe('postSummary', () => {
  it('removes approved leave from the denominator', () => {
    const rows = [
      row({ employee_id: 'A' }),
      row({ employee_id: 'B' }),
      row({ employee_id: 'C' }),
      row({ employee_id: 'D', on_leave: true, punch_count: 0 }),
    ]

    expect(postSummary(rows, OPEN)).toEqual({ due: 3, seen: 3, leave: 1, exceptions: 0 })
  })

  it('counts each exception once', () => {
    const rows = [
      row({ employee_id: 'A' }),
      row({ employee_id: 'B', punch_count: 0, first_punch_at: null }),
      row({ employee_id: 'C', punch_count: 1, last_punch_at: null }),
      row({ employee_id: 'D', late_minutes: 47 }),
    ]

    expect(postSummary(rows, OPEN)).toMatchObject({ due: 4, exceptions: 3 })
  })
})

describe('orderByAttention', () => {
  it('sorts no punch, then single punch, then late by descending minutes', () => {
    const rows = [
      row({ employee_id: 'ok' }),
      row({ employee_id: 'late-small', late_minutes: 35 }),
      row({ employee_id: 'missing', punch_count: 0, first_punch_at: null }),
      row({ employee_id: 'late-big', late_minutes: 62 }),
      row({ employee_id: 'single', punch_count: 1, last_punch_at: null }),
      row({ employee_id: 'leave', on_leave: true, punch_count: 0 }),
    ]

    expect(orderByAttention(rows, OPEN).map((r) => r.employee_id)).toEqual([
      'missing',
      'single',
      'late-big',
      'late-small',
      'ok',
      'leave',
    ])
  })
})

describe('groupByUnitAndPost', () => {
  it('nests posts inside their unit', () => {
    const grouped = groupByUnitAndPost([
      row({ employee_id: 'A', duty_post: 'البوابة الرئيسية' }),
      row({ employee_id: 'B', duty_post: 'التفتيش' }),
      row({ employee_id: 'C', duty_post: 'البوابة الرئيسية' }),
    ])

    const posts = grouped.get('السرية الثانية')
    expect([...(posts?.keys() ?? [])]).toEqual(['البوابة الرئيسية', 'التفتيش'])
    expect(posts?.get('البوابة الرئيسية')).toHaveLength(2)
  })
})

describe('arrivalOffsetMinutes', () => {
  it('is negative for an early arrival and null with no punch', () => {
    expect(arrivalOffsetMinutes(row())).toBe(-8)
    expect(arrivalOffsetMinutes(row({ first_punch_at: '2026-08-19T01:47:00' }))).toBe(47)
    expect(arrivalOffsetMinutes(row({ first_punch_at: null }))).toBeNull()
  })
})

describe('shiftCounts', () => {
  it('reports seen over due per shift, excluding leave', () => {
    const rows = [
      row({ employee_id: 'A', shift_code: 'morning' }),
      row({ employee_id: 'B', shift_code: 'morning', punch_count: 0, first_punch_at: null }),
      row({ employee_id: 'C', shift_code: 'night', punch_count: 0, first_punch_at: null }),
      row({ employee_id: 'D', shift_code: 'night', on_leave: true, punch_count: 0 }),
    ]

    expect(shiftCounts(rows, OPEN)).toEqual({
      morning: { seen: 1, due: 2 },
      night: { seen: 0, due: 1 },
    })
  })
})

describe('isWindowOpen', () => {
  it('is true once any scheduled start has passed', () => {
    const rows = [row({ scheduled_start_at: '2026-08-19T01:00:00' })]
    expect(isWindowOpen(rows, new Date('2026-08-19T02:00:00Z'))).toBe(true)
    expect(isWindowOpen(rows, new Date('2026-08-19T00:00:00Z'))).toBe(false)
  })

  it('reads naive API timestamps as UTC, not local time', () => {
    // Without the appended Z this is parsed as local time, which on a UTC+4
    // machine makes a not-yet-open window look four hours open.
    const rows = [row({ scheduled_start_at: '2026-08-19T01:00:00' })]
    expect(isWindowOpen(rows, new Date('2026-08-19T00:30:00Z'))).toBe(false)
  })
})

describe('date and time helpers', () => {
  it('steps ISO dates across month boundaries', () => {
    expect(shiftIsoDate('2026-08-19', -1)).toBe('2026-08-18')
    expect(shiftIsoDate('2026-08-31', 1)).toBe('2026-09-01')
    expect(shiftIsoDate('2026-09-01', -1)).toBe('2026-08-31')
  })

  it('renders punch instants in the site timezone', () => {
    // 00:52Z is 04:52 in Asia/Dubai — the register must print site wall time.
    expect(siteTime('2026-08-19T00:52:00')).toBe('04:52')
    expect(siteTime(null)).toBe('—')
  })
})
