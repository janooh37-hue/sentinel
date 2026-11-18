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

import { Clock3 } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import { pickEmployeeName } from '@/lib/employeeName'

import { CorrectAttendanceButton } from './AttendanceCorrectionEntry'
import type { AttendanceRow } from './attendanceModel'
import {
  groupByUnitAndPost,
  inAt,
  isExcused,
  isOnSiteNow,
  isUnpaired,
  minutesPastGrace,
  needsDecision,
  orderByAttention,
  outAt,
  postSummary,
  rowState,
  siteTime,
  splitByShift,
} from './attendanceModel'
import { AttendanceStatusDot } from './AttendanceStatusDot'
import { attendanceStatusLabel } from './attendanceStatusLabel'

interface Props {
  rows: readonly AttendanceRow[]
  operationalDate: string
  now: Date
  graceMinutes?: number
  freshThrough?: string | null
  onOpenEmployee: (employeeId: string) => void
}

export function RegisterView({
  rows,
  operationalDate,
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
        const absent = unitRows.filter((row) => rowState(row, input) === 'absent').length
        const nationalService = unitRows.filter((row) => rowState(row, input) === 'national_service').length
        const leave = unitRows.filter((row) => {
          const state = rowState(row, input)
          return isExcused(state) && state !== 'national_service'
        }).length
        // Counted off the pairing fact, not off the state: a person who arrived
        // late and never punched out is one late arrival AND one missing pair,
        // and the register has to be able to say both.
        const unpaired = unitRows.filter((row) => isUnpaired(row, input)).length
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
                  <span>{t('attendance.register.schedule')} </span>
                  <bdi dir="ltr" className="font-mono">
                    {siteTime(unitRows[0]?.scheduled_start_at)} – {siteTime(unitRows[0]?.scheduled_end_at)}
                  </bdi>
                  {' · '}
                  {t('attendance.register.posts', { count: posts.size })}
                </div>
              </div>
              <dl className="ms-auto flex flex-wrap gap-4 text-[0.72em] text-muted-foreground">
                <Stat label={t('attendance.register.assigned')} value={unitRows.length} />
                <Stat label={t('attendance.register.seen')} value={summary.seen} />
                <Stat label={t('attendance.register.late')} value={late} tone="text-warning" />
                <Stat label={t('attendance.register.absent')} value={absent} tone="text-accent" />
                <Stat
                  label={t('attendance.register.unpaired')}
                  value={unpaired}
                  tone="text-destructive"
                />
                <Stat label={t('attendance.register.leave')} value={leave} tone="text-info" />
                <Stat label={t('attendance.register.nationalService')} value={nationalService} tone="text-smart" />
              </dl>
            </header>

            {/* Let the available width choose the column count so full names,
                verdict text and explicit In/Out keep their space. */}
            <div className="columns-[29rem] gap-0">
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
                      const onSite = isOnSiteNow(row, input)
                      const departure = outAt(row)
                      const label = attendanceStatusLabel(t, state, {
                        onSite,
                        hasOut: departure !== null,
                        leaveLabel: row.leave_label,
                        corrected: row.corrected,
                      })
                      return (
                        <div
                          key={`${row.employee_id}-${row.shift_code}`}
                          className={`flex items-center gap-2 border-b border-hairline py-2.5 text-[0.76em] last:border-0 ${
                            attention ? 'font-semibold text-foreground' : 'text-muted-foreground'
                          }`}
                        >
                          <AttendanceStatusDot state={state} onSite={onSite} corrected={row.corrected} />
                          <div className="min-w-0 flex-1 min-[641px]:flex min-[641px]:items-center min-[641px]:gap-3">
                            <div className="min-w-0 flex-1">
                              <button
                                type="button"
                                data-attendance-correction-navigation=""
                                onClick={() => onOpenEmployee(row.employee_id)}
                                aria-label={t('attendance.register.openEmployee', { name, employeeId: row.employee_id })}
                                className="min-h-11 w-full rounded-sm text-start font-semibold text-foreground hover:underline focus-visible:ring-2 focus-visible:ring-ring min-[641px]:min-h-7"
                              >
                                <span className="block [overflow-wrap:anywhere]">{name}</span>
                                <bdi dir="ltr" className="font-mono text-[0.86em] text-muted-foreground">{row.employee_id}</bdi>
                              </button>
                              <span className="block text-[0.9em] text-foreground">{label}</span>
                            </div>
                            <dl className="mt-1 flex shrink-0 gap-4 text-[0.92em] min-[641px]:mt-0">
                              <div>
                                <dt className="text-muted-foreground">{t('attendance.register.in')}</dt>
                                <dd className="font-mono text-foreground">
                                  <bdi dir="ltr">{siteTime(inAt(row))}</bdi>
                                  {state === 'late' && (
                                    <span className="ms-1 text-warning">
                                      {t('attendance.register.pastGrace', { minutes: minutesPastGrace(row, input) })}
                                    </span>
                                  )}
                                </dd>
                              </div>
                              <div>
                                <dt className="text-muted-foreground">{t('attendance.register.out')}</dt>
                                <dd className="font-mono text-foreground"><bdi dir="ltr">{siteTime(departure)}</bdi></dd>
                              </div>
                            </dl>
                          </div>
                          <CorrectAttendanceButton target={{
                            caseId: row.case_id,
                            employeeId: row.employee_id,
                            employeeName: name,
                            operationalDate,
                            shiftCode: row.shift_code,
                          }} className="max-[640px]:h-[44px] max-[640px]:w-[44px]" />
                        </div>
                      )
                    })}
                  </div>
                )
              })}
            </div>

            <footer className="flex flex-wrap items-center gap-2 border-t border-hairline px-4 py-2 text-[0.7em] text-muted-foreground">
              <Clock3 aria-hidden className="h-3.5 w-3.5 shrink-0" />
              <span className="isolate-bidi">
                {freshThrough
                  ? t('attendance.register.source', { through: siteTime(freshThrough) })
                  : t('attendance.register.sourceUnknown')}
              </span>
            </footer>
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

