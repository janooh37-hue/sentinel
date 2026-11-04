import { useId } from 'react'
import { zodResolver } from '@hookform/resolvers/zod'
import { Controller, useForm, useWatch } from 'react-hook-form'
import { useTranslation } from 'react-i18next'
import { z } from 'zod'

import { DialogBody, DialogFooter, DialogShell, FormAlert } from '@/components/forms/DialogShell'
import { UniformArt } from '@/components/UniformArt'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { todayIso } from '@/lib/leaveDateMath'
import { toast } from '@/lib/toast'
import { useCapabilities } from '@/lib/useCapabilities'
import { whole } from '../quantity'
import { uniformErrorMessage, useCreateUniformReceipt, useUniformItems } from '../uniformQueries'

interface Props {
  open: boolean
  onOpenChange: (open: boolean) => void
  itemId?: number
  returnFocusRef?: React.RefObject<HTMLElement | null>
  onSuccess?: (sizeIds: number[]) => void
}

function validReceiptDate(date: string): boolean {
  const value = new Date(`${date}T00:00:00Z`)
  return /^\d{4}-\d{2}-\d{2}$/.test(date) && date >= '0001-01-01' && Number.isFinite(value.getTime()) && value.toISOString().slice(0, 10) === date && date <= todayIso()
}
const schema = z.object({
  date: z.string().refine(validReceiptDate, 'assets.uniform.catalog.validReceiptDate'),
  reference: z.string().trim().max(120, 'assets.uniform.catalog.referenceTooLong'),
  note: z.string().trim().max(500, 'assets.uniform.catalog.descriptionTooLong'),
  quantities: z.record(z.string(), z.string()),
})
type Values = z.infer<typeof schema>

export function ReceiveStockDialog(props: Props): React.JSX.Element | null {
  const editable = useCapabilities().has('uniform.edit')
  return editable && props.open ? <ReceiveStockContent {...props} /> : null
}

function ReceiveStockContent({ open, onOpenChange, itemId, returnFocusRef, onSuccess }: Props): React.JSX.Element {
  const { t, i18n } = useTranslation()
  const id = useId()
  const items = useUniformItems()
  const mutation = useCreateUniformReceipt()
  const { control, register, handleSubmit } = useForm<Values>({
    resolver: zodResolver(schema),
    defaultValues: { date: todayIso(), reference: '', note: '', quantities: {} },
  })
  const [date, reference, note, quantities] = useWatch({ control, name: ['date', 'reference', 'note', 'quantities'] })
  const today = todayIso()
  const validDate = validReceiptDate(date)
  const validation = schema.safeParse({ date, reference, note, quantities })
  const eligible = (items.data ?? []).filter(item => !item.archived_at && item.tracking === 'shelf' && item.sizes.some(size => !size.archived_at) && (itemId === undefined || item.id === itemId))
  const lines = eligible.flatMap(item => item.sizes.filter(size => !size.archived_at).flatMap(size => {
    const qty = whole(quantities[size.id] ?? '0')
    return qty > 0 ? [{ size_id: size.id, qty }] : []
  }))
  const reason = items.isError ? t('assets.uniform.error') : !items.data ? t('assets.uniform.loading') : !validation.success ? t(validation.error.issues[0].message) : !lines.length ? t('assets.uniform.errors.linesRequired') : ''
  return <DialogShell open={open} onOpenChange={onOpenChange} title={t('assets.uniform.receiveStock')} description={t('assets.uniform.tagline')} size="lg" busy={mutation.isPending} returnFocusRef={returnFocusRef}>
    <form noValidate className="flex min-h-0 flex-1 flex-col" aria-busy={mutation.isPending} onSubmit={handleSubmit(values => {
      if (reason || mutation.isPending) return
      mutation.mutate({ received_on: values.date, reference: values.reference || null, note: values.note || null, lines }, { onSuccess: () => {
        toast.success(t('assets.uniform.receiptSaved'))
        onSuccess?.(lines.map(line => line.size_id))
        onOpenChange(false)
      } })
    })}>
      <DialogBody>
        <FormAlert id={`${id}-error`} message={mutation.error ? uniformErrorMessage(mutation.error) : null} />
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="space-y-1 text-sm" htmlFor={`${id}-date`}>{t('assets.uniform.receivedOn')}<Input {...register('date')} id={`${id}-date`} type="date" required max={today} dir="ltr" disabled={mutation.isPending} className="min-h-11" aria-invalid={!validDate} aria-describedby={!validDate ? `${id}-reason` : undefined} /></label>
          <label className="space-y-1 text-sm" htmlFor={`${id}-reference`}>{t('assets.uniform.reference')}<Input {...register('reference')} id={`${id}-reference`} maxLength={120} dir="auto" disabled={mutation.isPending} className="min-h-11" /></label>
        </div>
        <label className="space-y-1 text-sm" htmlFor={`${id}-note`}>{t('assets.uniform.note')}<textarea {...register('note')} id={`${id}-note`} maxLength={500} dir="auto" disabled={mutation.isPending} className="min-h-11 w-full rounded-md border border-input bg-background px-3 py-2" /></label>
        {items.isError ? <div><p role="alert" className="text-sm text-destructive-text">{t('assets.uniform.error')}</p><Button type="button" variant="ghost" className="min-h-11" onClick={() => void items.refetch()}>{t('assets.uniform.retry')}</Button></div> : !items.data ? <p role="status">{t('assets.uniform.loading')}</p> : eligible.length === 0 ? <p>{t('assets.uniform.catalog.noReceiptSizes')}</p> : eligible.map(item => <fieldset key={item.id} disabled={mutation.isPending} className="min-w-0 border-t border-hairline py-3">
          <legend className="flex items-center gap-3 text-sm font-semibold"><UniformArt kind={item.drawing} size={48} /><span dir="auto">{i18n.language.startsWith('ar') ? item.name_ar : item.name_en}</span></legend>
          <div className="flex flex-wrap gap-3">{item.sizes.filter(size => !size.archived_at).map(size => <label key={size.id} htmlFor={`${id}-size-${size.id}`} className="flex flex-col gap-1 text-sm"><bdi dir="ltr">{size.label === 'one' ? t('assets.uniform.oneSize') : size.label}</bdi><Controller control={control} name={`quantities.${size.id}`} defaultValue="0" render={({ field }) => <Input {...field} id={`${id}-size-${size.id}`} type="number" min={0} step={1} inputMode="numeric" dir="ltr" className="min-h-11 w-24 tabular-nums" aria-label={t('assets.uniform.qtyOf', { name: `${i18n.language.startsWith('ar') ? item.name_ar : item.name_en} ${size.label === 'one' ? t('assets.uniform.oneSize') : size.label}` })} onBlur={() => { field.onBlur(); field.onChange(String(whole(field.value))) }} />} /></label>)}</div>
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
