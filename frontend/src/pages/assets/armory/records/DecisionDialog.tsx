import { useId, useState } from 'react'
import type { FormEvent } from 'react'

import { Button } from '@/components/ui/button'
import { DialogContent, DialogDescription, DialogHeader, DialogRoot, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { ApiError } from '@/lib/api'
import type { ArmoryBatchRef, ArmoryDecisionBatchInput, ArmoryDecisionCreate, ArmoryDiscrepancyRead, ArmoryPersonCandidateRead } from '@/lib/api'
import { useAuth } from '@/lib/authContext'
import { normalizeDigits } from '@/lib/utils'
import { displayDate, Ltr, useArmoryLocale } from '../armoryFormat'
import { armoryErrorMessage, isArmoryAccessError, useArmoryAccess, useArmoryItem, useDecideArmoryDiscrepancy } from '../armoryQueries'
import { ArmoryPersonPicker } from '../dialogs/ArmoryPersonPicker'
import { DecisionQuantities } from './auditDecisionEvidence'
import { AuditLoadError, AuditLoading } from './auditDisplay'
import { parseAuditQuantity } from './auditInput'

interface DecisionDialogProps {
  discrepancy: ArmoryDiscrepancyRead
  onClose(): void
  onSaved?(result: ArmoryDiscrepancyRead): void
  onRestoreFocus?(): void
}

type Outcome = ArmoryDecisionCreate['outcome']

export function DecisionDialog(props: DecisionDialogProps): React.JSX.Element {
  const { canEdit, principal } = useArmoryAccess()
  if (!canEdit || !props.discrepancy.can_decide || props.discrepancy.status !== 'open') return <></>
  return <DecisionForm key={`${principal}:${props.discrepancy.id}`} {...props} />
}

function DecisionForm({ discrepancy, onClose, onSaved, onRestoreFocus }: DecisionDialogProps) {
  const { t, name } = useArmoryLocale()
  const { user } = useAuth()
  const id = useId()
  const [outcome, setOutcome] = useState<Outcome | null>(null)
  const [note, setNote] = useState('')
  const [witness, setWitness] = useState<ArmoryPersonCandidateRead | null>(null)
  const [allocation, setAllocation] = useState<Record<number, string>>({})
  const mutation = useDecideArmoryDiscrepancy()
  const difference = discrepancy.observed_qty - discrepancy.expected_qty
  const needsBatches = discrepancy.kind === 'monthly_quantity' && discrepancy.item.kind === 'expiry'
    && ((difference > 0 && outcome === 'found') || (difference < 0 && outcome === 'lost'))
  const item = useArmoryItem(needsBatches ? discrepancy.item.id : null, difference < 0 ? discrepancy.safe.id : null)
  const knownBatches = new Map<number, ArmoryBatchRef>()
  if (needsBatches && !item.isError && item.data) {
    for (const { batch } of item.data.batches) knownBatches.set(batch.id, batch)
  }
  const batches: ArmoryDecisionBatchInput[] = []
  let totalAllocated = 0
  let invalidAllocation = false
  if (needsBatches) {
    for (const batch of knownBatches.values()) {
      const raw = allocation[batch.id]?.trim()
      if (!raw) continue
      const qty = parseAuditQuantity(raw)
      if (qty === null || qty === 0) invalidAllocation = true
      else {
        batches.push({ batch_id: batch.id, qty })
        totalAllocated += qty
      }
    }
  }

  const error = mutation.error
  const code = error instanceof ApiError ? error.code : null
  const conflict = error instanceof ApiError && error.status === 409
    && (code === 'armory_stale_decision' || code === 'armory_already_decided')
  const batchError = needsBatches && error instanceof ApiError && code === 'armory_invalid_input'
    && typeof error.details.field === 'string' && /^batches(?:\.|$)/.test(error.details.field)
  const invalidWitness = code === 'armory_invalid_witness'
  const noAccess = isArmoryAccessError(error)
  const unavailable = noAccess || conflict || code === 'armory_second_user_required' || code === 'armory_actor_employee_required'
  const disabled = mutation.isPending || unavailable
  const hasRequired = outcome !== null && discrepancy.allowed_outcomes.includes(outcome) && note.trim() !== '' && witness !== null
  const batchesReady = !needsBatches || (!invalidAllocation && totalAllocated === Math.abs(difference))
  const canSave = hasRequired && batchesReady && !batchError && !invalidWitness && !disabled
  const excluded = [discrepancy.recorder.employee?.employee_id, discrepancy.person?.employee_id, user?.employee_id]
    .filter((employeeId): employeeId is string => Boolean(employeeId))

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!canSave || !outcome || !witness) return
    const body: ArmoryDecisionCreate = {
      outcome,
      note: note.trim(),
      witness_employee_id: witness.person.employee_id,
      ...(needsBatches ? { batches } : {}),
    }
    mutation.mutate({ discrepancyId: discrepancy.id, body }, {
      onSuccess: (result) => { onSaved?.(result); onClose() },
    })
  }

  return (
    <DialogRoot open onOpenChange={(open) => { if (!open && !mutation.isPending) onClose() }}>
      <DialogContent
        className="max-h-[calc(100dvh-1rem)] max-w-xl"
        onCloseAutoFocus={(event) => {
          if (onRestoreFocus) { event.preventDefault(); onRestoreFocus() }
        }}
      >
        <DialogHeader className="pe-16">
          <DialogTitle>{t('assets.armory.review')}</DialogTitle>
          {noAccess ? <DialogDescription>{t('assets.armory.audit')}</DialogDescription> : (
            <DialogDescription className="flex flex-wrap items-baseline gap-x-3 gap-y-1 wrap-anywhere">
              <bdi>{name(discrepancy.item)}</bdi>
              {discrepancy.serial_code && <Ltr>{discrepancy.serial_code}</Ltr>}
              <Ltr>{discrepancy.source.record_ref}</Ltr>
            </DialogDescription>
          )}
        </DialogHeader>
        <form className="flex min-h-0 flex-1 flex-col" onSubmit={submit}>
          <div className="min-h-0 space-y-4 overflow-y-auto overscroll-contain p-4">
            {error && !batchError && !invalidWitness && (
              <p role="alert" className="rounded-md bg-accent-soft px-3 py-2 text-sm text-destructive-text">{armoryErrorMessage(error)}</p>
            )}
            {!noAccess && (
              <>
                <DecisionQuantities finding={discrepancy} />
                <fieldset className="min-w-0 space-y-1" disabled={disabled}>
                  <legend className="text-sm font-semibold">{t('assets.armory.outcome')}</legend>
                  <div className="grid gap-1.5 sm:grid-cols-2">
                    {discrepancy.allowed_outcomes.map((option) => (
                      <label key={option} className="flex min-h-11 items-center gap-2 rounded-md border border-input px-3 py-2 text-sm has-checked:bg-primary-soft">
                        <input
                          type="radio"
                          name={`${id}-outcome`}
                          value={option}
                          checked={outcome === option}
                          className="size-4 shrink-0 accent-primary"
                          onChange={() => { setOutcome(option); setAllocation({}); mutation.reset() }}
                        />
                        {t(`assets.armory.decisionOutcome.${option}`)}
                      </label>
                    ))}
                  </div>
                </fieldset>
                {needsBatches && (
                  <fieldset className="min-w-0 space-y-2" disabled={disabled}>
                    <legend className="text-sm font-semibold">{t('assets.armory.batches')}</legend>
                    <p className="text-sm text-muted-foreground">{t('assets.armory.auditPane.allocateBatches')}</p>
                    <dl className="flex flex-wrap gap-4">
                      <div><dt className="text-xs text-muted-foreground">{t('assets.armory.difference')}</dt><dd><Ltr className="tabular-nums">{Math.abs(difference)}</Ltr></dd></div>
                      <div><dt className="text-xs text-muted-foreground">{t('assets.armory.auditPane.allocated')}</dt><dd><Ltr className="tabular-nums">{totalAllocated}</Ltr></dd></div>
                    </dl>
                    {item.isError ? <AuditLoadError error={item.error} onRetry={() => void item.refetch()} /> : !item.data ? <AuditLoading /> : (
                      knownBatches.size ? (
                        <ul className="divide-y divide-hairline rounded-md border border-border">
                          {[...knownBatches.values()].map((batch) => (
                            <li key={batch.id} className="px-3 py-2">
                              <label className="grid grid-cols-[minmax(0,1fr)_6rem] items-center gap-2 text-sm">
                                <span className="wrap-anywhere">
                                  <span className="block font-mono"><Ltr>{batch.batch_ref}</Ltr></span>
                                  <span className="block text-xs text-muted-foreground"><Ltr>{displayDate(batch.expires_on)}</Ltr></span>
                                  <span className="sr-only">{t('assets.armory.quantity')}</span>
                                </span>
                                <Input
                                  dir="ltr"
                                  inputMode="numeric"
                                  className="min-h-11 tabular-nums"
                                  value={allocation[batch.id] ?? ''}
                                  onChange={(event) => {
                                    const value = normalizeDigits(event.target.value)
                                    setAllocation((current) => ({ ...current, [batch.id]: value }))
                                    if (batchError) mutation.reset()
                                  }}
                                />
                              </label>
                            </li>
                          ))}
                        </ul>
                      ) : <p className="text-sm text-muted-foreground">{t('assets.armory.noBatches')}</p>
                    )}
                    {(batchError || invalidAllocation) && (
                      <p role="alert" className="text-sm text-destructive-text">{t('assets.armory.auditPane.invalidBatchAllocation')}</p>
                    )}
                  </fieldset>
                )}
                <div className="space-y-1">
                  <label htmlFor={`${id}-note`} className="block text-sm font-semibold">{t('assets.armory.decisionNote')}</label>
                  <Textarea id={`${id}-note`} dir="auto" required maxLength={500} value={note} disabled={disabled} onChange={(event) => setNote(event.target.value)} />
                </div>
                <ArmoryPersonPicker
                  purpose="witness"
                  safeId={discrepancy.safe.id}
                  label={t('assets.armory.decisionWitness')}
                  value={witness}
                  excludeIds={excluded}
                  disabled={disabled}
                  onChange={(next) => { setWitness(next); if (invalidWitness) mutation.reset() }}
                />
                {error && invalidWitness && <p role="alert" className="text-sm text-destructive-text">{armoryErrorMessage(error)}</p>}
              </>
            )}
          </div>
          <footer className="flex shrink-0 flex-wrap items-center justify-end gap-2 border-t border-border px-4 py-3">
            <p className="me-auto text-sm text-muted-foreground" aria-live="polite">
              {mutation.isPending ? t('assets.armory.auditPane.saving') : !unavailable && !hasRequired ? t('assets.armory.needDecision') : null}
            </p>
            <Button type="button" variant="outline" className="min-h-11" disabled={mutation.isPending} onClick={onClose}>
              {t(unavailable ? 'assets.armory.close' : 'assets.armory.cancel')}
            </Button>
            {!noAccess && <Button type="submit" className="min-h-11" disabled={!canSave}>{t('assets.armory.save')}</Button>}
          </footer>
        </form>
      </DialogContent>
    </DialogRoot>
  )
}
