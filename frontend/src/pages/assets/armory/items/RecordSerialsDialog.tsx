import { ScanLine } from 'lucide-react'
import { type FormEvent, type RefObject, useId, useRef, useState } from 'react'

import { Button } from '@/components/ui/button'
import { DialogContent, DialogDescription, DialogHeader, DialogRoot, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import type { ArmoryItemDetailRead, ArmoryPersonCandidateRead } from '@/lib/api'
import { useAuth } from '@/lib/authContext'
import { Ltr } from '../ArmoryLtr'
import { useArmoryLocale } from '../armoryFormat'
import { armoryErrorMessage, isArmoryAccessError, useArmoryAccess, useRecordArmorySerials } from '../armoryQueries'
import { ArmoryPersonPicker } from '../dialogs/ArmoryPersonPicker'
import { parseSerialEntry } from './serialCodes'

interface Props {
  open: boolean
  item: ArmoryItemDetailRead
  initialSafeId: number
  onOpenChange(open: boolean): void
  onSaved(): void
  returnFocusRef: RefObject<HTMLElement | null>
  fallbackFocusRef: RefObject<HTMLElement | null>
}

export function RecordSerialsDialog(props: Props) {
  const { canEdit, principal } = useArmoryAccess()
  return canEdit && principal !== null && props.open ? <RegistrationForm key={principal} {...props} /> : null
}

function RegistrationForm({ open, item, initialSafeId, onOpenChange, onSaved, returnFocusRef, fallbackFocusRef }: Props) {
  const { t, name, isAr } = useArmoryLocale()
  const { user } = useAuth()
  const id = useId()
  const input = useRef<HTMLTextAreaElement>(null)
  const registration = useRecordArmorySerials()
  const [safeId, setSafeId] = useState(initialSafeId)
  const [serialText, setSerialText] = useState('')
  const [reference, setReference] = useState('')
  const [witness, setWitness] = useState<ArmoryPersonCandidateRead | null>(null)
  const eligible = item.stock.filter(row => (row.unrecorded_qty ?? 0) > 0)
  const selected = eligible.find(row => row.safe.id === safeId)
  const limit = selected?.unrecorded_qty ?? 0
  const controlled = item.kind === 'firearm'
  const actorId = user?.employee_id
  const needsActor = controlled && !actorId
  const denied = isArmoryAccessError(registration.error)
  const registered = new Set(item.serials.filter(row => row.state !== null).map(row => row.serial_code))
  const entries = parseSerialEntry(serialText).map(entry => ({
    code: entry.code,
    error: !entry.valid ? 'invalidStockCode' : entry.duplicate ? 'serialRepeated' : registered.has(entry.code) ? 'serialDuplicate' : null,
  }))
  const ready = entries.filter(entry => entry.error === null)
  const problems = entries.filter(entry => entry.error !== null)
  const overLimit = entries.length > limit
  const limitText = t('assets.armory.serialLimit', { count: limit })
  const blocked = !selected ? t('assets.armory.items.noUnrecorded')
    : needsActor ? t('assets.armory.errors.actorEmployeeRequired')
      : !entries.length ? t('assets.armory.needSerialEntry')
        : problems.length ? t('assets.armory.fixSerials')
          : overLimit ? limitText
            : controlled && (!reference.trim() || !witness) ? t('assets.armory.items.needRegistrationEvidence') : ''

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (blocked || denied || registration.isPending) return
    try {
      await registration.mutateAsync({ itemId: item.id, body: {
        safe_id: safeId,
        serial_codes: ready.map(entry => entry.code),
        reference: controlled ? reference.trim() : null,
        witness_employee_id: controlled ? witness?.person.employee_id ?? null : null,
      } })
    } catch (error) {
      if (isArmoryAccessError(error)) {
        setSerialText('')
        setReference('')
        setWitness(null)
      }
      return
    }
    onSaved()
    onOpenChange(false)
  }

  function scan() {
    const field = input.current
    if (!field) return
    if (serialText && !/[\s,،;؛]$/.test(serialText)) setSerialText(`${serialText}\n`)
    field.focus()
    field.setSelectionRange(field.value.length, field.value.length)
  }

  const codeChip = (entry: typeof entries[number], index: number) => <li key={index} className={`rounded border border-hairline bg-surface-raised px-2 py-1 text-xs wrap-anywhere ${entry.error ? 'text-destructive-text' : ''}`}>
    <Ltr className="font-mono">{entry.code}</Ltr>{entry.error ? <> {t(`assets.armory.${entry.error}`)}</> : null}
  </li>

  return <DialogRoot open={open} onOpenChange={next => { if (!registration.isPending) onOpenChange(next) }}>
    <DialogContent hideClose dir={isAr ? 'rtl' : 'ltr'} returnFocusRef={returnFocusRef}
      onCloseAutoFocus={event => {
        if (!returnFocusRef.current?.isConnected && fallbackFocusRef.current?.isConnected) { event.preventDefault(); fallbackFocusRef.current.focus() }
      }}
      className="max-sm:h-dvh max-sm:max-h-dvh max-sm:max-w-none max-sm:rounded-none sm:max-h-[min(90dvh,48rem)]">
      <DialogHeader>
        <DialogTitle>{t('assets.armory.recordSerials')}</DialogTitle>
        <DialogDescription>{denied ? null : <><bdi>{name(item)}</bdi> · {t('assets.armory.items.registrationDoesNotIncrease')}</>}</DialogDescription>
      </DialogHeader>
      <form onSubmit={submit} className="flex min-h-0 flex-1 flex-col">
        <div className="min-h-0 flex-1 space-y-3 overflow-y-auto overscroll-contain p-4">
          {registration.isError ? <p role="alert" className="rounded bg-accent-soft p-2 text-sm text-destructive-text">{armoryErrorMessage(registration.error)}</p> : null}
          {!denied ? <fieldset disabled={registration.isPending} className="min-w-0 space-y-3">
            <label className="grid gap-1 text-sm font-medium">{t('assets.armory.safe')}
              <select value={selected?.safe.id ?? ''} onChange={event => { setSafeId(Number(event.currentTarget.value)); setWitness(null) }}
                className="min-h-11 w-full rounded-md border border-input bg-surface px-3 focus-visible:outline-2 focus-visible:outline-ring">
                {!selected ? <option value="">{t('assets.armory.chooseSafe')}</option> : null}
                {eligible.map(row => <option key={row.safe.id} value={row.safe.id}>{name(row.safe)}</option>)}
              </select>
            </label>
            <div className="space-y-1">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <label className="text-sm font-medium" htmlFor={`${id}-serials`}>{t('assets.armory.serialEntryLabel')}</label>
                <Button type="button" variant="ghost" className="min-h-11" onClick={scan}><ScanLine aria-hidden />{t('assets.armory.scanSerials')}</Button>
              </div>
              <Textarea ref={input} id={`${id}-serials`} dir="ltr" rows={3} maxLength={16000} spellCheck={false} autoCapitalize="characters" autoComplete="off"
                value={serialText} onChange={event => setSerialText(event.currentTarget.value)} placeholder={t('assets.armory.serialEntryPlaceholder')}
                aria-describedby={`${id}-hint ${id}-limit`} aria-invalid={problems.length > 0 || overLimit} />
              <p id={`${id}-hint`} className="text-xs text-muted-foreground">{t('assets.armory.serialPadHint')}</p>
              <p id={`${id}-limit`} className={`text-xs ${overLimit ? 'text-destructive-text' : 'text-muted-foreground'}`}>{limitText}</p>
              <div role="status" className="text-xs text-muted-foreground">
                {entries.length ? <>{t('assets.armory.serialReadyN', { count: ready.length })}{problems.length ? <> · {t('assets.armory.serialFixN', { count: problems.length })}</> : null}</> : null}
              </div>
              {entries.length ? <ul className="flex flex-wrap gap-1">{[...problems, ...ready.slice(0, 10)].map(codeChip)}</ul> : null}
              {ready.length > 10 ? <details><summary className="flex min-h-11 cursor-pointer items-center text-sm text-primary-text">{t('assets.armory.moreSerials', { count: ready.length - 10 })}</summary>
                <ul className="flex flex-wrap gap-1">{ready.slice(10).map(codeChip)}</ul></details> : null}
            </div>
            {controlled ? <>
              <label className="grid gap-1 text-sm font-medium">{t('assets.armory.reference')}
                <Input className="min-h-11" dir="ltr" required maxLength={80} value={reference} onChange={event => setReference(event.currentTarget.value)} />
              </label>
              {selected && !needsActor ? <ArmoryPersonPicker key={safeId} purpose="witness" safeId={safeId} label={t('assets.armory.witness')}
                value={witness} onChange={setWitness} excludeIds={actorId ? [actorId] : []} disabled={registration.isPending} /> : null}
            </> : null}
          </fieldset> : null}
        </div>
        <footer className="flex shrink-0 flex-wrap items-center justify-end gap-2 border-t border-border px-4 py-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
          {!denied ? <p id={`${id}-blocked`} role="status" className="me-auto basis-full text-xs text-muted-foreground">{registration.isPending ? t('common.saving') : blocked}</p> : null}
          <Button type="button" variant="outline" className="min-h-11" disabled={registration.isPending} onClick={() => onOpenChange(false)}>{t('assets.armory.cancel')}</Button>
          {!denied ? <Button type="submit" className="min-h-11" disabled={Boolean(blocked) || registration.isPending} aria-describedby={`${id}-blocked`}>{t('assets.armory.save')}</Button> : null}
        </footer>
      </form>
    </DialogContent>
  </DialogRoot>
}
