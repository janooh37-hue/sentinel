/**
 * NationalServiceDialog — manual National Service record creation (the one
 * kind with no DOCX form). Opened from the Services gallery tile via
 * /leaves?ns=new. End date defaults to a 2-week service (start + 13 days,
 * inclusive); extend/delay live on the record afterwards.
 */

import { useEffect, useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'

import { api, apiErrorMessage } from '@/lib/api'
import { todayIso } from '@/lib/leaveDateMath'
import { addDays } from './report/fmt'
import { LeaveEmployeePicker } from './LeaveEmployeePicker'
import {
  DialogRoot,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'

// ─── component ───────────────────────────────────────────────────────────────

interface NationalServiceDialogProps {
  open: boolean
  onClose: () => void
  /** Called with the new record id so the page can deep-open it (?open=). */
  onCreated: (id: number) => void
}

/** Controlled form state, reset each time `open` becomes true. */
interface FormState {
  employeeId: string | null
  start: string
  end: string
  /** True once the user has touched the end-date field. */
  endTouched: boolean
  notes: string
}

function initialState(): FormState {
  const start = todayIso()
  return { employeeId: null, start, end: addDays(start, 13), endTouched: false, notes: '' }
}

/**
 * State is reset via a `useEffect` on `open`: whenever the dialog transitions
 * to open the effect calls `setForm(initialState())`, giving a fresh default
 * start date and a linked end date without remounting the component.
 */
export function NationalServiceDialog({
  open,
  onClose,
  onCreated,
}: NationalServiceDialogProps): React.JSX.Element {
  const { t } = useTranslation()
  const qc = useQueryClient()

  const [form, setForm] = useState<FormState>(initialState)

  // Reset form whenever the dialog opens (re-used instance, not remounted).
  useEffect(() => {
    if (open) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- URL-param / dialog-open hydration
      setForm(initialState())
    }
  }, [open])

  const mutation = useMutation({
    mutationFn: () =>
      api.createLeave({
        employee_id: form.employeeId!,
        leave_type: 'National Service',
        start_date: form.start,
        end_date: form.end,
        notes: form.notes.trim() || null,
      }),
    onSuccess: (row) => {
      void qc.invalidateQueries({ queryKey: ['leaves-list'] })
      toast.success(t('leaves.ns.created'))
      onCreated(row.id)
    },
    onError: (err) =>
      toast.error(apiErrorMessage(err)),
  })

  const canSubmit =
    !!form.employeeId &&
    !!form.start &&
    !!form.end &&
    form.start <= form.end &&
    !mutation.isPending

  function handleStartChange(value: string): void {
    setForm((prev) => ({
      ...prev,
      start: value,
      // Keep the +13-day link until the user explicitly touches End.
      // Guard against empty / invalid ISO strings (mid-edit states).
      end: prev.endTouched || !value ? prev.end : addDays(value, 13),
    }))
  }

  return (
    <DialogRoot open={open} onOpenChange={(o) => { if (!o) onClose() }}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t('leaves.ns.dialogTitle')}</DialogTitle>
          <DialogDescription>{t('leaves.ns.description')}</DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-4 overflow-y-auto px-4 py-4">
          {/* Employee */}
          <div className="flex flex-col gap-1.5">
            <Label>{t('leaves.filters.employee')}</Label>
            <LeaveEmployeePicker
              selectedId={form.employeeId}
              onSelect={(id) => setForm((prev) => ({ ...prev, employeeId: id }))}
              placeholder={t('application.employeePicker.placeholder')}
            />
          </div>

          {/* Start / End dates */}
          <div className="grid grid-cols-2 gap-3">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="ns-start">{t('leaves.ns.start')}</Label>
              <input
                id="ns-start"
                type="date"
                value={form.start}
                onChange={(e) => handleStartChange(e.target.value)}
                className="h-9 rounded-md border border-input bg-surface px-3 font-mono text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="ns-end">{t('leaves.ns.end')}</Label>
              <input
                id="ns-end"
                type="date"
                value={form.end}
                onChange={(e) =>
                  setForm((prev) => ({ ...prev, end: e.target.value, endTouched: true }))
                }
                className="h-9 rounded-md border border-input bg-surface px-3 font-mono text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              />
            </div>
          </div>

          {/* Notes */}
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="ns-notes">{t('leaves.ns.notes')}</Label>
            <textarea
              id="ns-notes"
              rows={3}
              value={form.notes}
              onChange={(e) => setForm((prev) => ({ ...prev, notes: e.target.value }))}
              dir="auto"
              className="min-h-[72px] resize-none rounded-md border border-input bg-surface px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            />
          </div>
        </div>

        {/* Footer */}
        <div className="flex justify-end gap-2 border-t border-border px-4 py-3">
          <Button type="button" variant="ghost" onClick={onClose}>
            {t('common.cancel')}
          </Button>
          <Button
            type="button"
            disabled={!canSubmit}
            onClick={() => mutation.mutate()}
          >
            {t('leaves.ns.create')}
          </Button>
        </div>
      </DialogContent>
    </DialogRoot>
  )
}
