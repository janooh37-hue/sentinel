import { useId, useRef, useState, type RefObject } from 'react'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { ApiError, type ArmoryAssignmentLineRead, type ArmoryAssignmentSummary, type ArmoryBulkReturnCreate, type ArmoryPersonCandidateRead, type ArmoryReturnRead } from '@/lib/api'
import { useAuth } from '@/lib/authContext'
import { Ltr } from '../ArmoryLtr'
import { useArmoryLocale } from '../armoryFormat'
import { armoryErrorMessage, armoryErrorRecovery, isArmoryAccessError, useArmoryAccess, useArmoryShift, useCreateArmoryBulkReturn } from '../armoryQueries'
import { ArmoryPersonPicker } from '../dialogs/ArmoryPersonPicker'
import { evidenceFor, planReturn, retainMatchingLines, roundsCount, shortfallReasons, stageLine, type LineEvidence, type StagedLines } from './bulkReturnDraft'
import { ShiftCopy, ShiftHolder, ShiftReadError } from './shiftPresentation'
import { EvidenceCheckbox, ShiftScanner, ShiftTaskDialog } from './shiftTaskControls'
import { matchSerial } from './shiftValues'

interface Props {
  open: boolean
  safeId: number
  onOpenChange(open: boolean): void
  onSaved(results: ArmoryReturnRead[]): void
  returnFocusRef: RefObject<HTMLElement | null>
}

const emptyLines: StagedLines = new Map()
const noRecords: readonly ArmoryAssignmentSummary[] = []
const selectClass = 'min-h-11 w-full rounded-md border border-input bg-surface px-3 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring'
type ScanFeedback = { kind: 'found'; serial: string; record: ArmoryAssignmentSummary } | { kind: 'ambiguousSerial' | 'unlistedReturnSerial' }
type UpdateLine = (line: ArmoryAssignmentLineRead, change: Partial<LineEvidence>) => void

export function BulkReturnDialog(props: Props) {
  const { canEdit, principal } = useArmoryAccess()
  if (!canEdit || !props.open || principal === null) return null
  return <BulkReturnTask key={`${principal}:${props.safeId}`} {...props} />
}

function BulkReturnTask({ open, safeId, onOpenChange, onSaved, returnFocusRef }: Props) {
  const { t, name } = useArmoryLocale()
  const { user } = useAuth()
  const actorId = user?.employee_id ?? null
  const shift = useArmoryShift(safeId)
  const mutation = useCreateArmoryBulkReturn()
  const [staged, setStaged] = useState<StagedLines>(emptyLines)
  const [witness, setWitness] = useState<ArmoryPersonCandidateRead | null>(null)
  const [scan, setScan] = useState('')
  const [feedback, setFeedback] = useState<ScanFeedback | null>(null)
  const [confirmDiscard, setConfirmDiscard] = useState(false)
  const scanRef = useRef<HTMLInputElement>(null)

  const denied = isArmoryAccessError(shift.error) || isArmoryAccessError(mutation.error)
  const group = denied || shift.isError ? undefined : shift.data?.safes.find(row => row.safe.id === safeId)
  const records = group?.out ?? noRecords
  const busy = shift.isFetching || mutation.isPending
  const dirty = staged.size > 0 || !!witness || !!scan.trim()
  if (!busy && !denied && shift.isSuccess && staged.size) {
    // A refetched line must still be the exact same outstanding evidence to keep its tick or count.
    const retained = retainMatchingLines(staged, records)
    if (retained !== staged) {
      setStaged(retained)
      setFeedback(null)
    }
  }
  if (denied && (dirty || feedback || confirmDiscard)) {
    setStaged(emptyLines)
    setWitness(null)
    setScan('')
    setFeedback(null)
    setConfirmDiscard(false)
  }

  const plans = records.map(record => planReturn(record, staged))
  const witnessExclusions = new Set<string>()
  if (actorId) witnessExclusions.add(actorId)
  let hasShortfall = false
  for (const { hasShortfall: needsWitness, record, lines, error } of plans) {
    if (needsWitness) hasShortfall = true
    if (!needsWitness && (error || !lines.length)) continue
    for (const person of [record.holder.employee, record.holder.supervisor]) {
      if (person) witnessExclusions.add(person.employee_id)
    }
  }
  const witnessId = witness && actorId && !witnessExclusions.has(witness.person.employee_id) ? witness.person.employee_id : null
  if (hasShortfall && witness && !witnessId) setWitness(null)
  const inputs: ArmoryBulkReturnCreate['records'] = []
  for (const plan of plans) {
    if (!plan.error && plan.lines.length && (!plan.hasShortfall || witnessId)) {
      inputs.push({ assignment_id: plan.record.id, witness_employee_id: plan.hasShortfall ? witnessId : null, lines: plan.lines })
    }
  }

  function close() {
    setStaged(emptyLines)
    setWitness(null)
    setScan('')
    setFeedback(null)
    setConfirmDiscard(false)
    mutation.reset()
    onOpenChange(false)
  }

  function requestClose() {
    if (mutation.isPending) return
    if (dirty && !denied) setConfirmDiscard(true)
    else close()
  }

  function scanSerial() {
    if (busy || denied) return
    const serials = records.flatMap(record => record.lines.filter(line => line.serial_id !== null && line.remaining_qty > 0).map(line => ({ record, line })))
    const { hit, ambiguous } = matchSerial(scan, serials, ({ line }) => line.serial_code)
    if (!hit || !hit.line.serial_code) {
      setFeedback({ kind: ambiguous ? 'ambiguousSerial' : 'unlistedReturnSerial' })
      return
    }
    setStaged(previous => stageLine(previous, hit.record.id, hit.line, { checked: true }))
    setScan('')
    setFeedback({ kind: 'found', serial: hit.line.serial_code, record: hit.record })
  }

  function recordReturns() {
    if (busy || !group || inputs.length === 0) return
    mutation.mutate({ safe_id: safeId, records: inputs }, {
      onSuccess: results => { close(); onSaved(results) },
      onError: error => {
        if (isArmoryAccessError(error)) {
          setStaged(emptyLines)
          setWitness(null)
          setScan('')
          setFeedback(null)
        } else if (error instanceof ApiError && error.status === 409) {
          setFeedback(null)
          // Known conflicts already refresh the live shift read through the mutation wrapper.
          if (armoryErrorRecovery(error) === 'none') void shift.refetch({ cancelRefetch: false })
        }
      },
    })
  }

  const message = feedback?.kind === 'found' ? <ShiftCopy id="lastReturnScan" values={{
    serial: <Ltr className="font-mono">{feedback.serial}</Ltr>, name: <ShiftHolder holder={feedback.record.holder} />,
  }} /> : feedback ? t(`assets.armory.${feedback.kind}`) : undefined

  return <ShiftTaskDialog open={open} title={t('assets.armory.bulkReturn')} onClose={requestClose} busy={mutation.isPending}
    returnFocusRef={returnFocusRef} initialFocusRef={scanRef}
    subtitle={group && <><bdi>{name(group.safe)}</bdi> · <ShiftCopy id="returnKitsN" count={records.length} /></>}
    discard={confirmDiscard && !denied ? {
      title: t('assets.armory.discardReturn'), message: t('assets.armory.shiftPane.discardReturnHint'), keep: () => setConfirmDiscard(false), confirm: close,
    } : undefined}
    footer={<div className="space-y-2">
      {mutation.isPending ? <p role="status" className="text-sm text-muted-foreground">{t('common.saving')}</p> : records.length > 0 && <>
        <p role="status" className="text-sm text-muted-foreground"><ShiftCopy id="returnProgress" values={{ ready: <Ltr>{inputs.length}</Ltr>, total: <Ltr>{records.length}</Ltr> }} /></p>
        {!inputs.length && <p className="text-sm text-warning">{t('assets.armory.needReadyReturn')}</p>}
      </>}
      <div className="flex flex-wrap justify-end gap-2">
        <Button type="button" variant="ghost" className="min-h-11" disabled={mutation.isPending} onClick={requestClose}>{t(denied ? 'assets.armory.close' : 'assets.armory.cancel')}</Button>
        {records.length > 0 && <Button type="button" className="min-h-11" disabled={busy || inputs.length === 0} onClick={recordReturns}>
          {inputs.length > 0 ? <ShiftCopy id="recordReturnsN" count={inputs.length} /> : t('assets.armory.saveReturns')}
        </Button>}
      </div>
    </div>}>
    <div className="space-y-4">
      {shift.isFetching && !mutation.isPending && <p role="status" className="text-sm text-muted-foreground">{t('assets.armory.loadingText')}</p>}
      {shift.isError && !isArmoryAccessError(mutation.error) && <ShiftReadError error={shift.error} retry={() => void shift.refetch()} />}
      {mutation.isError && <p role="alert" className="text-sm font-medium text-destructive-text">{armoryErrorMessage(mutation.error)}</p>}
      {shift.isSuccess && !busy && !denied && !records.length && <p className="text-sm text-muted-foreground">{t('assets.armory.noneOut')}</p>}
      {records.length > 0 && <>
        <ShiftScanner label={t('assets.armory.scanReturn')} hint={t('assets.armory.scanReturnHint')} value={scan} inputRef={scanRef} disabled={busy}
          onChange={value => { setScan(value); setFeedback(null) }} onScan={scanSerial} feedback={message} error={!!feedback && feedback.kind !== 'found'} />
        {plans.map(plan => {
          const { record } = plan
          const status = plan.error ?? (!plan.lines.length ? 'notReadyReturn' : plan.hasShortfall && !witnessId ? 'needWitness' : 'readyReturn')
          return <ReturnRecord key={record.id} record={record} staged={staged} disabled={busy} status={status}
            update={(line, change) => setStaged(previous => stageLine(previous, record.id, line, change))}
            confirmAccessories={lines => setStaged(previous => {
              let next = previous
              for (const line of lines) next = stageLine(next, record.id, line, { checked: true })
              return next
            })} />
        })}
        {hasShortfall && (actorId ? <ArmoryPersonPicker purpose="witness" safeId={safeId} label={t('assets.armory.countWitness')}
          value={witnessId ? witness : null} excludeIds={[...witnessExclusions]} disabled={busy} onChange={setWitness} /> :
          <p role="alert" className="text-sm text-destructive-text">{t('assets.armory.errors.actorEmployeeRequired')}</p>)}
      </>}
    </div>
  </ShiftTaskDialog>
}

function ReturnRecord({ record, staged, disabled, status, update, confirmAccessories }: {
  record: ArmoryAssignmentSummary; staged: StagedLines; disabled: boolean; status: string; update: UpdateLine
  confirmAccessories: (lines: ArmoryAssignmentLineRead[]) => void
}) {
  const { t, overdue } = useArmoryLocale()
  const title = useId()
  const remaining = record.lines.filter(line => line.remaining_qty > 0)
  const serialized = remaining.filter(line => line.serial_id !== null)
  const accessories = remaining.filter(line => line.serial_id === null && line.item.kind !== 'ammunition')
  const ammunition = remaining.filter(line => line.item.kind === 'ammunition')
  const showKit = serialized.length > 0 || accessories.length > 0
  return <section aria-labelledby={title} className="space-y-2 rounded-lg border border-border bg-surface-raised p-3">
    <header className="flex flex-wrap items-baseline justify-between gap-1">
      <h3 id={title} className="min-w-0 font-semibold [overflow-wrap:anywhere]"><ShiftHolder holder={record.holder} /> <Ltr className="font-mono text-xs text-muted-foreground">{record.record_ref}</Ltr></h3>
      {record.overdue_minutes !== null && <span className="text-sm font-medium text-destructive-text"><bdi>{overdue(record.overdue_minutes)}</bdi></span>}
    </header>
    <div className={showKit && ammunition.length > 0 ? 'grid gap-3 sm:grid-cols-2' : 'grid gap-3'}>
      {showKit && <fieldset disabled={disabled} className="min-w-0 space-y-1 rounded-md border border-border bg-surface p-2">
        <legend className="px-1 text-sm font-medium">{t('assets.armory.options')}</legend>
        {serialized.map(line => <KitReturnLine key={line.id} line={line} evidence={evidenceFor(staged, record.id, line)} update={update} />)}
        {accessories.length > 0 && <div className="border-t border-hairline pt-1">
          <details>
            <summary className="min-h-11 content-center cursor-pointer rounded-sm px-1 text-sm font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">{t('assets.armory.accessories')}</summary>
            {accessories.map(line => <KitReturnLine key={line.id} line={line} evidence={evidenceFor(staged, record.id, line)} update={update} />)}
            <Button type="button" variant="secondary" className="h-auto min-h-11 whitespace-normal py-2 text-start" onClick={() => confirmAccessories(accessories)}>{t('assets.armory.confirmAccessories')}</Button>
          </details>
        </div>}
      </fieldset>}
      {ammunition.length > 0 && <div className="grid content-start gap-2">
        {ammunition.map(line => <AmmoReturnLine key={line.id} line={line} evidence={evidenceFor(staged, record.id, line)} update={update} disabled={disabled} />)}
      </div>}
    </div>
    <p className={`border-t border-hairline pt-2 text-sm ${status === 'readyReturn' || status === 'notReadyReturn' ? 'text-muted-foreground' : 'text-warning'}`}>
      {t(`assets.armory.${status}`)}
    </p>
  </section>
}

function KitReturnLine({ line, evidence, update }: { line: ArmoryAssignmentLineRead; evidence: LineEvidence; update: UpdateLine }) {
  const { t, name } = useArmoryLocale()
  const id = useId()
  const isSerial = line.serial_code !== null
  return <div className="border-b border-hairline p-1 last:border-0">
    <p className="px-2 pt-1 text-sm font-medium [overflow-wrap:anywhere]">
      <ShiftCopy id="lineQty" count={line.remaining_qty} values={{ item: <bdi>{name(line.item)}</bdi> }} />
      {line.serial_code && <> · <Ltr className="font-mono">{line.serial_code}</Ltr></>}
      {line.batch && <> · <Ltr className="font-mono">{line.batch.batch_ref}</Ltr></>}
    </p>
    <EvidenceCheckbox checked={evidence.checked} onChange={checked => update(line, { checked })}
      label={line.serial_code ? `${t('assets.armory.serialSeen')}: \u2066${line.serial_code}\u2069` : `${t('assets.armory.returned')}: ${name(line.item)}`}>
      {t(isSerial ? 'assets.armory.serialSeen' : 'assets.armory.returned')}
    </EvidenceCheckbox>
    {isSerial && evidence.checked && <details className="px-2 pb-1">
      <summary className="min-h-11 content-center cursor-pointer rounded-sm text-sm font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">{t('assets.armory.condition')}</summary>
      <div className="space-y-2">
        <label className="block text-sm" htmlFor={`${id}-condition`}>{t('assets.armory.condition')}</label>
        <select id={`${id}-condition`} className={selectClass} value={evidence.condition} onChange={event => update(line, { condition: event.currentTarget.value === 'repair' ? 'repair' : 'ok' })}>
          <option value="ok">{t('assets.armory.ok')}</option><option value="repair">{t('assets.armory.needsRepair')}</option>
        </select>
        {evidence.condition === 'repair' && <div className="space-y-1">
          <label htmlFor={`${id}-fault`} className="text-sm">{t('assets.armory.fault')}</label>
          <Textarea id={`${id}-fault`} dir="auto" maxLength={500} value={evidence.fault} onChange={event => update(line, { fault: event.currentTarget.value })} />
        </div>}
      </div>
    </details>}
  </div>
}

function AmmoReturnLine({ line, evidence, update, disabled }: { line: ArmoryAssignmentLineRead; evidence: LineEvidence; update: UpdateLine; disabled: boolean }) {
  const { t, name } = useArmoryLocale()
  const id = useId()
  const qty = roundsCount(evidence, line.remaining_qty)
  const invalid = (!!evidence.rounds || evidence.badCount) && qty === null
  const shortfall = qty === null ? 0 : line.remaining_qty - qty
  return <fieldset disabled={disabled} className="min-w-0 space-y-2 rounded-md border border-border bg-surface p-2">
    <legend className="px-1 text-sm font-medium"><bdi>{name(line.item)}</bdi></legend>
    <label htmlFor={id} className="text-sm font-medium">{t('assets.armory.roundsReturned')}</label>
    <div className="flex items-end gap-2">
      <Input id={id} dir="ltr" type="number" min={0} max={line.remaining_qty} step={1} inputMode="numeric" className="min-h-11 min-w-0"
        value={evidence.rounds} aria-invalid={invalid} aria-describedby={`${id}-amount`} onChange={event => update(line, { rounds: event.currentTarget.value, badCount: event.currentTarget.validity.badInput })} />
      <Button type="button" variant="secondary" className="h-auto min-h-11 whitespace-normal py-2" onClick={() => update(line, { rounds: String(line.remaining_qty), badCount: false })}>
        <ShiftCopy id="allRounds" count={line.remaining_qty} />
      </Button>
    </div>
    <p className="text-xs text-muted-foreground" id={`${id}-amount`}>
      {invalid ? t('assets.armory.countRoundsPrecisely') : qty === null ? <ShiftCopy id="roundsIssued" count={line.remaining_qty} /> :
        <ShiftCopy id="ammoFinding" values={{ issued: <Ltr>{line.remaining_qty}</Ltr>, returned: <Ltr>{qty}</Ltr>, short: <Ltr>{shortfall}</Ltr> }} />}
    </p>
    {shortfall > 0 && <div className="space-y-2 rounded-md bg-warning-soft p-2">
      <p className="text-sm text-warning"><ShiftCopy id="shortfall" count={shortfall} /></p>
      <p className="text-xs text-warning">{t('assets.armory.shortfallHint')}</p>
      <label htmlFor={`${id}-reason`} className="block text-sm">{t('assets.armory.reason')}</label>
      <select id={`${id}-reason`} className={selectClass} value={evidence.reason} onChange={event => update(line, { reason: shortfallReasons.find(reason => reason === event.currentTarget.value) ?? '' })}>
        <option value="">{t('assets.armory.chooseReason')}</option>
        {shortfallReasons.map(reason => <option key={reason} value={reason}>{t(`assets.armory.shortfallReason.${reason}`)}</option>)}
      </select>
      <label htmlFor={`${id}-ref`} className="block text-sm">{t('assets.armory.reference')}</label>
      <Input id={`${id}-ref`} dir="ltr" className="min-h-11" maxLength={80} aria-describedby={`${id}-ref-hint`}
        value={evidence.reference} onChange={event => update(line, { reference: event.currentTarget.value })} />
      <p id={`${id}-ref-hint`} className="text-xs text-warning">{t('assets.armory.shortfallReferenceRule')}</p>
      {evidence.reason === 'other' && <>
        <label htmlFor={`${id}-note`} className="block text-sm">{t('assets.armory.reasonDetail')}</label>
        <Textarea id={`${id}-note`} dir="auto" maxLength={500} value={evidence.note} onChange={event => update(line, { note: event.currentTarget.value })} />
      </>}
    </div>}
  </fieldset>
}
