import { useEffect, useId, useRef, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { Link } from 'react-router-dom'

import { DialogBody, DialogFooter, DialogShell, FormAlert } from '@/components/forms/DialogShell'
import { Button } from '@/components/ui/button'
import { ConfirmDialog } from '@/components/ui/confirm-dialog'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import type {
  ArmoryAssignmentLineInput, ArmoryAssignmentRead, ArmoryCustodyCreate, ArmoryItemRef, ArmoryKitLineRead, ArmoryKitRead,
  ArmoryPersonCandidateRead, ArmorySafeRead, ArmoryShiftIssueCreate,
} from '@/lib/api'
import { useAuth } from '@/lib/authContext'
import { isolateBidi } from '@/lib/useCapabilityCatalog'
import { normalizeDigits } from '@/lib/utils'
import { Ltr } from '../ArmoryLtr'
import { displayDate, orgDateIso, orgDateTimeInput, orgInputToInstant, useArmoryLocale } from '../armoryFormat'
import {
  armoryErrorMessage, invalidateArmoryQueries, useArmoryAccess, useArmoryItem, useArmoryItems, useArmoryKits,
  useArmoryPeople, useArmoryShift, useCreateArmoryCustody, useCreateArmoryIssue,
} from '../armoryQueries'
import { armoryLink } from '../armoryUrl'
import { ArmoryArt } from '../items/ArmoryArt'
import { ArmoryPersonPicker } from './ArmoryPersonPicker'

type Mode = 'shift' | 'custody'
type HolderKind = 'person' | 'site'
type OffDutyReason = NonNullable<ArmoryShiftIssueCreate['off_duty_reason']>
const OFF_DUTY_REASONS: readonly OffDutyReason[] = ['cover', 'escort', 'training', 'other']

interface Pick { qty: string; serialId: number | null; batchId: number | null }
const EMPTY_PICK: Pick = { qty: '', serialId: null, batchId: null }

interface Props {
  open: boolean
  mode: Mode
  safeId: number | null
  safes: ArmorySafeRead[]
  onOpenChange(open: boolean): void
  onSaved(record: ArmoryAssignmentRead): void
  onCorrectQualification(employeeId: string): void
  resumeSignal: number
  returnFocusRef: React.RefObject<HTMLElement | null>
}

/**
 * Records a shift issue or a custody handover: one shared form. It records a
 * sign-out that is authorized elsewhere; it never authorizes release. The
 * draft lives in this component (outside the dialog content), so the shell can
 * suspend it with `open=false` while Guards corrects a qualification.
 */
export function ArmoryAssignmentDialog(props: Props): React.JSX.Element | null {
  const { canEdit } = useArmoryAccess()
  return canEdit ? <AssignmentForm {...props} /> : null
}

function whole(raw: string): number | null {
  return /^\d{1,9}$/.test(raw.trim()) ? Number(raw.trim()) : null
}

/** Kit slots: a default line plus its alternative share one slot (right/left holster). */
interface Slot { key: number; options: ArmoryKitLineRead[]; role: ArmoryKitLineRead['role'] }
function kitSlots(kit: ArmoryKitRead | undefined): Slot[] {
  if (!kit) return []
  const slots: Slot[] = []
  for (const line of kit.lines) {
    if (line.role === 'alternative' && line.substitutes_item_id !== null) {
      const slot = slots.find(entry => entry.key === line.substitutes_item_id)
      if (slot) { slot.options.push(line); continue }
    }
    slots.push({ key: line.item.id, options: [line], role: line.role })
  }
  return slots
}

function AssignmentForm({ open, mode, safeId: initialSafeId, safes, onOpenChange, onSaved, onCorrectQualification, resumeSignal, returnFocusRef }: Props): React.JSX.Element {
  const { t, name } = useArmoryLocale()
  const { user } = useAuth()
  const client = useQueryClient()
  const id = useId()
  const searchRef = useRef<HTMLInputElement>(null)
  const [safeId, setSafeId] = useState<number | null>(initialSafeId)
  const [holderKind, setHolderKind] = useState<HolderKind>('person')
  const [siteSafeId, setSiteSafeId] = useState<number | null>(null)
  const [chosen, setChosen] = useState<ArmoryPersonCandidateRead | null>(null)
  const [kitChoice, setKitId] = useState<number | null>(null)
  const [picks, setPicks] = useState<Record<number, Pick>>({})
  const [slotChoice, setSlotChoice] = useState<Record<number, number>>({})
  const [offDuty, setOffDuty] = useState<OffDutyReason | ''>('')
  const [offDutyNote, setOffDutyNote] = useState('')
  const [acknowledged, setAcknowledged] = useState(false)
  const [excessReason, setExcessReason] = useState('')
  const [dueInput, setDue] = useState<string | null>(null)
  const [conditionNote, setConditionNote] = useState('')
  const [notice, setNotice] = useState('')
  const [dirty, setDirty] = useState(false)
  const [confirmDiscard, setConfirmDiscard] = useState(false)
  const lastResume = useRef(resumeSignal)

  const kits = useArmoryKits()
  const items = useArmoryItems(safeId === null ? {} : { safe_id: safeId })
  const shift = useArmoryShift(safeId)
  const issue = useCreateArmoryIssue()
  const custody = useCreateArmoryCustody()
  const mutation = mode === 'shift' ? issue : custody
  const purpose = mode === 'shift' ? 'issue' : 'custody'
  // Eligibility is always read live for the chosen person (refreshed after a Guards correction).
  const live = useArmoryPeople({ purpose, q: chosen?.person.employee_id ?? '', ...(safeId !== null ? { safe_id: safeId } : {}), limit: 50 }, open && chosen !== null && (purpose !== 'issue' || safeId !== null))
  const person = (chosen && live.data?.find(row => row.person.employee_id === chosen.person.employee_id)) ?? chosen

  // The approved form opens on the rifle kit; serials are never pre-selected.
  const kitId = kitChoice ?? (kits.data?.find(entry => entry.code === 'rifle') ?? kits.data?.[0])?.id ?? null
  const kit = kits.data?.find(entry => entry.id === kitId)
  const firearm = kit?.firearm_item ?? null
  const slots = kitSlots(kit)
  const safe = safes.find(entry => entry.id === safeId) ?? null
  const isSite = mode === 'custody' && holderKind === 'site'
  const needsPerson = !isSite || firearm !== null
  const self = person !== null && person.person.employee_id === user?.employee_id
  const noCourse = firearm !== null && person !== null && person.course_round === null
  const held = firearm !== null ? person?.open_firearm ?? null : null
  const blocked = self || noCourse || held !== null
  const isOffDuty = mode === 'shift' && person !== null && !person.on_duty_here
  const requiresAck = firearm !== null && person !== null && !noCourse && held === null && (person.licence_status === 'missing' || person.licence_status === 'expired')
  const window = shift.data?.window ?? null
  // Organization clock from the server read: no browser clock in validation.
  const nowAt = shift.data ? Date.parse(shift.data.attention.now_at) : NaN
  const today = shift.data ? orgDateIso(shift.data.attention.now_at, window?.time_zone) : null
  const expiringDays = firearm !== null && today && person?.licence_status === 'expiring' && person.licence_expires_on
    ? Math.round((Date.parse(person.licence_expires_on) - Date.parse(today)) / 86_400_000) : null
  const due = dueInput ?? (mode === 'shift' && window ? orgDateTimeInput(window.ends_at, window.time_zone) : '')

  useEffect(() => {
    if (lastResume.current === resumeSignal) return
    lastResume.current = resumeSignal
    setAcknowledged(false)
    setNotice(t('assets.armory.eligibilityRefreshed'))
    void invalidateArmoryQueries(client)
  }, [client, resumeSignal, t])

  function touch() { setDirty(true); mutation.reset() }
  function available(itemId: number): number {
    const item = items.data?.find(entry => entry.id === itemId)
    return item?.stock.find(row => row.safe.id === safeId)?.available_qty ?? 0
  }
  function pick(itemId: number): Pick { return picks[itemId] ?? EMPTY_PICK }
  function setPick(itemId: number, patch: Partial<Pick>) {
    touch()
    setPicks(previous => ({ ...previous, [itemId]: { ...(previous[itemId] ?? EMPTY_PICK), ...patch } }))
  }
  function chooseSafe(next: number | null) {
    touch()
    const hadSelections = Object.values(picks).some(entry => entry.serialId !== null || entry.batchId !== null)
    setSafeId(next)
    setPicks(previous => Object.fromEntries(Object.entries(previous).map(([key, value]) => [key, { ...value, serialId: null, batchId: null }])))
    setNotice(hadSelections ? t('assets.armory.assignment.safeChanged') : '')
  }
  function chooseKit(next: number) {
    touch()
    setKitId(next)
    setPicks({})
    setSlotChoice({})
    setAcknowledged(false)
    setExcessReason('')
  }
  function choosePerson(next: ArmoryPersonCandidateRead | null) {
    touch()
    setChosen(next)
    setAcknowledged(false)
    setOffDuty('')
    setOffDutyNote('')
  }

  const chosenSlots = slots.map(slot => {
    const itemId = slotChoice[slot.key] ?? slot.options[0].item.id
    return { slot, line: slot.options.find(option => option.item.id === itemId) ?? slot.options[0] }
  })
  const qtyOf = (line: ArmoryKitLineRead) => whole(picks[line.item.id]?.qty ?? (line.role === 'optional' ? '0' : String(line.default_qty)))
  const lines: ArmoryAssignmentLineInput[] = []
  if (firearm && pick(firearm.id).serialId !== null) lines.push({ item_id: firearm.id, qty: 1, serial_id: pick(firearm.id).serialId })
  for (const { line } of chosenSlots) {
    const kind = line.item.kind
    const value = pick(line.item.id)
    if (kind === 'firearm' || kind === 'serial') {
      if (value.serialId !== null) lines.push({ item_id: line.item.id, qty: 1, serial_id: value.serialId })
    } else if (kind === 'expiry') {
      const qty = whole(value.qty) ?? 0
      if (value.batchId !== null && qty > 0) lines.push({ item_id: line.item.id, qty, batch_id: value.batchId })
    } else {
      const qty = qtyOf(line) ?? 0
      if (qty > 0) lines.push({ item_id: line.item.id, qty })
    }
  }
  const overStock = chosenSlots.find(({ line }) => (line.item.kind === 'quantity' || line.item.kind === 'ammunition') && (qtyOf(line) ?? 0) > available(line.item.id))
  const badQty = chosenSlots.find(({ line }) => (line.item.kind === 'quantity' || line.item.kind === 'ammunition') && qtyOf(line) === null)
  const excess = firearm !== null && chosenSlots.some(({ line }) => line.item.kind === 'ammunition' && (qtyOf(line) ?? 0) > line.default_qty)
  const dueInstant = mode === 'shift' ? orgInputToInstant(due, window?.time_zone) : null
  const dueTime = dueInstant ? Date.parse(dueInstant) : NaN

  const reason = (() => {
    if (safeId === null) return t('assets.armory.chooseSafeForAction')
    if (!kit) return t('assets.armory.assignment.chooseKit')
    if (isSite && siteSafeId === null) return t('assets.armory.chooseSite')
    if (needsPerson && !person) return t('assets.armory.chooseGuard')
    if (self) return t('assets.armory.errors.selfIssue')
    if (noCourse) return t('assets.armory.noCourse')
    if (held) return heldText()
    if (isOffDuty && !offDuty) return t('assets.armory.needReason')
    if (isOffDuty && offDuty === 'other' && offDutyNote.trim().length < 3) return t('assets.armory.needReasonDetail')
    if (requiresAck && !acknowledged) return t('assets.armory.needAck')
    if (firearm && pick(firearm.id).serialId === null) return t('assets.armory.needSerial')
    if (badQty) return t('assets.armory.needStockQuantity')
    if (overStock) return t('assets.armory.onlyLeft', { count: available(overStock.line.item.id) })
    if (excess && excessReason.trim().length < 3) return t('assets.armory.needExcess')
    if (!lines.length) return t('assets.armory.needEquipment')
    if (mode === 'shift') {
      if (!Number.isFinite(dueTime) || !(dueTime > nowAt)) return t('assets.armory.needDue')
      if (window && dueTime > Date.parse(window.next_ends_at)) return t('assets.armory.dueCap')
    }
    return ''
  })()

  function heldText(): string {
    if (!held) return ''
    // Isolate both values: a digit-leading serial reorders inside an Arabic sentence.
    return t(held.assignment_kind === 'shift' ? 'assets.armory.shiftFirst' : 'assets.armory.custodyFirst', { item: isolateBidi(name(held.item)), serial: `\u2066${held.serial_code}\u2069` })
  }

  function submit(event: React.SyntheticEvent) {
    event.preventDefault()
    if (reason || safeId === null || !kit) return
    const common = {
      safe_id: safeId, kit_id: kit.id, lines,
      excess_rounds_reason: excess ? excessReason.trim() : null,
      licence_warning_acknowledged: requiresAck && acknowledged,
    }
    const done = (record: ArmoryAssignmentRead) => { setDirty(false); onSaved(record) }
    if (mode === 'shift') {
      const body: ArmoryShiftIssueCreate = {
        ...common, employee_id: person!.person.employee_id, due_at: dueInstant,
        off_duty_reason: isOffDuty ? offDuty as OffDutyReason : null,
        off_duty_note: isOffDuty && offDutyNote.trim() ? offDutyNote.trim() : null,
      }
      issue.mutate(body, { onSuccess: done })
    } else {
      const body: ArmoryCustodyCreate = {
        ...common, holder_kind: holderKind,
        holder_employee_id: isSite ? null : person!.person.employee_id,
        holder_safe_id: isSite ? siteSafeId : null,
        supervisor_employee_id: isSite && firearm ? person!.person.employee_id : null,
        condition_note: conditionNote.trim() || null,
      }
      custody.mutate(body, { onSuccess: done })
    }
  }

  function requestClose(next: boolean) {
    if (next) return onOpenChange(true)
    if (dirty && !mutation.isPending) setConfirmDiscard(true)
    else onOpenChange(false)
  }

  const title = t(mode === 'shift' ? 'assets.armory.signout' : 'assets.armory.handover')
  const actor = user ? name({ name_en: user.name_en || user.email, name_ar: user.name_ar }) : ''
  const description = [safe ? name(safe) : t('assets.armory.chooseSafe'), `${t('assets.armory.actor')}: ${actor}`].join(' · ')
  const personLabel = t(isSite ? 'assets.armory.siteSupervisor' : 'assets.armory.guard')
  const errorText = mutation.error ? armoryErrorMessage(mutation.error) : null

  return <>
    <DialogShell open={open && !confirmDiscard} onOpenChange={requestClose} title={title} description={description} size="xl" busy={mutation.isPending} returnFocusRef={returnFocusRef}
      onOpenAutoFocus={event => { if (!person && searchRef.current) { event.preventDefault(); searchRef.current.focus() } }}>
      <form onSubmit={submit} className="flex min-h-0 flex-1 flex-col" aria-describedby={`${id}-reason`}>
        <DialogBody>
          {notice && <p role="status" className="rounded-md bg-surface-tinted px-3 py-2 text-sm">{notice}</p>}
          <label className="flex flex-col gap-1.5 text-sm font-semibold">{t('assets.armory.safe')}
            <select className="min-h-11 rounded-md border border-border bg-surface px-3 font-normal" value={safeId ?? ''} disabled={mutation.isPending}
              onChange={event => chooseSafe(event.target.value ? Number(event.target.value) : null)}>
              <option value="">{t('assets.armory.chooseSafe')}</option>
              {safes.map(entry => <option key={entry.id} value={entry.id}>{name(entry)}</option>)}
            </select>
          </label>
          {mode === 'custody' && <fieldset className="flex flex-col gap-2">
            <legend className="text-sm font-semibold">{t('assets.armory.custodyKind')}</legend>
            <div className="flex flex-wrap gap-4">
              {(['person', 'site'] as const).map(kind => <label key={kind} className="flex min-h-11 items-center gap-2 text-sm">
                <input type="radio" name={`${id}-holder`} checked={holderKind === kind} onChange={() => { setHolderKind(kind); choosePerson(null) }} />
                {t(kind === 'person' ? 'assets.armory.person' : 'assets.armory.siteKind')}
              </label>)}
            </div>
            {isSite && <label className="flex flex-col gap-1.5 text-sm font-semibold">{t('assets.armory.siteKind')}
              <select className="min-h-11 rounded-md border border-border bg-surface px-3 font-normal" value={siteSafeId ?? ''}
                onChange={event => { touch(); setSiteSafeId(event.target.value ? Number(event.target.value) : null) }}>
                <option value="">{t('assets.armory.chooseSite')}</option>
                {safes.map(entry => <option key={entry.id} value={entry.id}>{name(entry.vehicle_site ?? entry)}</option>)}
              </select>
            </label>}
          </fieldset>}

          <fieldset className="flex flex-col gap-2">
            <legend className="text-sm font-semibold">{t('assets.armory.kit')}</legend>
            {kits.isError && <p role="alert" className="text-sm text-destructive-text">{t('assets.armory.loadFailed')}</p>}
            <div className="flex flex-wrap gap-2">
              {kits.data?.map(entry => <label key={entry.id} className="flex min-h-11 cursor-pointer items-center gap-2 rounded-md border border-border px-3 text-sm has-[:checked]:border-primary has-[:checked]:bg-primary-soft">
                <input type="radio" name={`${id}-kit`} checked={kitId === entry.id} onChange={() => chooseKit(entry.id)} />
                {name(entry)}
              </label>)}
            </div>
          </fieldset>

          {needsPerson && <div className="flex flex-col gap-2">
            {isSite && <p className="text-xs text-muted-foreground">{t('assets.armory.supervisorHint')}</p>}
            <ArmoryPersonPicker purpose={purpose} safeId={safeId} label={personLabel} value={person} onChange={choosePerson} inputRef={searchRef}
              excludeIds={user?.employee_id ? [user.employee_id] : []} disabled={mutation.isPending || (purpose === 'issue' && safeId === null)}
              describeSelected={candidate => mode === 'shift' && candidate.on_duty_here ? <p className="text-xs text-muted-foreground">{t('assets.armory.onDutyHere')}</p> : null} />
          </div>}

          {person && needsPerson && <div className="flex flex-col gap-2" aria-live="polite">
            {self && <Warning>{t('assets.armory.errors.selfIssue')}</Warning>}
            {noCourse && <Warning>
              <p className="font-semibold">{t('assets.armory.noCourse')}</p>
              <Button type="button" variant="secondary" className="mt-2 min-h-11" onClick={() => onCorrectQualification(person.person.employee_id)}>{t('assets.armory.assignment.recordCourse')}</Button>
            </Warning>}
            {held && <Warning>
              <p className="font-semibold">{heldText()}</p>
              <Link className="mt-1 inline-flex min-h-11 items-center text-sm font-medium text-primary-text underline underline-offset-2"
                to={held.assignment_kind === 'shift' ? armoryLink('shift', { issue: held.assignment_id }) : armoryLink('custody', { custody: held.assignment_id })}>
                {t('assets.armory.viewRecord')}
              </Link>
            </Warning>}
            {isOffDuty && !blocked && <Warning>
              <p className="font-semibold">{t('assets.armory.offDuty')}</p>
              <label className="mt-2 flex flex-col gap-1.5 text-sm font-semibold">{t('assets.armory.offDutyReason')}
                <select className="min-h-11 rounded-md border border-border bg-surface px-3 font-normal" value={offDuty} onChange={event => { touch(); setOffDuty(event.target.value as OffDutyReason | '') }}>
                  <option value="">{t('assets.armory.chooseReason')}</option>
                  {OFF_DUTY_REASONS.map(value => <option key={value} value={value}>{t(`assets.armory.${value}`)}</option>)}
                </select>
              </label>
              {offDuty === 'other' && <label className="mt-2 flex flex-col gap-1.5 text-sm font-semibold">{t('assets.armory.reasonDetail')}
                <Textarea dir="auto" maxLength={160} value={offDutyNote} onChange={event => { touch(); setOffDutyNote(event.target.value) }} />
              </label>}
            </Warning>}
            {expiringDays !== null && !blocked && <Warning>
              <p className="font-semibold">{t('assets.armory.licenceExpiringWarning', { count: Math.max(0, expiringDays) })} <Ltr>{displayDate(person.licence_expires_on ?? '')}</Ltr></p>
            </Warning>}
            {requiresAck && <Warning>
              <p className="font-semibold">{t(person.licence_status === 'expired' ? 'assets.armory.licenceExpiredWarning' : 'assets.armory.licenceMissingWarning')}</p>
              <p className="mt-1 text-sm">{t('assets.armory.releaseNotAuthorized')}</p>
              <label className="mt-2 flex min-h-11 items-start gap-2 text-sm">
                <input type="checkbox" className="mt-1" checked={acknowledged} onChange={event => { touch(); setAcknowledged(event.target.checked) }} />
                <span>{t('assets.armory.licenceAcknowledge')}</span>
              </label>
              <Button type="button" variant="secondary" className="mt-1 min-h-11" onClick={() => onCorrectQualification(person.person.employee_id)}>
                {t(person.licence_status === 'missing' ? 'assets.armory.addLicenceNow' : 'assets.armory.updateLicenceNow')}
              </Button>
            </Warning>}
          </div>}

          {kit && safeId !== null && <section className="flex flex-col gap-1" aria-labelledby={`${id}-contents`}>
            <h3 id={`${id}-contents`} className="text-sm font-semibold">{t(firearm ? 'assets.armory.options' : 'assets.armory.extras')}</h3>
            {items.isError && <p role="alert" className="text-sm text-destructive-text">{t('assets.armory.loadFailed')}</p>}
            {firearm && <LineRow item={firearm}>
              <SerialSelect itemId={firearm.id} safeId={safeId} label={t('assets.armory.serialNumber')} required value={pick(firearm.id).serialId} onChange={serialId => setPick(firearm.id, { serialId })} />
            </LineRow>}
            {chosenSlots.map(({ slot, line }) => <LineRow key={slot.key} item={line.item}>
              {slot.options.length > 1 && <fieldset className="flex flex-wrap gap-3">
                <legend className="sr-only">{t('assets.armory.holster')}</legend>
                {slot.options.map(option => <label key={option.item.id} className="flex min-h-11 items-center gap-2 text-sm">
                  <input type="radio" name={`${id}-slot-${slot.key}`} checked={line.item.id === option.item.id} onChange={() => {
                    touch()
                    setSlotChoice(previous => ({ ...previous, [slot.key]: option.item.id }))
                    setPicks(previous => ({ ...previous, [option.item.id]: previous[line.item.id] ?? EMPTY_PICK }))
                  }} />
                  {name(option.item)}
                </label>)}
              </fieldset>}
              {line.item.kind === 'serial' || line.item.kind === 'firearm'
                ? <SerialSelect itemId={line.item.id} safeId={safeId} label={t('assets.armory.serialNumber')} value={pick(line.item.id).serialId} onChange={serialId => setPick(line.item.id, { serialId })} />
                : line.item.kind === 'expiry'
                  ? <BatchSelect itemId={line.item.id} safeId={safeId} value={pick(line.item.id)} onChange={patch => setPick(line.item.id, patch)} itemName={name(line.item)} />
                  : <Quantity itemName={name(line.item)} value={picks[line.item.id]?.qty ?? (line.role === 'optional' ? '0' : String(line.default_qty))}
                    max={available(line.item.id)} onChange={qty => setPick(line.item.id, { qty })} />}
            </LineRow>)}
          </section>}

          {excess && <label className="flex flex-col gap-1.5 text-sm font-semibold">{t('assets.armory.excessRounds')}
            <Textarea dir="auto" maxLength={160} value={excessReason} onChange={event => { touch(); setExcessReason(event.target.value) }} />
          </label>}

          {mode === 'shift' && <fieldset className="flex flex-col gap-1.5">
            <legend className="text-sm font-semibold">{t('assets.armory.dueBack')}</legend>
            <div className="flex flex-wrap gap-3">
              <label className="flex flex-col gap-1 text-xs text-muted-foreground">{t('assets.armory.date')}
                <Input type="date" dir="ltr" className="min-h-11 w-fit font-mono" value={due.slice(0, 10)} onChange={event => { touch(); setDue(`${event.target.value}T${due.slice(11)}`) }} />
              </label>
              <label className="flex flex-col gap-1 text-xs text-muted-foreground">{t('assets.armory.dueTime')}
                <Input type="text" inputMode="numeric" dir="ltr" maxLength={5} placeholder="18:00" className="min-h-11 w-24 font-mono" value={due.slice(11)}
                  onChange={event => { touch(); setDue(`${due.slice(0, 10)}T${normalizeDigits(event.target.value)}`) }} />
              </label>
            </div>
            <span className="text-xs text-muted-foreground">{t('assets.armory.dueDefault')} {t('assets.armory.date24Hint')} {t('assets.armory.dueCap')}</span>
          </fieldset>}
          {mode === 'custody' && <label className="flex flex-col gap-1.5 text-sm font-semibold">{t('assets.armory.conditionNote')}
            <Textarea dir="auto" maxLength={500} value={conditionNote} onChange={event => { touch(); setConditionNote(event.target.value) }} />
          </label>}
          <FormAlert id={`${id}-error`} message={errorText} />
        </DialogBody>
        <DialogFooter>
          <p id={`${id}-reason`} role="status" className="me-auto text-xs text-muted-foreground">{reason}</p>
          <Button type="button" variant="secondary" className="min-h-11" disabled={mutation.isPending} onClick={() => requestClose(false)}>{t('assets.armory.cancel')}</Button>
          <Button type="submit" className="min-h-11" disabled={!!reason || mutation.isPending} aria-describedby={`${id}-reason`}>{title}</Button>
        </DialogFooter>
      </form>
    </DialogShell>
    <ConfirmDialog open={open && confirmDiscard} onOpenChange={next => { if (!next) setConfirmDiscard(false) }}
      title={t('assets.armory.assignment.discardDraft')} confirmLabel={t('assets.armory.discard')} destructive
      onConfirm={() => { setConfirmDiscard(false); onOpenChange(false) }} />
  </>
}

function Warning({ children }: { children: React.ReactNode }): React.JSX.Element {
  return <div className="rounded-md border border-warning/40 bg-warning-soft px-3 py-2 text-sm">{children}</div>
}

function LineRow({ item, children }: { item: ArmoryItemRef; children: React.ReactNode }): React.JSX.Element {
  const { name } = useArmoryLocale()
  return <div className="grid grid-cols-[40px_minmax(0,1fr)] items-start gap-x-3 gap-y-2 border-t border-hairline py-3 sm:grid-cols-[40px_minmax(140px,220px)_minmax(0,1fr)]">
    <ArmoryArt drawing={item.drawing} className="h-10 w-10" />
    <span className="pt-2 text-sm font-semibold">{name(item)}</span>
    <div className="col-span-full flex min-w-0 flex-col gap-2 sm:col-span-1">{children}</div>
  </div>
}

/** Available serials of one item in the chosen safe; never pre-selected. */
function SerialSelect({ itemId, safeId, label, value, onChange, required = false }: { itemId: number; safeId: number; label: string; value: number | null; onChange(serialId: number | null): void; required?: boolean }): React.JSX.Element {
  const { t } = useArmoryLocale()
  const detail = useArmoryItem(itemId, safeId)
  const id = useId()
  const serials = (detail.data?.serials ?? []).filter(serial => serial.state === 'in_safe' && serial.safe?.id === safeId)
  if (detail.isError) return <p role="alert" className="text-sm text-destructive-text">{t('assets.armory.loadFailed')}</p>
  return <label htmlFor={id} className="flex flex-col gap-1 text-xs text-muted-foreground">{label}
    <select id={id} className="min-h-11 rounded-md border border-border bg-surface px-3 font-mono text-sm text-foreground" value={value ?? ''}
      disabled={!detail.data || serials.length === 0} onChange={event => onChange(event.target.value ? Number(event.target.value) : null)}>
      <option value="">{detail.isPending ? t('assets.armory.loadingText') : serials.length ? t(required ? 'assets.armory.chooseSerial' : 'assets.armory.none') : t('assets.armory.unavailableSerials')}</option>
      {serials.map(serial => <option key={serial.id} value={serial.id}>{serial.serial_code}</option>)}
    </select>
  </label>
}

/** Explicit unexpired batch with stock in the chosen safe, plus a bounded quantity. */
function BatchSelect({ itemId, safeId, value, onChange, itemName }: { itemId: number; safeId: number; value: Pick; onChange(patch: Partial<Pick>): void; itemName: string }): React.JSX.Element {
  const { t } = useArmoryLocale()
  const detail = useArmoryItem(itemId, safeId)
  const id = useId()
  const batches = (detail.data?.batches ?? []).filter(row => row.safe.id === safeId && row.status !== 'expired' && row.on_hand > 0)
  const chosen = batches.find(row => row.batch.id === value.batchId)
  return <div className="flex flex-wrap items-end gap-3">
    <label htmlFor={id} className="flex flex-col gap-1 text-xs text-muted-foreground">{t('assets.armory.batchNumber')}
      <select id={id} className="min-h-11 rounded-md border border-border bg-surface px-3 font-mono text-sm text-foreground" value={value.batchId ?? ''}
        disabled={batches.length === 0} onChange={event => onChange({ batchId: event.target.value ? Number(event.target.value) : null })}>
        <option value="">{batches.length ? t('assets.armory.none') : t('assets.armory.assignment.noBatches')}</option>
        {batches.map(row => <option key={row.batch.id} value={row.batch.id}>{row.batch.batch_ref} · {displayDate(row.batch.expires_on)}</option>)}
      </select>
    </label>
    {chosen && <Quantity itemName={itemName} value={value.qty || '0'} max={chosen.on_hand} onChange={qty => onChange({ qty })} />}
  </div>
}

function Quantity({ itemName, value, max, onChange }: { itemName: string; value: string; max: number; onChange(qty: string): void }): React.JSX.Element {
  const { t } = useArmoryLocale()
  const n = whole(value)
  const over = n !== null && n > max
  const step = (delta: number) => onChange(String(Math.max(0, Math.min(max, (n ?? 0) + delta))))
  return <div className="flex flex-col gap-1">
    <div className="flex w-fit items-center rounded-md border border-border">
      <Button type="button" variant="ghost" className="min-h-11 min-w-11" aria-label={t('assets.armory.decrease', { item: itemName })} disabled={(n ?? 0) <= 0} onClick={() => step(-1)}>−</Button>
      <Input type="text" inputMode="numeric" dir="ltr" aria-label={`${t('assets.armory.quantity')}: ${itemName}`} aria-invalid={over || n === null}
        className="min-h-11 w-16 border-0 px-1 text-center tabular-nums shadow-none" value={value} onChange={event => onChange(normalizeDigits(event.target.value))} />
      <Button type="button" variant="ghost" className="min-h-11 min-w-11" aria-label={t('assets.armory.increase', { item: itemName })} disabled={(n ?? 0) >= max} onClick={() => step(1)}>+</Button>
    </div>
    {over && <p role="status" className="text-xs text-warning">{t('assets.armory.onlyLeft', { count: max })}</p>}
  </div>
}
