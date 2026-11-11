/** Shared pre-approval editor for request-group leaves on desktop and mobile. */
import { useEffect, useId } from 'react'
import { useForm, useWatch } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { useTranslation } from 'react-i18next'
import { z } from 'zod'

import type { LeaveRead, LeaveUpdate } from '@/lib/api'
import { englishPart, splitBilingual } from '@/lib/bilingualValue'
import {
  DialogRoot,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'

import { leaveEmployeeName } from './leaveEmployeeName'
import { useLeaveDecisionActions } from './useLeaveDecisionActions'

const editSchema = z.object({
  start_date: z.string().min(1, 'dateRequired'),
  end_date: z.string().min(1, 'dateRequired'),
  notes: z.string(),
}).refine((values) => !values.start_date || !values.end_date || values.end_date >= values.start_date, {
  path: ['end_date'],
  message: 'endBeforeStart',
})

type EditValues = z.infer<typeof editSchema>
type EditableLeave = Pick<LeaveRead,
  'id' | 'employee_id' | 'employee_name_en' | 'employee_name_ar' | 'leave_type' | 'start_date' | 'end_date' | 'notes'
>

interface Props {
  open: boolean
  leave: EditableLeave
  onOpenChange: (open: boolean) => void
  onEdited: () => void
}

export function EditLeaveDialog({ open, leave, onOpenChange, onEdited }: Props): React.JSX.Element {
  const { t, i18n } = useTranslation()
  const id = useId()
  const { register, control, handleSubmit, reset, formState: { errors, isDirty } } = useForm<EditValues>({
    resolver: zodResolver(editSchema),
    defaultValues: {
      start_date: leave.start_date.slice(0, 10),
      end_date: leave.end_date.slice(0, 10),
      notes: leave.notes ?? '',
    },
  })
  const [startDate, endDate] = useWatch({ control, name: ['start_date', 'end_date'] })

  useEffect(() => {
    if (open) reset({
      start_date: leave.start_date.slice(0, 10),
      end_date: leave.end_date.slice(0, 10),
      notes: leave.notes ?? '',
    })
  }, [open, leave.id, leave.start_date, leave.end_date, leave.notes, reset])

  const { editMutation } = useLeaveDecisionActions({
    leaveId: leave.id,
    employeeId: leave.employee_id,
    onMutated: () => {
      onEdited()
      onOpenChange(false)
    },
  })

  // ISO date-only parsing is UTC, so inclusive days do not drift across DST.
  const days = Math.round((Date.parse(endDate) - Date.parse(startDate)) / 86_400_000) + 1
  const submit = (values: EditValues): void => {
    const changes: Pick<LeaveUpdate, 'start_date' | 'end_date' | 'notes'> = {}
    if (values.start_date !== leave.start_date.slice(0, 10)) changes.start_date = values.start_date
    if (values.end_date !== leave.end_date.slice(0, 10)) changes.end_date = values.end_date
    if (values.notes !== (leave.notes ?? '')) changes.notes = values.notes
    if (Object.keys(changes).length > 0) editMutation.mutate(changes)
  }

  return (
    <DialogRoot open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t('leaves.edit.title')}</DialogTitle>
          <DialogDescription>{t('leaves.edit.help')}</DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit(submit)} noValidate className="flex min-h-0 flex-col">
          <div className="flex flex-col gap-3 overflow-y-auto px-4 py-4 text-sm">
            <dl className="grid grid-cols-2 gap-3 rounded-md border border-border bg-surface-raised p-3">
              <div className="min-w-0">
                <dt className="text-xs text-muted-foreground">{t('leaves.columns.employee')}</dt>
                <dd className="break-words"><bdi>{leaveEmployeeName(leave, i18n.language)}</bdi></dd>
                <dd className="font-mono text-xs text-muted-foreground"><bdi>{leave.employee_id}</bdi></dd>
              </div>
              <div className="min-w-0">
                <dt className="text-xs text-muted-foreground">{t('leaves.columns.leaveType')}</dt>
                <dd>{t(`leaves.type.${englishPart(leave.leave_type)}`, {
                  defaultValue: splitBilingual(leave.leave_type, i18n.language),
                })}</dd>
              </div>
            </dl>

            <div className="grid grid-cols-2 gap-3">
              <div className="flex flex-col gap-1.5">
                <label htmlFor={`${id}-start`} className="text-xs text-muted-foreground">{t('leaves.edit.startDate')}</label>
                <input
                  id={`${id}-start`}
                  type="date"
                  dir="ltr"
                  aria-invalid={!!errors.start_date}
                  aria-describedby={errors.start_date ? `${id}-start-error` : undefined}
                  className="h-9 min-w-0 rounded-md border border-input bg-surface px-3 font-mono text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  {...register('start_date')}
                />
                {errors.start_date && <p id={`${id}-start-error`} role="alert" className="text-xs text-accent">{t(`leaves.edit.errors.${errors.start_date.message}`)}</p>}
              </div>
              <div className="flex flex-col gap-1.5">
                <label htmlFor={`${id}-end`} className="text-xs text-muted-foreground">{t('leaves.edit.endDate')}</label>
                <input
                  id={`${id}-end`}
                  type="date"
                  dir="ltr"
                  min={startDate}
                  aria-invalid={!!errors.end_date}
                  aria-describedby={errors.end_date ? `${id}-end-error` : undefined}
                  className="h-9 min-w-0 rounded-md border border-input bg-surface px-3 font-mono text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  {...register('end_date')}
                />
                {errors.end_date && <p id={`${id}-end-error`} role="alert" className="text-xs text-accent">{t(`leaves.edit.errors.${errors.end_date.message}`)}</p>}
              </div>
            </div>

            <div className="flex flex-col gap-1.5">
              <label htmlFor={`${id}-days`} className="text-xs text-muted-foreground">{t('leaves.columns.days')}</label>
              <input id={`${id}-days`} readOnly value={Number.isFinite(days) && days > 0 ? days : ''} dir="ltr" className="h-9 rounded-md border border-input bg-surface-raised px-3 font-mono text-sm text-muted-foreground" />
            </div>
            <div className="flex flex-col gap-1.5">
              <label htmlFor={`${id}-notes`} className="text-xs text-muted-foreground">{t('leaves.report.notes')}</label>
              <textarea id={`${id}-notes`} rows={3} dir="auto" className="resize-none rounded-md border border-input bg-surface px-3 py-1.5 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" {...register('notes')} />
            </div>
          </div>

          <div className="flex justify-end gap-2 border-t border-border px-4 py-3">
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>{t('common.cancel')}</Button>
            <Button type="submit" disabled={!isDirty || editMutation.isPending}>{t('leaves.edit.save')}</Button>
          </div>
        </form>
      </DialogContent>
    </DialogRoot>
  )
}
