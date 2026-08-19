/**
 * Pure helpers behind every Attendance view.
 *
 * The Register, the Board and the Timeline are three projections of one day
 * payload (`GET /workforce/attendance/day`), so every rule that decides what a
 * row *means* lives here once, with no React and no i18n.
 *
 * Two rules are load-bearing and easy to get wrong:
 *   • a window that has not opened yet is `pending`, never `missing` — a night
 *     shift before 21:00 is not an absence;
 *   • approved leave leaves the denominator, so a post of 4 with one person on
 *     leave is at full strength on 3 (`3/3 +1 leave`), never short-handed on 4.
 */

import type { AttendanceDayRow } from '@/lib/api'

export type AttendanceRow = AttendanceDayRow

/** What a row means once policy and clock are applied. */
export type RowState = 'verified' | 'late' | 'single' | 'missing' | 'leave' | 'pending'

export const ROW_STATE_ORDER: readonly RowState[] = [
  'missing',
  'single',
  'late',
  'verified',
  'leave',
  'pending',
]

/** Minutes past the scheduled start beyond which an arrival counts as late. */
export const DEFAULT_GRACE_MINUTES = 30

export interface StateInput {
  /**
   * The instant to judge against — normally `new Date()`.
   *
   * Openness is decided PER ROW, never per day: on the rotation's double day a
   * company works the morning and the night window, so a whole-day flag would
   * declare the not-yet-started night shift absent. That is the most damaging
   * mistake this module can make, because it manufactures absences for people
   * whose shift has not begun.
   */
  now: Date
  graceMinutes?: number
}

/** Whether this row's own scheduled window has started. */
export function isRowWindowOpen(row: AttendanceRow, now: Date): boolean {
  const start = parseInstant(row.scheduled_start_at)
  return start !== null && start <= now.getTime()
}

export function rowState(row: AttendanceRow, { now, graceMinutes = DEFAULT_GRACE_MINUTES }: StateInput): RowState {
  if (row.on_leave || row.presence_state === 'excused_leave') return 'leave'
  // Order matters: an unopened window must never read as an absence, even
  // though it has no punches yet.
  if (!isRowWindowOpen(row, now) && row.punch_count === 0) return 'pending'
  if (row.punch_count === 0) return 'missing'
  if (row.punch_count === 1) return 'single'
  if ((row.late_minutes ?? 0) > graceMinutes) return 'late'
  return 'verified'
}

/** True when a row needs a human decision. */
export function needsDecision(state: RowState): boolean {
  return state === 'missing' || state === 'single' || state === 'late'
}

/** Worst first: no punch, then single punch, then late by descending minutes. */
export function orderByAttention(rows: readonly AttendanceRow[], input: StateInput): AttendanceRow[] {
  return [...rows].sort((a, b) => {
    const rank = ROW_STATE_ORDER.indexOf(rowState(a, input)) - ROW_STATE_ORDER.indexOf(rowState(b, input))
    if (rank !== 0) return rank
    const late = (b.late_minutes ?? 0) - (a.late_minutes ?? 0)
    if (late !== 0) return late
    return a.employee_id.localeCompare(b.employee_id)
  })
}

const UNASSIGNED = '—'

/** `unit → post → rows`, insertion-ordered by first appearance. */
export function groupByUnitAndPost(
  rows: readonly AttendanceRow[],
): Map<string, Map<string, AttendanceRow[]>> {
  const units = new Map<string, Map<string, AttendanceRow[]>>()
  for (const row of rows) {
    const unit = row.duty_unit?.trim() || UNASSIGNED
    const post = row.duty_post?.trim() || UNASSIGNED
    const posts = units.get(unit) ?? new Map<string, AttendanceRow[]>()
    units.set(unit, posts)
    posts.set(post, [...(posts.get(post) ?? []), row])
  }
  return units
}

/**
 * Split a day into its shifts, earliest scheduled start first.
 *
 * Grouping by unit alone is not enough: on the rotation's double day one company
 * works BOTH the morning and the night window, so a single unit section would
 * mix two windows under the same post headings and print one of them with the
 * wrong times.
 */
export function splitByShift(rows: readonly AttendanceRow[]): Array<[string, AttendanceRow[]]> {
  const shifts = new Map<string, AttendanceRow[]>()
  for (const row of rows) {
    const code = row.shift_code ?? UNASSIGNED
    shifts.set(code, [...(shifts.get(code) ?? []), row])
  }
  return [...shifts.entries()].sort(([, a], [, b]) => {
    const first = parseInstant(a[0]?.scheduled_start_at) ?? 0
    const second = parseInstant(b[0]?.scheduled_start_at) ?? 0
    return first - second
  })
}

export interface PostSummary {
  /** People expected to appear: headcount minus approved leave. */
  due: number
  seen: number
  leave: number
  exceptions: number
}

export function postSummary(rows: readonly AttendanceRow[], input: StateInput): PostSummary {
  let leave = 0
  let seen = 0
  let exceptions = 0
  for (const row of rows) {
    const state = rowState(row, input)
    if (state === 'leave') {
      leave += 1
      continue
    }
    if (row.punch_count > 0) seen += 1
    if (needsDecision(state)) exceptions += 1
  }
  return { due: rows.length - leave, seen, leave, exceptions }
}

export interface ShiftCount {
  seen: number
  due: number
}

/** Per-shift `seen/due`, so the toolbar can show the cost of switching. */
export function shiftCounts(rows: readonly AttendanceRow[], input: StateInput): Record<string, ShiftCount> {
  const counts: Record<string, ShiftCount> = {}
  for (const row of rows) {
    const code = row.shift_code ?? UNASSIGNED
    const entry = counts[code] ?? { seen: 0, due: 0 }
    if (rowState(row, input) === 'leave') {
      counts[code] = entry
      continue
    }
    entry.due += 1
    if (row.punch_count > 0) entry.seen += 1
    counts[code] = entry
  }
  return counts
}

/**
 * Parse an instant from the API.
 *
 * The backend stores and returns UTC-naive timestamps (`2026-08-19T01:00:00`,
 * no offset). `Date.parse` reads a bare date-time as LOCAL time, which on this
 * site's UTC+4 machines shifts every window four hours earlier and makes a
 * not-yet-open shift look open. Always append the `Z` the payload omits.
 */
export function parseInstant(iso: string | null | undefined): number | null {
  if (!iso) return null
  const at = Date.parse(iso.endsWith('Z') || /[+-]\d\d:\d\d$/.test(iso) ? iso : `${iso}Z`)
  return Number.isNaN(at) ? null : at
}

/** Signed minutes between the scheduled start and the first punch; null with no punch. */
export function arrivalOffsetMinutes(row: AttendanceRow): number | null {
  const first = parseInstant(row.first_punch_at)
  const start = parseInstant(row.scheduled_start_at)
  if (first === null || start === null) return null
  return Math.round((first - start) / 60_000)
}

/**
 * Whether ANY row's window has started.
 *
 * Only for page-level copy ("this window has not opened yet"). Never feed this
 * into `rowState`: openness is a per-row fact — see `isRowWindowOpen`.
 */
export function isWindowOpen(rows: readonly AttendanceRow[], now: Date): boolean {
  return rows.some((row) => isRowWindowOpen(row, now))
}

/** ISO date (`YYYY-MM-DD`) shifted by whole days, in local time. */
export function shiftIsoDate(iso: string, days: number): string {
  const [year, month, day] = iso.split('-').map(Number)
  const at = new Date(year, (month ?? 1) - 1, day ?? 1)
  at.setDate(at.getDate() + days)
  const pad = (value: number): string => String(value).padStart(2, '0')
  return `${at.getFullYear()}-${pad(at.getMonth() + 1)}-${pad(at.getDate())}`
}

/** `HH:MM` in the site's timezone, from an ISO instant. */
export function siteTime(iso: string | null | undefined): string {
  const at = parseInstant(iso)
  if (at === null) return '—'
  return new Date(at).toLocaleTimeString('en-GB', {
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'Asia/Dubai',
    hour12: false,
  })
}
