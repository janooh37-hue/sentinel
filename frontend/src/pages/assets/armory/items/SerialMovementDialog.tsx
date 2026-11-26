import { useIsFetching, useQueryClient } from '@tanstack/react-query'
import { type FormEvent, type RefObject, useEffect, useId, useRef, useState } from 'react'

import { Button } from '@/components/ui/button'
import { DialogContent, DialogDescription, DialogHeader, DialogRoot, DialogTitle } from '@/components/ui/dialog'
import { Textarea } from '@/components/ui/textarea'
import { ApiError, type ArmoryPersonCandidateRead, type ArmorySafeRead, type ArmorySerialMovementCreate, type ArmorySerialRead } from '@/lib/api'
import { useAuth } from '@/lib/authContext'
import { Ltr } from '../ArmoryLtr'
import { serialStateKey, useArmoryLocale } from '../armoryFormat'
import { armoryErrorMessage, armoryErrorRecovery, armoryKeys, isArmoryAccessError, useArmoryAccess, useMoveArmorySerial } from '../armoryQueries'
import { ArmoryPersonPicker } from '../dialogs/ArmoryPersonPicker'
import { allowedSerialActions } from './serialActions'

type Action = ArmorySerialMovementCreate['action']

interface MovementDraft {
  action?: Action
  destinationId: number | null
  reason: string
  witness: ArmoryPersonCandidateRead | null
}

interface MovementBasis {
  state: ArmorySerialRead['state']
  safeId: number | null
  postingId: ArmorySerialRead['last_posting_id']
}

const EMPTY_DRAFT: MovementDraft = { destinationId: null, reason: '', witness: null }

function hasEntries({ action, destinationId, reason, witness }: MovementDraft) {
  return action !== undefined || destinationId !== null || reason.length > 0 || witness !== null
}

interface Props {
  open: boolean
  serial: ArmorySerialRead
  safes: ArmorySafeRead[]
  onOpenChange(open: boolean): void
  onSaved(): void
  returnFocusRef: RefObject<HTMLElement | null>
  fallbackFocusRef?: RefObject<HTMLElement | null>
}

export function SerialMovementDialog(props: Props) {
  const { canEdit, principal } = useArmoryAccess()
  return canEdit && principal !== null && props.open ? <MovementForm key={principal} principal={principal} {...props} /> : null
}

function MovementForm({ open, serial, safes, onOpenChange, onSaved, returnFocusRef, fallbackFocusRef, principal }: Props & { principal: number }) {
  const { t, name, isAr } = useArmoryLocale()
  const client = useQueryClient()
  const serialKey = armoryKeys.serial(principal, serial.id)
  const fetchingSerial = useIsFetching({ queryKey: serialKey, exact: true }) > 0
  const movement = useMoveArmorySerial()
  const [refreshing, setRefreshing] = useState(false)
  const [entry, setEntry] = useState<{ draft: MovementDraft; basis: MovementBasis } | null>(null)
  const [refreshFailed, setRefreshFailed] = useState(false)
  const denied = isArmoryAccessError(movement.error)
  const conflicted = movement.error instanceof ApiError && movement.error.status === 409
  const reviewingLatest = refreshing || (conflicted && fetchingSerial)
  const busy = reviewingLatest || movement.isPending
  const { safe, state } = serial
  const safeId = safe?.id ?? null
  const postingId = serial.last_posting_id
  const actions = allowedSerialActions(serial)
  const destinations = safes.filter(candidate => candidate.id !== safeId)
  const draft = entry?.draft ?? EMPTY_DRAFT
  // There is no pinned basis until the operator has something to keep.
  const reviewPending = entry !== null && (
    entry.basis.state !== state || entry.basis.safeId !== safeId || entry.basis.postingId !== postingId
  )

  function updateDraft(changes: Partial<MovementDraft>) {
    setEntry(previous => {
      const next = { ...(previous?.draft ?? EMPTY_DRAFT), ...changes }
      return hasEntries(next) ? { draft: next, basis: previous?.basis ?? { state, safeId, postingId } } : null
    })
  }

  function resolveReview(keep: boolean) {
    const next = keep ? {
      ...draft,
      action: draft.action && actions.includes(draft.action) ? draft.action : undefined,
      destinationId: destinations.some(destination => destination.id === draft.destinationId) ? draft.destinationId : null,
    } : EMPTY_DRAFT
    setEntry(hasEntries(next) ? { draft: next, basis: { state, safeId, postingId } } : null)
    if (conflicted) movement.reset()
  }

  async function refresh() {
    setRefreshing(true)
    setRefreshFailed(false)
    try {
      await client.invalidateQueries({ queryKey: serialKey, exact: true }, { throwOnError: true })
    } catch {
      setRefreshFailed(true)
    } finally {
      setRefreshing(false)
    }
  }

  async function submit(body: ArmorySerialMovementCreate) {
    if (denied || busy || refreshFailed || reviewPending) return
    try {
      await movement.mutateAsync({ serialId: serial.id, body })
    } catch (error) {
      if (error instanceof ApiError && error.status === 409) {
        // The shared mutation already revalidates all recognized Armory conflict codes.
        if (armoryErrorRecovery(error) === 'none') await refresh()
      }
      return
    }
    onSaved()
    onOpenChange(false)
  }

  return <DialogRoot open={open} onOpenChange={next => { if (!busy) onOpenChange(next) }}>
    <DialogContent hideClose dir={isAr ? 'rtl' : 'ltr'} returnFocusRef={returnFocusRef}
      onCloseAutoFocus={event => {
        if (!returnFocusRef.current?.isConnected && fallbackFocusRef?.current?.isConnected) { event.preventDefault(); fallbackFocusRef.current.focus() }
      }}
      className="max-sm:h-dvh max-sm:max-h-dvh max-sm:max-w-none max-sm:rounded-none sm:max-h-[min(90dvh,48rem)]">
      <DialogHeader>
        <DialogTitle>{t('assets.armory.changeState')}</DialogTitle>
        <DialogDescription>{denied ? null : <><bdi>{name(serial.item)}</bdi> · <Ltr>{serial.serial_code}</Ltr>
          {safe ? <> · <bdi>{name(safe)}</bdi></> : null}{state ? <> · {t(serialStateKey(state))}</> : null}</>}</DialogDescription>
      </DialogHeader>
      {denied || (!actions.length && entry === null) ? <>
        <div className="min-h-0 flex-1 space-y-2 overflow-y-auto p-4">
          {movement.isError ? <p role="alert" className="rounded bg-accent-soft p-2 text-sm text-destructive-text">{armoryErrorMessage(movement.error)}</p> : null}
          {!denied ? <p className="text-sm text-muted-foreground">{t('assets.armory.items.noStateChanges')}</p> : null}
        </div>
        <div className="flex shrink-0 justify-end border-t border-border px-4 py-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
          <Button type="button" variant="outline" className="min-h-11" onClick={() => onOpenChange(false)}>{t('assets.armory.close')}</Button>
        </div>
      </> : <MovementFields
        actions={actions} serial={serial} destinations={destinations} draft={draft} onDraftChange={updateDraft}
        error={movement.isError ? armoryErrorMessage(movement.error) : undefined} busy={busy} refreshing={reviewingLatest} refreshFailed={refreshFailed}
        reviewPending={reviewPending} onResolveReview={resolveReview}
        onRefresh={() => void refresh()} onClose={() => onOpenChange(false)} onSubmit={body => void submit(body)} />}
    </DialogContent>
  </DialogRoot>
}

interface FieldsProps {
  actions: readonly Action[]
  serial: ArmorySerialRead
  destinations: ArmorySafeRead[]
  draft: MovementDraft
  onDraftChange(changes: Partial<MovementDraft>): void
  error?: string
  busy: boolean
  refreshing: boolean
  refreshFailed: boolean
  reviewPending: boolean
  onResolveReview(keep: boolean): void
  onRefresh(): void
  onClose(): void
  onSubmit(body: ArmorySerialMovementCreate): void
}

function MovementFields({ actions, serial, destinations, draft, onDraftChange, error, busy, refreshing, refreshFailed, reviewPending, onResolveReview, onRefresh, onClose, onSubmit }: FieldsProps) {
  const { t, name } = useArmoryLocale()
  const { user } = useAuth()
  const id = useId()
  const keepEntries = useRef<HTMLButtonElement>(null)
  const actionInput = useRef<HTMLSelectElement>(null)
  const cancel = useRef<HTMLButtonElement>(null)
  const { action, destinationId, reason, witness } = draft
  const { safe, state } = serial
  const reviewReady = reviewPending && !busy && !refreshFailed
  const fieldsDisabled = busy || refreshFailed || reviewPending || !actions.length
  const destination = destinations.find(safe => safe.id === destinationId)
  const actorId = user?.employee_id
  const blocked = !actions.length ? t('assets.armory.items.noStateChanges')
    : !actorId ? t('assets.armory.errors.actorEmployeeRequired')
      : action === 'transfer' && !destination ? t('assets.armory.items.needDestination')
        : !action || !actions.includes(action) || reason.trim().length < 3 || !witness ? t('assets.armory.items.needStateEvidence') : ''

  useEffect(() => {
    if (reviewReady) keepEntries.current?.focus()
  }, [reviewReady])

  function resolve(keep: boolean) {
    onResolveReview(keep)
    requestAnimationFrame(() => {
      const target = actions.length ? actionInput.current : cancel.current
      target?.focus()
    })
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (fieldsDisabled || blocked || !safe || !state || !action || !witness) return
    onSubmit({
      action,
      expected_state: state,
      expected_safe_id: safe.id,
      expected_posting_id: serial.last_posting_id,
      destination_safe_id: action === 'transfer' ? destination?.id ?? null : null,
      reason: reason.trim(),
      witness_employee_id: witness.person.employee_id,
    })
  }

  return <form onSubmit={submit} className="flex min-h-0 flex-1 flex-col">
    <div className="min-h-0 flex-1 space-y-3 overflow-y-auto overscroll-contain p-4">
      {error ? <p role="alert" className="rounded bg-accent-soft p-2 text-sm text-destructive-text">{error}</p> : null}
      {refreshFailed ? <div className="space-y-1">
        <p role="alert" className="text-sm text-destructive-text">{t('assets.armory.loadFailed')}</p>
        <Button type="button" variant="outline" className="min-h-11" onClick={onRefresh}>{t('assets.armory.retry')}</Button>
      </div> : null}
      {reviewReady ? <section aria-labelledby={`${id}-review`} className="space-y-3 rounded-md bg-surface-raised p-3">
        <p id={`${id}-review`} role="status" className="text-sm font-medium">{t('assets.armory.items.serialChanged')}</p>
        <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-1 text-sm">
          <dt className="text-muted-foreground">{t('assets.armory.status')}</dt>
          <dd>{state ? t(serialStateKey(state)) : t('assets.armory.items.serialVoided')}</dd>
          <dt className="text-muted-foreground">{t('assets.armory.safe')}</dt>
          <dd className="wrap-anywhere">{safe ? <bdi>{name(safe)}</bdi> : t('assets.armory.notApplicable')}</dd>
        </dl>
        <div className="flex flex-wrap gap-2">
          <Button ref={keepEntries} type="button" variant="outline" className="min-h-11" onClick={() => resolve(true)}>{t('assets.armory.items.keepEntries')}</Button>
          <Button type="button" variant="outline" className="min-h-11" onClick={() => resolve(false)}>{t('assets.armory.items.discardEntries')}</Button>
        </div>
      </section> : null}
      <fieldset disabled={fieldsDisabled} className="min-w-0 space-y-3">
        <label className="grid gap-1 text-sm font-medium">{t('assets.armory.status')}
          <select ref={actionInput} required value={action ?? ''} onChange={event => onDraftChange({ action: actions.find(value => value === event.currentTarget.value) })}
            className="min-h-11 w-full rounded-md border border-input bg-surface px-3 focus-visible:outline-2 focus-visible:outline-ring">
            <option value="">{t('assets.armory.chooseState')}</option>
            {action && !actions.includes(action) ? <option value={action} disabled>{t(`assets.armory.serialAction.${action}`)}</option> : null}
            {actions.map(value => <option key={value} value={value} disabled={value === 'transfer' && destinations.length === 0}>{t(`assets.armory.serialAction.${value}`)}</option>)}
          </select>
        </label>
        {actions.includes('transfer') && destinations.length === 0 ? <p className="text-xs text-muted-foreground">{t('assets.armory.items.noTransferDestination')}</p> : null}
        {action === 'transfer' ? <label className="grid gap-1 text-sm font-medium">{t('assets.armory.destination')}
          <select required value={destination?.id ?? ''} onChange={event => onDraftChange({ destinationId: Number(event.currentTarget.value) || null })}
            className="min-h-11 w-full rounded-md border border-input bg-surface px-3 focus-visible:outline-2 focus-visible:outline-ring">
            <option value="">{t('assets.armory.chooseSafe')}</option>
            {destinations.map(safe => <option key={safe.id} value={safe.id}>{name(safe)}</option>)}
          </select>
        </label> : null}
        <label className="grid gap-1 text-sm font-medium">{t('assets.armory.reason')}
          <Textarea required minLength={3} maxLength={500} dir="auto" value={reason} onChange={event => onDraftChange({ reason: event.currentTarget.value })} />
        </label>
        {actorId ? <ArmoryPersonPicker purpose="witness" safeId={safe?.id ?? null} label={t('assets.armory.witness')} value={witness} onChange={value => onDraftChange({ witness: value })}
          excludeIds={[actorId, ...(serial.holder?.employee ? [serial.holder.employee.employee_id] : []), ...(serial.holder?.supervisor ? [serial.holder.supervisor.employee_id] : [])]} disabled={fieldsDisabled} /> : null}
      </fieldset>
    </div>
    <footer className="flex shrink-0 flex-wrap items-center justify-end gap-2 border-t border-border px-4 py-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
      <p id={`${id}-blocked`} role="status" className="me-auto basis-full text-xs text-muted-foreground">{refreshing ? t('assets.armory.loadingText') : busy ? t('common.saving') : refreshFailed ? t('assets.armory.loadFailed') : reviewPending ? '' : blocked}</p>
      <Button ref={cancel} type="button" variant="outline" className="min-h-11" disabled={busy} onClick={onClose}>{t('assets.armory.cancel')}</Button>
      <Button type="submit" className="min-h-11" disabled={fieldsDisabled || Boolean(blocked)} aria-describedby={`${id}-blocked`}>{t('assets.armory.save')}</Button>
    </footer>
  </form>
}
