import { Plus, X } from 'lucide-react'
import { useCallback, useId, useLayoutEffect, useMemo, useRef, useState, type FormEvent, type RefObject } from 'react'

import { DialogBody, DialogFooter } from '@/components/forms/DialogShell'
import { Button } from '@/components/ui/button'
import { DialogClose } from '@/components/ui/dialog'
import type { ArmoryIntakeLineInput, ArmoryPersonCandidateRead, ArmoryPostingRead, ArmoryReceiptCreate, ArmorySafeRead, ArmoryStockRead } from '@/lib/api'
import { useAuth } from '@/lib/authContext'
import { cn } from '@/lib/utils'

import { useArmoryLocale } from '../armoryFormat'
import { isArmoryAccessError, useArmoryAccess, useArmoryItems, useCreateArmoryReceipt } from '../armoryQueries'
import { ArmoryPersonPicker } from '../dialogs/ArmoryPersonPicker'
import { IntakeAccessError, IntakeDialog, IntakeWriteError } from './intakeDialog'
import { BLANK_ENTRY, inspectIntakeEntries, isControlled, KIND_DEFAULTS, stockToday, validStockDate, type IntakeEntryDraft } from './intakeEntry'
import { IntakeDateField, IntakeEntryFields, IntakeReferenceField, IntakeSelect, IntakeText } from './intakeFields'
import type { ReceivePreset, ReceiveResume } from './intakeTypes'

interface ReceiveStockDialogProps {
  open: boolean
  preset: ReceivePreset
  safes: ArmorySafeRead[]
  defaultSafeId: number | null
  onOpenChange(open: boolean): void
  onSaved(posting: ArmoryPostingRead): void
  onAddMissingItem(): void
  resume: ReceiveResume | null
  returnFocusRef: RefObject<HTMLElement | null>
}

type ReceiptKind = ArmoryReceiptCreate['kind']
type Source = NonNullable<ArmoryReceiptCreate['source']>
const MODES: readonly { value: ReceiptKind; label: string }[] = [
  { value: 'receipt', label: 'receiptMode' }, { value: 'opening', label: 'openingMode' },
]
const SOURCES: readonly { value: Source; label: string }[] = [
  { value: 'supplier', label: 'supplier' }, { value: 'head_office', label: 'headOffice' }, { value: 'other', label: 'other' },
]

interface ReceiptLine {
  key: number
  itemId: number | null
  entry: IntakeEntryDraft
  serialSeed?: string
}

interface ReceiptDraft {
  kind: ReceiptKind
  safeId: number | null
  receivedOn: string
  source: Source
  reference: string
  witness: ArmoryPersonCandidateRead | null
  lines: ReceiptLine[]
  nextKey: number
  dirty: boolean
}

function newReceiptDraft(preset: ReceivePreset, defaultSafeId: number | null): ReceiptDraft {
  return {
    kind: preset.mode ?? 'receipt', safeId: preset.safeId ?? defaultSafeId, receivedOn: stockToday(), source: 'supplier',
    reference: '', witness: null, dirty: false, nextKey: 1,
    lines: [{ key: 0, itemId: preset.itemId ?? null,
      entry: preset.itemId !== undefined && preset.serialCode ? { ...BLANK_ENTRY, serialText: preset.serialCode } : BLANK_ENTRY,
      serialSeed: preset.itemId === undefined ? preset.serialCode : undefined }],
  }
}

type FocusRequest = { target: 'item'; key: number } | { target: 'missing' | 'add' }

export function ReceiveStockDialog(props: ReceiveStockDialogProps) {
  const { canEdit, principal } = useArmoryAccess()
  return canEdit && principal !== null ? <ReceiveStockTask key={principal} {...props} /> : null
}

function ReceiveStockTask({ open, preset, safes, defaultSafeId, onOpenChange, onSaved, onAddMissingItem, resume, returnFocusRef }: ReceiveStockDialogProps) {
  const { t, name } = useArmoryLocale()
  const actorId = useAuth().user?.employee_id
  const id = useId()
  const [draft, setDraft] = useState(() => newReceiptDraft(preset, defaultSafeId))
  const [handledResume, setHandledResume] = useState<number | null>(null)
  const [focusRequest, setFocusRequest] = useState<FocusRequest | null>(null)
  const appliedFocus = useRef<FocusRequest | null>(null)
  const addRef = useRef<HTMLButtonElement>(null)
  const missingRef = useRef<HTMLButtonElement>(null)
  const itemRefs = useRef(new Map<number, HTMLSelectElement>())
  const suspending = useRef(false)
  const items = useArmoryItems()
  const mutation = useCreateArmoryReceipt()
  const denied = isArmoryAccessError(mutation.error) || isArmoryAccessError(items.error)
  const itemById = useMemo(() => new Map(items.data?.map(item => [item.id, item])), [items.data])
  const opening = draft.kind === 'opening'
  const safe = safes.find(row => row.id === draft.safeId)
  const today = stockToday()

  // Adjust the suspended in-memory draft once per explicit resume signal, not on query refreshes.
  if (open && !denied && resume && resume.signal !== handledResume) {
    setHandledResume(resume.signal)
    if (resume.itemId === null) {
      setFocusRequest({ target: 'missing' })
    } else {
      const existing = draft.lines.find(line => line.itemId === resume.itemId)
      if (existing) {
        setFocusRequest({ target: 'item', key: existing.key })
      } else {
        const blank = draft.lines.find(line => line.itemId === null)
        const item = itemById.get(resume.itemId)
        const serialSeed = blank?.serialSeed
        const itemMayUseSeed = !item || KIND_DEFAULTS[item.kind].entry === 'serial'
        const line: ReceiptLine = {
          key: blank?.key ?? draft.nextKey, itemId: resume.itemId,
          entry: serialSeed && itemMayUseSeed ? { ...BLANK_ENTRY, serialText: serialSeed } : BLANK_ENTRY,
          serialSeed: !itemMayUseSeed ? serialSeed : undefined,
        }
        setDraft({ ...draft, dirty: true, nextKey: blank ? draft.nextKey : draft.nextKey + 1,
          lines: blank ? draft.lines.map(previous => previous.key === blank.key ? line : previous) : [...draft.lines, line] })
        setFocusRequest({ target: 'item', key: line.key })
      }
    }
  }

  const focusRequested = useCallback((request: FocusRequest | null): boolean => {
    if (!request || appliedFocus.current === request) return false
    const target = request.target === 'item' ? itemRefs.current.get(request.key)
      : request.target === 'missing' ? missingRef.current : addRef.current
    if (!target || target.disabled) return false
    target.focus()
    appliedFocus.current = request
    return true
  }, [])
  useLayoutEffect(() => {
    if (open) focusRequested(focusRequest)
  }, [open, focusRequest, focusRequested, items.data])

  const rows = draft.lines.map(line => {
    const item = line.itemId === null ? undefined : itemById.get(line.itemId)
    const stock = safe ? item?.stock.find(balance => balance.safe.id === safe.id) : undefined
    return { line, item, stock, known: opening && stock?.opening_qty != null }
  })
  const inspections = inspectIntakeEntries(rows.map(({ line, item }) => ({ itemId: line.itemId, kind: item?.kind ?? null, draft: line.entry })), opening)
  const usedItems = new Set<number>()
  const duplicates = new Set<number>()
  let controlled = false
  for (const { item } of rows) {
    if (!item) continue
    if (usedItems.has(item.id)) duplicates.add(item.id)
    usedItems.add(item.id)
    controlled ||= isControlled(item.kind)
  }
  const knownRow = rows.find(row => row.known)
  const entryError = inspections.find(row => row.error)?.error
  const referenceRequired = !opening || controlled
  const reason = !safe ? (safes.length ? 'chooseSafeForAction' : 'noSafesEditor')
    : !items.data ? (items.isError ? 'loadFailed' : 'loadingText')
    : rows.some(row => !row.item) ? 'chooseItem' : duplicates.size ? 'duplicateReceiptItem'
    : knownRow ? 'openingAlreadyKnown' : entryError ?? (inspections.some(row => !row.entry) ? (opening ? 'intake.enterOpening' : 'enterStock')
      : !validStockDate(draft.receivedOn, today) ? 'needStockDate'
      : referenceRequired && !draft.reference.trim() ? 'needStockReference'
      : controlled && !draft.witness ? 'needWitness' : null)

  function changeDraft(patch: Partial<ReceiptDraft>) {
    setDraft(previous => ({ ...previous, ...patch, dirty: true }))
  }

  function updateLine(key: number, update: (line: ReceiptLine) => ReceiptLine) {
    setDraft(previous => ({ ...previous, dirty: true, lines: previous.lines.map(line => line.key === key ? update(line) : line) }))
  }

  function addLine() {
    changeDraft({ lines: [...draft.lines, { key: draft.nextKey, itemId: null, entry: BLANK_ENTRY }], nextKey: draft.nextKey + 1 })
    setFocusRequest({ target: 'item', key: draft.nextKey })
  }

  function removeLine(key: number) {
    if (draft.lines.length === 1) {
      changeDraft({ lines: [{ key: draft.nextKey, itemId: null, entry: BLANK_ENTRY }], nextKey: draft.nextKey + 1 })
      setFocusRequest({ target: 'item', key: draft.nextKey })
    } else {
      changeDraft({ lines: draft.lines.filter(line => line.key !== key) })
      setFocusRequest({ target: 'add' })
    }
  }

  function dismiss() {
    setDraft(newReceiptDraft(preset, defaultSafeId))
    setFocusRequest(null)
    mutation.reset()
    onOpenChange(false)
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!safe || reason || denied || mutation.isPending) return
    const lines: ArmoryIntakeLineInput[] = []
    for (const [index, { item }] of rows.entries()) {
      const { entry } = inspections[index]
      if (!item || !entry) return
      lines.push({ item_id: item.id, entry })
    }
    const body: ArmoryReceiptCreate = {
      safe_id: safe.id, kind: draft.kind, received_on: draft.receivedOn,
      ...(!opening ? { source: draft.source } : {}), reference: draft.reference.trim() || null,
      witness_employee_id: controlled ? draft.witness?.person.employee_id ?? null : null, lines,
    }
    mutation.mutate(body, {
      onSuccess: posting => { onSaved(posting); dismiss() },
      onError: error => {
        if (isArmoryAccessError(error)) {
          setDraft(newReceiptDraft({}, null))
          setFocusRequest(null)
        }
      },
    })
  }

  const reasonId = `${id}-reason`
  const fieldIssueId = reason === 'openingAlreadyKnown' && knownRow ? `${id}-known-${knownRow.line.key}` : reasonId
  return <IntakeDialog open={open} title={t('assets.armory.receiveStock')} description={t('assets.armory.receiveHint')}
    dirty={!denied && draft.dirty} busy={mutation.isPending} discardTitle={t('assets.armory.discardReceipt')}
    onDismiss={dismiss} returnFocusRef={returnFocusRef}
    onOpenAutoFocus={event => {
      if (focusRequested(focusRequest)) event.preventDefault()
      else if (!focusRequest && safe) {
        const picker = itemRefs.current.get(draft.lines[0].key)
        if (picker && !picker.disabled) { picker.focus(); event.preventDefault() }
      }
    }} onCloseAutoFocus={event => {
      if (suspending.current) { event.preventDefault(); suspending.current = false }
    }}>
    {denied ? <IntakeAccessError /> : <form className="flex min-h-0 flex-1 flex-col" noValidate onSubmit={submit} aria-busy={mutation.isPending}>
      <DialogBody>
        <fieldset disabled={mutation.isPending} className="min-w-0 space-y-4">
          <fieldset className="min-w-0 space-y-2">
            <legend className="sr-only">{t('assets.armory.intake.modeLabel')}</legend>
            <div className="inline-flex max-w-full flex-wrap gap-1 rounded-md border border-border bg-surface-raised p-1">
              {MODES.map(({ value, label }) => <label key={value} className={cn('flex min-h-11 cursor-pointer items-center gap-2 rounded-sm px-3 text-sm',
                value === draft.kind ? 'bg-primary-soft font-semibold text-primary-text' : 'text-muted-foreground hover:bg-surface-tinted')}>
                <input type="radio" name={`${id}-mode`} value={value} checked={value === draft.kind} className="size-4 accent-primary"
                  onChange={() => changeDraft({ kind: value })} />
                {t(`assets.armory.${label}`)}
              </label>)}
            </div>
            {opening && <p className="text-sm text-muted-foreground">{t('assets.armory.openingModeHint')}</p>}
          </fieldset>
          <div className="grid items-start gap-4 md:grid-cols-[minmax(0,1fr)_minmax(13rem,0.48fr)]">
            <section className="grid min-w-0 grid-cols-2 gap-2 border-b border-border pb-3 md:col-start-2 md:row-start-1 md:grid-cols-1 md:border-b-0 md:border-s md:pb-0 md:ps-4">
              <h3 className="col-span-full text-base font-semibold">{t(opening ? 'assets.armory.intake.openingDetails' : 'assets.armory.deliveryDetails')}</h3>
              <IntakeSelect label={t('assets.armory.toSafe')} value={safe?.id ?? ''} required onChange={event => {
                changeDraft({ safeId: event.target.value ? Number(event.target.value) : null, witness: null })
              }}>
                <option value="">{t('assets.armory.chooseSafe')}</option>
                {safes.map(row => <option key={row.id} value={row.id} dir="auto">{name(row)}</option>)}
              </IntakeSelect>
              <IntakeDateField opening={opening} value={draft.receivedOn} today={today} onChange={receivedOn => changeDraft({ receivedOn })} />
              {!opening && <IntakeSelect label={t('assets.armory.deliverySource')} value={draft.source} required onChange={event => {
                const source = SOURCES.find(option => option.value === event.target.value)
                if (source) changeDraft({ source: source.value })
              }}>
                {SOURCES.map(option => <option key={option.value} value={option.value}>{t(`assets.armory.${option.label}`)}</option>)}
              </IntakeSelect>}
              <div className={opening ? 'col-span-full' : undefined}>
                <IntakeReferenceField required={referenceRequired} value={draft.reference} onChange={reference => changeDraft({ reference })} />
              </div>
              {controlled && safe && <div className="col-span-full pt-1">
                <ArmoryPersonPicker key={safe.id} purpose="witness" safeId={safe.id} label={t('assets.armory.witness')}
                  value={draft.witness} onChange={witness => changeDraft({ witness })} excludeIds={actorId ? [actorId] : undefined}
                  disabled={mutation.isPending} />
              </div>}
            </section>
            <section className="min-w-0 space-y-2 md:col-start-1 md:row-start-1">
              <h3 className="text-base font-semibold">{t(opening ? 'assets.armory.intake.openingItems' : 'assets.armory.receiptItems')}</h3>
              {items.isPending && <p role="status" className="text-sm text-muted-foreground">{t('assets.armory.loadingText')}</p>}
              {items.isError && <div className="flex flex-wrap items-center gap-2">
                <p role="alert" className="text-sm text-destructive-text">{t('assets.armory.loadFailed')}</p>
                <Button type="button" variant="ghost" className="min-h-11" onClick={() => void items.refetch()}>{t('assets.armory.retry')}</Button>
              </div>}
              {items.data?.length === 0 && <p className="text-sm text-muted-foreground">{t('assets.armory.nothingHere')}</p>}
              {rows.map(({ line, item, stock, known }, index) => {
                const inspection = inspections[index]
                const duplicated = item && duplicates.has(item.id)
                return <fieldset key={line.key} className="min-w-0 space-y-2 border-b border-hairline pb-3">
                  <legend className="sr-only"><IntakeText message="intake.lineNumber" values={{ number: index + 1 }} /></legend>
                  <div className="flex items-end gap-2">
                    <IntakeSelect className="flex-1" label={t('assets.armory.item')} value={item?.id ?? ''} required disabled={!items.data?.length}
                      ref={node => { if (node) itemRefs.current.set(line.key, node); else itemRefs.current.delete(line.key) }}
                      aria-invalid={duplicated || known || undefined} aria-describedby={duplicated ? reasonId : known ? `${id}-known-${line.key}` : undefined}
                      onChange={event => {
                        const next = itemById.get(Number(event.target.value))
                        updateLine(line.key, previous => {
                          const seed = next && KIND_DEFAULTS[next.kind].entry === 'serial' ? previous.serialSeed : undefined
                          return { ...previous, itemId: next?.id ?? null, entry: seed ? { ...BLANK_ENTRY, serialText: seed } : BLANK_ENTRY,
                            serialSeed: seed ? undefined : previous.serialSeed }
                        })
                      }}>
                      <option value="">{t('assets.armory.chooseItem')}</option>
                      {items.data?.map(option => <option key={option.id} value={option.id} dir="auto">{name(option)}</option>)}
                    </IntakeSelect>
                    <Button type="button" size="icon" variant="ghost" className="min-h-11 min-w-11" aria-label={t('assets.armory.removeReceiptLine')}
                      onClick={() => removeLine(line.key)}><X aria-hidden className="size-4" /></Button>
                  </div>
                  {known ? <p id={`${id}-known-${line.key}`} role="alert" className="rounded-md bg-warning-soft px-2 py-1.5 text-sm text-warning">
                    {t('assets.armory.openingAlreadyKnown')}
                  </p> : item && <>
                    {item.kind === 'expiry' && <p className="text-xs text-muted-foreground">{t('assets.armory.expiryTracking')}</p>}
                    <IntakeEntryFields kind={item.kind} opening={opening} draft={line.entry} inspection={inspection}
                      onChange={entry => updateLine(line.key, previous => ({ ...previous, entry }))} />
                    {safe && inspection.entry && !inspection.error && <StockOutcome stock={stock} added={inspection.quantity} opening={opening} />}
                  </>}
                </fieldset>
              })}
              <div className="flex flex-wrap gap-x-3 gap-y-1">
                <Button ref={addRef} type="button" variant="secondary" className="min-h-11" onClick={addLine}>
                  <Plus aria-hidden className="size-4" />{t('assets.armory.addReceiptLine')}
                </Button>
                <Button ref={missingRef} type="button" variant="link" className="min-h-11 px-0 text-primary-text" onClick={() => {
                  suspending.current = true
                  onAddMissingItem()
                }}>{t('assets.armory.notListedAdd')}</Button>
              </div>
            </section>
          </div>
        </fieldset>
        <IntakeWriteError id={`${id}-write-error`} error={mutation.error} />
      </DialogBody>
      <DialogFooter>
        <p id={reasonId} role="status" className="me-auto text-sm text-muted-foreground">
          {mutation.isPending ? t('common.saving') : reason && reason !== 'openingAlreadyKnown' ? t(`assets.armory.${reason}`) : null}
        </p>
        <DialogClose asChild><Button type="button" variant="ghost" className="min-h-11" disabled={mutation.isPending}>{t('assets.armory.cancel')}</Button></DialogClose>
        <Button type="submit" className="min-h-11" disabled={!!reason || mutation.isPending} aria-describedby={fieldIssueId}>
          {t(opening ? 'assets.armory.intake.saveOpening' : 'assets.armory.receiveStock')}
        </Button>
      </DialogFooter>
    </form>}
  </IntakeDialog>
}

function StockOutcome({ stock, added, opening }: { stock: ArmoryStockRead | undefined; added: number; opening: boolean }) {
  const current = stock?.in_safe ?? null
  const known = stock?.known_in_safe ?? 0
  return <div className="space-y-1 text-sm text-primary-text">
    {opening ? <>
      <p><IntakeText message="openingN" values={{ count: added }} /></p>
      <p><IntakeText message="intake.stockAfterOpening" values={{ count: known + added }} /></p>
    </> : current === null ? <>
      <p><IntakeText message="stockUnknownPreview" values={{ count: added }} /></p>
      {known > 0 && <p><IntakeText message="intake.knownAfterReceipt" values={{ count: known + added }} /></p>}
    </> : <p><IntakeText message="stockPreview" values={{ before: current, after: current + added }} /></p>}
  </div>
}
