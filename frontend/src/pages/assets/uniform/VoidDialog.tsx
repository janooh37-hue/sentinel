import { useId, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { DialogBody, DialogFooter, DialogShell, Field, FormAlert } from '@/components/forms/DialogShell'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { toast } from '@/lib/toast'
import { useCapabilities } from '@/lib/useCapabilities'
import { uniformErrorMessage, useVoidUniformAdjustment, useVoidUniformIssue, useVoidUniformReceipt, useVoidUniformReturn } from './uniformQueries'

export type UniformVoidKind = 'receipt' | 'issue' | 'return' | 'adjustment'
const MAX_REASON = 500

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
  const [reason, setReason] = useState('')
  const [touched, setTouched] = useState(false)
  const trimmed = reason.trim()
  const problem = !trimmed ? t('assets.uniform.errors.reasonRequired') : trimmed.length > MAX_REASON ? t('assets.uniform.errors.reasonTooLong') : ''
  return <DialogShell open={open} onOpenChange={onOpenChange} title={t('assets.uniform.voidConfirmTitle')} description={t('assets.uniform.voidConfirm')} size="md" busy={mutation.isPending} returnFocusRef={returnFocusRef}>
    <form noValidate aria-busy={mutation.isPending} className="flex min-h-0 flex-1 flex-col" onSubmit={event => {
      event.preventDefault()
      setTouched(true)
      if (problem || mutation.isPending) return
      mutation.mutate({ id: recordId, body: { reason: trimmed } }, {
        onSuccess: () => {
          toast.success(t('assets.uniform.voidSaved'))
          onVoided?.()
          onOpenChange(false)
        },
      })
    }}>
      <DialogBody>
        <FormAlert id={`${id}-error`} message={mutation.error ? uniformErrorMessage(mutation.error) : null} />
        <Field id={`${id}-reason`} label={t('assets.uniform.voidReason')} required error={touched && problem ? problem : undefined}>
          <Textarea id={`${id}-reason`} dir="auto" rows={3} required aria-invalid={touched && !!problem} disabled={mutation.isPending} value={reason}
            onChange={event => setReason(event.target.value)} onBlur={() => setTouched(true)} />
        </Field>
      </DialogBody>
      <DialogFooter>
        <Button type="button" variant="secondary" className="min-h-11" disabled={mutation.isPending} onClick={() => onOpenChange(false)}>{t('assets.uniform.cancel')}</Button>
        <Button type="submit" variant="destructive" className="min-h-11" disabled={mutation.isPending}>{t('assets.uniform.voidRecord')}</Button>
      </DialogFooter>
    </form>
  </DialogShell>
}
