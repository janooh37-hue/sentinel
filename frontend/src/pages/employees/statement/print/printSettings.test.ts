import { describe, expect, it } from 'vitest'

import { calendarCells, weekdayOrder } from './attendancePaperModel'
import {
  activitySearch,
  attendanceSearch,
  parseActivitySettings,
  parseAttendanceSettings,
  type ActivitySettings,
  type AttendanceSettings,
} from './printSettings'

const TODAY = '2026-10-27'

describe('activity setup <-> URL query', () => {
  it('round-trips every setting', () => {
    const settings: ActivitySettings = {
      preset: 'custom',
      from: '2026-02-03',
      to: '2026-09-30',
      cats: ['leave', 'document'],
      lang: 'ar',
      orient: 'landscape',
      summary: false,
      sign: true,
    }
    const search = activitySearch(settings)
    expect(parseActivitySettings(new URLSearchParams(search), TODAY, 'en')).toEqual(settings)
  })

  it('reads the keys the Activity tab writes, with defaults for the rest', () => {
    const parsed = parseActivitySettings(new URLSearchParams('period=last3&cats=violation,ledger'), TODAY, 'ar')
    expect(parsed).toMatchObject({
      preset: 'last3',
      from: '2026-07-27',
      to: TODAY,
      cats: ['violation', 'ledger'],
      lang: 'ar',
      orient: 'portrait',
      summary: true,
      sign: true,
    })
    // An empty list is "none", not "all".
    expect(parseActivitySettings(new URLSearchParams('cats='), TODAY, 'en').cats).toEqual([])
  })

  it('never prints past today', () => {
    const parsed = parseActivitySettings(new URLSearchParams('period=custom&from=2026-10-01&to=2027-01-01'), TODAY, 'en')
    expect(parsed.to).toBe(TODAY)
  })

  it('ignores impossible dates and falls back to the defaults', () => {
    const activity = parseActivitySettings(new URLSearchParams('period=custom&from=2026-02-30&to=2026-13-01'), TODAY, 'en')
    expect(activity).toMatchObject({ from: '2026-01-01', to: TODAY })
    const attendance = parseAttendanceSettings(new URLSearchParams('mode=custom&from=2026-02-30'), TODAY, 'en')
    expect(attendance).toMatchObject({ from: '2026-10-01', to: TODAY })
  })
})

describe('attendance setup <-> URL query', () => {
  it('round-trips every setting in each mode', () => {
    const base: Omit<AttendanceSettings, 'mode' | 'from' | 'to'> = {
      year: 2026,
      month: 8,
      quarter: 2,
      summary: false,
      calendar: true,
      exceptions: false,
      daily: true,
      dailyEx: true,
      punches: false,
      sign: false,
      lang: 'en',
      orient: 'landscape',
    }
    const cases: AttendanceSettings[] = [
      { ...base, mode: 'month', from: '2026-08-01', to: '2026-08-31' },
      { ...base, mode: 'quarter', from: '2026-04-01', to: '2026-06-30' },
      { ...base, mode: 'custom', from: '2026-03-05', to: '2026-05-20' },
    ]
    for (const settings of cases) {
      const parsed = parseAttendanceSettings(new URLSearchParams(attendanceSearch(settings)), TODAY, 'ar')
      expect(parsed).toMatchObject({ ...settings, year: parsed.year, month: parsed.month, quarter: parsed.quarter })
      expect(attendanceSearch(parsed)).toBe(attendanceSearch(settings))
    }
  })

  it('opens the month the Attendance tab links to, clamped to today', () => {
    const parsed = parseAttendanceSettings(new URLSearchParams('mode=month&y=2026&m=10'), TODAY, 'en')
    expect(parsed).toMatchObject({ mode: 'month', from: '2026-10-01', to: TODAY, calendar: true, daily: false })
  })
})

describe('calendar grid', () => {
  it('starts on Saturday in Arabic and Sunday in English', () => {
    expect(weekdayOrder('ar')).toEqual([6, 0, 1, 2, 3, 4, 5])
    expect(weekdayOrder('en')).toEqual([0, 1, 2, 3, 4, 5, 6])
  })

  it('closes the final week with empty cells', () => {
    // 1 Oct 2026 is a Thursday; 31 Oct a Saturday.
    const en = calendarCells('2026-10', 'en')
    const ar = calendarCells('2026-10', 'ar')
    for (const cells of [en, ar]) expect(cells.length % 7).toBe(0)
    expect(en.slice(0, 5)).toEqual([null, null, null, null, '2026-10-01'])
    expect(en.slice(-1)).toEqual(['2026-10-31'])
    expect(ar.slice(0, 6)).toEqual([null, null, null, null, null, '2026-10-01'])
    // Saturday 31 opens the last Arabic week, so six empty cells close it.
    expect(ar.slice(-7)).toEqual(['2026-10-31', null, null, null, null, null, null])
  })
})
