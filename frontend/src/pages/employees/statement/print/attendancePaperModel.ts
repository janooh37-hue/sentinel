/**
 * What the attendance statement prints, derived from the employee's judged
 * days. Every verdict comes from the shared ladder (`rowState`), so the paper
 * and the Attendance tab cannot disagree about one day. Punch direction is
 * unknown: the paper shows the first and last punch, never in/out.
 */

import type { EmployeeAttendanceDay } from '@/lib/api'
import {
  minutesPastGrace,
  parseInstant,
  rowState,
  siteTime,
  type RowState,
} from '@/pages/employees/attendance/attendanceModel'

/** A case's printed state. `rest` is a day with no roster case, or one ruled off. */
export type PaperState = RowState | 'rest'

/** Worst first: one day can hold two shifts, and trouble wins the cell. */
const WORST_FIRST: readonly PaperState[] = ['absent', 'unpaired', 'late', 'grace', 'verified', 'pending', 'leave', 'rest']

export const EXCEPTION_STATES: readonly PaperState[] = ['late', 'absent', 'unpaired']

/** Every glyph the paper can print, in legend order. */
export const LEGEND_STATES: readonly PaperState[] = ['verified', 'grace', 'late', 'absent', 'unpaired', 'leave', 'pending', 'rest']

export interface PaperCase {
  date: string
  shiftCode: string | null
  state: PaperState
  /** `HH:MM` site time, Western digits. */
  firstPunch: string | null
  lastPunch: string | null
  /** The last punch fell after midnight of the operational date. */
  lastNextDay: boolean
  punchCount: number
  pastGrace: number
}

export interface PaperDay {
  date: string
  cases: PaperCase[]
  /** The worst state across the day's cases; `rest` when none. */
  state: PaperState
}

export interface AttendanceStats {
  scheduled: number
  onTime: number
  grace: number
  late: number
  lateMinutes: number
  absent: number
  single: number
  pending: number
  restDays: number
  leaveDays: number
  /** Share of judged shifts on time or inside grace; null with none judged. */
  punctuality: number | null
}

const siteDate = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Asia/Dubai',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
})

export function addDays(iso: string, days: number): string {
  const [y, m, d] = iso.split('-').map(Number)
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10)
}

function paperCase(day: EmployeeAttendanceDay, now: Date, canViewLeaveFacts: boolean): PaperCase | null {
  if (day.presence_state === 'off') return null
  const state = rowState(day, { now })
  // Same privacy rule as the tab: without leave access, leave and absence
  // verdicts are not this reader's to see.
  if (!canViewLeaveFacts && (state === 'leave' || state === 'absent')) return null
  const punches = (day.punches ?? [])
    .map((punch) => ({ iso: punch.occurred_at, at: parseInstant(punch.occurred_at) }))
    .filter((punch): punch is { iso: string; at: number } => punch.at !== null)
    .sort((a, b) => a.at - b.at)
  const first = punches[0]
  const last = punches.length > 1 ? punches[punches.length - 1] : undefined
  return {
    date: day.operational_date,
    shiftCode: day.shift_code ?? null,
    state,
    firstPunch: first ? siteTime(first.iso) : null,
    lastPunch: last ? siteTime(last.iso) : null,
    lastNextDay: last !== undefined && siteDate.format(new Date(last.at)) > day.operational_date,
    punchCount: day.punch_count,
    pastGrace: minutesPastGrace(day),
  }
}

/** One entry per calendar day in `[from, to]`, rest days included. */
export function paperDays(
  days: readonly EmployeeAttendanceDay[],
  from: string,
  to: string,
  now: Date,
  canViewLeaveFacts: boolean,
): PaperDay[] {
  const byDate = new Map<string, PaperCase[]>()
  for (const day of days) {
    if (day.operational_date < from || day.operational_date > to) continue
    const one = paperCase(day, now, canViewLeaveFacts)
    if (one) byDate.set(one.date, [...(byDate.get(one.date) ?? []), one])
  }
  const out: PaperDay[] = []
  for (let date = from; date <= to; date = addDays(date, 1)) {
    const cases = byDate.get(date) ?? []
    const state = cases.reduce<PaperState>(
      (worst, c) => (WORST_FIRST.indexOf(c.state) < WORST_FIRST.indexOf(worst) ? c.state : worst),
      'rest',
    )
    out.push({ date, cases, state })
  }
  return out
}

export function attendanceStats(days: readonly PaperDay[]): AttendanceStats {
  const stats: AttendanceStats = {
    scheduled: 0,
    onTime: 0,
    grace: 0,
    late: 0,
    lateMinutes: 0,
    absent: 0,
    single: 0,
    pending: 0,
    restDays: 0,
    leaveDays: 0,
    punctuality: null,
  }
  for (const day of days) {
    if (day.state === 'rest') stats.restDays += 1
    if (day.state === 'leave') stats.leaveDays += 1
    for (const c of day.cases) {
      if (c.state === 'leave') continue
      stats.scheduled += 1
      if (c.state === 'verified') stats.onTime += 1
      else if (c.state === 'grace') stats.grace += 1
      else if (c.state === 'late') {
        stats.late += 1
        stats.lateMinutes += c.pastGrace
      } else if (c.state === 'absent') stats.absent += 1
      else if (c.state === 'unpaired') stats.single += 1
      else if (c.state === 'pending') stats.pending += 1
    }
  }
  const judged = stats.scheduled - stats.pending
  stats.punctuality = judged === 0 ? null : Math.round(((stats.onTime + stats.grace) / judged) * 100)
  return stats
}

export function exceptionCases(days: readonly PaperDay[]): PaperCase[] {
  return days.flatMap((day) => day.cases.filter((c) => EXCEPTION_STATES.includes(c.state)))
}

/**
 * One month's grid: Saturday first in Arabic, Sunday first in English. Leading
 * and trailing cells are null so every week row closes with seven cells.
 */
export function calendarCells(yearMonth: string, language: 'ar' | 'en'): (string | null)[] {
  const [year, month] = yearMonth.split('-').map(Number)
  const firstWeekday = language === 'ar' ? 6 : 0
  const lead = (new Date(Date.UTC(year, month - 1, 1)).getUTCDay() - firstWeekday + 7) % 7
  const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate()
  const cells: (string | null)[] = Array.from({ length: lead }, () => null)
  for (let d = 1; d <= daysInMonth; d += 1) cells.push(`${yearMonth}-${String(d).padStart(2, '0')}`)
  while (cells.length % 7 !== 0) cells.push(null)
  return cells
}

/** Weekday indexes (0 = Sunday) in the order the grid prints them. */
export function weekdayOrder(language: 'ar' | 'en'): number[] {
  const first = language === 'ar' ? 6 : 0
  return Array.from({ length: 7 }, (_, i) => (first + i) % 7)
}

/** The `YYYY-MM` months a range touches, oldest first. */
export function monthsIn(from: string, to: string): string[] {
  const months: string[] = []
  let [y, m] = from.split('-').map(Number)
  const end = to.slice(0, 7)
  for (;;) {
    const ym = `${y}-${String(m).padStart(2, '0')}`
    if (ym > end) break
    months.push(ym)
    m += 1
    if (m > 12) {
      m = 1
      y += 1
    }
  }
  return months
}
