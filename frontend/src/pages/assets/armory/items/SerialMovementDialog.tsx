import { useIsFetching, useQueryClient } from '@tanstack/react-query'
import { type FormEvent, type RefObject, useId, useState } from 'react'

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
  const [attempt, setAttempt] = useState(0)
  const [refreshFailed, setRefreshFailed] = useState(false)
  const denied = isArmoryAccessError(movement.error)
  const conflicted = movement.error instanceof ApiError && movement.error.status === 409
  const reviewingLatest = refreshing || (conflicted && fetchingSerial)
  const busy = reviewingLatest || movement.isPending
  const { safe, state } = serial

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
    if (denied || busy || refreshFailed) return
    try {
      await movement.mutateAsync({ serialId: serial.id, body })
    } catch (error) {
      if (error instanceof ApiError && error.status === 409) {
        setAttempt(previous => previous + 1)
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
      {denied || !safe || !state || allowedSerialActions(serial).length === 0 ? <>
        <div className="min-h-0 flex-1 space-y-2 overflow-y-auto p-4">
          {movement.isError ? <p role="alert" className="rounded bg-accent-soft p-2 text-sm text-destructive-text">{armoryErrorMessage(movement.error)}</p> : null}
          {!denied ? <p className="text-sm text-muted-foreground">{t('assets.armory.items.noStateChanges')}</p> : null}
        </div>
        <div className="flex shrink-0 justify-end border-t border-border px-4 py-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
          <Button type="button" variant="outline" className="min-h-11" onClick={() => onOpenChange(false)}>{t('assets.armory.close')}</Button>
        </div>
      </> : <MovementFields key={`${serial.id}:${safe.id}:${state}:${serial.last_posting_id}:${attempt}`}
        actions={allowedSerialActions(serial)} serial={serial} state={state} safeId={safe.id} safes={safes}
        error={movement.isError ? armoryErrorMessage(movement.error) : undefined} busy={busy} refreshing={reviewingLatest} refreshFailed={refreshFailed}
        onRefresh={() => void refresh()} onClose={() => onOpenChange(false)} onSubmit={body => void submit(body)} />}
    </DialogContent>
  </DialogRoot>
}

interface FieldsProps {
  actions: readonly Action[]
  serial: ArmorySerialRead
  state: NonNullable<ArmorySerialRead['state']>
  safeId: number
  safes: ArmorySafeRead[]
  error?: string
  busy: boolean
  refreshing: boolean
  refreshFailed: boolean
  onRefresh(): void
  onClose(): void
  onSubmit(body: ArmorySerialMovementCreate): void
}

function MovementFields({ actions, serial, state, safeId, safes, error, busy, refreshing, refreshFailed, onRefresh, onClose, onSubmit }: FieldsProps) {
  const { t, name } = useArmoryLocale()
  const { user } = useAuth()
  const id = useId()
  const [action, setAction] = useState<Action>()
  const [destinationId, setDestinationId] = useState<number | null>(null)
  const [reason, setReason] = useState('')
  const [witness, setWitness] = useState<ArmoryPersonCandidateRead | null>(null)
  const destinations = safes.filter(safe => safe.id !== safeId)
  const destination = destinations.find(safe => safe.id === destinationId)
  const actorId = user?.employee_id
  const blocked = !actorId ? t('assets.armory.errors.actorEmployeeRequired')
    : action === 'transfer' && !destination ? t('assets.armory.items.needDestination')
      : !action || reason.trim().length < 3 || !witness ? t('assets.armory.items.needStateEvidence') : ''

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (busy || refreshFailed || blocked || !action || !witness) return
    onSubmit({
      action,
      expected_state: state,
      expected_safe_id: safeId,
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
      <fieldset disabled={busy || refreshFailed} className="min-w-0 space-y-3">
        <label className="grid gap-1 text-sm font-medium">{t('assets.armory.status')}
          <select required value={action ?? ''} onChange={event => setAction(actions.find(value => value === event.currentTarget.value))}
            className="min-h-11 w-full rounded-md border border-input bg-surface px-3 focus-visible:outline-2 focus-visible:outline-ring">
            <option value="">{t('assets.armory.chooseState')}</option>
            {actions.map(value => <option key={value} value={value} disabled={value === 'transfer' && destinations.length === 0}>{t(`assets.armory.serialAction.${value}`)}</option>)}
          </select>
        </label>
        {actions.includes('transfer') && destinations.length === 0 ? <p className="text-xs text-muted-foreground">{t('assets.armory.items.noTransferDestination')}</p> : null}
        {action === 'transfer' ? <label className="grid gap-1 text-sm font-medium">{t('assets.armory.destination')}
          <select required value={destination?.id ?? ''} onChange={event => setDestinationId(Number(event.currentTarget.value) || null)}
            className="min-h-11 w-full rounded-md border border-input bg-surface px-3 focus-visible:outline-2 focus-visible:outline-ring">
            <option value="">{t('assets.armory.chooseSafe')}</option>
            {destinations.map(safe => <option key={safe.id} value={safe.id}>{name(safe)}</option>)}
          </select>
        </label> : null}
        <label className="grid gap-1 text-sm font-medium">{t('assets.armory.reason')}
          <Textarea required minLength={3} maxLength={500} dir="auto" value={reason} onChange={event => setReason(event.currentTarget.value)} />
        </label>
        {actorId ? <ArmoryPersonPicker purpose="witness" safeId={safeId} label={t('assets.armory.witness')} value={witness} onChange={setWitness}
          excludeIds={[actorId, ...(serial.holder?.employee ? [serial.holder.employee.employee_id] : []), ...(serial.holder?.supervisor ? [serial.holder.supervisor.employee_id] : [])]} disabled={busy || refreshFailed} /> : null}
      </fieldset>
    </div>
    <footer className="flex shrink-0 flex-wrap items-center justify-end gap-2 border-t border-border px-4 py-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
      <p id={`${id}-blocked`} role="status" className="me-auto basis-full text-xs text-muted-foreground">{refreshing ? t('assets.armory.loadingText') : busy ? t('common.saving') : refreshFailed ? t('assets.armory.loadFailed') : blocked}</p>
      <Button type="button" variant="outline" className="min-h-11" disabled={busy} onClick={onClose}>{t('assets.armory.cancel')}</Button>
      <Button type="submit" className="min-h-11" disabled={Boolean(blocked) || busy || refreshFailed} aria-describedby={`${id}-blocked`}>{t('assets.armory.save')}</Button>
    </footer>
  </form>
}
