/**
 * ReturnFormDialog — file the Duty Resumption (return) form for a returnable
 * leave. Pre-fills leave start/end (read-only) + leave type; resumption date
 * defaults to today and is editable; optional delay reason. On success the
 * leave is Completed.
 */

import { useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'

import { api, type LeaveListItem, type LeaveRead, apiErrorMessage } from '@/lib/api'
import {
  DialogRoot,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'

// ─── types ───────────────────────────────────────────────────────────────────

type ReturnableLeave = Pick<
  LeaveListItem | LeaveRead,
  'id' | 'employee_id' | 'leave_type' | 'start_date' | 'end_date'
>

export interface ReturnFormDialogProps {
  open: boolean
  leave: ReturnableLeave
  onOpenChange: (open: boolean) => void
  onFiled: () => void
}

// ─── helpers ─────────────────────────────────────────────────────────────────

function todayIso(): string {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

// ─── component ───────────────────────────────────────────────────────────────

export function ReturnFormDialog({
  open,
  leave,
  onOpenChange,
  onFiled,
}: ReturnFormDialogProps): React.JSX.Element {
  const { t } = useTranslation()
  const qc = useQueryClient()

  const [resumption, setResumption] = useState(todayIso)
  const [delayReason, setDelayReason] = useState('')

  const mutation = useMutation({
    mutationFn: () =>
      api.fileLeaveReturn(leave.id, {
        resumption_date: resumption,
        delay_reason: delayReason || undefined,
      }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['leaves-list'] })
      void qc.invalidateQueries({ queryKey: ['leave', leave.id] })
      void qc.invalidateQueries({ queryKey: ['leave-balance', leave.employee_id] })
      void qc.invalidateQueries({ queryKey: ['books'] })
      toast.success(t('leaves.return.filed'))
      onFiled()
      onOpenChange(false)
    },
    onError: (err) => toast.error(apiErrorMessage(err)),
  })

  const resumptionInvalid = !!resumption && resumption < leave.start_date.slice(0, 10)

  return (
    <DialogRoot open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t('leaves.return.title')}</DialogTitle>
          <DialogDescription>{t('leaves.return.description')}</DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-3 overflow-y-auto px-4 py-4 text-sm">
          {/* Leave dates (read-only) */}
          <div className="grid grid-cols-2 gap-3">
            <div className="flex flex-col gap-1">
              <span className="text-xs text-muted-foreground">
                {t('leaves.return.leaveStart')}
              </span>
              <div className="font-mono">{leave.start_date.slice(0, 10)}</div>
            </div>
            <div className="flex flex-col gap-1">
              <span className="text-xs text-muted-foreground">
                {t('leaves.return.leaveEnd')}
              </span>
              <div className="font-mono">{leave.end_date.slice(0, 10)}</div>
            </div>
          </div>

          {/* Resumption date */}
          <div className="flex flex-col gap-1.5">
            <label
              htmlFor="return-resumption"
              className="text-xs text-muted-foreground"
            >
              {t('leaves.return.resumptionDate')}
            </label>
            <input
              id="return-resumption"
              type="date"
              value={resumption}
              min={leave.start_date.slice(0, 10)}
              aria-label={t('leaves.return.resumptionDate')}
              onChange={(e) => setResumption(e.target.value)}
              className="h-9 rounded-md border border-input bg-surface px-3 font-mono text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            />
          </div>

          {/* Delay reason (optional) */}
          <div className="flex flex-col gap-1.5">
            <label
              htmlFor="return-delay-reason"
              className="text-xs text-muted-foreground"
            >
              {t('leaves.return.delayReason')}
            </label>
            <textarea
              id="return-delay-reason"
              value={delayReason}
              rows={2}
              dir="auto"
              onChange={(e) => setDelayReason(e.target.value)}
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
            onClick={() => mutation.mutate()}
            disabled={mutation.isPending || resumptionInvalid}
          >
            {t('leaves.return.fileButton')}
          </Button>
        </div>
      </DialogContent>
    </DialogRoot>
  )
}
