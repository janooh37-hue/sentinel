/**
 * TimelineView — arrivals against the grace line (design 8).
 *
 * Time is the x-axis and posts are lanes, so density stops mattering: forty dots
 * in nine lanes read instantly. A late arrival draws a tail back to the grace
 * line, which turns "how late" into a length rather than a number to compare.
 *
 * The axis is deliberately narrow — 45 minutes before the start to 165 after —
 * because arrivals only happen there. Spanning the whole eight-hour window would
 * squeeze every dot into the first sixth of the lane.
 */

import { useTranslation } from 'react-i18next'

import { pickEmployeeName } from '@/lib/employeeName'

import type { AttendanceRow } from './attendanceModel'
import {
  DEFAULT_GRACE_MINUTES,
  arrivalOffsetMinutes,
  groupByUnitAndPost,
  parseInstant,
  rowState,
  siteTime,
  splitByShift,
} from './attendanceModel'

const AXIS_BEFORE = 45
const AXIS_AFTER = 165
const AXIS_SPAN = AXIS_BEFORE + AXIS_AFTER

interface Props {
  rows: readonly AttendanceRow[]
  now: Date
  graceMinutes?: number
  onOpenEmployee: (employeeId: string) => void
}

/** Offset in minutes from the scheduled start → percentage across the axis. */
function pct(offsetMinutes: number): number {
  return ((offsetMinutes + AXIS_BEFORE) / AXIS_SPAN) * 100
}

export function TimelineView({
  rows,
  now,
  graceMinutes = DEFAULT_GRACE_MINUTES,
  onOpenEmployee,
}: Props): React.JSX.Element {
  const { t, i18n } = useTranslation()
  const input = { now, graceMinutes }
  // Shift first: one company can work two windows on the same day.
  const sections = splitByShift(rows).flatMap(([shiftCode, shiftRows]) =>
    [...groupByUnitAndPost(shiftRows).entries()].map(([unit, posts]) => ({ shiftCode, unit, posts })),
  )

  return (
    <div className="mt-3 grid gap-3">
      {sections.map(({ shiftCode, unit, posts }) => {
        const unitRows = [...posts.values()].flat()
        const shift = shiftCode
        const start = unitRows[0]?.scheduled_start_at ?? null
        const end = unitRows[0]?.scheduled_end_at ?? null
        const offsets = unitRows
          .map(arrivalOffsetMinutes)
          .filter((value): value is number => value !== null)
          .sort((a, b) => a - b)
        const median = offsets.length > 0 ? offsets[Math.floor(offsets.length / 2)] : null

        return (
          <section
            key={`${unit}-${shift}`}
            data-testid="attendance-timeline-unit"
            className="overflow-hidden rounded-2xl border border-hairline bg-surface"
          >
            <header className="flex flex-wrap items-center gap-2.5 border-b border-hairline px-4 py-2.5">
              <h3 className="text-[0.82em] font-extrabold">
                {t(`attendance.shift.${shift}`, shift)}
              </h3>
              <span dir="rtl" className="isolate-bidi text-[0.76em] text-muted-foreground">
                {unit}
              </span>
              <span className="text-[0.72em] text-muted-foreground">
                {t('attendance.timeline.start', { time: siteTime(start) })}
                {' · '}
                {t('attendance.timeline.grace', {
                  time: siteTime(shiftInstant(start, graceMinutes)),
                })}
                {' · '}
                {t('attendance.timeline.closes', { time: siteTime(end) })}
              </span>
              {median !== null && (
                <span className="ms-auto text-[0.72em] text-muted-foreground">
                  {t('attendance.timeline.median')}{' '}
                  <b className="font-mono">
                    {median >= 0 ? '+' : '−'}
                    {Math.abs(median)}m
                  </b>
                </span>
              )}
            </header>

            <div className="py-2">
              {[...posts.entries()].map(([post, postRows]) => {
                const missing = postRows.filter((row) => rowState(row, input) === 'missing').length
                const leave = postRows.filter((row) => rowState(row, input) === 'leave').length
                return (
                  <div
                    key={post}
                    data-testid="attendance-timeline-lane"
                    className="grid grid-cols-[130px_minmax(0,1fr)_70px] items-center gap-2.5 px-4 py-0.5 even:bg-surface-raised md:grid-cols-[190px_minmax(0,1fr)_74px]"
                  >
                    <span className="truncate text-[0.74em] font-semibold">{post}</span>

                    <span className="relative block h-[26px] overflow-hidden">
                      <i aria-hidden className="absolute inset-x-0 top-3 h-[2px] bg-hairline" />
                      <i
                        aria-hidden
                        className="absolute top-1.5 h-3.5 rounded bg-primary-soft/60"
                        style={{ left: `${pct(0)}%`, width: `${100 - pct(0)}%` }}
                      />
                      <i
                        aria-hidden
                        className="absolute top-1.5 h-3.5"
                        style={{
                          left: `${pct(0)}%`,
                          width: `${pct(graceMinutes) - pct(0)}%`,
                          background:
                            'repeating-linear-gradient(45deg, var(--warning-soft) 0 4px, transparent 4px 8px)',
                        }}
                      />
                      <i
                        aria-hidden
                        className="absolute inset-y-0 w-[2px] bg-primary/35"
                        style={{ left: `${pct(0)}%` }}
                      />
                      <i
                        aria-hidden
                        data-testid="attendance-timeline-grace-line"
                        className="absolute inset-y-0 w-[2px] bg-warning shadow-[0_0_0_3px_rgba(180,83,9,.10)]"
                        style={{ left: `${pct(graceMinutes)}%` }}
                      />

                      {postRows.map((row, index) => {
                        const offset = arrivalOffsetMinutes(row)
                        if (offset === null) return null
                        const state = rowState(row, input)
                        const left = Math.min(100, Math.max(0, pct(offset)))
                        // Coincident arrivals are common (a crew arrives on one
                        // bus), and stacked dots hide each other. A deterministic
                        // 3px vertical fan keeps every person visible without
                        // implying a time difference that is not there.
                        const fan = (index % 3) - 1
                        const name = pickEmployeeName(
                          { name_en: row.name_en, name_ar: row.name_ar ?? null },
                          i18n.language,
                        )
                        return (
                          <span key={`${row.employee_id}-${row.shift_code}`}>
                            {state === 'late' && (
                              <i
                                aria-hidden
                                className="absolute top-[12.5px] h-[2px] bg-warning/60"
                                style={{
                                  left: `${pct(graceMinutes)}%`,
                                  width: `${Math.max(0, left - pct(graceMinutes))}%`,
                                }}
                              />
                            )}
                            <button
                              type="button"
                              data-testid="attendance-timeline-dot"
                              data-state={state}
                              onClick={() => onOpenEmployee(row.employee_id)}
                              title={`${name} · ${siteTime(row.first_punch_at)} · ${t(`attendance.state.${state}`)}`}
                              className={`absolute -ms-[5.5px] h-[11px] w-[11px] rounded-full ring-2 ring-surface ${
                                state === 'late'
                                  ? 'bg-warning'
                                  : state === 'single'
                                    ? 'bg-surface ring-[2.5px] ring-accent'
                                    : 'bg-success'
                              }`}
                              style={{ left: `${left}%`, top: `${8 + fan * 3}px` }}
                            />
                          </span>
                        )
                      })}
                    </span>

                    <span className="text-end font-mono text-[0.72em] text-muted-foreground">
                      {postRows.length - missing - leave}/{postRows.length - leave}
                      {missing > 0 && (
                        <b className="text-accent"> {t('attendance.timeline.missingGutter', { count: missing })}</b>
                      )}
                    </span>
                  </div>
                )
              })}
            </div>

            <p className="border-t border-hairline px-4 py-2 text-[0.7em] text-muted-foreground">
              {t('attendance.timeline.glance')}
            </p>
          </section>
        )
      })}
    </div>
  )
}

/** `start + minutes`, as an ISO string the time formatter accepts. */
function shiftInstant(iso: string | null, minutes: number): string | null {
  const at = parseInstant(iso)
  if (at === null) return null
  return new Date(at + minutes * 60_000).toISOString()
}
