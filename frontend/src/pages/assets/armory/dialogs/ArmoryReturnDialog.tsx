import { useId, useRef, useState } from 'react'
import type { FormEvent, ReactNode } from 'react'

import { Button } from '@/components/ui/button'
import { ConfirmDialog } from '@/components/ui/confirm-dialog'
import { DialogContent, DialogDescription, DialogHeader, DialogRoot, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { NATIVE_SELECT } from '@/components/ui/native-select'
import { Textarea } from '@/components/ui/textarea'
import type { ArmoryAssignmentLineRead, ArmoryPersonCandidateRead, ArmoryReturnLineInput, ArmoryReturnRead, ArmoryShortfallInput } from '@/lib/api'
import { useAuth } from '@/lib/authContext'
import { toast } from '@/lib/toast'
import { cn, normalizeDigits } from '@/lib/utils'
import { Ltr } from '../ArmoryLtr'
import { useArmoryLocale } from '../armoryFormat'
import { armoryErrorMessage, isArmoryAccessError, useArmoryAccess, useArmoryCustodyDetail, useArmoryIssue, useCreateArmoryReturn } from '../armoryQueries'
import { ArmoryPersonPicker } from './ArmoryPersonPicker'

interface Props {
  open: boolean
  assignmentId: number
  kind: 'shift' | 'custody'
  onOpenChange(open: boolean): void
  onSaved(result: ArmoryReturnRead): void
  returnFocusRef: React.RefObject<HTMLElement | null>
}

type LineCondition = NonNullable<ArmoryReturnLineInput['condition']>
type ShortfallReason = ArmoryShortfallInput['reason']

interface LineDraft {
  source: ArmoryAssignmentLineRead
  condition?: LineCondition
  faultNote?: string
  rounds?: string
  reason?: ShortfallReason
  reference?: string
  shortfallNote?: string
}

interface ReturnDraft {
  source: readonly ArmoryAssignmentLineRead[]
  checked: ReadonlyMap<number, LineDraft>
  witness: ArmoryPersonCandidateRead | null
}

const NO_LINES: readonly ArmoryAssignmentLineRead[] = []
const REASONS: readonly ShortfallReason[] = ['training', 'incident', 'lost', 'other']

function sameLine(before: ArmoryAssignmentLineRead, after: ArmoryAssignmentLineRead): boolean {
  return before.id === after.id && before.item.id === after.item.id && before.item.kind === after.item.kind
    && before.qty === after.qty && before.remaining_qty === after.remaining_qty
    && before.serial_id === after.serial_id && before.serial_code === after.serial_code
    && before.batch?.id === after.batch?.id && before.batch?.batch_ref === after.batch?.batch_ref
    && before.batch?.expires_on === after.batch?.expires_on
}

function rebaseDraft(draft: ReturnDraft, source: readonly ArmoryAssignmentLineRead[]): ReturnDraft {
  const checked = new Map<number, LineDraft>()
  for (const line of source) {
    const previous = draft.checked.get(line.id)
    if (line.remaining_qty > 0 && previous && sameLine(previous.source, line)) checked.set(line.id, previous)
  }
  return { source, checked, witness: source.length ? draft.witness : null }
}

function countRounds(value: string, remaining: number): number | null {
  if (!/^\d+$/.test(value)) return null
  const count = Number(value)
  return Number.isSafeInteger(count) && count <= remaining ? count : null
}

function planReturn(checked: ReadonlyMap<number, LineDraft>, custody: boolean) {
  const lines: ArmoryReturnLineInput[] = []
  let needsWitness = custody
  let error = checked.size ? undefined : 'assets.armory.needReturn'
  for (const { source, condition = 'ok', faultNote, rounds, reason, reference, shortfallNote } of checked.values()) {
    const input: ArmoryReturnLineInput = {
      assignment_line_id: source.id, expected_remaining_qty: source.remaining_qty, returned_qty: source.remaining_qty,
    }
    if (source.item.kind === 'ammunition') {
      const count = countRounds(rounds ?? '', source.remaining_qty)
      if (count === null) {
        error ??= 'assets.armory.returns.countWithinOutstanding'
        continue
      }
      input.returned_qty = count
      if (count < source.remaining_qty) {
        needsWitness = true
        const ref = reference?.trim() ?? ''
        const note = shortfallNote?.trim() ?? ''
        if (!reason || !/^.{3,80}$/u.test(ref) || !/[\p{L}\p{Nd}].*[\p{L}\p{Nd}]/u.test(ref)) {
          error ??= 'assets.armory.needShortfall'
          continue
        }
        if (reason === 'other' && [...note].length < 3) {
          error ??= 'assets.armory.needReasonDetail'
          continue
        }
        input.shortfall = { reason, reference: ref, ...(reason === 'other' ? { note } : {}) }
      }
    } else if (source.serial_id !== null) {
      input.condition = condition
      if (condition === 'repair') {
        const fault = faultNote?.trim() ?? ''
        if ([...fault].length < 3) {
          error ??= 'assets.armory.needFault'
          continue
        }
        input.fault_note = fault
      }
    }
    lines.push(input)
  }
  return { lines, needsWitness, error }
}

/** Reuse approved plural copy while keeping its inserted numeral directionally isolated. */
function CountCopy({ message, count }: { message: 'stillOut' | 'shortfall'; count: number }) {
  const { t } = useArmoryLocale()
  const [before, after] = t(`assets.armory.${message}`, { count, skipInterpolation: true }).split('{{count}}')
  return <>{before}<Ltr className="tabular-nums">{count}</Ltr>{after}</>
}

function LineIdentity({ line }: { line: ArmoryAssignmentLineRead }) {
  const { t, name } = useArmoryLocale()
  return <div className="min-w-0 space-y-1 py-2">
    <p className="break-words text-sm font-semibold"><bdi>{name(line.item)}</bdi></p>
    {line.serial_code && <Ltr className="break-all font-mono text-sm">{line.serial_code}</Ltr>}
    {line.batch && <p className="text-xs text-muted-foreground">
      {t('assets.armory.batchNumber')}: <Ltr className="break-all font-mono">{line.batch.batch_ref}</Ltr>
    </p>}
    <dl className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
      <div className="flex gap-1">
        <dt>{t('assets.armory.returns.originalQty')}:</dt><dd><Ltr className="tabular-nums">{line.qty}</Ltr></dd>
      </div>
      <div className="flex gap-1">
        <dt>{t('assets.armory.returns.outstandingQty')}:</dt><dd><Ltr className="tabular-nums">{line.remaining_qty}</Ltr></dd>
      </div>
    </dl>
  </div>
}

interface LineProps {
  line: ArmoryAssignmentLineRead
  draft: LineDraft | undefined
  onCheck(checked: boolean): void
  onEdit(patch: Partial<Omit<LineDraft, 'source'>>): void
}

function ReturnCheckbox({ checked, onCheck, children, label }: {
  checked: boolean
  onCheck(checked: boolean): void
  children: ReactNode
  label?: string
}) {
  return <label className="inline-flex min-h-11 cursor-pointer items-center gap-2 text-sm font-medium has-disabled:cursor-not-allowed">
    <input type="checkbox" aria-label={label} checked={checked} onChange={event => onCheck(event.target.checked)}
      className="size-4 shrink-0 accent-primary focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring" />
    {children}
  </label>
}

function EquipmentReturnLine({ line, draft, onCheck, onEdit }: LineProps) {
  const { t, name } = useArmoryLocale()
  const id = useId()
  const serial = line.serial_id !== null
  const condition = draft?.condition ?? 'ok'
  const checkboxText = t(serial ? 'assets.armory.serialSeen' : 'assets.armory.returned')
  const checkboxLabel = serial && line.serial_code
    ? t('assets.armory.checkedSerial', { serial: line.serial_code })
    : `${checkboxText}: ${name(line.item)}`
  return <li className="border-b border-hairline last:border-0">
    <div role="group" aria-label={name(line.item)} className="grid grid-cols-[minmax(0,1fr)_auto] items-start gap-x-3">
      <LineIdentity line={line} />
      <ReturnCheckbox checked={!!draft} onCheck={onCheck} label={checkboxLabel}>{checkboxText}</ReturnCheckbox>
      {draft && serial && <div className="col-span-full space-y-3 pb-3">
        <label className="grid gap-1.5 text-sm font-medium">
          {t('assets.armory.condition')}
          <select className={cn(NATIVE_SELECT, 'min-h-11 w-full sm:w-auto sm:justify-self-start')} value={condition}
            onChange={event => onEdit({ condition: event.target.value === 'repair' ? 'repair' : 'ok' })}>
            <option value="ok">{t('assets.armory.ok')}</option>
            <option value="repair">{t('assets.armory.needsRepair')}</option>
          </select>
        </label>
        {condition === 'repair' && <div className="space-y-1.5">
          <label className="block text-sm font-medium" htmlFor={`${id}-fault`}>{t('assets.armory.fault')}</label>
          <Textarea id={`${id}-fault`} dir="auto" maxLength={500} required value={draft.faultNote ?? ''}
            onChange={event => onEdit({ faultNote: event.target.value })} />
        </div>}
      </div>}
    </div>
  </li>
}

function RoundsReturnLine({ line, draft, onCheck, onEdit }: LineProps) {
  const { t } = useArmoryLocale()
  const id = useId()
  const count = draft ? countRounds(draft.rounds ?? '', line.remaining_qty) : null
  const missing = count === null ? 0 : line.remaining_qty - count

  return <li className="space-y-2 border-b border-hairline pb-3 last:border-0 last:pb-0">
    <LineIdentity line={line} />
    <ReturnCheckbox checked={!!draft} onCheck={onCheck}>{t('assets.armory.roundsCounted')}</ReturnCheckbox>
    {draft && <div className="space-y-3">
      <div className="space-y-1.5">
        <label className="block text-sm font-medium" htmlFor={`${id}-rounds`}>{t('assets.armory.roundsReturned')}</label>
        <Input id={`${id}-rounds`} inputMode="numeric" dir="ltr" autoComplete="off" required
          aria-describedby={`${id}-rounds-limit`} value={draft.rounds ?? ''} className="min-h-11 max-w-40 tabular-nums"
          onChange={event => onEdit({ rounds: normalizeDigits(event.target.value) })} />
        <p id={`${id}-rounds-limit`} className="text-xs text-muted-foreground">
          <Ltr className="tabular-nums">0</Ltr>{' '}{t('assets.armory.returns.rangeTo')}{' '}
          <Ltr className="tabular-nums">{line.remaining_qty}</Ltr>
        </p>
      </div>
      {missing > 0 && <section className="space-y-3 rounded-md bg-warning-soft p-3">
        <div>
          <p className="text-sm font-semibold text-warning"><CountCopy message="shortfall" count={missing} /></p>
          <p className="text-sm text-foreground">{t('assets.armory.shortfallHint')}</p>
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="min-w-0 space-y-1.5">
            <label htmlFor={`${id}-reason`} className="block text-sm font-medium">{t('assets.armory.reason')}</label>
            <select id={`${id}-reason`} required className={cn(NATIVE_SELECT, 'min-h-11 w-full')} value={draft.reason ?? ''}
              onChange={event => onEdit({ reason: REASONS.find(reason => reason === event.target.value) })}>
              <option value="">{t('assets.armory.chooseReason')}</option>
              {REASONS.map(reason => <option key={reason} value={reason}>{t(`assets.armory.shortfallReason.${reason}`)}</option>)}
            </select>
          </div>
          <div className="min-w-0 space-y-1.5">
            <label htmlFor={`${id}-reference`} className="block text-sm font-medium">{t('assets.armory.reference')}</label>
            <Input id={`${id}-reference`} dir="ltr" autoComplete="off" spellCheck={false} required maxLength={80}
              aria-describedby={`${id}-reference-hint`} value={draft.reference ?? ''} className="min-h-11"
              onChange={event => onEdit({ reference: event.target.value })} />
            <p id={`${id}-reference-hint`} className="text-xs text-muted-foreground">{t('assets.armory.shortfallReferenceRule')}</p>
          </div>
        </div>
        {draft.reason === 'other' && <div className="space-y-1.5">
          <label htmlFor={`${id}-note`} className="block text-sm font-medium">{t('assets.armory.reasonDetail')}</label>
          <Textarea id={`${id}-note`} dir="auto" maxLength={500} required value={draft.shortfallNote ?? ''}
            onChange={event => onEdit({ shortfallNote: event.target.value })} />
        </div>}
      </section>}
    </div>}
  </li>
}

export function ArmoryReturnDialog(props: Props) {
  const { canEdit, principal } = useArmoryAccess()
  if (!props.open || !canEdit || principal === null) return null
  return <ReturnTask key={`${principal}:${props.kind}:${props.assignmentId}`} {...props} />
}

function ReturnTask({ assignmentId, kind, onOpenChange, onSaved, returnFocusRef }: Props) {
  const { t, name, isAr, overdue } = useArmoryLocale()
  const { user } = useAuth()
  const isCustody = kind === 'custody'
  const issue = useArmoryIssue(isCustody ? null : assignmentId)
  const custody = useArmoryCustodyDetail(isCustody ? assignmentId : null)
  const query = isCustody ? custody : issue
  const mutation = useCreateArmoryReturn()
  const [deniedWrite, setDeniedWrite] = useState<unknown>(null)
  const accessError = deniedWrite || (isArmoryAccessError(query.error) ? query.error : null)
  const record = accessError ? undefined : query.data
  const source = record?.state === 'active' ? record.lines : NO_LINES
  const [draft, setDraft] = useState<ReturnDraft>(() => ({ source, checked: new Map(), witness: null }))
  const [confirmDiscard, setConfirmDiscard] = useState(false)
  const headerRef = useRef<HTMLDivElement>(null)
  const cancelRef = useRef<HTMLButtonElement>(null)
  const validationId = useId()

  // The shared mutation invalidates reads on stale_return. Only confirmations
  // against unchanged lines survive a fresh result, even on a background reload.
  if (draft.source !== source) setDraft(rebaseDraft(draft, source))

  const outstanding = source.filter(line => line.remaining_qty > 0)
  const equipment = outstanding.filter(line => line.item.kind !== 'ammunition')
  const ammunition = outstanding.filter(line => line.item.kind === 'ammunition')
  const plan = planReturn(draft.checked, isCustody)
  const excludeIds = [user?.employee_id, record?.holder.employee?.employee_id, record?.holder.supervisor?.employee_id]
    .filter((id): id is string => Boolean(id))
  const witness = draft.witness && !excludeIds.includes(draft.witness.person.employee_id) ? draft.witness : null
  const validation = plan.error ?? (plan.needsWitness
    ? !user?.employee_id ? 'assets.armory.errors.actorEmployeeRequired' : !witness ? 'assets.armory.returns.needIndependentWitness' : null
    : null)
  const busy = mutation.isPending
  const readBusy = query.fetchStatus !== 'idle'
  const showForm = !!record && outstanding.length > 0
  const canSubmit = showForm && !busy && !readBusy && !query.isError && !mutation.isSuccess && !validation
  const dirty = draft.checked.size > 0 || !!draft.witness
  const title = t(isCustody ? 'assets.armory.endCustody' : 'assets.armory.signin')
  const closeLabel = t('assets.armory.cancel')
  const holder = record?.holder.employee ?? record?.holder.site_safe
  const unconfirmed = outstanding.length - draft.checked.size

  function requestClose() {
    if (busy) return
    if (dirty && !mutation.isSuccess && !accessError) setConfirmDiscard(true)
    else onOpenChange(false)
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!canSubmit) return
    mutation.mutate({
      assignment_id: assignmentId,
      witness_employee_id: plan.needsWitness ? witness?.person.employee_id ?? null : null,
      lines: plan.lines,
    }, {
      onSuccess: result => {
        toast.success(t(isCustody && result.assignment.state === 'ended' ? 'assets.armory.savedEnd' : 'assets.armory.savedReturn'))
        onSaved(result)
      },
      onError: error => {
        if (isArmoryAccessError(error)) {
          setDeniedWrite(error)
          mutation.reset()
        }
      },
    })
  }

  function lineProps(line: ArmoryAssignmentLineRead): LineProps {
    return {
      line,
      draft: draft.checked.get(line.id),
      onCheck(checked) {
        setDraft(current => {
          const next = new Map(current.checked)
          if (checked) next.set(line.id, { source: line })
          else next.delete(line.id)
          return { ...current, checked: next }
        })
      },
      onEdit(patch) {
        setDraft(current => {
          const selected = current.checked.get(line.id)
          if (!selected) return current
          return { ...current, checked: new Map(current.checked).set(line.id, { ...selected, ...patch }) }
        })
      },
    }
  }

  return <>
    <DialogRoot open onOpenChange={open => { if (!open) requestClose() }}>
      <DialogContent dir={isAr ? 'rtl' : 'ltr'} returnFocusRef={returnFocusRef}
        className="inset-0 start-auto end-0 h-dvh max-h-dvh max-w-[35rem] translate-x-0 translate-y-0 rounded-none"
        onOpenAutoFocus={event => { event.preventDefault(); headerRef.current?.focus() }}>
        <DialogHeader className="pe-14 sm:ps-5">
          <div ref={headerRef} tabIndex={-1} className="space-y-1 focus-visible:outline-none">
            <DialogTitle className="text-lg">{title}</DialogTitle>
            <DialogDescription className="flex flex-wrap items-baseline gap-x-3 gap-y-1 text-sm">
              {record ? <>
                {holder && <bdi>{name(holder)}</bdi>}
                {record.holder.employee && <Ltr className="font-mono">{record.holder.employee.employee_id}</Ltr>}
                <Ltr className="font-mono">{record.record_ref}</Ltr>
                <bdi>{name(record.safe)}</bdi>
              </> : t('assets.armory.returns.description')}
            </DialogDescription>
          </div>
        </DialogHeader>
        <form className="flex min-h-0 flex-1 flex-col" onSubmit={submit} noValidate>
          <div className="min-h-0 flex-1 space-y-4 overflow-y-auto overscroll-contain px-4 py-4 sm:px-5">
            {accessError ? <p role="alert" className="text-sm text-destructive-text">{armoryErrorMessage(accessError)}</p> : <>
              {query.isPending && <p role="status" className="text-sm text-muted-foreground">{t('assets.armory.loadingText')}</p>}
              {query.isError && <div className="space-y-2">
                <p role="alert" className="text-sm text-destructive-text">{armoryErrorMessage(query.error)}</p>
                <Button type="button" variant="outline" className="min-h-11" disabled={readBusy} onClick={() => void query.refetch()}>
                  {t('assets.armory.retry')}
                </Button>
              </div>}
              {record && !showForm && <p className="text-sm text-muted-foreground">{t('assets.armory.returns.noOutstanding')}</p>}
              {showForm && <fieldset disabled={busy || mutation.isSuccess} className="min-w-0 space-y-4">
                {!isCustody && record.overdue_minutes !== null && <p className="text-sm font-semibold text-destructive-text">{overdue(record.overdue_minutes)}</p>}
                {equipment.length > 0 && <fieldset className="min-w-0 rounded-lg border border-border px-3 pb-1">
                  <legend className="px-1 text-sm font-semibold">{t('assets.armory.options')}</legend>
                  <ul>{equipment.map(line => <EquipmentReturnLine key={line.id} {...lineProps(line)} />)}</ul>
                </fieldset>}
                {ammunition.length > 0 && <fieldset className="min-w-0 rounded-lg border border-border px-3 pb-3">
                  <legend className="px-1 text-sm font-semibold">{t('assets.armory.ammunition')}</legend>
                  <ul className="space-y-3">{ammunition.map(line => <RoundsReturnLine key={line.id} {...lineProps(line)} />)}</ul>
                </fieldset>}
                {plan.needsWitness && user?.employee_id && <ArmoryPersonPicker purpose="witness" safeId={record.safe.id}
                  label={t(isCustody ? 'assets.armory.witness' : 'assets.armory.countWitness')} value={witness} excludeIds={excludeIds}
                  onChange={person => setDraft(current => ({ ...current, witness: person }))} />}
              </fieldset>}
            </>}
          </div>
          <footer className="shrink-0 space-y-2 border-t border-border bg-surface px-4 pt-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] sm:px-5">
            {!accessError && mutation.isError && <p role="alert" className="text-sm text-destructive-text">{armoryErrorMessage(mutation.error)}</p>}
            {showForm && !mutation.isSuccess && unconfirmed > 0 && <p role="status" className="text-sm text-muted-foreground">
              <CountCopy message="stillOut" count={unconfirmed} />
            </p>}
            {showForm && <p id={validationId} className="text-sm text-muted-foreground">
              {busy ? <span role="status">{t('common.saving')}</span>
                : readBusy ? <span role="status">{t('assets.armory.loadingText')}</span>
                  : !mutation.isSuccess && validation ? t(validation) : null}
            </p>}
            <div className="flex flex-wrap justify-end gap-2">
              <Button ref={cancelRef} type="button" variant="outline" className="min-h-11" disabled={busy} onClick={requestClose}>{closeLabel}</Button>
              {!accessError && <Button type="submit" className="min-h-11" disabled={!canSubmit} aria-describedby={showForm ? validationId : undefined}>{title}</Button>}
            </div>
          </footer>
        </form>
      </DialogContent>
    </DialogRoot>
    <ConfirmDialog open={confirmDiscard && !accessError} onOpenChange={setConfirmDiscard} title={t('assets.armory.discardReturn')}
      description={t('assets.armory.returns.discardDescription')} confirmLabel={t('assets.armory.discard')} destructive
      returnFocusRef={cancelRef} onConfirm={() => onOpenChange(false)} />
  </>
}
