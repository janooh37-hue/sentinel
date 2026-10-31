import { useId } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useForm } from 'react-hook-form'
import { useTranslation } from 'react-i18next'
import { StoreItemArt } from '@/components/StoreItemArt'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { api, type StoreItemRead } from '@/lib/api'
import { useAuth } from '@/lib/authContext'
import { toast } from '@/lib/toast'
import { invalidateStoreQueries, itemName, storeErrorMessage, storeKeys } from '../storeUtils'
import { StoreQuantity } from './RecordParts'

export function QuantityStepper({ value, max, onChange, label, disabled = false, minimum = 1 }: { value: number; max: number; onChange: (value: number) => void; label: string; disabled?: boolean; minimum?: number }) {
  const { t } = useTranslation()
  return <div role="group" aria-label={label} className="inline-flex items-center rounded-lg border border-border bg-surface">
    <Button type="button" variant="ghost" className="h-11 min-w-11 px-2" aria-label={t('assets.store.handovers.decrease', { label })} disabled={disabled || value <= minimum} onClick={() => onChange(value - 1)}>−</Button>
    <output aria-label={label} className="min-w-8 text-center font-mono tabular-nums"><bdi dir="ltr">{value}</bdi></output>
    <Button type="button" variant="ghost" className="h-11 min-w-11 px-2" aria-label={t('assets.store.handovers.increase', { label })} disabled={disabled || value >= max} onClick={() => onChange(value + 1)}>+</Button>
  </div>
}

export function HandoverForm({ lines, onSuccess, onCancel, multi = false, children, busyChanged }: { lines: { item_id: number; quantity: number }[]; onSuccess: () => void; onCancel?: () => void; multi?: boolean; children?: React.ReactNode; busyChanged?: (busy: boolean) => void }) {
  const { t, i18n } = useTranslation()
  const id = useId()
  const client = useQueryClient()
  const { user } = useAuth()
  const takers = useQuery({ queryKey: storeKeys.takers, queryFn: api.listStoreHandoverTakers })
  const { register, handleSubmit, formState: { errors } } = useForm<{ takenBy: string; note: string }>({ defaultValues: { takenBy: '', note: '' } })
  const mutation = useMutation({
    mutationFn: api.createStoreHandover,
    onMutate: () => busyChanged?.(true),
    onSuccess: (_, body) => {
      invalidateStoreQueries(client)
      toast.success(t('assets.store.handovers.saved', { count: body.lines.length, name: body.taken_by }))
      onSuccess()
    },
    onSettled: () => busyChanged?.(false),
  })
  const name = user ? itemName({ name_en: user.name_en || user.email, name_ar: user.name_ar }, i18n.language) : t('assets.store.handovers.you')
  return <form aria-label={t('assets.store.handovers.give')} className="space-y-3" noValidate onSubmit={handleSubmit(values => {
    if (lines.length && lines.every(line => Number.isSafeInteger(line.quantity) && line.quantity > 0)) mutation.mutate({ taken_by: values.takenBy, note: values.note.trim() || null, lines })
  })}>
    <fieldset disabled={mutation.isPending} className="space-y-3">
      {children}
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-1"><label htmlFor={`${id}-taker`} className="text-sm font-medium">{t('assets.store.handovers.takenBy')}</label><Input id={`${id}-taker`} className="min-h-11" dir="auto" maxLength={128} autoComplete="off" list={`${id}-people`} placeholder={t('assets.store.handovers.takenByPlaceholder')} aria-invalid={!!errors.takenBy} aria-describedby={errors.takenBy ? `${id}-error` : undefined} {...register('takenBy', { validate: value => !!value.trim() || t('assets.store.handovers.nameRequired') })} /><datalist id={`${id}-people`}>{takers.data?.map(value => <option key={value} value={value} />)}</datalist></div>
        <div className="space-y-1"><label htmlFor={`${id}-note`} className="text-sm font-medium">{t('assets.store.handovers.note')}</label><Input id={`${id}-note`} className="min-h-11" dir="auto" placeholder={t('assets.store.handovers.notePlaceholder')} {...register('note')} /></div>
      </div>
      {errors.takenBy && <p id={`${id}-error`} role="alert" className="text-sm text-accent">{errors.takenBy.message}</p>}
      {mutation.error && <p role="alert" className="text-sm text-accent">{storeErrorMessage(mutation.error)}</p>}
      <p className="text-xs text-muted-foreground">{t(user ? 'assets.store.handovers.recordedBySelf' : 'assets.store.handovers.recordedBy', { name })}</p>
      <div className="flex flex-wrap justify-end gap-2">{onCancel && <Button type="button" variant="secondary" className="min-h-11" onClick={onCancel}>{t('common.cancel')}</Button>}<Button type="submit" className="min-h-11" disabled={!lines.length || mutation.isPending}>{multi ? t('assets.store.handovers.recordAll', { count: lines.length }) : t('assets.store.handovers.record')}</Button></div>
    </fieldset>
  </form>
}

export function HandoverTray({ items, picked, maximum, onChange, onCancel, onSuccess, busyChanged, busy }: { items: StoreItemRead[]; picked: Record<number, number>; maximum: (id: number) => number; onChange: (id: number, quantity: number) => void; onCancel: () => void; onSuccess: () => void; busyChanged: (busy: boolean) => void; busy: boolean }) {
  const { t, i18n } = useTranslation()
  const selected = items.filter(item => picked[item.id] > 0)
  return <section aria-label={t('assets.store.handovers.title')} className="fixed inset-x-0 bottom-[calc(5.5rem+var(--safe-bottom))] z-40 max-h-[55dvh] overflow-y-auto border-t border-border bg-surface px-4 py-4 shadow-2xl md:bottom-0 md:max-h-[60dvh] md:pb-[max(1rem,var(--safe-bottom))]">
    <div className="mx-auto grid max-w-7xl gap-4 lg:grid-cols-2">
      <div><h2 className="mb-2 font-semibold">{t('assets.store.handovers.title')} · {t('assets.store.dashboard.shelfItems', { count: selected.length })}</h2>
        <div className="max-h-40 space-y-1 overflow-y-auto">{!selected.length && <p className="text-sm text-muted-foreground">{t('assets.store.handovers.empty')}</p>}{selected.map(item => <div key={item.id} className="flex items-center gap-2"><StoreItemArt kind={item.art_kind} color={item.art_color} categoryId={item.category_id} size={38} /><span dir="auto" className="min-w-0 flex-1 text-sm">{itemName(item, i18n.language)}<span className="block text-xs text-muted-foreground"><StoreQuantity value={picked[item.id]} item={item} /></span></span><QuantityStepper label={itemName(item, i18n.language)} value={picked[item.id]} max={maximum(item.id)} minimum={0} disabled={busy} onChange={quantity => onChange(item.id, quantity)} /></div>)}</div>
      </div>
      <HandoverForm multi lines={selected.map(item => ({ item_id: item.id, quantity: picked[item.id] }))} onCancel={onCancel} onSuccess={onSuccess} busyChanged={busyChanged} />
    </div>
  </section>
}
