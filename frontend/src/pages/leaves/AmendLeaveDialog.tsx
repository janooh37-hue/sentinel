/**
 * AmendLeaveDialog — post-approval date change for an Approved request-kind
 * leave. Start and end are editable; the new day count is derived; a reason
 * is required and is sent to the employee with the notification. The approval
 * chain stands. Used by BOTH detail surfaces (RecordExpansion + LeaveDetailDrawer).
 */
import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'

import type { LeaveListItem, LeaveRead } from '@/lib/api'
import {
  DialogRoot,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'

import { useLeaveDecisionActions } from './useLeaveDecisionActions'

// ─── types ───────────────────────────────────────────────────────────────────

type AmendableLeave = Pick<
  LeaveListItem | LeaveRead,
  'id' | 'employee_id' | 'leave_type' | 'start_date' | 'end_date' | 'days'
>

interface Props {
  open: boolean
  leave: AmendableLeave
  onOpenChange: (open: boolean) => void
  onAmended: () => void
}

export function AmendLeaveDialog({ open, leave, onOpenChange, onAmended }: Props): React.JSX.Element {
  const { t } = useTranslation()
  const [startDate, setStartDate] = useState(leave.start_date.slice(0, 10))
  const [endDate, setEndDate] = useState(leave.end_date.slice(0, 10))
  const [reason, setReason] = useState('')

  // The dialog stays mounted in both surfaces — re-seed local state each time
  // it opens so a second amend starts from the record's current values.
  useEffect(() => {
    if (open) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setStartDate(leave.start_date.slice(0, 10))
      setEndDate(leave.end_date.slice(0, 10))
      setReason('')
    }
  }, [open, leave.start_date, leave.end_date])

  const { amendMutation } = useLeaveDecisionActions({
    leaveId: leave.id,
    employeeId: leave.employee_id,
    onMutated: () => {
      onAmended()
      onOpenChange(false)
    },
  })

  const newDays = useMemo(() => {
    const start = new Date(startDate)
    const end = new Date(endDate)
    return Math.round((end.getTime() - start.getTime()) / 86_400_000) + 1
  }, [startDate, endDate])

  const canSave = reason.trim().length > 0 && newDays >= 1 && !amendMutation.isPending

  return (
    <DialogRoot open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t('leaves.amend.title')}</DialogTitle>
          <DialogDescription>{t('leaves.amend.help')}</DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-3 overflow-y-auto px-4 py-4 text-sm">
          {/* Leave dates — both editable */}
          <div className="grid grid-cols-2 gap-3">
            <div className="flex flex-col gap-1.5">
              <label
                htmlFor="amend-start-date"
                className="text-xs text-muted-foreground"
              >
                {t('leaves.amend.startDate')}
              </label>
              <input
                id="amend-start-date"
                type="date"
                value={startDate}
                max={endDate}
                onChange={(e) => setStartDate(e.target.value)}
                className="h-9 rounded-md border border-input bg-surface px-3 font-mono text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              />
            </div>

            <div className="flex flex-col gap-1.5">
              <label
                htmlFor="amend-end-date"
                className="text-xs text-muted-foreground"
              >
                {t('leaves.amend.endDate')}
              </label>
              <input
                id="amend-end-date"
                type="date"
                value={endDate}
                min={startDate}
                onChange={(e) => setEndDate(e.target.value)}
                className="h-9 rounded-md border border-input bg-surface px-3 font-mono text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              />
            </div>
          </div>

          {/* New duration line */}
          <p className="text-xs text-muted-foreground">
            {t('leaves.amend.newDuration', { days: newDays, oldDays: leave.days })}
          </p>

          {/* Reason (required) */}
          <div className="flex flex-col gap-1.5">
            <label
              htmlFor="amend-reason"
              className="text-xs text-muted-foreground"
            >
              {t('leaves.amend.reason')}
            </label>
            <textarea
              id="amend-reason"
              value={reason}
              rows={3}
              dir="auto"
              onChange={(e) => setReason(e.target.value)}
              className="resize-none rounded-md border border-input bg-surface px-3 py-1.5 text-sm text-foreground placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            />
          </div>
        </div>

        {/* Footer */}
        <div className="flex justify-end gap-2 border-t border-border px-4 py-3">
          <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
            {t('common.cancel')}
          </Button>
          <Button
            type="button"
            disabled={!canSave}
            onClick={() =>
              amendMutation.mutate({ start_date: startDate, end_date: endDate, reason: reason.trim() })
            }
          >
            {t('leaves.amend.save')}
          </Button>
        </div>
      </DialogContent>
    </DialogRoot>
  )
}
