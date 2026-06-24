/**
 * Leaves tab — full leave history via `listEmployeeLeaves`.
 *
 * Fetches the complete leave list for the employee (not the 10-item aggregate
 * slice). Falls back to the passed `leaves` while the query is pending.
 */

import { useQuery } from '@tanstack/react-query'
import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'

import { api } from '@/lib/api'
import type { LeaveRead, RecentLeaveRead } from '@/lib/api'

const STATUS_CLS: Record<string, string> = {
  Approved: 'bg-success-soft text-success',
  Rejected: 'bg-accent-soft text-accent',
  Pending: 'bg-warning-soft text-warning',
  Generated: 'bg-primary-soft text-primary',
}

/** Shared leave row shape used by both LeaveRead and RecentLeaveRead. */
type LeaveRow = Pick<LeaveRead | RecentLeaveRead, 'id' | 'leave_type' | 'start_date' | 'end_date' | 'days' | 'status'>

interface Props {
  employeeId: string
  /** Initial snapshot from the aggregate response (shown while the full list loads). */
  leaves: RecentLeaveRead[]
}

export function LeavesTab({ employeeId, leaves }: Props): React.JSX.Element {
  const { t, i18n } = useTranslation()
  const dateFmt = useMemo(
    () =>
      new Intl.DateTimeFormat(i18n.language, {
        year: 'numeric',
        month: 'short',
        day: 'numeric',
      }),
    [i18n.language],
  )

  const { data: fullLeaves } = useQuery({
    queryKey: ['employee-leaves', employeeId],
    queryFn: () => api.listEmployeeLeaves(employeeId),
  })

  const rows: LeaveRow[] = fullLeaves ?? leaves

  if (rows.length === 0) {
    return (
      <div className="rounded-2xl bg-surface p-12 text-center text-muted-foreground">
        {t('employee.leaves.empty')}
      </div>
    )
  }
  return (
    <div className="overflow-hidden rounded-2xl border border-hairline bg-surface">
      {rows.map((l) => (
        <div
          key={l.id}
          className="grid grid-cols-[1fr_120px_120px_60px_100px] items-center gap-4 border-b border-hairline px-4 py-2.5 last:border-b-0"
        >
          <div className="text-[0.92em] font-medium">{l.leave_type}</div>
          <div className="font-mono text-[0.86em] text-muted-foreground">
            {dateFmt.format(new Date(l.start_date))}
          </div>
          <div className="font-mono text-[0.86em] text-muted-foreground">
            {dateFmt.format(new Date(l.end_date))}
          </div>
          <div className="text-end text-[0.86em] font-semibold">{l.days}d</div>
          <span
            className={`rounded-full px-3 py-0.5 text-center text-[0.72em] font-semibold ${
              STATUS_CLS[l.status] ?? 'bg-surface-tinted text-muted-foreground'
            }`}
          >
            {l.status}
          </span>
        </div>
      ))}
    </div>
  )
}
