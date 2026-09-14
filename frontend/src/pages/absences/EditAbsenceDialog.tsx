import { useEffect, useState } from 'react'
import { useMutation } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import {
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogRoot,
  DialogTitle,
} from '@/components/ui/dialog'
import { Label } from '@/components/ui/label'
import { api, apiErrorMessage } from '@/lib/api'
import type { AbsenceRegisterRowRead } from '@/lib/api'

interface Props {
  open: boolean
  row: AbsenceRegisterRowRead | null
  onOpenChange: (open: boolean) => void
  onSaved: (employeeId: string) => void
}

export function EditAbsenceDialog({
  open,
  row,
  onOpenChange,
  onSaved,
}: Props): React.JSX.Element {
  const { t, i18n } = useTranslation()
  const [start, setStart] = useState(row?.start_date ?? '')
  const [end, setEnd] = useState(row?.end_date ?? '')
  const [note, setNote] = useState(row?.notes ?? '')

  useEffect(() => {
    if (open && row) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setStart(row.start_date)
      setEnd(row.end_date)
      setNote(row.notes ?? '')
    }
  }, [open, row])

  const mutation = useMutation({
    mutationFn: (targetRow: AbsenceRegisterRowRead) =>
      api.updateEmployeeAbsenceEpisode(targetRow.employee_id, {
        start_date: targetRow.start_date,
        end_date: targetRow.end_date,
        new_start_date: start,
        new_end_date: end,
        note: note.trim() || null,
      }),
    onSuccess: (result, targetRow) => {
      toast.success(t('absences.edit.saved'))

      const skippedOnLeave = result.skipped_on_leave ?? []
      if (skippedOnLeave.length > 0) {
        toast.warning(t('absences.skippedOnLeave', { count: skippedOnLeave.length }))
      }

      if (result.skipped_off_roster.length > 0) {
        toast.warning(
          t('absences.savedWithSkips', {
            count: result.created.length,
            skipped: result.skipped_off_roster.length,
          }),
        )
      }

      onSaved(targetRow.employee_id)
      onOpenChange(false)
    },
    onError: (error) => toast.error(apiErrorMessage(error)),
  })

  if (!row) {
    return <DialogRoot open={false} onOpenChange={onOpenChange} />
  }

  const displayName = i18n.language.startsWith('ar')
    ? (row.employee_name_ar?.trim() || row.employee_name_en?.trim() || '')
    : (row.employee_name_en?.trim() || row.employee_name_ar?.trim() || '')
  const canSave = !!row && start <= end && !mutation.isPending

  return (
    <DialogRoot open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t('absences.edit.title')}</DialogTitle>
          <DialogDescription>{t('absences.edit.description')}</DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-4 overflow-y-auto px-4 py-4 text-sm">
          <p className="truncate text-xs text-muted-foreground" dir="auto">
            {displayName}{' '}
            <span className="font-mono">({row.employee_id})</span>
          </p>

          <div className="grid grid-cols-2 gap-3">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="edit-absence-start">{t('absences.form.start')}</Label>
              <input
                id="edit-absence-start"
                type="date"
                value={start}
                onChange={(event) => setStart(event.target.value)}
                className="h-9 rounded-md border border-input bg-surface px-3 font-mono text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              />
            </div>

            <div className="flex flex-col gap-1.5">
              <Label htmlFor="edit-absence-end">{t('absences.form.end')}</Label>
              <input
                id="edit-absence-end"
                type="date"
                value={end}
                min={start}
                onChange={(event) => setEnd(event.target.value)}
                className="h-9 rounded-md border border-input bg-surface px-3 font-mono text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              />
            </div>
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="edit-absence-note">{t('absences.form.note')}</Label>
            <input
              id="edit-absence-note"
              type="text"
              value={note}
              onChange={(event) => setNote(event.target.value)}
              placeholder={t('absences.form.notePlaceholder')}
              dir="auto"
              className="h-9 rounded-md border border-input bg-surface px-3 text-sm text-foreground placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            />
          </div>
        </div>

        <div className="flex justify-end gap-2 border-t border-border px-4 py-3">
          <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
            {t('common.cancel')}
          </Button>
          <Button type="button" disabled={!canSave} onClick={() => mutation.mutate(row)}>
            {t('absences.edit.save')}
          </Button>
        </div>
      </DialogContent>
    </DialogRoot>
  )
}
