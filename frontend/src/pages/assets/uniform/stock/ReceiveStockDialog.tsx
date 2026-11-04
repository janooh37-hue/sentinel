import { useId, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { DialogBody, DialogFooter, DialogShell, FormAlert } from '@/components/forms/DialogShell'
import { UniformArt } from '@/components/UniformArt'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { todayIso } from '@/lib/leaveDateMath'
import { toast } from '@/lib/toast'
import { useCapabilities } from '@/lib/useCapabilities'
import { uniformErrorMessage, useCreateUniformReceipt, useUniformItems } from '../uniformQueries'

interface Props {
  open: boolean
  onOpenChange: (open: boolean) => void
  itemId?: number
  returnFocusRef?: React.RefObject<HTMLElement | null>
  onSuccess?: (sizeIds: number[]) => void
}

function quantity(raw: string): number {
  const value = Number(raw)
  return Number.isFinite(value) ? Math.min(Number.MAX_SAFE_INTEGER, Math.max(0, Math.floor(value))) : 0
}

export function ReceiveStockDialog(props: Props): React.JSX.Element | null {
  const editable = useCapabilities().has('uniform.edit')
  return editable && props.open ? <ReceiveStockContent {...props} /> : null
}

function ReceiveStockContent({ open, onOpenChange, itemId, returnFocusRef, onSuccess }: Props): React.JSX.Element {
  const { t, i18n } = useTranslation()
  const id = useId()
  const items = useUniformItems()
  const mutation = useCreateUniformReceipt()
  const [date, setDate] = useState(todayIso)
  const [reference, setReference] = useState('')
  const [note, setNote] = useState('')
  const [quantities, setQuantities] = useState<Record<number, string>>({})
  const today = todayIso()
  const dateValue = new Date(`${date}T00:00:00Z`)
  const validDate = /^\d{4}-\d{2}-\d{2}$/.test(date) && date >= '0001-01-01' && Number.isFinite(dateValue.getTime()) && dateValue.toISOString().slice(0, 10) === date && date <= today
  const eligible = (items.data ?? []).filter(item => !item.archived_at && item.tracking === 'shelf' && item.sizes.some(size => !size.archived_at) && (itemId === undefined || item.id === itemId))
  const lines = eligible.flatMap(item => item.sizes.filter(size => !size.archived_at).flatMap(size => {
    const qty = quantity(quantities[size.id] ?? '0')
    return qty > 0 ? [{ size_id: size.id, qty }] : []
  }))
  const reason = items.isError ? t('assets.uniform.error') : !items.data ? t('assets.uniform.loading') : !validDate ? t('uniform.catalog.validReceiptDate') : reference.trim().length > 120 ? t('uniform.catalog.referenceTooLong') : note.trim().length > 500 ? t('assets.uniform.errors.descriptionTooLong') : !lines.length ? t('assets.uniform.errors.linesRequired') : ''
  return <DialogShell open={open} onOpenChange={onOpenChange} title={t('assets.uniform.receiveStock')} description={t('assets.uniform.tagline')} size="lg" busy={mutation.isPending} returnFocusRef={returnFocusRef}>
    <form noValidate className="flex min-h-0 flex-1 flex-col" aria-busy={mutation.isPending} onSubmit={event => {
      event.preventDefault()
      if (reason || mutation.isPending) return
      mutation.mutate({ received_on: date, reference: reference.trim() || null, note: note.trim() || null, lines }, { onSuccess: () => {
        toast.success(t('assets.uniform.receiptSaved'))
        onSuccess?.(lines.map(line => line.size_id))
        onOpenChange(false)
      } })
    }}>
      <DialogBody>
        <FormAlert id={`${id}-error`} message={mutation.error ? uniformErrorMessage(mutation.error) : null} />
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="space-y-1 text-sm" htmlFor={`${id}-date`}>{t('assets.uniform.receivedOn')}<Input id={`${id}-date`} type="date" required max={today} dir="ltr" value={date} disabled={mutation.isPending} className="min-h-11" aria-invalid={!validDate} aria-describedby={!validDate ? `${id}-reason` : undefined} onChange={event => setDate(event.target.value)} /></label>
          <label className="space-y-1 text-sm" htmlFor={`${id}-reference`}>{t('assets.uniform.reference')}<Input id={`${id}-reference`} maxLength={120} dir="auto" value={reference} disabled={mutation.isPending} className="min-h-11" onChange={event => setReference(event.target.value)} /></label>
        </div>
        <label className="space-y-1 text-sm" htmlFor={`${id}-note`}>{t('assets.uniform.note')}<textarea id={`${id}-note`} maxLength={500} dir="auto" value={note} disabled={mutation.isPending} className="min-h-11 w-full rounded-md border border-input bg-background px-3 py-2" onChange={event => setNote(event.target.value)} /></label>
        {items.isError ? <div><p role="alert" className="text-sm text-destructive-text">{t('assets.uniform.error')}</p><Button type="button" variant="ghost" className="min-h-11" onClick={() => void items.refetch()}>{t('assets.uniform.retry')}</Button></div> : !items.data ? <p role="status">{t('assets.uniform.loading')}</p> : eligible.length === 0 ? <p>{t('uniform.catalog.noReceiptSizes')}</p> : eligible.map(item => <fieldset key={item.id} disabled={mutation.isPending} className="min-w-0 border-t border-hairline py-3">
          <legend className="flex items-center gap-3 text-sm font-semibold"><UniformArt kind={item.drawing} size={48} /><span dir="auto">{i18n.language.startsWith('ar') ? item.name_ar : item.name_en}</span></legend>
          <div className="flex flex-wrap gap-3">{item.sizes.filter(size => !size.archived_at).map(size => <label key={size.id} htmlFor={`${id}-size-${size.id}`} className="flex flex-col gap-1 text-sm"><bdi dir="ltr">{size.label === 'one' ? t('assets.uniform.oneSize') : size.label}</bdi><Input id={`${id}-size-${size.id}`} type="number" min={0} step={1} inputMode="numeric" dir="ltr" className="min-h-11 w-24 tabular-nums" aria-label={t('assets.uniform.qtyOf', { name: `${i18n.language.startsWith('ar') ? item.name_ar : item.name_en} ${size.label === 'one' ? t('assets.uniform.oneSize') : size.label}` })} value={quantities[size.id] ?? '0'} onChange={event => setQuantities(previous => ({ ...previous, [size.id]: event.target.value }))} onBlur={event => setQuantities(previous => ({ ...previous, [size.id]: String(quantity(event.target.value)) }))} /></label>)}</div>
        </fieldset>)}
      </DialogBody>
      <DialogFooter>
        <p id={`${id}-reason`} role="status" className="me-auto text-sm text-muted-foreground">{reason}</p>
        <Button type="button" variant="secondary" className="min-h-11" disabled={mutation.isPending} onClick={() => onOpenChange(false)}>{t('assets.uniform.cancel')}</Button>
        <Button type="submit" className="min-h-11" disabled={!!reason || mutation.isPending} aria-describedby={`${id}-reason`}>{t('assets.uniform.save')}</Button>
      </DialogFooter>
    </form>
  </DialogShell>
}
