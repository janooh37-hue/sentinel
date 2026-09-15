/**
 * ReturnFormDialog — file the Duty Resumption (return) form for a returnable
 * leave. Pre-fills leave start/end (read-only) + leave type; resumption date
 * defaults to today and is editable; optional delay reason. Manager +
 * "include manager signature" mirror the Services Duty Resumption template
 * (`ManagerPickerField` / `EmbedSignatureCheckbox`, checked by default) so
 * both filing surfaces share the same manager-signature contract. On success
 * the leave is Completed.
 */

import { useEffect } from 'react'
import { FormProvider, useForm } from 'react-hook-form'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'

import { api, ApiError, type LeaveListItem, type LeaveRead, apiErrorMessage } from '@/lib/api'
import {
  DialogRoot,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { ManagerPickerField } from '@/components/application/fields/ManagerPickerField'
import { EmbedSignatureCheckbox } from '@/components/application/fields/EmbedSignatureCheckbox'

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

interface ReturnFormValues {
  resumption_date: string
  delay_reason: string
  manager_id: number | null
  hand_sign_manager: boolean
}

// ─── helpers ─────────────────────────────────────────────────────────────────

function todayIso(): string {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

function defaultValues(): ReturnFormValues {
  return {
    resumption_date: todayIso(),
    delay_reason: '',
    manager_id: null,
    hand_sign_manager: true,
  }
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

  const form = useForm<ReturnFormValues>({ defaultValues: defaultValues() })
  const { register, handleSubmit, watch, reset } = form
  const resumption = watch('resumption_date')

  // A newly opened leave gets a fresh form; values entered before a failed
  // submit on the SAME leave are preserved (no reset on every render/error).
  useEffect(() => {
    if (open) reset(defaultValues())
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, leave.id])

  const mutation = useMutation({
    mutationFn: (values: ReturnFormValues) =>
      api.fileLeaveReturn(leave.id, {
        resumption_date: values.resumption_date,
        delay_reason: values.delay_reason.trim() || undefined,
        manager_id: values.manager_id,
        embed_manager_signature: values.hand_sign_manager,
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

  const managerSignatureRequired =
    mutation.isError &&
    mutation.error instanceof ApiError &&
    mutation.error.code === 'MANAGER_SIGNATURE_REQUIRED'

  const resumptionInvalid = !!resumption && resumption < leave.start_date.slice(0, 10)

  return (
    <DialogRoot open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t('leaves.return.title')}</DialogTitle>
          <DialogDescription>{t('leaves.return.description')}</DialogDescription>
        </DialogHeader>

        <FormProvider {...form}>
          <form
            className="flex flex-col gap-3 overflow-y-auto px-4 py-4 text-sm"
            onSubmit={handleSubmit((values) => mutation.mutate(values))}
          >
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
              <label htmlFor="return-resumption" className="text-xs text-muted-foreground">
                {t('leaves.return.resumptionDate')}
              </label>
              <input
                id="return-resumption"
                type="date"
                min={leave.start_date.slice(0, 10)}
                aria-label={t('leaves.return.resumptionDate')}
                className="h-9 rounded-md border border-input bg-surface px-3 font-mono text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                {...register('resumption_date')}
              />
            </div>

            {/* Delay reason (optional) */}
            <div className="flex flex-col gap-1.5">
              <label htmlFor="return-delay-reason" className="text-xs text-muted-foreground">
                {t('leaves.return.delayReason')}
              </label>
              <textarea
                id="return-delay-reason"
                rows={2}
                dir="auto"
                className="resize-none rounded-md border border-input bg-surface px-3 py-1.5 text-sm text-foreground placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                {...register('delay_reason')}
              />
            </div>

            {/* Manager + signature */}
            <div className="flex flex-col gap-2 rounded-md border border-border p-3">
              <ManagerPickerField
                name="manager_id"
                label_en="Line Manager"
                label_ar="المدير المباشر"
              />
              <EmbedSignatureCheckbox
                name="hand_sign_manager"
                label_en="Include manager signature"
                label_ar="تضمين توقيع المدير"
                defaultOn
              />
              <p className="text-xs text-muted-foreground">
                {t('leaves.return.managerSignatureHelp')}
              </p>
              {managerSignatureRequired && (
                <span role="alert" className="text-xs text-destructive">
                  {t('leaves.return.managerSignatureRequired')}
                </span>
              )}
            </div>

            {/* Footer */}
            <div className="-mx-4 -mb-4 mt-1 flex justify-end gap-2 border-t border-border px-4 py-3">
              <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
                {t('common.cancel')}
              </Button>
              <Button type="submit" disabled={mutation.isPending || resumptionInvalid}>
                {t('leaves.return.fileButton')}
              </Button>
            </div>
          </form>
        </FormProvider>
      </DialogContent>
    </DialogRoot>
  )
}
