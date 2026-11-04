import { useId, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { DialogBody, DialogFooter, DialogShell, FormAlert } from '@/components/forms/DialogShell'
import { UniformArt } from '@/components/UniformArt'
import { Button } from '@/components/ui/button'
import { type UniformItemRead, type UniformReceiptRead, type UniformAdjustmentRead } from '@/lib/api'
import { formatDmy } from '@/lib/formatDmy'
import { toast } from '@/lib/toast'
import { useCapabilities } from '@/lib/useCapabilities'
import { uniformErrorMessage, useUniformAdjustments, useUniformReceipts, useVoidUniformAdjustment, useVoidUniformReceipt } from '../uniformQueries'

interface Props {
  open: boolean
  onOpenChange: (open: boolean) => void
  item: UniformItemRead
  returnFocusRef?: React.RefObject<HTMLElement | null>
}

type Entry = { kind: 'receipt'; date: string; record: UniformReceiptRead } | { kind: 'adjustment'; date: string; record: UniformAdjustmentRead }

export function StockHistory(props: Props): React.JSX.Element | null {
  return props.open ? <StockHistoryContent key={props.item.id} {...props} /> : null
}

function StockHistoryContent({ open, onOpenChange, item, returnFocusRef }: Props): React.JSX.Element {
  const { t, i18n } = useTranslation()
  const id = useId()
  const editable = useCapabilities().has('uniform.edit')
  const receipts = useUniformReceipts()
  const adjustments = useUniformAdjustments()
  const voidReceipt = useVoidUniformReceipt()
  const voidAdjustment = useVoidUniformAdjustment()
  const [confirmation, setConfirmation] = useState<string | null>(null)
  const [reason, setReason] = useState('')
  const busy = voidReceipt.isPending || voidAdjustment.isPending
  const invalidReason = !reason.trim() ? t('assets.uniform.errors.reasonRequired') : reason.trim().length > 500 ? t('assets.uniform.errors.reasonTooLong') : ''
  const sizeIds = new Set(item.sizes.map(size => size.id))
  const entries: Entry[] = [
    ...(receipts.data ?? []).filter(receipt => receipt.lines.some(line => sizeIds.has(line.size_id))).map(record => ({ kind: 'receipt' as const, date: record.received_on, record })),
    ...(adjustments.data ?? []).filter(adjustment => sizeIds.has(adjustment.size_id)).map(record => ({ kind: 'adjustment' as const, date: record.adjusted_on, record })),
  ].sort((a, b) => b.date.localeCompare(a.date) || b.record.id - a.record.id)
  const failed = receipts.isError || adjustments.isError
  const loaded = receipts.data && adjustments.data
  const name = i18n.language.startsWith('ar') ? item.name_ar : item.name_en
  const mutationError = voidReceipt.error ?? voidAdjustment.error
  const clearConfirmation = () => {
    setConfirmation(null)
    setReason('')
    voidReceipt.reset()
    voidAdjustment.reset()
  }
  return <DialogShell open={open} onOpenChange={onOpenChange} title={t('uniform.catalog.stockHistory')} description={name} size="lg" busy={busy} returnFocusRef={returnFocusRef}>
    <DialogBody>
      {failed ? <div><p role="alert" className="text-sm text-destructive-text">{t('assets.uniform.error')}</p><Button type="button" variant="ghost" className="min-h-11" onClick={() => { void receipts.refetch(); void adjustments.refetch() }}>{t('assets.uniform.retry')}</Button></div> : !loaded ? <p role="status">{t('assets.uniform.loading')}</p> : entries.length === 0 ? <p>{t('uniform.catalog.historyEmpty')}</p> : <ol className="space-y-3">{entries.map(entry => {
        const key = `${entry.kind}-${entry.record.id}`
        const confirming = confirmation === key
        const lines = entry.kind === 'receipt' ? entry.record.lines.filter(line => sizeIds.has(line.size_id)).map(line => ({ sizeId: line.size_id, qty: line.qty })) : [{ sizeId: entry.record.size_id, qty: entry.record.delta }]
        return <li key={key} className="rounded-lg border border-border p-3">
          <div className="flex flex-wrap items-start gap-3">
            <UniformArt kind={item.drawing} size={48} />
            <div className="min-w-0 flex-1 space-y-1">
              <p className="flex flex-wrap gap-x-3 text-sm font-semibold"><span>{t(entry.kind === 'receipt' ? 'uniform.catalog.receipt' : 'uniform.catalog.adjustment')}</span><time dateTime={entry.date} dir="ltr">{formatDmy(entry.date)}</time></p>
              <p className="text-xs text-muted-foreground">{t(entry.record.voided_at ? 'assets.uniform.voidStatus' : 'assets.uniform.activeStatus')}</p>
              {entry.kind === 'receipt' && entry.record.reference && <p className="break-words text-sm">{t('assets.uniform.reference')}: <bdi dir="auto">{entry.record.reference}</bdi></p>}
              {entry.kind === 'receipt' && entry.record.note && <p className="whitespace-pre-wrap break-words text-sm">{t('assets.uniform.note')}: <bdi dir="auto">{entry.record.note}</bdi></p>}
              {entry.kind === 'adjustment' && <p className="whitespace-pre-wrap break-words text-sm">{t('assets.uniform.adjustmentReason')}: <bdi dir="auto">{entry.record.reason}</bdi></p>}
              <ul className="flex flex-wrap gap-x-4 gap-y-1 text-sm">{lines.map(line => {
                const size = item.sizes.find(size => size.id === line.sizeId)
                return <li key={line.sizeId}><span>{t('assets.uniform.size')}: </span><bdi dir="ltr">{size?.label === 'one' ? t('assets.uniform.oneSize') : size?.label ?? String(line.sizeId)}</bdi><span className="ms-2">{t('assets.uniform.qty')}: </span><bdi dir="ltr" className="tabular-nums">{entry.kind === 'adjustment' && line.qty > 0 ? '+' : ''}{line.qty}</bdi></li>
              })}</ul>
              {entry.record.void_reason && <p className="whitespace-pre-wrap break-words text-sm">{t('assets.uniform.voidReason')}: <bdi dir="auto">{entry.record.void_reason}</bdi></p>}
            </div>
            {editable && !entry.record.voided_at && !confirming && <Button type="button" variant="secondary" className="min-h-11" disabled={busy} onClick={() => { clearConfirmation(); setConfirmation(key) }}>{t('assets.uniform.voidRecord')}</Button>}
          </div>
          {editable && confirming && !entry.record.voided_at && <form className="mt-3 space-y-2 border-t border-hairline pt-3" aria-busy={busy} onSubmit={event => {
            event.preventDefault()
            if (invalidReason || busy || !editable) return
            const options = { onSuccess: () => { toast.success(t('assets.uniform.voidSaved')); clearConfirmation() } }
            const variables = { id: entry.record.id, body: { reason: reason.trim() } }
            if (entry.kind === 'receipt') voidReceipt.mutate(variables, options)
            else voidAdjustment.mutate(variables, options)
          }}>
            <p className="text-sm font-semibold">{t('assets.uniform.voidConfirmTitle')}</p>
            <p className="text-sm text-muted-foreground">{t('assets.uniform.voidConfirm')}</p>
            <label htmlFor={`${id}-void-${key}`} className="block text-sm">{t('assets.uniform.voidReason')}</label>
            <textarea id={`${id}-void-${key}`} value={reason} disabled={busy} required maxLength={500} dir="auto" aria-invalid={!!invalidReason} aria-describedby={`${id}-reason-${key}`} className="min-h-11 w-full rounded-md border border-input bg-background px-3 py-2" onChange={event => setReason(event.target.value)} />
            <p id={`${id}-reason-${key}`} role="status" className="text-sm text-destructive-text">{invalidReason}</p>
            <FormAlert id={`${id}-error-${key}`} message={mutationError ? uniformErrorMessage(mutationError) : null} />
            <div className="flex flex-wrap justify-end gap-2"><Button type="button" variant="secondary" className="min-h-11" disabled={busy} onClick={clearConfirmation}>{t('assets.uniform.cancel')}</Button><Button type="submit" variant="destructive" className="min-h-11" disabled={busy || !!invalidReason} aria-describedby={`${id}-reason-${key}`}>{t('assets.uniform.voidRecord')}</Button></div>
          </form>}
        </li>
      })}</ol>}
    </DialogBody>
    <DialogFooter><Button type="button" variant="secondary" className="min-h-11" disabled={busy} onClick={() => onOpenChange(false)}>{t('common.close')}</Button></DialogFooter>
  </DialogShell>
}
