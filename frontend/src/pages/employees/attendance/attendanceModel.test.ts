/**
 * attendanceModel — the rules every Attendance view shares.
 *
 * Each test pins a rule that is wrong by default if nobody writes it down: an
 * arrival inside the grace is not late, a start with no punch is an absence only
 * once twice the grace has passed, a punch after that boundary is a late arrival
 * rather than an absence, one punch mid-duty is not a missing pair, approved
 * leave leaves the denominator, and the attention order is
 * absent → unpaired → late-descending.
 */
import { describe, expect, it } from 'vitest'

import type { AttendanceRow } from './attendanceModel'
import {
  arrivalOffsetMinutes,
  groupByUnitAndPost,
  isWindowOpen,
  minutesPastGrace,
  needsDecision,
  orderByAttention,
  postSummary,
  rowState,
  shiftCounts,
  shiftIsoDate,
  siteTime,
} from './attendanceModel'

// The morning duty runs 01:00Z-09:00Z with thirty minutes of grace, so the
// absence boundary - twice the grace - falls at 02:00Z and the verdict on its
// pairing falls due at 11:00Z. Every one of those numbers arrives from the
// server on the row itself.
const SETTLED = { now: new Date('2026-08-19T12:00:00Z') }
const RUNNING = { now: new Date('2026-08-19T06:00:00Z') }
const INSIDE_GRACE_WINDOW = { now: new Date('2026-08-19T01:20:00Z') }
const BEFORE_ABSENCE = { now: new Date('2026-08-19T01:45:00Z') }
const BEFORE_START = { now: new Date('2026-08-19T00:00:00Z') }

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
    grace_minutes: 30,
    absence_due_at: '2026-08-19T02:00:00',
    judgment_due_at: '2026-08-19T11:00:00',
    on_leave: false,
    ...overrides,
  } as AttendanceRow
}

describe('rowState', () => {
  it('reads a paired, on-time day as verified', () => {
    expect(rowState(row(), SETTLED)).toBe('verified')
  })

  it('marks an arrival inside the grace without calling it late', () => {
    // The whole point of a grace: 01:20 against an 01:00 start is noted in
    // yellow and costs the person nothing.
    const inGrace = row({ late_minutes: 20 })
    expect(rowState(inGrace, SETTLED)).toBe('grace')
    expect(needsDecision(rowState(inGrace, SETTLED))).toBe(false)
    expect(minutesPastGrace(inGrace)).toBe(0)
  })

  it('reads late past the grace, and counts the minutes from the grace', () => {
    const late = row({ late_minutes: 44 })
    expect(rowState(late, SETTLED)).toBe('late')
    expect(minutesPastGrace(late)).toBe(14)
  })

  it('calls a start with no punch absent once twice the grace has passed', () => {
    const noPunch = row({ punch_count: 0, first_punch_at: null, last_punch_at: null })
    expect(rowState(noPunch, BEFORE_START)).toBe('pending')
    expect(rowState(noPunch, INSIDE_GRACE_WINDOW)).toBe('pending')
    expect(rowState(noPunch, BEFORE_ABSENCE)).toBe('pending')
    expect(rowState(noPunch, RUNNING)).toBe('absent')
    expect(rowState(noPunch, SETTLED)).toBe('absent')
  })

  it('reads a punch after the absence boundary as late, never as absent', () => {
    // Absence is provisional: the person who walks in three hours into the duty
    // is a very late arrival, and calling that "unpaired" or "absent" would hide
    // the hours behind the wrong word.
    const veryLate = row({
      punch_count: 1,
      first_punch_at: '2026-08-19T04:00:00',
      last_punch_at: null,
      late_minutes: 180,
    })
    expect(rowState(veryLate, RUNNING)).toBe('late')
    expect(rowState(veryLate, SETTLED)).toBe('late')
    expect(minutesPastGrace(veryLate)).toBe(150)
  })

  it('holds pairing until the duty is over', () => {
    // One punch mid-duty is an arrival, not a missing checkout: on this site
    // that describes every person who is currently at their post.
    const arrivedOnly = row({ punch_count: 1, last_punch_at: null })
    expect(rowState(arrivedOnly, RUNNING)).toBe('verified')
    expect(needsDecision(rowState(arrivedOnly, RUNNING))).toBe(false)
    expect(rowState(arrivedOnly, SETTLED)).toBe('unpaired')
  })

  it('judges each row against its OWN duty on the double day', () => {
    // The rotation's double day: the same company works morning and night. At
    // 16:00 Dubai the morning start went unanswered but the night duty has not
    // even begun. A whole-day flag would call the night crew absent.
    const nowAt4pmDubai = { now: new Date('2026-08-19T12:00:00Z') }
    const morning = row({ punch_count: 0, first_punch_at: null, last_punch_at: null })
    const night = row({
      shift_code: 'night',
      scheduled_start_at: '2026-08-19T17:00:00',
      scheduled_end_at: '2026-08-20T01:00:00',
      absence_due_at: '2026-08-19T18:00:00',
      judgment_due_at: '2026-08-20T03:00:00',
      punch_count: 0,
      first_punch_at: null,
      last_punch_at: null,
    })

    expect(rowState(morning, nowAt4pmDubai)).toBe('absent')
    expect(rowState(night, nowAt4pmDubai)).toBe('pending')
  })

  it('never judges a row with no policy behind it', () => {
    const noPolicy = row({
      grace_minutes: null,
      absence_due_at: null,
      judgment_due_at: null,
      punch_count: 0,
      first_punch_at: null,
    })
    expect(rowState(noPolicy, SETTLED)).toBe('pending')
  })

  it('reads approved leave as leave whichever way the flag arrives', () => {
    expect(rowState(row({ on_leave: true, punch_count: 0 }), SETTLED)).toBe('leave')
    expect(
      rowState(row({ presence_state: 'excused_leave', punch_count: 0 }), SETTLED),
    ).toBe('leave')
  })
})

describe('needsDecision', () => {
  it('flags only the states a human must resolve', () => {
    expect(['absent', 'unpaired', 'late'].map((s) => needsDecision(s as never))).toEqual([
      true,
      true,
      true,
    ])
    // Inside the grace is information, not work: it must never enter the queue.
    expect(['verified', 'grace', 'leave', 'pending'].map((s) => needsDecision(s as never))).toEqual([
      false,
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

    expect(postSummary(rows, SETTLED)).toEqual({ due: 3, seen: 3, leave: 1, exceptions: 0 })
  })

  it('counts each exception once', () => {
    const rows = [
      row({ employee_id: 'A' }),
      row({ employee_id: 'B', punch_count: 0, first_punch_at: null }),
      row({ employee_id: 'C', punch_count: 1, last_punch_at: null }),
      row({ employee_id: 'D', late_minutes: 47 }),
    ]

    expect(postSummary(rows, SETTLED)).toMatchObject({ due: 4, exceptions: 3 })
  })
})

describe('orderByAttention', () => {
  it('sorts absent, then unpaired, then late by descending minutes', () => {
    const rows = [
      row({ employee_id: 'ok' }),
      row({ employee_id: 'late-small', late_minutes: 35 }),
      row({ employee_id: 'absent', punch_count: 0, first_punch_at: null }),
      row({ employee_id: 'late-big', late_minutes: 62 }),
      row({ employee_id: 'unpaired', punch_count: 1, last_punch_at: null }),
      row({ employee_id: 'leave', on_leave: true, punch_count: 0 }),
    ]

    expect(orderByAttention(rows, SETTLED).map((r) => r.employee_id)).toEqual([
      'absent',
      'unpaired',
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

    expect(shiftCounts(rows, SETTLED)).toEqual({
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
