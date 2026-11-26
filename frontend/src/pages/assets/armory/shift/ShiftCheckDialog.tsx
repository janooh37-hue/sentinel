import { useRef, useState, type RefObject } from 'react'

import { Button } from '@/components/ui/button'
import type { ArmoryCountRead, ArmoryPersonCandidateRead, ArmorySerialRead, ArmoryShiftCheckDraftRead } from '@/lib/api'
import { ApiError } from '@/lib/api'
import { useAuth } from '@/lib/authContext'
import { cn } from '@/lib/utils'
import { Ltr } from '../ArmoryLtr'
import { serialStateKey, useArmoryLocale } from '../armoryFormat'
import { armoryErrorMessage, armoryErrorRecovery, isArmoryAccessError, useArmoryAccess, useArmoryShiftCheckDraft, useCreateArmoryShiftCheck } from '../armoryQueries'
import { ArmoryPersonPicker } from '../dialogs/ArmoryPersonPicker'
import { ShiftCopy, ShiftHolder, ShiftReadError, ShiftWindowMeta } from './shiftPresentation'
import { EvidenceCheckbox, ShiftScanner, ShiftTaskDialog } from './shiftTaskControls'
import { groupByItem, matchSerial, shiftWindowKey } from './shiftValues'

interface Props {
  open: boolean
  safeId: number
  onOpenChange(open: boolean): void
  onPausedChange(paused: boolean): void
  onSaved(count: ArmoryCountRead): void
  returnFocusRef: RefObject<HTMLElement | null>
}

interface Work {
  observed: ReadonlySet<number>
  witness: ArmoryPersonCandidateRead | null
  reviewing: boolean
  confirmMissing: boolean
}
const emptyWork: Work = { observed: new Set<number>(), witness: null, reviewing: false, confirmMissing: false }
const filters = ['all', 'toCheck', 'checkedItems'] as const
type Filter = (typeof filters)[number]
type ScanFeedback = { kind: 'found'; serial: ArmorySerialRead } | { kind: 'ambiguousSerial' | 'notExpectedSerial' }

export function ShiftCheckDialog(props: Props) {
  const { canEdit, principal } = useArmoryAccess()
  if (!canEdit || principal === null) return null
  return <ShiftCheckTask key={`${principal}:${props.safeId}`} {...props} />
}

function ShiftCheckTask({ open, safeId, onOpenChange, onPausedChange, onSaved, returnFocusRef }: Props) {
  const { t, name } = useArmoryLocale()
  const { user } = useAuth()
  const actorId = user?.employee_id ?? null
  const draft = useArmoryShiftCheckDraft(safeId, open)
  const mutation = useCreateArmoryShiftCheck()
  const [work, setWork] = useState(emptyWork)
  const [revision, setRevision] = useState<{ window: string; token: string } | null>(null)
  const [notice, setNotice] = useState<'newShiftStarted' | 'errors.staleCheck' | null>(null)
  const [recordedWindow, setRecordedWindow] = useState<string | null>(null)
  const [confirmDiscard, setConfirmDiscard] = useState(false)
  const [filter, setFilter] = useState<Filter>('all')
  const [scan, setScan] = useState('')
  const [scanFeedback, setScanFeedback] = useState<ScanFeedback | null>(null)
  const scanRef = useRef<HTMLInputElement>(null)
  const reviewRef = useRef<HTMLHeadingElement>(null)

  const denied = isArmoryAccessError(draft.error) || isArmoryAccessError(mutation.error)
  const current = denied || draft.isError ? undefined : draft.data
  const windowKey = current && shiftWindowKey(current.window)
  const periodRecorded = !!windowKey && recordedWindow === windowKey
  const missing = current?.expected.filter(serial => !work.observed.has(serial.id)) ?? []
  const dirty = work.observed.size > 0 || !!work.witness || work.confirmMissing || !!scan.trim()
  const busy = draft.isFetching || mutation.isPending
  const canAct = !!current && !busy && !periodRecorded
  const hasWitness = !!actorId && !!work.witness && actorId !== work.witness.person.employee_id

  // Resume only against a fresh draft for this window and snapshot. Newly returned
  // stock can change the expected set, but cannot create an observation.
  if (open && current && windowKey && !busy && (revision?.window !== windowKey || revision.token !== current.snapshot_token)) {
    if (revision) {
      setNotice(revision.window !== windowKey ? 'newShiftStarted' : 'errors.staleCheck')
      setWork(emptyWork)
      setFilter('all')
      setScan('')
      setScanFeedback(null)
    }
    setRevision({ window: windowKey, token: current.snapshot_token })
  }
  if (denied && (dirty || revision || scanFeedback || confirmDiscard)) {
    setWork(emptyWork)
    setRevision(null)
    setScan('')
    setScanFeedback(null)
    setConfirmDiscard(false)
  }

  function resetObservations() {
    setWork(emptyWork)
    setFilter('all')
    setScan('')
    setScanFeedback(null)
  }

  function finish() {
    resetObservations()
    setRevision(null)
    setNotice(null)
    setRecordedWindow(null)
    setConfirmDiscard(false)
    mutation.reset()
    onPausedChange(false)
    onOpenChange(false)
  }

  function requestClose() {
    if (mutation.isPending) return
    if (dirty && !denied) setConfirmDiscard(true)
    else finish()
  }

  function toggleSerial(id: number, checked: boolean) {
    if (!canAct) return
    setWork(previous => {
      const next = new Set(previous.observed)
      if (checked) next.add(id)
      else next.delete(id)
      return { ...previous, observed: next, confirmMissing: false }
    })
  }

  function scanSerial() {
    if (!canAct || !current) return
    const { hit, ambiguous } = matchSerial(scan, current.expected, serial => serial.serial_code)
    if (!hit) {
      setScanFeedback({ kind: ambiguous ? 'ambiguousSerial' : 'notExpectedSerial' })
      return
    }
    toggleSerial(hit.id, true)
    setFilter('all')
    setScan('')
    setScanFeedback({ kind: 'found', serial: hit })
  }

  function save() {
    if (!canAct || !current || !windowKey || !work.witness || !hasWitness || !work.reviewing || (missing.length > 0 && !work.confirmMissing)) return
    setNotice(null)
    mutation.mutate({ safeId, body: {
      snapshot_token: current.snapshot_token,
      observed_serial_ids: current.expected.filter(serial => work.observed.has(serial.id)).map(serial => serial.id),
      confirm_missing: missing.length > 0 && work.confirmMissing,
      witness_employee_id: work.witness.person.employee_id,
    } }, {
      onSuccess: count => { finish(); onSaved(count) },
      onError: error => {
        if (isArmoryAccessError(error)) {
          resetObservations()
          setRevision(null)
          onPausedChange(false)
        } else if (error instanceof ApiError && error.status === 409 && armoryErrorRecovery(error) === 'redraft') {
          // The shared redraft recovery invalidates the live draft. Never replay the post.
          resetObservations()
          if (error.code === 'armory_period_already_recorded') setRecordedWindow(windowKey)
        }
      },
    })
  }

  const present = current ? current.expected.length - missing.length : 0
  const saveReason = !work.reviewing ? null : missing.length > 0 && !work.confirmMissing ? t('assets.armory.confirmMissing')
    : !actorId ? t('assets.armory.errors.actorEmployeeRequired') : !hasWitness ? t('assets.armory.needWitness') : null
  const scanMessage = scanFeedback?.kind === 'found' ? <ShiftCopy id="lastCheckScan" values={{
    serial: <Ltr className="font-mono">{scanFeedback.serial.serial_code}</Ltr>, item: <bdi>{name(scanFeedback.serial.item)}</bdi>,
  }} /> : scanFeedback ? t(`assets.armory.${scanFeedback.kind}`) : undefined

  return <ShiftTaskDialog open={open} title={t('assets.armory.shiftCheck')} onClose={requestClose} busy={mutation.isPending}
    returnFocusRef={returnFocusRef} initialFocusRef={work.reviewing ? reviewRef : scanRef}
    subtitle={current && <><bdi>{name(current.safe)}</bdi> · <ShiftWindowMeta window={current.window} /></>}
    discard={confirmDiscard && !denied ? {
      title: t('assets.armory.discardCheck'), message: t('assets.armory.shiftPane.discardCheckHint'),
      keep: () => setConfirmDiscard(false), confirm: finish,
    } : undefined}
    footer={<div className="space-y-2">
      {mutation.isPending ? <p className="text-sm text-muted-foreground" role="status">{t('common.saving')}</p> : current && !periodRecorded && <>
        <p className="text-sm text-muted-foreground" role="status"><ShiftCopy id="checkCount" values={{ present: <Ltr>{present}</Ltr>, expected: <Ltr>{current.expected.length}</Ltr> }} /></p>
        {saveReason && <p className="text-sm text-warning">{saveReason}</p>}
      </>}
      <div className="flex flex-wrap justify-end gap-2">
        <Button type="button" variant="ghost" className="min-h-11" disabled={mutation.isPending} onClick={requestClose}>{t(denied || periodRecorded ? 'assets.armory.close' : 'assets.armory.cancel')}</Button>
        {current && !periodRecorded && <>
          <Button type="button" variant="secondary" className="min-h-11" disabled={busy} onClick={() => {
            if (!canAct) return
            onPausedChange(true)
            onOpenChange(false)
          }}>{t('assets.armory.pause')}</Button>
          <Button type="button" className="min-h-11 whitespace-normal" variant={work.reviewing && missing.length > 0 ? 'destructive' : 'default'}
            disabled={!canAct || !!saveReason} onClick={() => {
              if (work.reviewing) save()
              else {
                setWork(previous => ({ ...previous, reviewing: true, confirmMissing: false }))
                requestAnimationFrame(() => reviewRef.current?.focus())
              }
            }}>{t(`assets.armory.${!work.reviewing ? 'reviewCheck' : missing.length ? 'reportAndSaveCheck' : 'saveCheck'}`)}</Button>
        </>}
      </div>
    </div>}>
    <div className="space-y-4">
      {draft.isFetching && !mutation.isPending && <p role="status" className="text-sm text-muted-foreground">{t('assets.armory.loadingText')}</p>}
      {draft.isError && !isArmoryAccessError(mutation.error) && <ShiftReadError error={draft.error} retry={() => void draft.refetch()} />}
      {mutation.isError && <p role="alert" className="text-sm font-medium text-destructive-text">{armoryErrorMessage(mutation.error)}</p>}
      {notice && !denied && (!mutation.isError || notice === 'newShiftStarted') && <p role="status" className="rounded-md bg-warning-soft p-3 text-sm text-warning">{t(`assets.armory.${notice}`)}</p>}
      {current && !periodRecorded && <>
        {work.reviewing ? <section className="space-y-3">
          <h3 ref={reviewRef} tabIndex={-1} className="font-semibold">{t('assets.armory.checkReviewTitle')}</h3>
          {missing.length > 0 && <div className="space-y-2 rounded-md bg-accent-soft p-3 text-destructive-text">
            <p className="font-semibold"><ShiftCopy id="firearmsMissing" count={missing.length} /></p>
            <ul className="flex flex-wrap gap-x-3 gap-y-1">
              {missing.map(serial => <li key={serial.id}><Ltr className="font-mono text-sm [overflow-wrap:anywhere]">{serial.serial_code}</Ltr></li>)}
            </ul>
            <p className="text-sm">{t('assets.armory.createsFindings')}</p>
            <fieldset disabled={busy}>
              <EvidenceCheckbox checked={work.confirmMissing} onChange={checked => setWork(previous => ({ ...previous, confirmMissing: checked }))}>
                <ShiftCopy id="reportMissing" count={missing.length} />
              </EvidenceCheckbox>
            </fieldset>
          </div>}
          {actorId && <ArmoryPersonPicker purpose="witness" safeId={safeId} label={t('assets.armory.countWitness')} value={work.witness} excludeIds={[actorId]} disabled={busy}
            onChange={person => setWork(previous => ({ ...previous, witness: person }))} />}
          <Button type="button" variant="secondary" className="min-h-11" disabled={busy} onClick={() => {
            setWork(previous => ({ ...previous, reviewing: false, confirmMissing: false }))
            requestAnimationFrame(() => scanRef.current?.focus())
          }}>{t('assets.armory.resumeCounting')}</Button>
        </section> : <section className="space-y-3">
          <ShiftScanner label={t('assets.armory.scanCheck')} hint={t('assets.armory.checkHint')} value={scan} inputRef={scanRef} disabled={!canAct}
            onChange={value => { setScan(value); setScanFeedback(null) }} onScan={scanSerial} feedback={scanMessage} error={!!scanFeedback && scanFeedback.kind !== 'found'} />
          {current.expected.length === 0 ? <p className="text-sm text-muted-foreground">{t('assets.armory.checkNone')}</p> : <>
            <div className="flex flex-wrap gap-1" role="group" aria-label={t('assets.armory.status')}>
              {filters.map((item, i) => <Button type="button" variant="ghost" key={item} aria-pressed={filter === item} onClick={() => setFilter(item)}
                className={cn('min-h-11', filter === item && 'bg-primary-soft text-primary-text')}>
                {t(`assets.armory.${item}`)} <Ltr>{[current.expected.length, missing.length, present][i]}</Ltr>
              </Button>)}
            </div>
            {groupByItem(current.expected).map(group => {
              const visible = group.filter(serial => filter === 'all' || work.observed.has(serial.id) === (filter === 'checkedItems'))
              return visible.length > 0 && <fieldset key={group[0].item.id} disabled={!canAct} className="rounded-md border border-border p-2">
                <legend className="px-1 text-sm font-medium"><bdi>{name(group[0].item)}</bdi></legend>
                <ul className="grid grid-cols-2 gap-1 sm:grid-cols-3">
                  {visible.map(serial => <li key={serial.id} className="min-w-0">
                    <EvidenceCheckbox checked={work.observed.has(serial.id)} onChange={checked => toggleSerial(serial.id, checked)} className="bg-surface-raised">
                      <Ltr className="font-mono">{serial.serial_code}</Ltr>
                    </EvidenceCheckbox>
                  </li>)}
                </ul>
              </fieldset>
            })}
          </>}
        </section>}
        <Reconciliation draft={current} />
      </>}
    </div>
  </ShiftTaskDialog>
}

function Reconciliation({ draft }: { draft: ArmoryShiftCheckDraftRead }) {
  const { t, name } = useArmoryLocale()
  const { reconciliation: groups } = draft
  const unavailable = groups.missing.length + groups.lost.length
  const states = ['signed_out', 'in_custody', 'in_repair', 'missing', 'lost'] as const
  return <section className="space-y-1 rounded-md border border-border bg-surface-raised p-3 text-sm">
    <p className="text-muted-foreground"><ShiftCopy id="checkEquation" values={{
      safe: <Ltr>{draft.expected.length}</Ltr>, issued: <Ltr>{groups.signed_out.length}</Ltr>, custody: <Ltr>{groups.in_custody.length}</Ltr>,
      repair: <Ltr>{groups.in_repair.length}</Ltr>, extra: unavailable ? <ShiftCopy id="checkUnavailable" count={unavailable} /> : null,
      total: <Ltr>{groups.assigned_count}</Ltr>,
    }} /></p>
    <details>
      <summary className="min-h-11 content-center cursor-pointer rounded-sm font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">{t('assets.armory.accountedElsewhere')}</summary>
      <div className="space-y-2">
        {states.map(state => <div key={state}>
          <h3 className={cn('font-medium', state === 'missing' && groups.missing.length > 0 && 'text-destructive-text')}>
            {t(state === 'signed_out' ? 'assets.armory.checkAway' : serialStateKey(state))}: <Ltr>{groups[state].length}</Ltr>
          </h3>
          <ul className="space-y-1 text-muted-foreground">
            {groups[state].map(serial => <li key={serial.id} className="[overflow-wrap:anywhere]">
              <bdi>{name(serial.item)}</bdi> · <Ltr className="font-mono">{serial.serial_code}</Ltr>
              {serial.holder && <> · <ShiftHolder holder={serial.holder} /></>}
            </li>)}
          </ul>
        </div>)}
      </div>
    </details>
  </section>
}
