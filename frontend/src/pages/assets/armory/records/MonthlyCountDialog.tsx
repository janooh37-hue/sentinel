import { useEffect, useId, useRef, useState } from 'react'
import type { FormEvent } from 'react'
import { Trans } from 'react-i18next'
import { Link } from 'react-router-dom'
import { X } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { DialogContent, DialogDescription, DialogHeader, DialogRoot, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { ApiError } from '@/lib/api'
import type { ArmoryCountObservation, ArmoryItemRef, ArmoryMonthlyCountDraftRead, ArmoryPersonCandidateRead } from '@/lib/api'
import { useAuth } from '@/lib/authContext'
import { normalizeDigits } from '@/lib/utils'
import { Ltr, useArmoryLocale } from '../armoryFormat'
import { armoryErrorMessage, isArmoryAccessError, useArmoryAccess, useArmoryMonthlyCountDraft, useCreateArmoryMonthlyCount } from '../armoryQueries'
import { armoryLink } from '../armoryUrl'
import { ArmoryPersonPicker } from '../dialogs/ArmoryPersonPicker'
import { CountResult } from './auditCountResult'
import { AuditLoadError, AuditLoading, AuditMonth } from './auditDisplay'
import { MAX_COUNT, parseAuditQuantity } from './auditInput'

interface Props {
  safeId: number
  open: boolean
  onClose(): void
}

interface Observation {
  quantity: string
  serialText: string
  serials: string[]
  complete: boolean
  serialError: 'empty' | 'invalid' | 'duplicate' | null
}

const emptyObservation: Observation = { quantity: '', serialText: '', serials: [], complete: false, serialError: null }
const codePattern = /^[A-Z0-9][A-Z0-9._/-]{0,79}$/

function tracksSerials(item: ArmoryItemRef) {
  return item.kind === 'serial' || item.kind === 'firearm'
}

function observedQuantity(row: Observation): number | null {
  const qty = parseAuditQuantity(row.quantity)
  return qty !== null && qty + row.serials.length <= MAX_COUNT ? qty : null
}

function isComplete(item: ArmoryItemRef, row: Observation): boolean {
  return observedQuantity(row) !== null && (!tracksSerials(item) || (row.complete && row.serialText.trim() === '' && row.serialError === null))
}

export function MonthlyCountDialog({ safeId, open, onClose }: Props): React.JSX.Element {
  const { principal, canEdit } = useArmoryAccess()
  if (!open || !canEdit) return <></>
  return <MonthlyCountForm key={`${principal}:${safeId}`} safeId={safeId} onClose={onClose} />
}

function MonthlyCountForm({ safeId, onClose }: Omit<Props, 'open'>) {
  const { t, name } = useArmoryLocale()
  const { user } = useAuth()
  const draftQuery = useArmoryMonthlyCountDraft(safeId)
  const mutation = useCreateArmoryMonthlyCount()
  const [pinnedDraft, setPinnedDraft] = useState<ArmoryMonthlyCountDraftRead | null>(null)
  const [observations, setObservations] = useState<Record<number, Observation>>({})
  const [witness, setWitness] = useState<ArmoryPersonCandidateRead | null>(null)
  const [discarding, setDiscarding] = useState(false)
  const [recordedPeriod, setRecordedPeriod] = useState<ApiError | null>(null)
  const keepEditingRef = useRef<HTMLButtonElement>(null)
  const cancelRef = useRef<HTMLButtonElement>(null)
  const successRef = useRef<HTMLParagraphElement>(null)
  const lastFocus = useRef<HTMLElement | null>(null)
  const draft = pinnedDraft ?? draftQuery.data
  const saved = mutation.data
  const error = mutation.error
  const conflict = error instanceof ApiError && error.status === 409
    && (error.code === 'armory_stale_count' || error.code === 'armory_period_already_recorded') ? error : null
  const invalidWitness = mutation.error instanceof ApiError && mutation.error.code === 'armory_invalid_witness'
  const noAccess = isArmoryAccessError(draftQuery.error) || isArmoryAccessError(mutation.error)
  const pending = mutation.isPending
  const freshDraft = draftQuery.isError || draftQuery.isFetching ? undefined : draftQuery.data
  const total = draft?.items.length ?? 0
  let counted = 0
  for (const item of draft?.items ?? []) {
    const entry = observations[item.id]
    if (entry && isComplete(item, entry)) counted++
  }
  const dirty = witness !== null || Object.values(observations).some(({ quantity, serialText, serials, complete }) => (
    quantity.trim() !== '' || serialText.trim() !== '' || serials.length > 0 || complete
  ))
  const canSave = total > 0 && counted === total && witness !== null && !pending && !conflict && !recordedPeriod && !invalidWitness && !noAccess && !draftQuery.isError

  useEffect(() => { if (discarding) keepEditingRef.current?.focus() }, [discarding])
  useEffect(() => { if (saved) successRef.current?.focus() }, [saved])

  function keepEditing() {
    setDiscarding(false)
    requestAnimationFrame(() => {
      const previous = lastFocus.current
      if (previous?.isConnected && previous !== document.body) previous.focus()
      else cancelRef.current?.focus()
    })
  }

  function requestClose() {
    if (pending) return
    if (discarding) keepEditing()
    else if (!saved && !noAccess && dirty) {
      lastFocus.current = document.activeElement instanceof HTMLElement ? document.activeElement : null
      setDiscarding(true)
    } else onClose()
  }

  function updateObservation(itemId: number, patch: Partial<Observation>) {
    if (!pinnedDraft && draft) setPinnedDraft(draft)
    setObservations((current) => ({ ...current, [itemId]: { ...(current[itemId] ?? emptyObservation), ...patch } }))
  }

  function addSerials(itemId: number, raw: string) {
    const tokens = raw.trim().split(/[\s,;،؛]+/u).filter(Boolean)
    if (!tokens.length) {
      updateObservation(itemId, { serialError: 'empty' })
      return
    }
    const elsewhere = new Set<string>()
    for (const item of draft?.items ?? []) {
      if (item.id === itemId) continue
      for (const code of observations[item.id]?.serials ?? []) elsewhere.add(code)
    }
    const serials = new Set(observations[itemId]?.serials)
    for (const token of tokens) {
      const code = normalizeDigits(token).toUpperCase()
      const valid = codePattern.test(code)
      if (!valid || elsewhere.has(code)) {
        updateObservation(itemId, { serialText: tokens.join(' '), serialError: valid ? 'duplicate' : 'invalid', complete: false })
        return
      }
      serials.add(code)
    }
    updateObservation(itemId, { serials: [...serials], serialText: '', serialError: null, complete: false })
  }

  function applyFreshDraft(keep: boolean) {
    if (!freshDraft || !conflict) return
    const next: Record<number, Observation> = {}
    if (keep) {
      for (const item of freshDraft.items) {
        const previous = observations[item.id]
        if (previous) next[item.id] = { ...previous, complete: false }
      }
    }
    if (conflict.code === 'armory_period_already_recorded') setRecordedPeriod(conflict)
    setPinnedDraft(freshDraft)
    setObservations(next)
    setWitness(null)
    mutation.reset()
    requestAnimationFrame(() => cancelRef.current?.focus())
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!draft || !witness || !canSave) return
    const lines: ArmoryCountObservation[] = []
    for (const item of draft.items) {
      const entry = observations[item.id]
      if (!entry) return
      const qty = observedQuantity(entry)
      if (qty === null) return
      lines.push(tracksSerials(item)
        ? { item_id: item.id, observed_qty: qty, observed_serial_codes: entry.serials, serials_complete: true }
        : { item_id: item.id, observed_qty: qty, serials_complete: false })
    }
    mutation.mutate({ safeId, body: { snapshot_token: draft.snapshot_token, witness_employee_id: witness.person.employee_id, lines } })
  }

  const periodCountId = recordedPeriod?.details.count_id
  const allowRecordedLink = !dirty && typeof periodCountId === 'number' && Number.isSafeInteger(periodCountId) && periodCountId > 0

  return (
    <DialogRoot open onOpenChange={(open) => { if (!open) requestClose() }}>
      <DialogContent
        role={discarding ? 'alertdialog' : 'dialog'}
        hideClose={discarding}
        className="h-[100dvh] max-h-[100dvh] max-w-4xl rounded-none sm:h-auto sm:max-h-[calc(100dvh-2rem)] sm:rounded-2xl"
      >
        <DialogHeader className={discarding ? undefined : 'pe-16'}>
          <DialogTitle>{t(discarding ? 'assets.armory.discardCount' : saved && !noAccess ? 'assets.armory.auditPane.countComparison' : 'assets.armory.newCount')}</DialogTitle>
          <DialogDescription>
            {discarding ? t('assets.armory.auditPane.discardObservations') : (
              draft && !noAccess ? (
                <span className="flex flex-wrap items-baseline gap-x-3 gap-y-1 wrap-anywhere">
                  <bdi>{name(draft.safe)}</bdi>
                  <AuditMonth value={draft.month} />
                </span>
              ) : t('assets.armory.monthlyCounts')
            )}
          </DialogDescription>
        </DialogHeader>
        {discarding && (
          <div className="flex flex-wrap justify-end gap-2 p-4">
            <Button ref={keepEditingRef} type="button" variant="outline" className="min-h-11" onClick={keepEditing}>{t('assets.armory.keepEditing')}</Button>
            <Button type="button" variant="destructive" className="min-h-11" onClick={onClose}>{t('assets.armory.discard')}</Button>
          </div>
        )}
        <form hidden={discarding} className={discarding ? 'hidden' : 'flex min-h-0 flex-1 flex-col'} onSubmit={submit}>
          <div className="min-h-0 space-y-4 overflow-y-auto overscroll-contain p-4">
            {noAccess ? (
              <p role="alert" className="text-sm text-destructive-text">{armoryErrorMessage(mutation.error ?? draftQuery.error)}</p>
            ) : saved ? (
              <>
                <p ref={successRef} role="status" tabIndex={-1} className="rounded-md bg-success-soft px-3 py-2 text-sm font-medium">{t('assets.armory.savedCount')}</p>
                <CountResult count={saved} onFollowLink={onClose} />
              </>
            ) : conflict ? (
              <div className="space-y-3">
                <p role="alert" className="rounded-md bg-accent-soft px-3 py-2 text-sm text-destructive-text">{armoryErrorMessage(conflict)}</p>
                <p className="text-sm text-muted-foreground">{t('assets.armory.auditPane.recoverCount')}</p>
                {draftQuery.isError ? <AuditLoadError error={draftQuery.error} onRetry={() => void draftQuery.refetch()} /> : !freshDraft && <AuditLoading />}
                <div className="flex flex-wrap gap-2">
                  <Button type="button" variant="outline" className="min-h-11" disabled={!freshDraft} onClick={() => applyFreshDraft(true)}>
                    {t('assets.armory.auditPane.keepObservations')}
                  </Button>
                  <Button type="button" variant="outline" className="min-h-11" disabled={!freshDraft} onClick={() => applyFreshDraft(false)}>
                    {t('assets.armory.auditPane.startOver')}
                  </Button>
                </div>
              </div>
            ) : (
              <>
                {draftQuery.isError && <AuditLoadError error={draftQuery.error} onRetry={() => void draftQuery.refetch()} />}
                {mutation.error && !invalidWitness && <p role="alert" className="text-sm text-destructive-text">{armoryErrorMessage(mutation.error)}</p>}
                {recordedPeriod && (
                  <div className="space-y-1 rounded-md bg-warning-soft px-3 py-2">
                    <p role="alert" className="text-sm font-medium">{armoryErrorMessage(recordedPeriod)}</p>
                    {allowRecordedLink && (
                      <Link to={armoryLink('audit', { pane: 'counts', count: periodCountId })} className="inline-flex min-h-11 items-center text-sm font-medium text-primary-text underline underline-offset-4" onClick={onClose}>
                        {t('assets.armory.viewRecord')}
                      </Link>
                    )}
                  </div>
                )}
                {!draft ? !draftQuery.isError && <AuditLoading /> : draft.items.length === 0 ? (
                  <p className="text-sm text-muted-foreground">{t('assets.armory.auditPane.noCountItems')}</p>
                ) : (
                  <>
                    <p className="text-sm text-muted-foreground">{t('assets.armory.blindHint')}</p>
                    {!recordedPeriod && (
                      <ArmoryPersonPicker purpose="witness" label={t('assets.armory.countWitness')} safeId={safeId} value={witness}
                        excludeIds={user?.employee_id ? [user.employee_id] : undefined} disabled={pending}
                        onChange={(next) => { if (!pinnedDraft) setPinnedDraft(draft); setWitness(next); if (invalidWitness) mutation.reset() }} />
                    )}
                    {invalidWitness && <p role="alert" className="text-sm text-destructive-text">{armoryErrorMessage(mutation.error)}</p>}
                    <div className="grid items-start gap-3 lg:grid-cols-2">
                      {draft.items.map((item) => (
                        <CountItemInput key={item.id} item={item} value={observations[item.id] ?? emptyObservation} disabled={pending || recordedPeriod !== null}
                          update={(patch) => updateObservation(item.id, patch)} addSerials={(raw) => addSerials(item.id, raw)} />
                      ))}
                    </div>
                  </>
                )}
              </>
            )}
          </div>
          <footer className="flex shrink-0 flex-wrap items-center justify-end gap-2 border-t border-border px-4 py-3">
            {!saved && !conflict && !noAccess && draft && (
              <div className="me-auto text-sm" role="status">
                <p className="font-medium">
                  <Trans
                    i18nKey="assets.armory.auditPane.countProgress"
                    values={{ counted, total }}
                    components={{
                      countedValue: <bdi dir="ltr" className="tabular-nums" />,
                      totalValue: <bdi dir="ltr" className="tabular-nums" />,
                    }}
                  />
                </p>
                <p className="text-muted-foreground">
                  {pending ? t('assets.armory.auditPane.saving') : recordedPeriod ? null : counted < total ? t('assets.armory.auditPane.countAllItems') : !witness ? t('assets.armory.needWitness') : null}
                </p>
              </div>
            )}
            <Button ref={cancelRef} type="button" variant="outline" className="min-h-11" disabled={pending} onClick={requestClose}>
              {t(saved || noAccess || recordedPeriod ? 'assets.armory.close' : 'assets.armory.cancel')}
            </Button>
            {!saved && !noAccess && !conflict && !recordedPeriod && (
              <Button type="submit" className="min-h-11" disabled={!canSave}>{t('assets.armory.saveCount')}</Button>
            )}
          </footer>
        </form>
      </DialogContent>
    </DialogRoot>
  )
}

function CountItemInput({ item, value, disabled, update, addSerials }: {
  item: ArmoryItemRef
  value: Observation
  disabled: boolean
  update(patch: Partial<Observation>): void
  addSerials(raw: string): void
}) {
  const { t, name } = useArmoryLocale()
  const id = useId()
  const serialInput = useRef<HTMLInputElement>(null)
  const tracked = tracksSerials(item)
  const quantityError = value.quantity !== '' && observedQuantity(value) === null
  const serialErrorKey = value.serialError === 'empty' ? 'assets.armory.countEnter'
    : value.serialError === 'invalid' ? 'assets.armory.invalidStockCode'
      : value.serialError === 'duplicate' ? 'assets.armory.auditPane.serialAlreadyCounted' : null

  return (
    <fieldset disabled={disabled} className="min-w-0 space-y-2 rounded-md border border-border px-3 pb-3">
      <legend className="px-1 text-sm font-semibold wrap-anywhere"><bdi>{name(item)}</bdi></legend>
      <div className="space-y-1">
        <label htmlFor={`${id}-quantity`} className="block text-sm font-medium">{t(tracked ? 'assets.armory.unrecordedQty' : 'assets.armory.blindQuantity')}</label>
        <Input id={`${id}-quantity`} dir="ltr" inputMode="numeric" autoComplete="off" className="min-h-11 max-w-32 tabular-nums"
          aria-invalid={quantityError || undefined} aria-describedby={quantityError ? `${id}-quantity-error` : undefined}
          value={value.quantity} onChange={(event) => update({ quantity: normalizeDigits(event.target.value) })} required />
        {quantityError && <p id={`${id}-quantity-error`} className="text-sm text-destructive-text">{t('assets.armory.needStockQuantity')}</p>}
      </div>
      {tracked && (
        <div className="space-y-2 border-t border-hairline pt-2">
          <label htmlFor={`${id}-serial`} className="block text-sm font-medium">{t('assets.armory.blindSerials')}</label>
          <div className="flex flex-wrap items-center gap-2">
            <Input
              ref={serialInput}
              id={`${id}-serial`}
              dir="ltr"
              autoComplete="off"
              className="min-h-11 min-w-24 flex-1 font-mono"
              placeholder={t('assets.armory.countSearch')}
              aria-invalid={Boolean(serialErrorKey) || undefined}
              aria-describedby={serialErrorKey ? `${id}-serial-error` : undefined}
              value={value.serialText}
              onChange={(event) => update({ serialText: event.target.value, serialError: null, complete: false })}
              onPaste={(event) => { event.preventDefault(); addSerials(`${value.serialText} ${event.clipboardData.getData('text')}`) }}
              onKeyDown={(event) => { if (event.key === 'Enter') { event.preventDefault(); addSerials(value.serialText) } }}
            />
            <Button type="button" variant="outline" className="min-h-11" onClick={() => { addSerials(value.serialText); serialInput.current?.focus() }}>
              {t('assets.armory.add')}
            </Button>
          </div>
          {serialErrorKey && <p id={`${id}-serial-error`} role="alert" className="text-sm text-destructive-text">{t(serialErrorKey)}</p>}
          {value.serials.length > 0 && (
            <ul className="flex flex-wrap gap-2">
              {value.serials.map((serial) => (
                <li key={serial} className="flex max-w-full items-center gap-1 rounded-md border border-border bg-surface-raised ps-2">
                  <Ltr className="min-w-0 font-mono text-xs wrap-anywhere">{serial}</Ltr>
                  <Button type="button" size="icon" variant="ghost" className="min-h-11 min-w-11 shrink-0" aria-label={t('assets.armory.removeSerial', { serial })}
                    onClick={() => { update({ serials: value.serials.filter((code) => code !== serial), complete: false, serialError: null }); serialInput.current?.focus() }}>
                    <X className="size-4" aria-hidden />
                  </Button>
                </li>
              ))}
            </ul>
          )}
          <label className="flex min-h-11 items-center gap-2 text-sm">
            <input type="checkbox" checked={value.complete} className="size-4 shrink-0 accent-primary" onChange={(event) => update({ complete: event.target.checked })} required />
            {t('assets.armory.countConfirmed')}
          </label>
        </div>
      )}
    </fieldset>
  )
}
