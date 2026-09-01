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
import { splitBilingual } from '@/lib/bilingualValue'
import { StatusBadge } from '@/pages/leaves/StatusBadge'
import type { PreviewDoc } from '@/lib/docPreview'

/** Shared leave row shape used by both LeaveRead and RecentLeaveRead. */
type LeaveRow = Pick<
  LeaveRead | RecentLeaveRead,
  'id' | 'leave_type' | 'start_date' | 'end_date' | 'days' | 'status' | 'linked_documents'
>

interface Props {
  employeeId: string
  /** Initial snapshot from the aggregate response (shown while the full list loads). */
  leaves: RecentLeaveRead[]
  onPreviewDocs: (docs: PreviewDoc[], index?: number) => void
}

export function LeavesTab({
  employeeId,
  leaves,
  onPreviewDocs,
}: Props): React.JSX.Element {
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
      {rows.map((l) => {
        const linkedDocuments = l.linked_documents ?? []
        const rowClassName =
          'grid w-full grid-cols-[1fr_120px_120px_60px_100px] items-center gap-4 border-b border-hairline px-4 py-2.5 last:border-b-0'
        const content = (
          <>
            <div className="text-[0.92em] font-medium">
              {t(`leaves.type.${l.leave_type}`, {
                defaultValue: splitBilingual(l.leave_type, i18n.language),
              })}
            </div>
            <div className="font-mono text-[0.86em] text-muted-foreground">
              {dateFmt.format(new Date(l.start_date))}
            </div>
            <div className="font-mono text-[0.86em] text-muted-foreground">
              {dateFmt.format(new Date(l.end_date))}
            </div>
            <div className="text-end text-[0.86em] font-semibold">{l.days}d</div>
            <div className="text-center">
              <StatusBadge status={l.status} />
            </div>
          </>
        )

        return linkedDocuments.length > 0 ? (
          <button
            key={l.id}
            type="button"
            className={`${rowClassName} text-start transition-colors hover:bg-surface-tinted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1`}
            onClick={() =>
              onPreviewDocs(
                linkedDocuments.map((document) => ({
                  id: document.id,
                  name: document.template_id,
                })),
              )
            }
          >
            {content}
          </button>
        ) : (
          <div key={l.id} className={rowClassName}>
            {content}
          </div>
        )
      })}
    </div>
  )
}
