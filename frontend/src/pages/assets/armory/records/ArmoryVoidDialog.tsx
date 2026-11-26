import { useId, useRef, useState, type FormEvent, type RefObject } from 'react'
import { useTranslation } from 'react-i18next'
import { Link } from 'react-router-dom'

import { Button } from '@/components/ui/button'
import { DialogContent, DialogDescription, DialogHeader, DialogRoot, DialogTitle } from '@/components/ui/dialog'
import { Textarea } from '@/components/ui/textarea'
import { ApiError, type ArmoryPersonCandidateRead, type ArmoryPostingRead } from '@/lib/api'
import { Ltr } from '../ArmoryLtr'
import { armoryErrorMessage, useArmoryAccess, useVoidArmoryMovement } from '../armoryQueries'
import { armoryLink } from '../armoryUrl'
import { ArmoryPersonPicker } from '../dialogs/ArmoryPersonPicker'

interface VoidDialogProps {
  posting: ArmoryPostingRead
  open: boolean
  onClose(posting?: ArmoryPostingRead): void
  returnFocusRef?: RefObject<HTMLElement | null>
  focusFallback?: RefObject<HTMLElement | null>
}

export function ArmoryVoidDialog({ open, ...props }: VoidDialogProps): React.JSX.Element | null {
  const { canEdit, principal } = useArmoryAccess()
  if (!open || !canEdit || principal === null) return null
  return <VoidForm key={`${principal}:${props.posting.id}`} {...props} />
}

function VoidForm({ posting, onClose, returnFocusRef, focusFallback }: Omit<VoidDialogProps, 'open'>) {
  const { t } = useTranslation()
  const id = useId()
  const [reason, setReason] = useState('')
  const [witness, setWitness] = useState<ArmoryPersonCandidateRead | null>(null)
  const [submitted, setSubmitted] = useState(false)
  const reasonInput = useRef<HTMLTextAreaElement>(null)
  const witnessInput = useRef<HTMLInputElement>(null)
  const cancelButton = useRef<HTMLButtonElement>(null)
  const voidSucceeded = useRef(false)
  const mutation = useVoidArmoryMovement()
  const witnessRequired = posting.witness !== null
  const trimmedReason = reason.trim()
  const reasonInvalid = submitted && trimmedReason.length < 3
  const witnessInvalid = submitted && witnessRequired && witness === null
  const conflict = mutation.error instanceof ApiError && mutation.error.status === 409 ? mutation.error : null
  const blocker = conflict?.code === 'armory_void_dependency' ? conflict.details.blocking_posting_id : null
  const unavailable = posting.voided_at !== null || conflict?.code === 'armory_already_voided'
  const exclusions = [posting.actor.employee?.employee_id, posting.witness?.employee_id, posting.person?.employee_id]
    .filter((employeeId): employeeId is string => Boolean(employeeId))

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (mutation.isPending || unavailable) return
    setSubmitted(true)
    if (trimmedReason.length < 3) {
      reasonInput.current?.focus()
      return
    }
    if (witnessRequired && !witness) {
      witnessInput.current?.focus()
      return
    }
    mutation.mutate({ postingId: posting.id, body: { reason: trimmedReason, witness_employee_id: witness?.person.employee_id ?? null } }, {
      onSuccess: (result) => {
        voidSucceeded.current = true
        onClose(result)
      },
    })
  }

  function close() {
    if (!mutation.isPending) onClose()
  }

  return (
    <DialogRoot open onOpenChange={(next) => { if (!next) close() }}>
      <DialogContent hideClose returnFocusRef={returnFocusRef}
        onOpenAutoFocus={(event) => {
          event.preventDefault()
          cancelButton.current?.focus()
        }}
        onCloseAutoFocus={(event) => {
          const target = focusFallback?.current
          if (!target?.isConnected || (!voidSucceeded.current && returnFocusRef?.current?.isConnected)) return
          event.preventDefault()
          target.focus()
        }}>
        <form noValidate onSubmit={submit} className="flex min-h-0 flex-col">
          <DialogHeader className="shrink-0 border-b border-border px-4 py-3 sm:px-6">
            <DialogTitle>{t('assets.armory.movementsPane.voidTitle')}</DialogTitle>
            <DialogDescription className="text-sm">{t('assets.armory.movementsPane.voidConfirm')}</DialogDescription>
            <p className="text-sm font-semibold"><Ltr>{posting.record_ref}</Ltr></p>
          </DialogHeader>
          <div className="min-h-0 space-y-4 overflow-y-auto px-4 py-4 sm:px-6">
            <div className="space-y-1">
              <label htmlFor={`${id}-reason`} className="text-sm font-medium">{t('assets.armory.reason')}</label>
              <Textarea id={`${id}-reason`} ref={reasonInput} value={reason} dir="auto" required maxLength={500}
                aria-invalid={reasonInvalid || undefined} aria-describedby={`${id}-reason-help`}
                disabled={mutation.isPending || unavailable} onChange={(event) => setReason(event.target.value)} />
              <p id={`${id}-reason-help`} role={reasonInvalid ? 'alert' : undefined} className={reasonInvalid ? 'text-xs text-destructive-text' : 'text-xs text-muted-foreground'}>
                {t('assets.armory.movementsPane.voidReasonHelp')}
              </p>
            </div>
            <fieldset className="min-w-0 space-y-1" aria-describedby={witnessInvalid ? `${id}-witness-error` : undefined}>
              <ArmoryPersonPicker purpose="witness" safeId={posting.safe_id} value={witness} onChange={setWitness}
                label={t(witnessRequired ? 'assets.armory.movementsPane.witnessRequired' : 'assets.armory.movementsPane.witnessOptional')}
                excludeIds={exclusions} disabled={mutation.isPending || unavailable} inputRef={witnessInput} />
              {witnessInvalid && <p id={`${id}-witness-error`} role="alert" className="text-xs text-destructive-text">{t('assets.armory.movementsPane.voidWitnessRequired')}</p>}
            </fieldset>
            {mutation.error && (
              <div role="alert" className="space-y-1 rounded-md bg-destructive/10 p-3 text-sm text-destructive-text">
                <p>{conflict?.code === 'armory_void_dependency' ? t('assets.armory.movementsPane.voidDependency')
                  : armoryErrorMessage(mutation.error)}</p>
                {typeof blocker === 'number' && Number.isSafeInteger(blocker) && blocker > 0 && (
                  <Link className="inline-flex min-h-11 items-center text-primary-text underline underline-offset-4"
                    to={armoryLink('audit', { pane: 'movements', movement: blocker })}>
                    {t('assets.armory.movementsPane.viewBlocker')}
                  </Link>
                )}
              </div>
            )}
            {unavailable && conflict?.code !== 'armory_already_voided' && (
              <p role="status" className="text-sm text-muted-foreground">{t('assets.armory.errors.alreadyVoided')}</p>
            )}
          </div>
          <footer className="flex shrink-0 flex-wrap justify-end gap-2 border-t border-border px-4 py-3 sm:px-6">
            <Button ref={cancelButton} type="button" variant="outline" className="min-h-11" disabled={mutation.isPending} onClick={close}>
              {t(unavailable ? 'assets.armory.close' : 'assets.armory.cancel')}
            </Button>
            <Button type="submit" variant="destructive" className="min-h-11" disabled={mutation.isPending || unavailable}>
              {t(mutation.isPending ? 'assets.armory.movementsPane.voidPending' : 'assets.armory.movementsPane.confirmVoid')}
            </Button>
          </footer>
        </form>
      </DialogContent>
    </DialogRoot>
  )
}
