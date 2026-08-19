/**
 * useAttendanceAttention — today's attendance as one ordered list.
 *
 * The hero card's number, the section tab's badge and the register's side rail
 * all read from here, so the number a user sees is exactly the work they get.
 *
 * Lives in its own module because it is a hook plus a helper, not a component:
 * keeping them beside a component breaks Fast Refresh.
 */

import { useQuery } from '@tanstack/react-query'

import { api } from '@/lib/api'
import type { AttendanceDayRow } from '@/lib/api'
import { useCapabilities } from '@/lib/useCapabilities'
import {
  needsDecision,
  orderByAttention,
  rowState,
} from '@/pages/employees/attendance/attendanceModel'

/** Today's operational date in the site's timezone, as `YYYY-MM-DD`. */
export function siteToday(now: Date = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Dubai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now)
}

export interface AttendanceAttention {
  /** False when the caller lacks the capabilities the endpoint requires. */
  allowed: boolean
  isLoading: boolean
  attention: number | null
  seen: number
  late: number
  unpaired: number
  worst: AttendanceDayRow[]
}

export function useAttendanceAttention(operationalDate = siteToday()): AttendanceAttention {
  const { has, isLoading: capsLoading } = useCapabilities()
  // `/workforce/attendance/day` requires BOTH capabilities, and the role presets
  // give an operator only workforce.self.view — so an ungated fetch would 403 on
  // every visit to /employees.
  const allowed = has('workforce.people.view') && has('workforce.attendance.review')

  const query = useQuery({
    queryKey: ['attendance-day', operationalDate] as const,
    queryFn: () => api.listAttendanceDay({ operational_date: operationalDate, limit: 500 }),
    enabled: allowed && !capsLoading,
    staleTime: 60_000,
  })

  const rows = query.data?.items ?? []
  // Judge against the instant the payload was produced, so the counts and the
  // rows can never disagree about whether a window had opened.
  // `dataUpdatedAt` is 0 before the first payload; with no rows the loop below
  // does nothing, so the epoch value is never used to judge anything.
  const input = { now: new Date(query.dataUpdatedAt) }

  let late = 0
  let unpaired = 0
  let seen = 0
  for (const row of rows) {
    const state = rowState(row, input)
    if (row.punch_count > 0) seen += 1
    if (state === 'late') late += 1
    if (state === 'single' || state === 'missing') unpaired += 1
  }
  const worst = orderByAttention(rows, input).filter((row) => needsDecision(rowState(row, input)))

  return {
    allowed,
    isLoading: allowed && (capsLoading || query.isPending),
    attention: allowed && query.isSuccess ? worst.length : null,
    seen,
    late,
    unpaired,
    worst,
  }
}
