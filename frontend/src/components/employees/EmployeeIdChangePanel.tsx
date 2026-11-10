import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { zodResolver } from '@hookform/resolvers/zod'
import { useForm } from 'react-hook-form'
import { useTranslation } from 'react-i18next'
import { Link, useNavigate } from 'react-router-dom'
import { z } from 'zod'
import { Button } from '@/components/ui/button'
import { api, apiErrorMessage } from '@/lib/api'
import { bidi } from '@/lib/bidi'
import { pickEmployeeName } from '@/lib/employeeName'
import { toast } from '@/lib/toast'
import { useDebouncedValue } from '@/lib/useDebouncedValue'

const correctionSchema = z.object({
  new_id: z.string().trim().toUpperCase().regex(/^G\d{3,4}$/),
  reason: z.string().trim().min(5).max(500),
  confirmation: z.string().trim().toUpperCase(),
}).refine((value) => value.confirmation === value.new_id, { path: ['confirmation'] })
type CorrectionValues = z.input<typeof correctionSchema>

export function EmployeeIdChangePanel({ employeeId, onCancel, unsavedProfileChanges, onDiscardProfileChanges }: {
  employeeId: string
  onCancel: () => void
  /** The correction reopens the editor under the new number, which would drop these. */
  unsavedProfileChanges: boolean
  onDiscardProfileChanges: () => void
}): React.JSX.Element {
  const { t, i18n } = useTranslation()
  const navigate = useNavigate()
  const qc = useQueryClient()
  const [step, setStep] = useState(1)
  const { register, watch, handleSubmit } = useForm<CorrectionValues>({
    resolver: zodResolver(correctionSchema),
    defaultValues: { new_id: '', reason: '', confirmation: '' },
  })
  const newId = watch('new_id').trim().toUpperCase()
  const reason = watch('reason').trim()
  const confirmation = watch('confirmation').trim().toUpperCase()
  const debouncedId = useDebouncedValue(newId, 300)
  const preview = useQuery({
    queryKey: ['employee-id-change-preview', employeeId, debouncedId],
    queryFn: () => api.getEmployeeIdChangePreview(employeeId, debouncedId),
    enabled: debouncedId.length > 0,
    retry: false,
  })
  const currentPreview = newId === debouncedId ? preview.data : undefined
  const canContinue = currentPreview?.status === 'ok' && !preview.isFetching
  const mutation = useMutation({
    mutationFn: (values: z.output<typeof correctionSchema>) => api.changeEmployeeId(employeeId, {
      new_id: values.new_id,
      reason: values.reason,
    }),
    onSuccess: (employee) => {
      void qc.invalidateQueries({ predicate: (query) => query.queryKey.some(
        (part) => typeof part === 'string' && /employee|activity-statement/.test(part),
      ) })
      toast.success(t('employees.idChange.changedToast', { from: employeeId, to: employee.id }))
      navigate(`/employees/${encodeURIComponent(employee.id)}/edit`, {
        replace: true,
        state: { idChanged: { from: employeeId, to: employee.id } },
      })
    },
    onError: (error) => { toast.error(apiErrorMessage(error)) },
  })
  const steps = ['newNumber', 'whatMoves', 'reasonAndConfirm'] as const
  const inputClass = 'min-h-11 w-full rounded-lg border border-border-strong bg-surface px-3 py-2 text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring'
  const ownerName = currentPreview?.owner_id ? pickEmployeeName({
    name_en: currentPreview.owner_name_en || currentPreview.owner_id,
    name_ar: currentPreview.owner_name_ar,
  }, i18n.language) : ''

  return (
    <section aria-label={t('employees.idChange.correct')} className="mt-6 overflow-hidden rounded-2xl border border-border bg-surface text-foreground">
      <ol className="grid grid-cols-3 border-b border-border bg-surface-raised">
        {steps.map((label, index) => (
          <li key={label} aria-current={step === index + 1 ? 'step' : undefined} className={`flex items-center gap-2 p-3 text-sm font-bold md:p-4 ${step === index + 1 ? 'bg-primary-soft text-primary-text' : 'text-muted-foreground'}`}>
            <span className="flex size-7 shrink-0 items-center justify-center rounded-full border border-current font-mono tabular-nums">{index + 1}</span>
            <span className={step !== index + 1 ? 'hidden sm:inline' : ''}>{t(`employees.idChange.${label}`)}</span>
          </li>
        ))}
      </ol>
      <form onSubmit={handleSubmit((values) => { if (step === 3 && canContinue && !unsavedProfileChanges) mutation.mutate(values) })} className="space-y-5 p-4 md:p-6">
        {unsavedProfileChanges && (
          <div role="alert" className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-warning/30 bg-warning-soft p-3 text-sm">
            <p>{t('employees.idChange.unsavedProfile')}</p>
            <Button type="button" variant="outline" className="min-h-11" onClick={onDiscardProfileChanges}>{t('employees.idChange.discardProfile')}</Button>
          </div>
        )}
        {step === 1 && (
          <div className="space-y-3">
            <div className="flex flex-wrap items-end gap-6">
              <div><p className="text-sm font-semibold text-muted-foreground">{t('employees.idChange.current')}</p><p dir="ltr" className="font-mono text-2xl font-bold tabular-nums">{employeeId}</p></div>
              <div className="w-full sm:max-w-xs">
                <label htmlFor="employee-new-number" className="mb-2 block font-bold">{t('employees.idChange.correctNumber')}</label>
                <input {...register('new_id')} id="employee-new-number" dir="ltr" maxLength={5} autoFocus autoComplete="off" spellCheck={false} className={`${inputClass} font-mono tabular-nums uppercase`} aria-describedby="employee-number-preview" aria-invalid={!!currentPreview && currentPreview.status !== 'ok'} />
              </div>
            </div>
            <div id="employee-number-preview" aria-live="polite" className="text-sm">
              {!newId && <p className="text-muted-foreground">{t('employees.idChange.format')}</p>}
              {newId && (!currentPreview || preview.isFetching) && !preview.isError && <p>{t('common.loading')}</p>}
              {preview.isError && newId === debouncedId && <p role="alert" className="text-destructive-text">{apiErrorMessage(preview.error)}</p>}
              {currentPreview?.status === 'invalid' && <p className="text-destructive-text">{t('employees.idChange.invalid')}</p>}
              {currentPreview?.status === 'same' && <p className="text-destructive-text">{t('employees.idChange.same')}</p>}
              {currentPreview?.status === 'taken' && <p className="text-destructive-text">{t('employees.idChange.taken', { id: currentPreview.new_id, name: bidi(ownerName) })}{' '}<Link className="inline-flex min-h-11 items-center font-semibold underline underline-offset-4" to={`/employees/${encodeURIComponent(currentPreview.owner_id!)}`}>{t('employees.idChange.openOwner')}</Link></p>}
              {currentPreview?.status === 'ok' && <p className="text-success">{t('employees.idChange.available', { id: currentPreview.new_id })}</p>}
            </div>
          </div>
        )}
        {step === 2 && (
          <div className="space-y-4">
            <p className="font-semibold">{t('employees.idChange.impactLead', { from: employeeId, to: newId })}</p>
            <dl className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {currentPreview?.impact.filter((item) => item.count > 0).map((item) => (
                <div key={item.key} className="flex justify-between gap-4 rounded-lg bg-surface-tinted p-3"><dt>{t(`employees.idChange.impact.${item.key}`)}</dt><dd className="font-mono font-bold tabular-nums">{item.count}</dd></div>
              ))}
            </dl>
            {currentPreview && !currentPreview.impact.some((item) => item.count > 0) && (
              <p className="text-sm text-muted-foreground">{t('employees.idChange.impactNone')}</p>
            )}
            <p className="rounded-lg bg-info-soft p-3 text-sm">{t('employees.idChange.keepDocuments', { id: employeeId })}</p>
            <p className="rounded-lg bg-surface-tinted p-3 text-sm">{t('employees.idChange.oldSearch', { id: employeeId })}</p>
          </div>
        )}
        {step === 3 && (
          <div className="max-w-2xl space-y-4">
            <div><label htmlFor="employee-number-reason" className="mb-2 block font-bold">{t('employees.idChange.reason')}</label><textarea {...register('reason')} id="employee-number-reason" dir="auto" required minLength={5} maxLength={500} rows={3} autoFocus className={inputClass} aria-describedby="employee-number-reason-hint" /><p id="employee-number-reason-hint" className="mt-2 text-sm text-muted-foreground">{t('employees.idChange.reasonHint')}</p></div>
            <div><label htmlFor="employee-number-confirmation" className="mb-2 block font-bold">{t('employees.idChange.retype', { id: newId })}</label><input {...register('confirmation')} id="employee-number-confirmation" dir="ltr" required autoComplete="off" spellCheck={false} maxLength={5} className={`${inputClass} font-mono tabular-nums uppercase`} aria-invalid={!!confirmation && confirmation !== newId} aria-describedby={confirmation && confirmation !== newId ? 'employee-number-mismatch' : undefined} />{confirmation && confirmation !== newId && <p id="employee-number-mismatch" className="mt-2 text-sm text-destructive-text">{t('employees.idChange.mismatch')}</p>}</div>
          </div>
        )}
        {mutation.isError && <p role="alert" className="text-sm text-destructive-text">{apiErrorMessage(mutation.error)}</p>}
        <div className="flex flex-wrap justify-between gap-3 border-t border-border pt-4">
          <Button type="button" variant="outline" className="min-h-11" disabled={mutation.isPending} onClick={() => step === 1 ? onCancel() : setStep(step - 1)}>{t(step === 1 ? 'common.cancel' : 'employees.idChange.back')}</Button>
          {step < 3 ? <Button type="button" className="min-h-11" disabled={!canContinue} onClick={() => setStep(step + 1)}>{t('employees.idChange.continue')}</Button> : <Button type="submit" className="min-h-11" disabled={!canContinue || unsavedProfileChanges || reason.length < 5 || reason.length > 500 || confirmation !== newId || mutation.isPending}>{mutation.isPending ? t('common.saving') : t('employees.idChange.apply', { from: employeeId, to: newId })}</Button>}
        </div>
      </form>
    </section>
  )
}
