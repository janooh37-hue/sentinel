/**
 * AttentionQueue — the same ordered list the hero card counts.
 *
 * One list, three places: the hero card's number, the section tab's badge and
 * this rail all come from `orderByAttention`, so the number you saw is the work
 * you get.
 */

import { useTranslation } from 'react-i18next'

import { pickEmployeeName } from '@/lib/employeeName'

import type { AttendanceRow } from './attendanceModel'
import { needsDecision, orderByAttention, rowState, siteTime } from './attendanceModel'

interface Props {
  rows: readonly AttendanceRow[]
  now: Date
  graceMinutes?: number
  onOpenEmployee: (employeeId: string) => void
}

export function AttentionQueue({
  rows,
  now,
  graceMinutes,
  onOpenEmployee,
}: Props): React.JSX.Element {
  const { t, i18n } = useTranslation()
  const input = { now, graceMinutes }
  const queue = orderByAttention(rows, input).filter((row) => needsDecision(rowState(row, input)))

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
        <p className="px-4 py-4 text-[0.78em] text-muted-foreground">
          {t('attendance.attention.none')}
        </p>
      ) : (
        <ul>
          {queue.map((row) => {
            const state = rowState(row, input)
            const name = pickEmployeeName(
              { name_en: row.name_en, name_ar: row.name_ar ?? null },
              i18n.language,
            )
            return (
              <li key={`${row.employee_id}-${row.shift_code}`} className="border-b border-hairline last:border-b-0">
                <button
                  type="button"
                  onClick={() => onOpenEmployee(row.employee_id)}
                  className="flex w-full items-center gap-2.5 px-4 py-2.5 text-start hover:bg-surface-raised"
                >
                  <i
                    aria-hidden
                    className={`h-2.5 w-2.5 shrink-0 rounded-full ${
                      state === 'late' ? 'bg-warning' : 'bg-accent'
                    }`}
                  />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[0.8em] font-semibold">{name}</span>
                    <span className="block truncate text-[0.68em] text-faint">
                      {row.duty_post} · {t(`attendance.shift.${row.shift_code}`, row.shift_code ?? '')} ·{' '}
                      {row.employee_id}
                    </span>
                  </span>
                  <span className="shrink-0 font-mono text-[0.72em] font-bold text-accent">
                    {state === 'missing'
                      ? t('attendance.state.missing')
                      : state === 'single'
                        ? siteTime(row.first_punch_at)
                        : `+${row.late_minutes ?? 0}m`}
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
