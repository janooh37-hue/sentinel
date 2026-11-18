/**
 * People and their actual time on site, grouped by shift, unit and post.
 * The time axis follows reading direction; touch layouts keep the named list
 * and actions, without requiring anyone to select a tiny plotted mark.
 */

import { useTranslation } from 'react-i18next'

import { pickEmployeeName } from '@/lib/employeeName'

import { CorrectAttendanceButton } from './AttendanceCorrectionEntry'
import { useAttendanceCorrection } from './attendanceCorrectionContext'
import { AttendanceStatusDot } from './AttendanceStatusDot'
import type { AttendanceRow, StateInput } from './attendanceModel'
import {
  DEFAULT_GRACE_MINUTES,
  arrivalOffsetMinutes,
  groupByUnitAndPost,
  isOnSiteNow,
  outAt,
  parseInstant,
  rowState,
  siteTime,
  splitByShift,
} from './attendanceModel'
import { attendanceStatusLabel } from './attendanceStatusLabel'

interface Props {
  rows: readonly AttendanceRow[]
  now: Date
  operationalDate: string
  graceMinutes?: number
  onOpenEmployee: (employeeId: string) => void
}

interface Axis {
  from: number
  to: number
}

/** Include the full duty and its actual punches, including overnight shifts. */
function timeAxis(rows: readonly AttendanceRow[], input: StateInput): Axis | null {
  let from = Infinity
  let to = -Infinity
  for (const row of rows) {
    for (const iso of [row.scheduled_start_at, row.scheduled_end_at, row.first_punch_at, outAt(row)]) {
      const at = parseInstant(iso)
      if (at === null) continue
      from = Math.min(from, at)
      to = Math.max(to, at)
    }
    if (isOnSiteNow(row, input)) to = Math.max(to, input.now.getTime())
  }
  if (!Number.isFinite(from)) return null
  const margin = 45 * 60_000
  return { from: from - margin, to: to + margin }
}

function position(axis: Axis, at: number): number {
  return Math.min(100, Math.max(0, ((at - axis.from) / (axis.to - axis.from)) * 100))
}

export function TimelineView({
  rows,
  now,
  operationalDate,
  graceMinutes = DEFAULT_GRACE_MINUTES,
  onOpenEmployee,
}: Props): React.JSX.Element {
  const { t } = useTranslation()
  const { openCorrection } = useAttendanceCorrection()
  const input = { now, graceMinutes }
  const sections = splitByShift(rows).flatMap(([shiftCode, shiftRows]) =>
    [...groupByUnitAndPost(shiftRows).entries()].map(([unit, posts]) => ({ shiftCode, unit, posts })),
  )

  return (
    <div className="mt-3 grid gap-3">
      {sections.map(({ shiftCode, unit, posts }) => {
        const unitRows = [...posts.values()].flat()
        const first = unitRows[0]
        const axis = timeAxis(unitRows, input)
        const offsets = unitRows
          .map(arrivalOffsetMinutes)
          .filter((value): value is number => value !== null)
          .sort((a, b) => a - b)
        const median = offsets.length > 0 ? offsets[Math.floor(offsets.length / 2)] : null

        return (
          <section
            key={`${unit}-${shiftCode}`}
            data-testid="attendance-timeline-unit"
            className="overflow-hidden rounded-2xl border border-hairline bg-surface"
          >
            <header className="flex flex-wrap items-center gap-2.5 border-b border-hairline px-4 py-2.5">
              <h3 className="text-[0.82em] font-bold">{t(`attendance.shift.${shiftCode}`, shiftCode)}</h3>
              <span dir="auto" className="isolate-bidi text-[0.76em] text-muted-foreground">{unit}</span>
              <span className="text-[0.72em] text-muted-foreground">
                {t('attendance.timeline.schedule')}{' '}
                <bdi dir="ltr">{siteTime(first?.scheduled_start_at)} – {siteTime(first?.scheduled_end_at)}</bdi>
              </span>
              {median !== null && (
                <span className="ms-auto text-[0.72em] text-muted-foreground">
                  {t('attendance.timeline.median')}{' '}
                  <bdi dir="ltr" className="font-mono">{median >= 0 ? '+' : '−'}{Math.abs(median)}m</bdi>
                </span>
              )}
            </header>

            {axis && (
              <div
                aria-hidden
                className={`hidden grid-cols-[190px_minmax(0,1fr)_170px] gap-3 ps-4 pt-3 text-[0.68em] text-muted-foreground sm:grid [@media(pointer:coarse)]:hidden ${openCorrection ? 'pe-[3.5rem]' : 'pe-4'}`}
              >
                <span>{t('attendance.timeline.employee')}</span>
                <span className="flex justify-between gap-2">
                  {[axis.from, (axis.from + axis.to) / 2, axis.to].map((at) => (
                    <bdi key={at} dir="ltr">{siteTime(new Date(at).toISOString())}</bdi>
                  ))}
                </span>
                <span />
              </div>
            )}

            {[...posts.entries()].map(([post, postRows]) => (
              <div key={post} data-testid="attendance-timeline-lane" className="py-2">
                <h4 className="px-4 pb-1 text-[0.76em] font-semibold" dir="auto">{post}</h4>
                <ul aria-label={post}>
                  {postRows.map((row) => (
                    <TimelineRow
                      key={row.case_id}
                      row={row}
                      axis={axis}
                      input={input}
                      operationalDate={operationalDate}
                      onOpenEmployee={onOpenEmployee}
                    />
                  ))}
                </ul>
              </div>
            ))}

            <p className="border-t border-hairline px-4 py-2 text-[0.72em] text-muted-foreground">
              {t('attendance.timeline.glance')}
            </p>
          </section>
        )
      })}
    </div>
  )
}

function TimelineRow({
  row,
  axis,
  input,
  operationalDate,
  onOpenEmployee,
}: {
  row: AttendanceRow
  axis: Axis | null
  input: StateInput
  operationalDate: string
  onOpenEmployee: (employeeId: string) => void
}): React.JSX.Element {
  const { t, i18n } = useTranslation()
  const state = rowState(row, input)
  const onSite = isOnSiteNow(row, input)
  const departure = outAt(row)
  const name = pickEmployeeName({ name_en: row.name_en, name_ar: row.name_ar ?? null }, i18n.language)
  const label = attendanceStatusLabel(t, state, { onSite, hasOut: departure !== null, leaveLabel: row.leave_label })
  const status = onSite && state !== 'verified' ? `${label} · ${t('attendance.state.onSite')}` : label
  const first = parseInstant(row.first_punch_at)
  const last = parseInstant(departure) ?? (onSite ? input.now.getTime() : first)
  const scheduledStart = parseInstant(row.scheduled_start_at)
  const scheduledEnd = parseInstant(row.scheduled_end_at)
  const graceEnd = scheduledStart === null ? null : scheduledStart + (row.grace_minutes ?? input.graceMinutes ?? DEFAULT_GRACE_MINUTES) * 60_000
  const shift = row.shift_code ? t(`attendance.shift.${row.shift_code}`, row.shift_code) : '—'

  return (
    <li className="flex items-center gap-3 border-t border-hairline px-4 py-1.5 first:border-t-0">
      <button
        type="button"
        onClick={() => onOpenEmployee(row.employee_id)}
        aria-label={t('attendance.timeline.rowLabel', {
          name,
          employeeId: row.employee_id,
          date: operationalDate,
          shift,
          state: status,
          in: siteTime(row.first_punch_at),
          out: siteTime(departure),
        })}
        className="grid min-h-11 min-w-0 flex-1 grid-cols-1 items-center gap-x-3 gap-y-1 rounded-md py-1 text-start hover:bg-surface-raised focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring sm:grid-cols-[190px_minmax(0,1fr)_170px] [@media(pointer:coarse)]:grid-cols-1"
      >
        <span className="flex min-w-0 items-center gap-2.5">
          <AttendanceStatusDot state={state} onSite={onSite} />
          <span className="min-w-0">
            <span dir="auto" className="block text-[0.8em] font-semibold">{name}</span>
            <bdi dir="ltr" className="block text-[0.72em] text-muted-foreground">{row.employee_id}</bdi>
          </span>
        </span>
        <span aria-hidden className="relative hidden h-7 overflow-hidden rounded bg-surface-raised sm:block [@media(pointer:coarse)]:hidden">
          {axis && scheduledStart !== null && scheduledEnd !== null && (
            <i
              className="absolute inset-y-2 rounded bg-primary-soft"
              style={{ insetInlineStart: `${position(axis, scheduledStart)}%`, width: `${Math.max(0, position(axis, scheduledEnd) - position(axis, scheduledStart))}%` }}
            />
          )}
          {axis && scheduledStart !== null && graceEnd !== null && (
            <>
              <i
                className="absolute inset-y-2 bg-caution-soft"
                style={{ insetInlineStart: `${position(axis, scheduledStart)}%`, width: `${Math.max(0, position(axis, graceEnd) - position(axis, scheduledStart))}%` }}
              />
              <i
                data-testid="attendance-timeline-grace-line"
                className="absolute inset-y-1 w-px bg-caution"
                style={{ insetInlineStart: `${position(axis, graceEnd)}%` }}
              />
            </>
          )}
          {axis && first !== null && last !== null ? (
            <>
              <i
                data-testid="attendance-timeline-bar"
                className="absolute inset-y-2.5 min-w-[3px] rounded bg-primary"
                style={{ insetInlineStart: `${position(axis, first)}%`, width: `${Math.max(0, position(axis, last) - position(axis, first))}%` }}
              />
              <i className="absolute inset-y-2 w-[3px] bg-foreground" style={{ insetInlineStart: `${position(axis, first)}%` }} />
              {departure && <i className="absolute inset-y-2 w-[3px] bg-foreground" style={{ insetInlineStart: `${position(axis, last)}%` }} />}
            </>
          ) : <span className="relative px-2 text-[0.72em] leading-7 text-muted-foreground">{status}</span>}
          {axis && input.now.getTime() >= axis.from && input.now.getTime() <= axis.to && (
            <i className="absolute inset-y-0 w-px bg-primary" style={{ insetInlineStart: `${position(axis, input.now.getTime())}%` }} />
          )}
        </span>
        <span className="ps-5 text-[0.72em] sm:ps-0 sm:text-end [@media(pointer:coarse)]:ps-5 [@media(pointer:coarse)]:text-start">
          <span className="block text-muted-foreground">
            {t('attendance.timeline.in')}{' '}<bdi dir="ltr">{siteTime(row.first_punch_at)}</bdi>
            {' · '}{t('attendance.timeline.out')}{' '}<bdi dir="ltr">{siteTime(departure)}</bdi>
          </span>
          <span className="block">{status}</span>
        </span>
      </button>
      <CorrectAttendanceButton
        target={{ caseId: row.case_id, employeeId: row.employee_id, employeeName: name, operationalDate, shiftCode: row.shift_code }}
        className="[@media(pointer:coarse)]:h-11 [@media(pointer:coarse)]:w-11"
      />
    </li>
  )
}
