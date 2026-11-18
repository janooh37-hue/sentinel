/**
 * BoardView — grouped person tiles with the same verdicts as the duty register.
 * Employee-file navigation and attendance correction are separate actions.
 */

import { useTranslation } from 'react-i18next'

import { bidi } from '@/lib/bidi'
import { pickEmployeeName } from '@/lib/employeeName'

import { CorrectAttendanceButton } from './AttendanceCorrectionEntry'
import type { AttendanceRow } from './attendanceModel'
import {
  groupByUnitAndPost,
  inAt,
  isExcused,
  isOnSiteNow,
  minutesPastGrace,
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
  onOpenEmployee: (employeeId: string) => void
}

export function BoardView({ rows, operationalDate, now, graceMinutes, onOpenEmployee }: Props): React.JSX.Element {
  const { t, i18n } = useTranslation()
  const input = { now, graceMinutes }
  const sections = splitByShift(rows).flatMap(([shiftCode, shiftRows]) =>
    [...groupByUnitAndPost(shiftRows).entries()].map(([unit, posts]) => ({ shiftCode, unit, posts })),
  )

  return (
    <div data-testid="attendance-board" className="mt-3 grid gap-4">
      {sections.map(({ shiftCode, unit, posts }) => {
        const unitRows = [...posts.values()].flat()
        const summary = postSummary(unitRows, input)
        const nationalService = unitRows.filter((row) => rowState(row, input) === 'national_service').length
        const leave = unitRows.filter((row) => {
          const state = rowState(row, input)
          return isExcused(state) && state !== 'national_service'
        }).length
        const shiftLabel = t(`attendance.shift.${shiftCode}`, shiftCode)
        return (
          <section key={`${unit}-${shiftCode}`}>
            <header className="flex flex-wrap items-center gap-2.5 text-foreground">
              <h3 className="text-[0.9em] font-extrabold">{shiftLabel} · <bdi>{unit}</bdi></h3>
              <div className="ms-auto flex flex-wrap gap-2 text-[0.76em] text-muted-foreground">
                <span className="font-mono">{t('attendance.board.seenOf', { seen: summary.seen, due: summary.due })}</span>
                <span>{t('attendance.register.posts', { count: posts.size })}</span>
                <span>{t('attendance.board.leaveCount', { count: leave })}</span>
                <span>{t('attendance.board.nationalServiceCount', { count: nationalService })}</span>
              </div>
            </header>

            <div className="mt-2 grid gap-3 [grid-template-columns:repeat(auto-fit,minmax(min(100%,24rem),1fr))]">
              {[...posts.entries()].map(([post, postRows]) => {
                const stats = postSummary(postRows, input)
                return (
                  <section
                    key={post}
                    data-testid="attendance-board-post"
                    className="min-w-0 rounded-2xl border border-hairline bg-surface p-3"
                  >
                    <header className={`flex flex-wrap items-baseline gap-1.5 border-b pb-2 text-foreground ${
                      stats.exceptions > 0 ? 'border-accent' : 'border-border'
                    }`}>
                      <h4 className="text-[0.8em] font-bold">{post}</h4>
                      <span className="ms-auto font-mono text-[0.7em] text-muted-foreground">
                        <bdi dir="ltr">{stats.seen}/{stats.due}{stats.leave > 0 ? ` +${stats.leave}` : ''}</bdi>
                      </span>
                    </header>
                    <div className="mt-2 grid gap-2 [grid-template-columns:repeat(auto-fit,minmax(min(100%,12rem),1fr))]">
                      {orderByAttention(postRows, input).map((row) => {
                        const state = rowState(row, input)
                        const onSite = isOnSiteNow(row, input)
                        const departure = outAt(row)
                        const name = pickEmployeeName(
                          { name_en: row.name_en, name_ar: row.name_ar ?? null },
                          i18n.language,
                        )
                        const label = attendanceStatusLabel(t, state, {
                          onSite,
                          hasOut: departure !== null,
                          leaveLabel: row.leave_label,
                          corrected: row.corrected,
                        })
                        const details = t('attendance.board.personDetails', {
                          name,
                          employeeId: bidi(row.employee_id),
                          date: bidi(operationalDate),
                          shift: shiftLabel,
                          state: label,
                          in: siteTime(inAt(row)),
                          out: siteTime(departure),
                        })
                        return (
                          <div key={`${row.employee_id}-${row.shift_code}`} className="min-w-0 rounded-md border border-border bg-surface-raised p-2">
                            <button
                              type="button"
                              data-attendance-correction-navigation=""
                              onClick={() => onOpenEmployee(row.employee_id)}
                              aria-label={t('attendance.board.openEmployee', { details })}
                              title={details}
                              className="min-h-[44px] w-full rounded-sm text-start hover:bg-surface-tinted focus-visible:ring-2 focus-visible:ring-ring"
                            >
                              <span className="flex items-center gap-2">
                                <AttendanceStatusDot state={state} onSite={onSite} corrected={row.corrected} />
                                <span className="min-w-0 text-[0.76em] font-semibold text-foreground [overflow-wrap:anywhere]">{name}</span>
                              </span>
                              <span className="mt-1 flex flex-wrap gap-x-1.5 text-[0.68em] text-muted-foreground">
                                <bdi dir="ltr" className="font-mono">{row.employee_id}</bdi>
                                <span>{label}</span>
                              </span>
                              <span className="mt-2 flex flex-wrap justify-between gap-2 text-[0.7em] text-foreground">
                                <span>
                                  {t('attendance.register.in')} <bdi dir="ltr" className="font-mono">{siteTime(inAt(row))}</bdi>
                                  {state === 'late' && (
                                    <span className="ms-1 text-warning">{t('attendance.register.pastGrace', { minutes: minutesPastGrace(row, input) })}</span>
                                  )}
                                </span>
                                <span>{t('attendance.register.out')} <bdi dir="ltr" className="font-mono">{siteTime(departure)}</bdi></span>
                              </span>
                            </button>
                            <div className="mt-1 flex flex-wrap items-center justify-between gap-1">
                              <span className="text-[0.65em] text-muted-foreground">
                                {t('attendance.register.schedule')} <bdi dir="ltr" className="font-mono">{siteTime(row.scheduled_start_at)} – {siteTime(row.scheduled_end_at)}</bdi>
                              </span>
                              <CorrectAttendanceButton target={{
                                caseId: row.case_id,
                                employeeId: row.employee_id,
                                employeeName: name,
                                operationalDate,
                                shiftCode: row.shift_code,
                              }} className="h-[44px] w-[44px] sm:h-[44px] sm:w-[44px]" />
                            </div>
                          </div>
                        )
                      })}
                    </div>
                  </section>
                )
              })}
            </div>
          </section>
        )
      })}
    </div>
  )
}
