import { ClipboardList } from 'lucide-react'
import { useId, useLayoutEffect, useRef, useState, type FormEvent, type RefObject } from 'react'

import { DialogBody, DialogFooter, Field } from '@/components/forms/DialogShell'
import { Button } from '@/components/ui/button'
import { DialogClose } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { ApiError, type ArmoryItemCreate, type ArmoryItemDetailRead, type ArmoryOpeningInput, type ArmoryPersonCandidateRead, type ArmorySafeRead } from '@/lib/api'
import { useAuth } from '@/lib/authContext'
import { cn } from '@/lib/utils'

import { useArmoryLocale } from '../armoryFormat'
import { isArmoryAccessError, useArmoryAccess, useArmoryKits, useCreateArmoryItem } from '../armoryQueries'
import { ArmoryPersonPicker } from '../dialogs/ArmoryPersonPicker'
import { ArmoryArt } from './ArmoryArt'
import { IntakeAccessError, IntakeDialog, IntakeWriteError } from './intakeDialog'
import { BLANK_ENTRY, inspectIntakeEntries, isControlled, KIND_DEFAULTS, stockToday, validStockDate, type IntakeEntryDraft } from './intakeEntry'
import { IntakeDateField, IntakeEntryFields, IntakeReferenceField, IntakeSelect, IntakeText } from './intakeFields'

interface AddItemDialogProps {
  open: boolean
  safes: ArmorySafeRead[]
  onOpenChange(open: boolean): void
  onSaved(item: ArmoryItemDetailRead, options: { addAnother: boolean }): void
  onReceiveExisting(itemId: number): void
  returnFocusRef: RefObject<HTMLElement | null>
}

type ItemKind = ArmoryItemCreate['kind']
type Step = 'kind' | 'details' | 'opening'
const STEPS: readonly { id: Step; label: string }[] = [
  { id: 'kind', label: 'kindLabel' }, { id: 'details', label: 'itemDetails' }, { id: 'opening', label: 'openingStock' },
]
const KINDS: readonly ItemKind[] = ['firearm', 'ammunition', 'serial', 'quantity', 'expiry']
const EQUIPMENT_CATEGORIES = ['accessories', 'nonlethal', 'restraints', 'riot', 'comms'] as const satisfies readonly ArmoryItemCreate['category'][]
const DRAWINGS = [
  'rifle', 'pistol', 'magazine', 'rounds', 'sling', 'holster', 'tool', 'rod', 'scabbard', 'grip', 'adapter', 'case',
  'taser', 'spray', 'cartridge', 'cuffs', 'leg-irons', 'plastic', 'key', 'baton', 'helmet', 'shield', 'riot-suit', 'radio', 'bodycam', 'wand',
] as const satisfies readonly ArmoryItemCreate['drawing'][]

interface OpeningDraft {
  entry: IntakeEntryDraft
  receivedOn: string
  reference: string
  witness: ArmoryPersonCandidateRead | null
}

interface ItemDraft {
  kind: ItemKind | null
  nameEn: string
  nameAr: string
  category: ArmoryItemCreate['category']
  drawing: ArmoryItemCreate['drawing']
  kitIds: number[]
  openings: Record<number, OpeningDraft>
  addAnother: boolean
}

const BLANK_DRAFT: ItemDraft = {
  kind: null, nameEn: '', nameAr: '', category: 'accessories', drawing: 'case', kitIds: [], openings: {}, addAnother: false,
}

export function AddItemDialog(props: AddItemDialogProps) {
  const { canEdit, principal } = useArmoryAccess()
  return props.open && canEdit && principal !== null ? <AddItemTask key={principal} {...props} /> : null
}

function AddItemTask({ open, safes, onOpenChange, onSaved, onReceiveExisting, returnFocusRef }: AddItemDialogProps) {
  const { t, isAr, name } = useArmoryLocale()
  const actorId = useAuth().user?.employee_id
  const id = useId()
  const stageRef = useRef<HTMLDivElement>(null)
  const [step, setStep] = useState<Step>('kind')
  const [draft, setDraft] = useState(BLANK_DRAFT)
  const [duplicate, setDuplicate] = useState<{ itemId: number; name: string } | null>(null)
  const mutation = useCreateArmoryItem()
  const denied = isArmoryAccessError(mutation.error)
  const today = stockToday()
  const { kind, nameEn, nameAr, category, drawing, kitIds, addAnother } = draft
  const controlled = kind !== null && isControlled(kind)
  const blankOpening: OpeningDraft = { entry: BLANK_ENTRY, receivedOn: today, reference: '', witness: null }
  const rows = step === 'opening' ? safes.map(safe => ({ safe, opening: draft.openings[safe.id] ?? blankOpening })) : []
  const inspections = inspectIntakeEntries(rows.map(({ opening }) => ({ itemId: null, kind, draft: opening.entry })), true)
  const openingTotal = inspections.reduce((total, inspection) => total + inspection.quantity, 0)
  const counted = inspections.some(inspection => inspection.entry !== null)

  let reason = !kind ? 'chooseKind' : null
  if (step !== 'kind' && (!nameEn.trim() || !nameAr.trim())) reason = 'needBothNames'
  if (duplicate) reason = 'duplicateItem'
  if (step === 'opening') {
    for (const [index, { opening }] of rows.entries()) {
      const { entry, error } = inspections[index]
      if (error) { reason = error; break }
      if (!entry) continue
      if (!validStockDate(opening.receivedOn, today)) { reason = 'needStockDate'; break }
      if (controlled && !opening.reference.trim()) { reason = 'needStockReference'; break }
      if (controlled && !opening.witness) { reason = 'needWitness'; break }
    }
  }

  useLayoutEffect(() => {
    const stage = stageRef.current
    const field = stage?.querySelector<HTMLElement>('[data-stage-focus]') ?? stage?.querySelector<HTMLElement>('input, textarea, select, button')
    field?.focus()
  }, [step])

  function patchDraft(patch: Partial<ItemDraft>) {
    setDraft(previous => ({ ...previous, ...patch }))
  }

  function editName(patch: Pick<Partial<ItemDraft>, 'nameEn' | 'nameAr'>) {
    patchDraft(patch)
    setDuplicate(null)
    if (mutation.isError) mutation.reset()
  }

  function patchOpening(safeId: number, patch: Partial<OpeningDraft>) {
    setDraft(previous => ({ ...previous, openings: {
      ...previous.openings, [safeId]: { ...(previous.openings[safeId] ?? blankOpening), ...patch },
    } }))
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (reason || !kind || denied || mutation.isPending) return
    if (step === 'kind') { setStep('details'); return }
    if (step === 'details') { setStep('opening'); return }
    const openings: ArmoryOpeningInput[] = []
    for (const [index, { safe, opening }] of rows.entries()) {
      const { entry } = inspections[index]
      if (entry) openings.push({ safe_id: safe.id, received_on: opening.receivedOn, reference: opening.reference.trim() || null,
        witness_employee_id: opening.witness?.person.employee_id ?? null, entry })
    }
    const body: ArmoryItemCreate = {
      name_en: nameEn.trim(), name_ar: nameAr.trim(), kind, category, drawing, optional_kit_ids: kitIds, openings,
    }
    mutation.mutate(body, {
      onSuccess: item => {
        if (addAnother) {
          setDraft(BLANK_DRAFT)
          setStep('kind')
        }
        onSaved(item, { addAnother })
        if (!addAnother) onOpenChange(false)
      },
      onError: error => {
        if (isArmoryAccessError(error)) {
          setDraft(BLANK_DRAFT)
          setDuplicate(null)
          setStep('kind')
        } else if (error instanceof ApiError && error.status === 409 && error.code === 'armory_duplicate_item'
          && typeof error.details.item_id === 'number' && Number.isSafeInteger(error.details.item_id) && error.details.item_id > 0) {
          setDuplicate({ itemId: error.details.item_id, name: error.details.field === 'name_ar' ? body.name_ar : body.name_en })
          setStep('details')
        }
      },
    })
  }

  const reasonId = `${id}-reason`
  const stepIndex = STEPS.findIndex(entry => entry.id === step)
  return <IntakeDialog open={open} title={t('assets.armory.addItem')} description={t('assets.armory.createItemHint')}
    dirty={!denied && kind !== null} busy={mutation.isPending} discardTitle={t('assets.armory.discardItem')}
    onDismiss={() => onOpenChange(false)} returnFocusRef={returnFocusRef}
    onOpenAutoFocus={event => {
      const first = stageRef.current?.querySelector<HTMLInputElement>('input[type="radio"]')
      if (first) { event.preventDefault(); first.focus() }
    }}>
    {denied ? <IntakeAccessError /> : <form className="flex min-h-0 flex-1 flex-col" noValidate onSubmit={submit} aria-busy={mutation.isPending}>
      <DialogBody>
        <ol className="grid grid-cols-3 gap-1 text-sm">
          {STEPS.map(({ id: value, label }, index) => <li key={value} aria-current={value === step ? 'step' : undefined}
            className={cn('border-b-2 px-1 pb-2', value === step ? 'font-semibold text-primary-text' : 'text-muted-foreground')}
            style={{ borderColor: value === step ? 'var(--primary)' : index < stepIndex ? 'var(--success)' : undefined }}>
            {t(`assets.armory.${label}`)}
          </li>)}
        </ol>
        <fieldset disabled={mutation.isPending} className="min-w-0">
          <div ref={stageRef} className="space-y-3">
            {step === 'kind' && <fieldset className="min-w-0 space-y-2">
              <legend><h3 className="text-base font-semibold">{t('assets.armory.whatKind')}</h3></legend>
              <div className="grid gap-2 sm:grid-cols-2">
                {KINDS.map((value, index) => <label key={value} className={cn('grid min-h-[68px] cursor-pointer grid-cols-[auto_auto_minmax(0,1fr)] items-center gap-2 rounded-md border p-2.5 focus-within:ring-2 focus-within:ring-ring',
                  value === kind ? 'bg-primary-soft' : 'hover:bg-surface-raised')}
                  style={value === kind ? { borderColor: 'var(--primary)' } : undefined}>
                  <input type="radio" name={`${id}-kind`} value={value} checked={value === kind} className="size-4 accent-primary"
                    aria-labelledby={`${id}-${value}-name`} aria-describedby={`${id}-${value}-hint`}
                    data-stage-focus={value === kind || (kind === null && index === 0) ? '' : undefined}
                    onChange={() => {
                      if (kind !== value) patchDraft({ kind: value, category: KIND_DEFAULTS[value].category, drawing: KIND_DEFAULTS[value].drawing, openings: {}, kitIds: [] })
                      setDuplicate(null)
                    }} />
                  <ArmoryArt drawing={KIND_DEFAULTS[value].drawing} className="h-10 w-12" />
                  <span className="min-w-0">
                    <span id={`${id}-${value}-name`} className="block text-sm font-semibold">{t(`assets.armory.kind_${value}`)}</span>
                    <span id={`${id}-${value}-hint`} className="block text-xs text-muted-foreground">{t(`assets.armory.kind_${value}_hint`)}</span>
                  </span>
                </label>)}
              </div>
              <p className="text-sm text-muted-foreground">{t('assets.armory.kindLocked')}</p>
            </fieldset>}
            {step === 'details' && kind && <>
              <h3 className="text-base font-semibold">{t('assets.armory.itemDetails')}</h3>
              <div className="grid gap-3 sm:grid-cols-2">
                <Field id={`${id}-en`} label={t('assets.armory.nameEn')} required>
                  <Input id={`${id}-en`} className="min-h-11" lang="en" dir="ltr" required maxLength={120}
                    data-stage-focus={duplicate ? undefined : ''} value={nameEn} onChange={event => editName({ nameEn: event.target.value })} />
                </Field>
                <Field id={`${id}-ar`} label={t('assets.armory.nameAr')} required>
                  <Input id={`${id}-ar`} className="min-h-11" lang="ar" dir="rtl" required maxLength={120}
                    value={nameAr} onChange={event => editName({ nameAr: event.target.value })} />
                </Field>
              </div>
              {duplicate && <div className="rounded-md border bg-warning-soft p-3">
                <div role="alert" className="space-y-1 text-sm text-warning">
                  <p><IntakeText message="itemExists" values={{ item: duplicate.name }} /></p>
                  <p>{t('assets.armory.duplicateItem')}</p>
                </div>
                <Button type="button" variant="link" className="min-h-11 px-0 text-primary-text" data-stage-focus=""
                  onClick={() => onReceiveExisting(duplicate.itemId)}>{t('assets.armory.receiveStock')}</Button>
              </div>}
              <div className="grid items-start gap-3 sm:grid-cols-2">
                <IntakeSelect label={t('assets.armory.category')} value={category} disabled={controlled}
                  hint={controlled ? t('assets.armory.intake.categoryFixed') : undefined} onChange={event => {
                    const value = EQUIPMENT_CATEGORIES.find(candidate => candidate === event.target.value)
                    if (value) patchDraft({ category: value })
                  }}>
                  {(controlled ? [category] : EQUIPMENT_CATEGORIES).map(value => <option key={value} value={value}>{t(`assets.armory.categoryName.${value}`)}</option>)}
                </IntakeSelect>
                <div className="flex items-end gap-2">
                  <IntakeSelect className="flex-1" label={t('assets.armory.drawing')} value={drawing} onChange={event => {
                    const value = DRAWINGS.find(candidate => candidate === event.target.value)
                    if (value) patchDraft({ drawing: value })
                  }}>
                    {DRAWINGS.map(value => <option key={value} value={value}>{t(`assets.armory.intake.drawingLabels.${value}`)}</option>)}
                  </IntakeSelect>
                  <ArmoryArt drawing={drawing} className="h-14 w-20 shrink-0" />
                </div>
              </div>
              {!controlled && <OptionalKitFields selected={kitIds} onChange={kitIds => patchDraft({ kitIds })} />}
              <p className="flex items-start gap-2 rounded-md bg-surface-raised p-3 text-sm text-muted-foreground">
                <ClipboardList aria-hidden className="size-5 shrink-0" />{t(`assets.armory.kind_${kind}_rule`)}
              </p>
            </>}
            {step === 'opening' && kind && <>
              <h3 className="text-base font-semibold">{t('assets.armory.openingStock')}</h3>
              <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
                <p className="font-semibold [overflow-wrap:anywhere]"><bdi>{isAr ? nameAr.trim() : nameEn.trim()}</bdi></p>
                <p className="text-sm text-muted-foreground">{t(`assets.armory.kind_${kind}`)}{counted && <>{' · '}<IntakeText message="openingN" values={{ count: openingTotal }} /></>}</p>
              </div>
              <p className="text-sm text-muted-foreground">{t('assets.armory.openingHint')}</p>
              {!rows.length && <p className="rounded-md bg-surface-raised p-3 text-sm text-muted-foreground">{t('assets.armory.noSafesEditor')}</p>}
              <div className="grid items-start gap-3 sm:grid-cols-2">
                {rows.map(({ safe, opening }, index) => {
                  const inspection = inspections[index]
                  return <fieldset key={safe.id} className="min-w-0 space-y-2 rounded-md border border-border p-3">
                    <legend className="max-w-full px-1 font-semibold [overflow-wrap:anywhere]"><bdi>{name(safe)}</bdi></legend>
                    <IntakeEntryFields kind={kind} opening draft={opening.entry} inspection={inspection} onChange={entry => patchOpening(safe.id, { entry })} />
                    {inspection.error ? <p role="alert" className="text-sm text-destructive-text">{t(`assets.armory.${inspection.error}`)}</p> : <p className="text-sm text-primary-text">
                      {inspection.entry ? <IntakeText message="openingN" values={{ count: inspection.quantity }} /> : t('assets.armory.stockOpeningHint')}
                    </p>}
                    {inspection.entry && <div className="space-y-2 border-t border-hairline pt-2">
                      <div className="grid gap-2 lg:grid-cols-2">
                        <IntakeDateField opening value={opening.receivedOn} today={today} onChange={receivedOn => patchOpening(safe.id, { receivedOn })} />
                        <IntakeReferenceField required={controlled} value={opening.reference} onChange={reference => patchOpening(safe.id, { reference })} />
                      </div>
                      {controlled && <ArmoryPersonPicker purpose="witness" safeId={safe.id} label={t('assets.armory.witness')}
                        value={opening.witness} excludeIds={actorId ? [actorId] : undefined} onChange={witness => patchOpening(safe.id, { witness })}
                        disabled={mutation.isPending} />}
                    </div>}
                  </fieldset>
                })}
              </div>
              <label className="inline-flex min-h-11 cursor-pointer items-center gap-2 text-sm font-medium">
                <input type="checkbox" className="size-4 shrink-0 accent-primary" checked={addAnother}
                  onChange={event => patchDraft({ addAnother: event.target.checked })} />{t('assets.armory.addAnother')}
              </label>
            </>}
          </div>
        </fieldset>
        {!duplicate && <IntakeWriteError id={`${id}-write-error`} error={mutation.error} />}
      </DialogBody>
      <DialogFooter>
        <p id={reasonId} role="status" className="me-auto text-sm text-muted-foreground">
          {mutation.isPending ? t('common.saving') : reason && !duplicate ? t(`assets.armory.${reason}`) : null}
        </p>
        <DialogClose asChild><Button type="button" variant="ghost" className="min-h-11" disabled={mutation.isPending}>{t('assets.armory.cancel')}</Button></DialogClose>
        {step !== 'kind' && <Button type="button" variant="secondary" className="min-h-11" disabled={mutation.isPending}
          onClick={() => setStep(step === 'opening' ? 'details' : 'kind')}>{t('assets.armory.previous')}</Button>}
        <Button type="submit" className="min-h-11" disabled={!!reason || mutation.isPending}
          aria-describedby={duplicate ? undefined : reasonId}>{t(step === 'opening' ? 'assets.armory.saveItem' : 'assets.armory.next')}</Button>
      </DialogFooter>
    </form>}
  </IntakeDialog>
}

function OptionalKitFields({ selected, onChange }: { selected: number[]; onChange(value: number[]): void }) {
  const { t, name } = useArmoryLocale()
  const kits = useArmoryKits()
  return <details className="rounded-md border border-border px-3 pb-1">
    <summary className="min-h-11 cursor-pointer py-2.5 text-sm font-semibold">{t('assets.armory.kitMembership')}</summary>
    <p className="text-sm text-muted-foreground">{t('assets.armory.kitMembershipHint')}</p>
    {kits.isPending && <p role="status" className="py-2 text-sm text-muted-foreground">{t('assets.armory.loadingText')}</p>}
    {kits.isError && <div className="flex flex-wrap items-center gap-2">
      <p role="alert" className="text-sm text-destructive-text">{t('assets.armory.loadFailed')}</p>
      <Button type="button" variant="ghost" className="min-h-11" onClick={() => void kits.refetch()}>{t('assets.armory.retry')}</Button>
    </div>}
    {kits.data?.length === 0 && <p className="py-2 text-sm text-muted-foreground">{t('assets.armory.noKits')}</p>}
    <div className="flex flex-wrap gap-x-4">
      {kits.data?.map(kit => <label key={kit.id} className="inline-flex min-h-11 cursor-pointer items-center gap-2 text-sm">
        <input type="checkbox" className="size-4 shrink-0 accent-primary" checked={selected.includes(kit.id)} onChange={event => {
          onChange(event.target.checked ? [...selected, kit.id] : selected.filter(value => value !== kit.id))
        }} /><bdi>{name(kit)}</bdi>
      </label>)}
    </div>
  </details>
}
