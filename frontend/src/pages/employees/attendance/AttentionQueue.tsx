import { useEffect, useId, useState } from 'react'
import { useTranslation } from 'react-i18next'

import type { AttendanceException } from '@/lib/api'
import { pickEmployeeName } from '@/lib/employeeName'
import { cn } from '@/lib/utils'

import { CorrectAttendanceButton } from './AttendanceCorrectionEntry'
import { AttendanceStatusDot } from './AttendanceStatusDot'
import type { AttendanceRow } from './attendanceModel'
import {
  inAt,
  isOnSiteNow,
  minutesPastGrace,
  needsDecision,
  orderByAttention,
  outAt,
  rowState,
  siteTime,
} from './attendanceModel'
import { attendanceStatusLabel } from './attendanceStatusLabel'

interface Props {
  rows: readonly AttendanceRow[]
  exceptionRows?: readonly AttendanceException[]
  now: Date
  operationalDate: string
  graceMinutes?: number
  onOpenEmployee: (employeeId: string) => void
  onReviewCase?: (caseId: number) => void
  id?: string
  labelledBy?: string
}

export function AttentionQueue({
  rows,
  exceptionRows,
  now,
  operationalDate,
  graceMinutes,
  onOpenEmployee,
  onReviewCase,
  id,
  labelledBy,
}: Props): React.JSX.Element {
  const { t, i18n } = useTranslation()
  const titleId = useId()
  const [desktop, setDesktop] = useState(() => typeof window !== 'undefined' && window.matchMedia('(min-width: 64rem)').matches)
  useEffect(() => {
    if (!labelledBy) return
    // Match lg exactly: hidden IDREFs still name elements, so switch the
    // accessible label with the layout rather than listing both headlines.
    const media = window.matchMedia('(min-width: 64rem)')
    const update = (): void => setDesktop(media.matches)
    update()
    media.addEventListener('change', update)
    return () => media.removeEventListener('change', update)
  }, [labelledBy])
  const input = { now, graceMinutes }
  const registerQueue = orderByAttention(rows, input).filter((row) => needsDecision(rowState(row, input)))
  const reviewingExceptions = exceptionRows !== undefined
  const dayRows = new Map(rows.map((row) => [row.case_id, row]))
  const queue = reviewingExceptions
    ? exceptionRows.map((exception) => ({ item: exception, day: dayRows.get(exception.case_id), exception }))
    : registerQueue.map((day) => ({ item: day, day, exception: null }))

  const reasonLabel = (code: string | null | undefined): string | null =>
    code
      ? t(`attendance.review.reasons.${code.toLowerCase()}`, {
          defaultValue: code.replaceAll('_', ' ').toLowerCase().replace(/^./, (letter) => letter.toUpperCase()),
        })
      : null

  return (
    <aside
      id={id}
      tabIndex={-1}
      aria-labelledby={labelledBy && desktop ? labelledBy : titleId}
      className="rounded-2xl border border-hairline bg-surface focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      data-testid="attendance-attention-queue"
    >
      <header className="border-b border-hairline px-4 py-3">
        <div className={cn('flex items-center gap-2.5', labelledBy && 'lg:hidden')}>
          <h3 id={titleId} className="text-[0.82em] font-bold">{t('attendance.attention.title')}</h3>
          {queue.length > 0 && (
            <span className="rounded-full bg-accent-soft px-2 py-0.5 font-mono text-[0.72em] font-bold text-accent">
              <bdi dir="ltr">{queue.length}</bdi>
            </span>
          )}
        </div>
        {labelledBy && <p className="mt-1 text-xs leading-relaxed text-muted-foreground lg:mt-0">{t('attendance.attention.scope')}</p>}
      </header>

      {queue.length === 0 ? (
        <p className="px-4 py-4 text-[0.78em] text-muted-foreground">{t('attendance.attention.none')}</p>
      ) : (
        <ul>
          {queue.map(({ item, day, exception }) => {
            const name = pickEmployeeName({ name_en: item.name_en, name_ar: item.name_ar ?? null }, i18n.language)
            // Exceptions carry no punch bounds. Only the matching day row can
            // supply a verdict; an unmatched exception keeps its reason text.
            const state = day ? rowState(day, input) : null
            const onSite = day ? isOnSiteNow(day, input) : false
            const label = state && day
              ? attendanceStatusLabel(t, state, { onSite, hasOut: outAt(day) !== null, leaveLabel: day.leave_label, corrected: day.corrected })
              : null
            const detail = exception
              ? exception.missing_checkout
                ? t('attendance.review.reasons.missing_checkout')
                : exception.late_minutes
                  ? t('attendance.pastGrace', { minutes: exception.late_minutes })
                  : exception.early_exit_minutes
                    ? t('attendance.review.reasons.early_exit')
                    : reasonLabel(exception.reason_code)
              : state === 'late' && day
                ? t('attendance.pastGrace', { minutes: minutesPastGrace(day, input) })
                : state === 'unpaired' && day
                  ? siteTime(inAt(day))
                  : null
            return (
              <li key={item.case_id} className="border-b border-hairline px-4 py-2.5 last:border-b-0">
                <div className="flex items-center gap-2.5">
                  <button
                    type="button"
                    onClick={() => onOpenEmployee(item.employee_id)}
                    className="flex min-h-11 min-w-0 flex-1 items-center gap-2.5 rounded-md text-start hover:bg-surface-raised focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    {state && <AttendanceStatusDot state={state} onSite={onSite} corrected={day?.corrected} />}
                    <span className="min-w-0 flex-1">
                      <span dir="auto" className="block text-[0.8em] font-semibold leading-snug">{name}</span>
                      <span className="block text-[0.72em] text-muted-foreground">
                        <span dir="auto">{item.duty_post}</span>
                        {' · '}{t(`attendance.shift.${item.shift_code}`, item.shift_code ?? '')}
                        {' · '}<bdi dir="ltr">{item.employee_id}</bdi>
                      </span>
                      {label && (
                        <span className="block text-[0.76em]">
                          {label}{onSite && state !== 'verified' ? ` · ${t('attendance.state.onSite')}` : ''}
                        </span>
                      )}
                      {detail && <span className="isolate-bidi block text-[0.72em] text-muted-foreground">{detail}</span>}
                    </span>
                  </button>
                  <CorrectAttendanceButton
                    target={{ caseId: item.case_id, employeeId: item.employee_id, employeeName: name, operationalDate, shiftCode: item.shift_code }}
                    className="[@media(pointer:coarse)]:h-11 [@media(pointer:coarse)]:w-11"
                  />
                </div>
                {onReviewCase && (
                  <button
                    type="button"
                    onClick={() => onReviewCase(item.case_id)}
                    className="mt-2 inline-flex min-h-11 items-center rounded-lg border border-hairline px-2.5 text-[0.76em] font-semibold text-primary transition-colors hover:bg-surface-tinted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    {t('attendance.review.review', { name })}
                  </button>
                )}
              </li>
            )
          })}
        </ul>
      )}
    </aside>
  )
}
