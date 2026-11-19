/**
 * Capabilities behind the attendance roster.
 *
 * `GET /workforce/attendance/day`, `/exceptions` and `/punches` all require BOTH
 * `workforce.people.view` and `workforce.attendance.review`, so every surface
 * that reads them (the Attendance route and section tab, the attention badge,
 * the Punch log widget) gates on the pair through this one helper.
 */

export const ATTENDANCE_ROSTER_CAPS = ['workforce.people.view', 'workforce.attendance.review'] as const

/** Opens the audited correction overlay; every correction entry point hides without it. */
export const ATTENDANCE_CORRECT_CAP = 'workforce.attendance.correct'

export function canViewAttendanceRoster(has: (capability: string) => boolean): boolean {
  return ATTENDANCE_ROSTER_CAPS.every((capability) => has(capability))
}
