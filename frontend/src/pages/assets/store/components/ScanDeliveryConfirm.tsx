import { useEffect, useId, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Trans, useTranslation } from 'react-i18next'
import { AlertTriangle } from 'lucide-react'

import { Field, FieldGrid, FormAlert } from '@/components/forms/DialogShell'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import type { StoreDeliveryCreate, StoreDeliveryScan, StorePickerItem, StoreScanLine } from '@/lib/api'
import { todayIso } from '@/pages/vehicles/vehicleUtils'
import { EMPTY_QUANTITY, formatQuantity, hasContains, isBusinessDate, quantityFromParts, storeErrorMessage, useStorePickerItems } from '../storeUtils'
import { DeliveryLines } from './DeliveryLines'
import { DeliveryReview } from './DeliveryReview'
import { createDeliveryLines, newDeliveryLine, type DeliveryLine, type DeliveryLineErrors, validateDeliveryLines } from './deliveryLineModel'
import { ScanNotePreview } from './ScanNotePreview'
import { StoreItemSummary } from './RecordParts'
import { useScanDeliverySave } from './useScanDeliverySave'

interface Props { file: File | null; scan: StoreDeliveryScan; onChooseAnother: () => void }

export function ScanDeliveryConfirm(props: Props): React.JSX.Element {
  const { t } = useTranslation()
  const picker = useStorePickerItems()
  if (picker.isPending) return <p role="status">{t('assets.store.state.loading')}</p>
  if (picker.error && !picker.data) return <div role="alert"><p dir="auto">{storeErrorMessage(picker.error)}</p><Button type="button" variant="secondary" className="min-h-11" onClick={() => void picker.refetch()}>{t('assets.store.state.retry')}</Button></div>
  return <ConfirmForm {...props} items={picker.data ?? []} />
}

function ConfirmForm({ file, scan, items, onChooseAnother }: Props & { items: StorePickerItem[] }): React.JSX.Element {
  const { t, i18n } = useTranslation()
  const id = useId()
  const navigate = useNavigate()
  const summary = useRef<HTMLDivElement>(null)
  const form = useRef<HTMLFormElement>(null)
  const pendingFocus = useRef<string | null>(null)
  const [lines, setLines] = useState(() => scan.lines.length ? createDeliveryLines(scan.lines.map((row) => {
    const item = items.find((entry) => entry.id === row.item_id) ?? null
    const expiry = row.expiry == null ? undefined : row.expiry.length === 7 ? { mode: 'month' as const, date: '', month: row.expiry } : { mode: 'date' as const, date: row.expiry, month: '' }
    return { item, quantity: quantityFor(row, item), cartonContainsQty: row.carton_contains_qty == null ? '' : String(row.carton_contains_qty), ...(expiry ? { expiry } : {}) }
  })).sort((a, b) => Number(needsAttention(b)) - Number(needsAttention(a))) : createDeliveryLines())
  const [skipped, setSkipped] = useState<DeliveryLine[]>([])
  const [announcement, setAnnouncement] = useState<{ key: string; number: number } | null>(null)
  const [reasons, setReasons] = useState<Record<number, string>>({})
  const [submitted, setSubmitted] = useState(false)
  const [reviewing, setReviewing] = useState(false)
  const [receivedOn, setReceivedOn] = useState(todayIso)
  const [note, setNote] = useState('')
  const save = useScanDeliverySave(file)
  const disabled = save.saving || save.saved
  const attentionCount = lines.filter(needsAttention).length
  const checked = validateDeliveryLines(lines, (key) => key, { allowUndated: true, minimumQuantity: (line) => (notedQuantity(line) ?? 0) > 0 ? 0 : 1 })
  const lineErrors: DeliveryLineErrors = {}
  const reasonErrors: Record<number, string> = {}
  for (const line of lines) {
    const issue = checked.errors[line.key]
    if (submitted && issue) lineErrors[line.key] = {
      item: issue.item ? t(issue.item) : undefined,
      expiry: issue.expiry ? t(issue.expiry) : undefined,
      quantity: issue.quantity ? t('assets.store.scan.quantityRequired') : undefined,
      cartonContainsQty: issue.cartonContainsQty ? t(issue.cartonContainsQty, { count: line.item?.contains_qty ?? undefined }) : undefined,
    }
    if (hasDifference(line) && !reasons[line.key]?.trim()) reasonErrors[line.key] = 'assets.store.scan.reasonRequired'
  }
  const invalidDate = !isBusinessDate(receivedOn)
  const dateError = submitted && invalidDate ? t('assets.store.scan.dateRequired') : null
  const invalid = !lines.length || Object.keys(checked.errors).length > 0 || Object.keys(reasonErrors).length > 0 || invalidDate
  const message = submitted && invalid ? t(!lines.length ? 'assets.store.scan.noLines' : 'assets.store.deliveries.correctFields') : null

  function notedQuantity(line: DeliveryLine): number | null {
    const row = scan.lines[line.key]
    return row && line.item ? quantityFromParts(quantityFor(row, line.item), line.item) : null
  }

  function hasDifference(line: DeliveryLine): boolean {
    const noted = notedQuantity(line)
    const received = line.item ? quantityFromParts(line.quantity, line.item) : null
    return noted != null && received != null && Number.isSafeInteger(received) && received !== noted
  }

  function needsAttention(line: DeliveryLine): boolean {
    const row = scan.lines[line.key]
    return !!row && (!line.item || row.confidence < 85 || row.match_score < 85 || notedQuantity(line) == null)
  }

  useEffect(() => { summary.current?.focus() }, [])
  useEffect(() => {
    if (pendingFocus.current == null) return
    focusTarget(pendingFocus.current)
    pendingFocus.current = null
  })

  function focusTarget(target: string): void {
    const element = target === 'firstInvalid' ? form.current?.querySelector<HTMLElement>('[aria-invalid="true"]') : document.getElementById(target)
    ;(element ?? summary.current)?.focus()
  }

  function skipLine(line: DeliveryLine): void {
    setSkipped((current) => [...current, line])
    setLines((current) => current.filter((entry) => entry.key !== line.key))
    setAnnouncement({ key: 'assets.store.scan.skippedAnnouncement', number: line.key + 1 })
    pendingFocus.current = `${id}-${line.key}-restore`
  }

  function restoreLine(line: DeliveryLine): void {
    setLines((current) => [...current, line].sort((a, b) => Number(needsAttention(b)) - Number(needsAttention(a)) || a.key - b.key))
    setSkipped((current) => current.filter((entry) => entry.key !== line.key))
    setAnnouncement({ key: 'assets.store.scan.restoredAnnouncement', number: line.key + 1 })
    pendingFocus.current = `${id}-${line.key}-item`
  }

  function submit(event: React.FormEvent): void {
    event.preventDefault()
    if (disabled) return
    setSubmitted(true)
    if (invalid) {
      if (submitted) focusTarget('firstInvalid')
      else pendingFocus.current = 'firstInvalid'
      return
    }
    if (!reviewing) { setReviewing(true); return }
    const body: StoreDeliveryCreate = {
      received_on: receivedOn,
      note: note.trim() || null,
      lines: checked.payload.map((line, index) => {
        const entry = lines[index]
        const row = scan.lines[entry.key]
        const noted = notedQuantity(entry)
        return { ...line, source_text: row?.raw_text ?? null, noted_quantity: noted, difference_reason: hasDifference(entry) ? reasons[entry.key]?.trim() || null : null }
      }),
    }
    void save.save(body)
  }

  const editor = (crop?: (row: StoreScanLine) => React.ReactNode) => <DeliveryLines idPrefix={id} lines={lines} onChange={setLines} errors={lineErrors} alertId={`${id}-alert`} disabled={disabled} allowAdd={!scan.lines.length || lines.some((line) => !scan.lines[line.key])} allowUndated quantityLabel={t('assets.store.scan.received')} pluralQuantityUnits
    renderLineLegend={(line) => <Trans i18nKey="assets.store.scan.line" values={{ number: line.key + 1 }} components={{ number: <bdi dir="ltr" /> }} />}
    quantityForItem={(line, item) => item?.id === line.item?.id ? line.quantity : scan.lines[line.key] ? quantityFor(scan.lines[line.key], item) : { ...EMPTY_QUANTITY }}
    renderLineActions={scan.lines.length ? (line) => <Button type="button" variant="ghost" className="min-h-11 whitespace-normal text-start" aria-label={t('assets.store.scan.skipLine', { number: line.key + 1 })} disabled={disabled} onClick={() => skipLine(line)}>{t('assets.store.scan.skip')}</Button> : undefined}
    renderLineStart={(line) => needsAttention(line) && <p className="mb-3 flex items-center gap-2 text-sm font-medium"><AlertTriangle aria-hidden className="h-4 w-4 shrink-0 text-warning" />{t(!line.item ? 'assets.store.scan.unmatched' : 'assets.store.scan.lowConfidence')}</p>}
    renderQuantityAside={(line) => { const row = scan.lines[line.key]; return row ? <div className="flex min-w-0 flex-col gap-2 text-sm"><span className="font-medium">{t('assets.store.scan.onNote')}</span>{crop?.(row)}<p dir="auto" className="break-words text-muted-foreground">{row.raw_text}</p><output>{notedQuantity(line) == null ? t('assets.store.scan.unknownQuantity') : <bdi dir="auto" className="font-mono tabular-nums">{formatQuantity(notedQuantity(line)!, line.item!, i18n.language)}</bdi>}</output></div> : null }}
    renderLineFields={(line) => {
      if (!hasDifference(line)) return null
      const error = submitted && reasonErrors[line.key] ? t(reasonErrors[line.key]) : null
      return <Field id={`${id}-${line.key}-reason`} label={t('assets.store.scan.reason')} required full><Textarea id={`${id}-${line.key}-reason`} dir="auto" maxLength={200} required value={reasons[line.key] ?? ''} onChange={(event) => setReasons((current) => ({ ...current, [line.key]: event.target.value }))} disabled={disabled} aria-invalid={!!error || undefined} aria-describedby={error ? `${id}-${line.key}-reason-error` : undefined} />{error && <span id={`${id}-${line.key}-reason-error`} role="alert" className="text-xs text-destructive">{error}</span>}</Field>
    }} />

  return <form ref={form} noValidate onSubmit={submit} className="flex min-w-0 flex-col gap-5 rounded-2xl border border-border bg-surface p-4 md:p-6" aria-busy={save.saving}>
    <div ref={summary} tabIndex={-1} className="focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
      {!reviewing && <><h2 className="text-[1.2em] font-semibold">{t('assets.store.scan.confirmTitle')}</h2><p className="text-muted-foreground">{t('assets.store.scan.confirmDescription')}</p>
        {attentionCount > 0 && <p className="mt-2 flex items-center gap-2 font-medium"><AlertTriangle aria-hidden className="h-5 w-5 shrink-0 text-warning" /><span><Trans i18nKey="assets.store.scan.needsLook" count={attentionCount} components={{ count: <bdi dir="ltr" /> }} /></span></p>}</>}
      <FormAlert id={`${id}-alert`} message={message ?? save.error} />
    </div>
    {reviewing ? <DeliveryReview lines={lines} receivedOn={receivedOn} note={note} file={file} renderLineDetails={(line) => { const row = scan.lines[line.key]; return row && <div className="flex flex-col gap-2 text-sm"><p dir="auto" className="break-words text-muted-foreground">{row.raw_text}</p><p>{t('assets.store.scan.onNote')}: {notedQuantity(line) == null ? t('assets.store.scan.unknownQuantity') : <bdi dir="auto">{formatQuantity(notedQuantity(line)!, line.item!, i18n.language)}</bdi>}</p>{hasDifference(line) && <p dir="auto">{t('assets.store.scan.reason')}: {reasons[line.key]}</p>}</div> }} /> : <>
      {file && <p className="break-words text-sm">{t('assets.store.deliveries.deliveryNoteDisplay')}: <bdi dir="auto">{file.name}</bdi></p>}
      <FieldGrid>
        <Field id={`${id}-date`} label={t('assets.store.deliveries.receivedOn')} required><Input id={`${id}-date`} type="date" dir="ltr" className="min-h-11 font-mono tabular-nums" max={todayIso()} value={receivedOn} onChange={(event) => setReceivedOn(event.target.value)} disabled={disabled} required aria-invalid={!!dateError || undefined} aria-describedby={dateError ? `${id}-date-error` : undefined} />{dateError && <span id={`${id}-date-error`} role="alert" className="text-xs text-destructive">{dateError}</span>}</Field>
        <Field id={`${id}-note`} label={t('assets.store.deliveries.note')}><Textarea id={`${id}-note`} dir="auto" value={note} onChange={(event) => setNote(event.target.value)} disabled={disabled} /></Field>
      </FieldGrid>
      {file && scan.lines.length ? <ScanNotePreview file={file} scan={scan} render={editor} /> : editor()}
    </>}
    <p role="status" aria-atomic="true" className="sr-only">{announcement && <Trans i18nKey={announcement.key} values={{ number: announcement.number }} components={{ number: <bdi dir="ltr" /> }} />}</p>
    {skipped.length > 0 && <section aria-labelledby={`${id}-skipped`} className="rounded-xl border border-border p-3"><h3 id={`${id}-skipped`} className="font-medium">{t('assets.store.scan.skippedLines')}</h3><ul className="mt-2 flex flex-col gap-2">{skipped.map((line) => <li key={line.key} className="flex flex-wrap items-center justify-between gap-2"><div className="min-w-0">{line.item && <StoreItemSummary item={line.item} size={56} />}{scan.lines[line.key] && <span dir="auto">{scan.lines[line.key].raw_text}</span>}</div>{!reviewing && <Button id={`${id}-${line.key}-restore`} type="button" variant="secondary" className="min-h-11" disabled={disabled} aria-label={t('assets.store.scan.restoreLine', { number: line.key + 1 })} onClick={() => restoreLine(line)}>{t('assets.store.scan.restore')}</Button>}</li>)}</ul></section>}
    {!lines.length && <div className="flex flex-col gap-3"><p role="status">{t('assets.store.scan.noLines')}</p><div className="flex flex-wrap gap-2"><Button type="button" variant="secondary" className="min-h-11" onClick={onChooseAnother}>{t('assets.store.scan.chooseAnother')}</Button><Button type="button" variant="secondary" className="min-h-11" onClick={() => setLines([newDeliveryLine(Math.max(scan.lines.length, ...skipped.map((line) => line.key + 1)))])}>{t('assets.store.scan.manual')}</Button></div></div>}
    {save.uploadError && <div role="alert" className="flex flex-col gap-3 rounded-xl border border-warning bg-warning-soft p-3"><p dir="auto">{save.uploadError}</p><div className="flex flex-wrap gap-2"><Button type="button" className="min-h-11" onClick={() => void save.retryUpload()} disabled={save.saving}>{t('assets.store.scan.retryUpload')}</Button><Button type="button" variant="secondary" className="min-h-11 whitespace-normal" onClick={save.finishWithoutFile} disabled={save.saving}>{t('assets.store.scan.finishWithoutFile')}</Button></div></div>}
    <div className="flex flex-wrap gap-2">
      {!save.saved && <Button type="button" variant="secondary" className="min-h-11" disabled={save.saving} onClick={() => { if (reviewing) { setReviewing(false); pendingFocus.current = `${id}-date` } else navigate('/holdings/store/deliveries') }}>{t(reviewing ? 'assets.store.deliveries.editLines' : 'common.cancel')}</Button>}
      {!save.saved && !reviewing && lines.length > 0 && <Button type="button" variant="ghost" className="min-h-11 whitespace-normal" disabled={save.saving} onClick={onChooseAnother}>{t('assets.store.scan.chooseAnother')}</Button>}
      {!save.saved && <Button type="submit" className="min-h-11" disabled={disabled || !lines.length}>{t(save.saving ? 'assets.store.deliveries.saving' : reviewing ? 'assets.store.deliveries.save' : 'assets.store.deliveries.review')}</Button>}
    </div>
  </form>
}

const CARTON_UNIT = /^(?:cartons?|ctns?|كرتون|كراتين)$/i

function quantityFor(row: StoreScanLine, item: StorePickerItem | null) {
  if (!item || (!CARTON_UNIT.test(item.counting_unit_en.trim()) && !CARTON_UNIT.test(item.counting_unit_ar.trim()))) return { ...EMPTY_QUANTITY }
  return { units: row.cartons == null ? '' : String(row.cartons), loose: hasContains(item) && row.loose_quantity != null ? String(row.loose_quantity) : '' }
}
