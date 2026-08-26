/**
 * Pure helpers behind every Attendance view.
 *
 * The Register, the Board, the Timeline and one employee's month are
 * projections of the same judged day, so every rule that decides what a row
 * *means* lives here once, with no React and no i18n.
 *
 * Three rules are load-bearing and easy to get wrong:
 *   • the arrival ladder is the site's own: inside the grace is noted, past the
 *     grace is late, and a start that reaches twice the grace with no punch at
 *     all is an absence. Both boundaries arrive from the server per row, so the
 *     register can never judge by a different clock than the evaluator;
 *   • pairing a lone punch waits for `judgment_due_at`, so the guard who has
 *     arrived and not yet left is never an exception mid-duty;
 *   • approved leave leaves the denominator, so a post of 4 with one person on
 *     leave is at full strength on 3 (`3/3 +1 leave`), never short-handed on 4.
 */

import type { AttendanceDayRow } from '@/lib/api'

export type AttendanceRow = AttendanceDayRow

/**
 * What a row means once policy and clock are applied.
 *
 * `grace`, `late` and `absent` are the site's arrival ladder in order of
 * escalation. `unpaired` is not on that ladder: it is a punch that never got
 * its pair, which is a gap in the record rather than a lateness.
 */
export type RowState =
  | 'verified'
  | 'grace'
  | 'late'
  | 'unpaired'
  | 'absent'
  | 'leave'
  | 'pending'

export const ROW_STATE_ORDER: readonly RowState[] = [
  'absent',
  'unpaired',
  'late',
  'grace',
  'verified',
  'leave',
  'pending',
]

/**
 * Grace for a row that carries no policy of its own.
 *
 * Every judged row publishes `grace_minutes`, so this only covers a row whose
 * policy is missing. It matches the seeded default deliberately: a fallback that
 * differed from the installed policy would be a second, invisible rule.
 */
export const DEFAULT_GRACE_MINUTES = 30

/**
 * The judged day the ladder needs.
 *
 * Satisfied by both payloads that carry a verdict — a register row from
 * `GET /workforce/attendance/day` and a day from one employee's month — so the
 * whole product classifies attendance with one function instead of two that
 * drift.
 */
export interface JudgedDay {
  presence_state?: string | null
  punch_count: number
  late_minutes?: number | null
  grace_minutes?: number | null
  absence_due_at?: string | null
  judgment_due_at?: string | null
  on_leave?: boolean
}

export interface StateInput {
  /**
   * The instant to judge against — normally `new Date()`.
   *
   * Judgment is decided PER ROW, never per day: on the rotation's double day a
   * company works the morning and the night window, so a whole-day flag would
   * declare the not-yet-started night shift absent. That is the most damaging
   * mistake this module can make, because it manufactures absences for people
   * whose duty has not begun.
   */
  now: Date
  /** Fallback grace, used only for a row the server sent none for. */
  graceMinutes?: number
}

/** The grace this row was actually judged against. */
export function graceFor(row: JudgedDay, fallback?: number): number {
  return row.grace_minutes ?? fallback ?? DEFAULT_GRACE_MINUTES
}

/**
 * Minutes past the grace, from the raw arrival offset the API publishes.
 *
 * `late_minutes` counts from the scheduled start, so the grace comes off before
 * a number is shown: arriving 08:44 against an 08:00 start with thirty minutes
 * of grace is fourteen minutes late, not forty-four.
 */
export function minutesPastGrace(row: JudgedDay, input?: { graceMinutes?: number }): number {
  return Math.max(0, (row.late_minutes ?? 0) - graceFor(row, input?.graceMinutes))
}

/** One punch and a duty that is over: the pair never arrived. */
export function isUnpaired(row: JudgedDay, { now }: StateInput): boolean {
  const due = parseInstant(row.judgment_due_at)
  return row.punch_count === 1 && due !== null && due <= now.getTime()
}

export function rowState(row: JudgedDay, input: StateInput): RowState {
  if (row.on_leave || row.presence_state === 'excused_leave') return 'leave'
  // A human correction outranks the punches. The evaluator only ever rules
  // `absent` with zero punches, so `absent` beside punches is a correction;
  // and `completed`/`on_duty` without punches can only be one, because every
  // automatic completion derives from at least one punch. Without this, a
  // corrected present row keeps rendering — and counting — as absent.
  if (row.presence_state === 'absent') return 'absent'
  if (row.punch_count === 0) {
    if (row.presence_state === 'completed' || row.presence_state === 'on_duty') {
      return 'verified'
    }
    // The one verdict that lands mid-duty. `absence_due_at` is the server's own
    // boundary — twice the grace past the start — so the register calls an
    // absence at the same instant the evaluator does, without waiting for the
    // next evaluation to be written. An evaluator that has already ruled
    // `absent` outranks the boundary: a row with no policy has no boundary at
    // all, and softening a recorded absence into "not here yet" would hide it.
    // The verdict is provisional on both sides: a punch arriving later
    // re-evaluates the case into a late arrival.
    const absenceDue = parseInstant(row.absence_due_at)
    const reached = absenceDue !== null && absenceDue <= input.now.getTime()
    return reached ? 'absent' : 'pending'
  }
  // Lateness outranks pairing on purpose: a lone punch hours past the absence
  // boundary is a very late arrival, and labelling it "unpaired" would hide the
  // hours behind a missing-punch note.
  if (minutesPastGrace(row, input) > 0) return 'late'
  if (isUnpaired(row, input)) return 'unpaired'
  return (row.late_minutes ?? 0) > 0 ? 'grace' : 'verified'
}

/** True when a row needs a human decision. Arriving inside the grace is not one. */
export function needsDecision(state: RowState): boolean {
  return state === 'absent' || state === 'unpaired' || state === 'late'
}

/** Worst first: absent, then unpaired, then late by descending minutes. */
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
    if (row.punch_count > 0 || state === 'verified') seen += 1
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
    if (row.punch_count > 0 || rowState(row, input) === 'verified') entry.seen += 1
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
 * into `rowState`: whether a row may be judged is a per-row fact, and it turns
 * on the end of the duty rather than its start.
 */
export function isWindowOpen(rows: readonly AttendanceRow[], now: Date): boolean {
  return rows.some((row) => {
    const start = parseInstant(row.scheduled_start_at)
    return start !== null && start <= now.getTime()
  })
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
