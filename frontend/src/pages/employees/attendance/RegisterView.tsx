/**
 * RegisterView — the duty register (design 10).
 *
 * Names are the point, so all of them are printed: three columns for a
 * ~40-person guard shift, four for the ~70-person office day. Density comes from
 * typography, not cards.
 *
 * Reading order is engineered: a post whose people need attention gets a red
 * rule under its heading and floats to the top of its unit, and inside a post the
 * exceptions come first. Verified rows stay muted so they never compete.
 */

import { useTranslation } from 'react-i18next'

import { pickEmployeeName } from '@/lib/employeeName'

import type { AttendanceRow, RowState } from './attendanceModel'
import {
  groupByUnitAndPost,
  needsDecision,
  orderByAttention,
  postSummary,
  rowState,
  siteTime,
  splitByShift,
} from './attendanceModel'

interface Props {
  rows: readonly AttendanceRow[]
  now: Date
  graceMinutes?: number
  freshThrough?: string | null
  onOpenEmployee: (employeeId: string) => void
}

const BEAD: Record<RowState, string> = {
  verified: 'bg-success',
  late: 'bg-warning',
  single: 'bg-destructive',
  missing: 'bg-accent',
  leave: 'bg-info',
  pending: 'bg-faint',
}

export function RegisterView({
  rows,
  now,
  graceMinutes,
  freshThrough,
  onOpenEmployee,
}: Props): React.JSX.Element {
  const { t, i18n } = useTranslation()
  const input = { now, graceMinutes }
  // Shift first: one company can work two windows on the same day.
  const sections = splitByShift(rows).flatMap(([shiftCode, shiftRows]) =>
    [...groupByUnitAndPost(shiftRows).entries()].map(
      ([unit, posts]) => ({ shiftCode, unit, posts }),
    ),
  )

  return (
    <div className="mt-3 grid gap-3">
      {sections.map(({ shiftCode, unit, posts }) => {
        const unitRows = [...posts.values()].flat()
        const shift = shiftCode
        const summary = postSummary(unitRows, input)
        const late = unitRows.filter((row) => rowState(row, input) === 'late').length
        const unpaired = unitRows.filter((row) => {
          const state = rowState(row, input)
          return state === 'single' || state === 'missing'
        }).length
        // Posts needing attention first, then by size: the eye should land on
        // trouble before it reads a single name.
        const ordered = [...posts.entries()].sort((a, b) => {
          const diff = postSummary(b[1], input).exceptions - postSummary(a[1], input).exceptions
          return diff !== 0 ? diff : b[1].length - a[1].length
        })

        return (
          <section
            key={`${unit}-${shift}`}
            data-testid="attendance-register-unit"
            className="overflow-hidden rounded-2xl border border-hairline bg-surface"
          >
            <header className="flex flex-wrap items-end gap-3.5 border-b-2 border-primary px-4 py-3">
              <div>
                <h3 className="text-[0.95em] font-extrabold">
                  {t('attendance.register.masthead', {
                    shift: t(`attendance.shift.${shift}`, shift),
                    unit,
                  })}
                </h3>
                <div className="mt-0.5 text-[0.76em] text-muted-foreground">
                  {/* Isolated: an Arabic unit name directly before a clock range
                      is reordered by the bidi algorithm without this. */}
                  <span dir="rtl" className="isolate-bidi">
                    {unit}
                  </span>
                  {' · '}
                  <span className="font-mono">
                    {siteTime(unitRows[0]?.scheduled_start_at)} – {siteTime(unitRows[0]?.scheduled_end_at)}
                  </span>
                  {' · '}
                  {t('attendance.register.posts', { count: posts.size })}
                </div>
              </div>
              <dl className="ms-auto flex flex-wrap gap-4 text-[0.72em] text-muted-foreground">
                <Stat label={t('attendance.register.assigned')} value={unitRows.length} />
                <Stat label={t('attendance.register.seen')} value={summary.seen} />
                <Stat label={t('attendance.register.late')} value={late} tone="text-warning" />
                <Stat label={t('attendance.register.unpaired')} value={unpaired} tone="text-accent" />
                <Stat label={t('attendance.register.leave')} value={summary.leave} tone="text-info" />
              </dl>
            </header>

            {/* Column COUNT is the browser's to choose; the constraint we own is
              * the minimum width a row needs. A real roster line is a full
              * Emirati name plus a G-number plus a time — around 23rem — and
              * fixed `lg:columns-3` truncated names to about 22 characters,
              * cutting exactly the family name that distinguishes two brothers
              * on the same post. Declaring the width instead means the register
              * shows three columns on a wide canvas, two beside the attention
              * rail, and one on a phone, always with the name intact. */}
            <div className="columns-[23rem] gap-0">
              {ordered.map(([post, postRows]) => {
                const postStats = postSummary(postRows, input)
                return (
                  <div
                    key={post}
                    data-testid="attendance-register-post"
                    className="break-inside-avoid border-e border-hairline px-4 pb-3 pt-2.5"
                  >
                    <div
                      className={`mb-1.5 flex items-baseline gap-2 border-b pb-1.5 ${
                        postStats.exceptions > 0 ? 'border-accent' : 'border-border'
                      }`}
                    >
                      {/* Production post names run long ("بوابة الورشة الشمالية"),
                        * so the name truncates and the count never does. */}
                      <b className="min-w-0 flex-1 truncate text-[0.78em] font-extrabold">{post}</b>
                      <span
                        className={`shrink-0 font-mono text-[0.72em] ${
                          postStats.exceptions > 0 ? 'font-bold text-accent' : 'text-muted-foreground'
                        }`}
                      >
                        {postStats.seen}/{postStats.due}
                        {postStats.leave > 0 ? ` +${postStats.leave}` : ''}
                      </span>
                    </div>

                    {orderByAttention(postRows, input).map((row) => {
                      const state = rowState(row, input)
                      const attention = needsDecision(state)
                      const name = pickEmployeeName(
                        { name_en: row.name_en, name_ar: row.name_ar ?? null },
                        i18n.language,
                      )
                      return (
                        <button
                          key={`${row.employee_id}-${row.shift_code}`}
                          type="button"
                          onClick={() => onOpenEmployee(row.employee_id)}
                          className={`flex w-full items-center gap-1.5 py-[2.5px] text-start text-[0.76em] ${
                            attention ? 'font-semibold text-foreground' : 'text-muted-foreground'
                          }`}
                        >
                          <i aria-hidden className={`h-2 w-2 shrink-0 rounded-full ${BEAD[state]}`} />
                          <span className="min-w-0 flex-1 truncate" title={name}>
                            {name}
                          </span>
                          {/* The identifier a supervisor reads out and types into
                            * a report, so it never shrinks or truncates: a partial
                            * G-number is worse than none. Real names are long, so
                            * the name yields space first. */}
                          <span className="shrink-0 font-mono text-[0.86em] text-faint">
                            {row.employee_id}
                          </span>
                          <span
                            className={`shrink-0 font-mono text-[0.92em] ${
                              state === 'missing' || state === 'single'
                                ? 'font-bold text-accent'
                                : state === 'late'
                                  ? 'font-bold text-warning'
                                  : 'text-faint'
                            }`}
                          >
                            {timeLabel(row, state, t)}
                          </span>
                        </button>
                      )
                    })}
                  </div>
                )
              })}
            </div>

            <p className="flex flex-wrap items-center gap-2 border-t border-hairline px-4 py-2 text-[0.7em] text-muted-foreground">
              <i aria-hidden className="h-1.5 w-1.5 rounded-full bg-success shadow-[0_0_0_3px_var(--success-soft)]" />
              {freshThrough
                ? t('attendance.register.source', { through: siteTime(freshThrough) })
                : t('attendance.register.sourceUnknown')}
            </p>
          </section>
        )
      })}
    </div>
  )
}

function Stat({
  label,
  value,
  tone,
}: {
  label: string
  value: number
  tone?: string
}): React.JSX.Element {
  return (
    <div className="text-end">
      <dd className={`font-mono text-[1.35em] text-foreground ${tone ?? ''}`}>{value}</dd>
      <dt>{label}</dt>
    </div>
  )
}

function timeLabel(
  row: AttendanceRow,
  state: RowState,
  t: (key: string, options?: Record<string, unknown>) => string,
): string {
  if (state === 'leave') return t('attendance.register.leave')
  if (state === 'pending') return t('attendance.register.duePunch', { time: siteTime(row.scheduled_start_at) })
  if (state === 'missing') return t('attendance.register.noPunch')
  if (state === 'single') return t('attendance.register.onlyPunch', { time: siteTime(row.first_punch_at) })
  if (state === 'late') {
    return t('attendance.register.latePunch', {
      time: siteTime(row.first_punch_at),
      minutes: row.late_minutes ?? 0,
    })
  }
  return siteTime(row.first_punch_at)
}
