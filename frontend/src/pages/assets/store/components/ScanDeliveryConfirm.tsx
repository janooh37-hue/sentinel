import { useEffect, useId, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Trans, useTranslation } from 'react-i18next'
import { AlertTriangle } from 'lucide-react'

import { Field, FieldGrid, FormAlert } from '@/components/forms/DialogShell'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import type { StoreDeliveryCreate, StoreDeliveryScan, StorePickerItem } from '@/lib/api'
import { todayIso } from '@/pages/vehicles/vehicleUtils'
import { EMPTY_QUANTITY, formatQuantity, isBusinessDate, quantityFromParts, splitBase, storeErrorMessage, useStorePickerItems } from '../storeUtils'
import { DeliveryLines } from './DeliveryLines'
import { createDeliveryLines, type DeliveryLine, type DeliveryLineErrors, validateDeliveryLines } from './deliveryLineModel'
import { ScanNotePreview } from './ScanNotePreview'
import { useScanDeliverySave } from './useScanDeliverySave'

interface Props { file: File; scan: StoreDeliveryScan }

export function ScanDeliveryConfirm(props: Props): React.JSX.Element {
  const { t } = useTranslation()
  const picker = useStorePickerItems()
  if (picker.isPending) return <p role="status">{t('assets.store.state.loading')}</p>
  if (picker.error && !picker.data) return <div role="alert"><p dir="auto">{storeErrorMessage(picker.error)}</p><Button type="button" variant="secondary" className="min-h-11" onClick={() => void picker.refetch()}>{t('assets.store.state.retry')}</Button></div>
  return <ConfirmForm {...props} items={picker.data ?? []} />
}

function ConfirmForm({ file, scan, items }: Props & { items: StorePickerItem[] }): React.JSX.Element {
  const { t, i18n } = useTranslation()
  const id = useId()
  const navigate = useNavigate()
  const summary = useRef<HTMLDivElement>(null)
  const [lines, setLines] = useState(() => {
    const initial = createDeliveryLines(scan.lines.map((row) => {
      const item = items.find((entry) => entry.id === row.item_id) ?? null
      return { item, quantity: quantityFor(row.quantity, item) }
    }))
    return initial.sort((a, b) => Number(needsAttention(b)) - Number(needsAttention(a)))
  })
  const [reasons, setReasons] = useState<Record<number, string>>({})
  const [lineErrors, setLineErrors] = useState<DeliveryLineErrors>({})
  const [reasonErrors, setReasonErrors] = useState<Record<number, string>>({})
  const [receivedOn, setReceivedOn] = useState(todayIso)
  const [note, setNote] = useState('')
  const [dateError, setDateError] = useState<string | null>(null)
  const [message, setMessage] = useState<string | null>(null)
  const save = useScanDeliverySave(file)
  const disabled = save.saving || save.saved
  const attentionCount = lines.filter(needsAttention).length

  function needsAttention(line: DeliveryLine): boolean {
    const row = scan.lines[line.key]
    return !line.item || row.confidence < 85 || row.match_score < 85 || row.quantity == null
  }

  useEffect(() => { summary.current?.focus() }, [])

  function submit(event: React.FormEvent): void {
    event.preventDefault()
    if (disabled) return
    const checked = validateDeliveryLines(lines, t, { minimumQuantity: (line) => (scan.lines[line.key].quantity ?? 0) > 0 ? 0 : 1 })
    const invalidReasons: Record<number, string> = {}
    for (const line of lines) {
      const row = scan.lines[line.key]
      const received = line.item ? quantityFromParts(line.quantity, line.item) : null
      if (row.quantity != null && received != null && Number.isSafeInteger(received) && received !== row.quantity && !reasons[line.key]?.trim()) invalidReasons[line.key] = t('assets.store.scan.reasonRequired')
    }
    const invalidDate = !isBusinessDate(receivedOn) ? t('assets.store.scan.dateRequired') : null
    for (const issue of Object.values(checked.errors)) {
      if (issue.quantity) issue.quantity = t('assets.store.scan.quantityRequired')
    }
    setLineErrors(checked.errors)
    setReasonErrors(invalidReasons)
    setDateError(invalidDate)
    if (!lines.length || Object.keys(checked.errors).length || Object.keys(invalidReasons).length || invalidDate) {
      setMessage(t(!lines.length ? 'assets.store.scan.noLines' : 'assets.store.deliveries.correctFields'))
      summary.current?.focus()
      return
    }
    setMessage(null)
    const body: StoreDeliveryCreate = {
      received_on: receivedOn,
      note: note.trim() || null,
      lines: checked.payload.map((line, index) => {
        const key = lines[index].key
        const row = scan.lines[key]
        return { ...line, source_text: row.raw_text, noted_quantity: row.quantity, difference_reason: line.quantity !== row.quantity && row.quantity != null ? reasons[key]?.trim() || null : null }
      }),
    }
    void save.save(body)
  }

  return (
    <form noValidate onSubmit={submit} className="flex min-w-0 flex-col gap-5 rounded-xl border border-border bg-surface p-4 md:p-6" aria-busy={save.saving}>
      <div ref={summary} tabIndex={-1} className="rounded-lg border border-border p-3 focus-visible:ring-2 focus-visible:ring-ring">
        <h2 className="font-semibold">{t('assets.store.scan.confirmTitle')}</h2>
        <p className="text-sm text-muted-foreground">{t('assets.store.scan.confirmDescription')}</p>
        {attentionCount > 0 && <p className="mt-2 flex items-center gap-2 font-medium"><AlertTriangle aria-hidden className="h-5 w-5 shrink-0 text-warning" /><span><Trans i18nKey="assets.store.scan.needsLook" count={attentionCount} components={{ count: <bdi dir="ltr" /> }} /></span></p>}
        <FormAlert id={`${id}-alert`} message={message ?? save.error} />
      </div>
      <FieldGrid>
        <Field id={`${id}-date`} label={t('assets.store.deliveries.receivedOn')} required error={dateError ?? undefined}>
          <Input id={`${id}-date`} type="date" dir="ltr" className="min-h-11 font-mono tabular-nums" max={todayIso()} value={receivedOn} onChange={(event) => setReceivedOn(event.target.value)} disabled={disabled} required aria-invalid={!!dateError || undefined} aria-describedby={dateError ? `${id}-alert` : undefined} />
        </Field>
        <Field id={`${id}-note`} label={t('assets.store.deliveries.note')}><Textarea id={`${id}-note`} dir="auto" value={note} onChange={(event) => setNote(event.target.value)} disabled={disabled} /></Field>
      </FieldGrid>
      <ScanNotePreview file={file} scan={scan} render={(crop) => (
        <DeliveryLines idPrefix={id} lines={lines} onChange={setLines} errors={lineErrors} alertId={`${id}-alert`} disabled={disabled} allowAdd={false} allowUndated={false} quantityLabel={t('assets.store.scan.received')}
          renderLineLegend={(_line, index) => <Trans i18nKey="assets.store.scan.line" values={{ number: index + 1 }} components={{ number: <bdi dir="ltr" /> }} />}
          quantityForItem={(line, item) => quantityFor(scan.lines[line.key].quantity, item)}
          renderLineActions={(line) => <Button type="button" variant="ghost" className="mb-2 min-h-11 whitespace-normal text-start text-accent" disabled={disabled} onClick={() => { setLines((current) => current.filter((entry) => entry.key !== line.key)); summary.current?.focus() }}>{t('assets.store.scan.skip')}</Button>}
          renderLineStart={(line) => <div className="mb-3 flex flex-col gap-2">{crop(scan.lines[line.key])}<p dir="auto" className="break-words text-sm">{scan.lines[line.key].raw_text}</p>{needsAttention(line) && <p className="flex items-center gap-2 text-sm font-medium"><AlertTriangle aria-hidden className="h-4 w-4 shrink-0 text-warning" />{t(!line.item ? 'assets.store.scan.unmatched' : 'assets.store.scan.lowConfidence')}</p>}</div>}
          renderQuantityAside={(line) => <div className="flex flex-col gap-2 text-sm"><span className="font-medium">{t('assets.store.scan.onNote')}</span><output className="py-3">{scan.lines[line.key].quantity == null ? t('assets.store.scan.unknownQuantity') : <bdi dir="ltr" className="font-mono tabular-nums">{line.item ? formatQuantity(scan.lines[line.key].quantity!, line.item, i18n.language) : scan.lines[line.key].quantity}</bdi>}</output></div>}
          renderLineFields={(line) => {
            const row = scan.lines[line.key]
            const received = line.item ? quantityFromParts(line.quantity, line.item) : null
            if (row.quantity == null || received == null || !Number.isSafeInteger(received) || received === row.quantity) return null
            return <Field id={`${id}-${line.key}-reason`} label={t('assets.store.scan.reason')} required full error={reasonErrors[line.key]}><Textarea id={`${id}-${line.key}-reason`} dir="auto" maxLength={200} required value={reasons[line.key] ?? ''} onChange={(event) => setReasons((current) => ({ ...current, [line.key]: event.target.value }))} disabled={disabled} aria-invalid={!!reasonErrors[line.key] || undefined} aria-describedby={reasonErrors[line.key] ? `${id}-alert` : undefined} /></Field>
          }} />
      )} />
      {!lines.length && <p role="status">{t('assets.store.scan.noLines')}</p>}
      {save.uploadError && <div role="alert" className="flex flex-col gap-3 rounded-lg border border-warning bg-warning-soft p-3"><p dir="auto">{save.uploadError}</p><div className="flex flex-wrap gap-2"><Button type="button" className="min-h-11" onClick={() => void save.retryUpload()} disabled={save.saving}>{t('assets.store.scan.retryUpload')}</Button><Button type="button" variant="secondary" className="min-h-11 whitespace-normal" onClick={save.finishWithoutFile} disabled={save.saving}>{t('assets.store.scan.finishWithoutFile')}</Button></div></div>}
      <div className="flex flex-wrap gap-2">
        {!save.saved && <Button type="button" variant="secondary" className="min-h-11" disabled={save.saving} onClick={() => navigate('/holdings/store/deliveries')}>{t('common.cancel')}</Button>}
        {!save.saved && <Button type="submit" className="min-h-11" disabled={disabled || !lines.length}>{t(save.saving ? 'assets.store.deliveries.saving' : 'assets.store.deliveries.save')}</Button>}
      </div>
    </form>
  )
}

function quantityFor(base: number | null, item: StorePickerItem | null) {
  if (base == null || !item) return { ...EMPTY_QUANTITY }
  const parts = splitBase(base, item)
  return { units: String(parts.units), loose: String(parts.loose) }
}
