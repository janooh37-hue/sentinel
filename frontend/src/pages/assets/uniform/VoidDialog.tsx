import { zodResolver } from '@hookform/resolvers/zod'
import { useId } from 'react'
import { useForm } from 'react-hook-form'
import { useTranslation } from 'react-i18next'
import { z } from 'zod'

import { DialogBody, DialogFooter, DialogShell, Field, FormAlert } from '@/components/forms/DialogShell'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { toast } from '@/lib/toast'
import { useCapabilities } from '@/lib/useCapabilities'
import { uniformErrorMessage, useVoidUniformAdjustment, useVoidUniformIssue, useVoidUniformReceipt, useVoidUniformReturn } from './uniformQueries'

export type UniformVoidKind = 'receipt' | 'issue' | 'return' | 'adjustment'
const reasonSchema = z.object({
  reason: z.string().trim().min(1, 'assets.uniform.errors.reasonRequired').max(500, 'assets.uniform.errors.reasonTooLong'),
})

interface Props {
  open: boolean
  onOpenChange: (open: boolean) => void
  kind: UniformVoidKind
  recordId: number
  returnFocusRef?: React.RefObject<HTMLElement | null>
  onVoided?: () => void
}

/** Shared reasoned void for every Uniform posting; the server reverses the effect. */
export function VoidDialog(props: Props): React.JSX.Element | null {
  const editable = useCapabilities().has('uniform.edit')
  return editable && props.open ? <VoidContent {...props} /> : null
}

function VoidContent({ open, onOpenChange, kind, recordId, returnFocusRef, onVoided }: Props): React.JSX.Element {
  const { t } = useTranslation()
  const id = useId()
  const mutations = { receipt: useVoidUniformReceipt(), issue: useVoidUniformIssue(), return: useVoidUniformReturn(), adjustment: useVoidUniformAdjustment() }
  const mutation = mutations[kind]
  const form = useForm({ resolver: zodResolver(reasonSchema), defaultValues: { reason: '' }, mode: 'onChange' })
  const problem = form.formState.errors.reason?.message
  return <DialogShell open={open} onOpenChange={onOpenChange} title={t('assets.uniform.voidConfirmTitle')} description={t('assets.uniform.voidConfirm')} size="md" busy={mutation.isPending} returnFocusRef={returnFocusRef}>
    <form noValidate aria-busy={mutation.isPending} className="flex min-h-0 flex-1 flex-col" onSubmit={form.handleSubmit(({ reason }) => {
      if (mutation.isPending) return
      mutation.mutate({ id: recordId, body: { reason } }, {
        onSuccess: () => {
          toast.success(t('assets.uniform.voidSaved'))
          onVoided?.()
          onOpenChange(false)
        },
      })
    })}>
      <DialogBody>
        <FormAlert id={`${id}-error`} message={mutation.error ? uniformErrorMessage(mutation.error) : null} />
        <Field id={`${id}-reason`} label={t('assets.uniform.voidReason')} required error={problem ? t(problem) : undefined}>
          <Textarea id={`${id}-reason`} dir="auto" rows={3} required aria-invalid={!!problem} disabled={mutation.isPending} {...form.register('reason')} />
        </Field>
      </DialogBody>
      <DialogFooter>
        <Button type="button" variant="secondary" className="min-h-11" disabled={mutation.isPending} onClick={() => onOpenChange(false)}>{t('assets.uniform.cancel')}</Button>
        <Button type="submit" variant="destructive" className="min-h-11" disabled={mutation.isPending}>{t('assets.uniform.voidRecord')}</Button>
      </DialogFooter>
    </form>
  </DialogShell>
}
