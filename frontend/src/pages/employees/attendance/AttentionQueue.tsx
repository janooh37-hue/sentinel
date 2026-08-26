import { useTranslation } from 'react-i18next'

import type { AttendanceException } from '@/lib/api'
import { pickEmployeeName } from '@/lib/employeeName'

import type { AttendanceRow } from './attendanceModel'
import {
  isUnpaired,
  minutesPastGrace,
  needsDecision,
  orderByAttention,
  rowState,
  siteTime,
} from './attendanceModel'

interface Props {
  rows: readonly AttendanceRow[]
  exceptionRows?: readonly AttendanceException[]
  now: Date
  graceMinutes?: number
  onOpenEmployee: (employeeId: string) => void
  onReviewCase?: (caseId: number) => void
}

export function AttentionQueue({
  rows,
  exceptionRows,
  now,
  graceMinutes,
  onOpenEmployee,
  onReviewCase,
}: Props): React.JSX.Element {
  const { t, i18n } = useTranslation()
  const input = { now, graceMinutes }
  const registerQueue = orderByAttention(rows, input).filter((row) => needsDecision(rowState(row, input)))
  const reviewingExceptions = exceptionRows !== undefined
  const queue = reviewingExceptions ? exceptionRows : registerQueue

  const reasonLabel = (code: string | null | undefined): string =>
    code
      ? t(`attendance.review.reasons.${code.toLowerCase()}`, {
          defaultValue: code.replaceAll('_', ' ').toLowerCase().replace(/^./, (letter) => letter.toUpperCase()),
        })
      : t('attendance.state.pending')

  return (
    <aside className="rounded-2xl border border-hairline bg-surface" data-testid="attendance-attention-queue">
      <header className="flex items-center gap-2.5 border-b border-hairline px-4 py-3">
        <h3 className="text-[0.82em] font-bold">{t('attendance.attention.title')}</h3>
        {queue.length > 0 && (
          <span className="rounded-full bg-accent-soft px-2 py-0.5 font-mono text-[0.72em] font-bold text-accent">
            {queue.length}
          </span>
        )}
      </header>

      {queue.length === 0 ? (
        <p className="px-4 py-4 text-[0.78em] text-muted-foreground">{t('attendance.attention.none')}</p>
      ) : reviewingExceptions ? (
        <ul>
          {queue.map((row) => {
            const name = pickEmployeeName({ name_en: row.name_en, name_ar: row.name_ar ?? null }, i18n.language)
            const state = row.missing_checkout
              ? t('attendance.review.reasons.missing_checkout')
              : row.late_minutes
                ? t('attendance.pastGrace', { minutes: row.late_minutes })
                : row.early_exit_minutes
                  ? t('attendance.review.reasons.early_exit')
                  : reasonLabel(row.reason_code)
            return (
              <li key={row.case_id} className="border-b border-hairline px-4 py-2.5 last:border-b-0">
                <div className="flex items-center gap-2.5">
                  <button
                    type="button"
                    onClick={() => onOpenEmployee(row.employee_id)}
                    className="min-w-0 flex-1 text-start focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    <span className="block text-[0.8em] font-semibold leading-snug">{name}</span>
                    <span className="block truncate text-[0.68em] text-faint">
                      {row.duty_post} · {t(`attendance.shift.${row.shift_code}`, row.shift_code ?? '')} · {row.employee_id}
                    </span>
                  </button>
                  <span className="shrink-0 font-mono text-[0.72em] font-bold text-accent">{state}</span>
                </div>
                {onReviewCase && (
                  <button
                    type="button"
                    onClick={() => onReviewCase(row.case_id)}
                    className="mt-2 inline-flex min-h-8 items-center rounded-lg border border-hairline px-2.5 text-[0.72em] font-semibold text-primary transition-colors hover:bg-surface-tinted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    {t('attendance.review.review', { name })}
                  </button>
                )}
              </li>
            )
          })}
        </ul>
      ) : (
        <ul>
          {queue.map((row) => {
            const state = rowState(row, input)
            const name = pickEmployeeName({ name_en: row.name_en, name_ar: row.name_ar ?? null }, i18n.language)
            return (
              <li key={`${row.employee_id}-${row.shift_code}`} className="border-b border-hairline last:border-b-0">
                <button
                  type="button"
                  onClick={() => onOpenEmployee(row.employee_id)}
                  className="flex w-full items-center gap-2.5 px-4 py-2.5 text-start hover:bg-surface-raised focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  <i
                    aria-hidden
                    className={`h-2.5 w-2.5 shrink-0 rounded-full ${
                      state === 'late' ? 'bg-warning' : state === 'unpaired' ? 'bg-destructive' : 'bg-accent'
                    }`}
                  />
                  <span className="min-w-0 flex-1">
                    <span className="block text-[0.8em] font-semibold leading-snug">{name}</span>
                    <span className="block truncate text-[0.68em] text-faint">
                      {row.duty_post} · {t(`attendance.shift.${row.shift_code}`, row.shift_code ?? '')} · {row.employee_id}
                    </span>
                  </span>
                  <span className={`shrink-0 font-mono text-[0.72em] font-bold ${state === 'late' ? 'text-warning' : 'text-accent'}`}>
                    {state === 'absent'
                      ? t('attendance.state.absent')
                      : isUnpaired(row, input) && state !== 'late'
                        ? siteTime(row.first_punch_at)
                        : t('attendance.pastGrace', { minutes: minutesPastGrace(row, input) })}
                  </span>
                </button>
              </li>
            )
          })}
        </ul>
      )}
    </aside>
  )
}
