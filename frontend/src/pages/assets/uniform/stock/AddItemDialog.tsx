import { zodResolver } from '@hookform/resolvers/zod'
import { useId } from 'react'
import { type UseMutationResult } from '@tanstack/react-query'
import { useForm, useWatch } from 'react-hook-form'
import { useTranslation } from 'react-i18next'
import { z } from 'zod'
import { DialogBody, DialogFooter, DialogShell, FormAlert } from '@/components/forms/DialogShell'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { UNIFORM_ART_GROUPS, UNIFORM_ART_KINDS, UNIFORM_ART_LABELS } from '@/components/uniformArtCatalog'
import { type UniformItemCreate, type UniformItemRead } from '@/lib/api'
import { useCapabilities } from '@/lib/useCapabilities'
import { toast } from '@/lib/toast'
import { uniformErrorMessage, useCreateUniformItem, useUniformItems } from '../uniformQueries'
import { DrawingPicker } from './DrawingPicker'

interface Props {
  open: boolean
  onOpenChange: (open: boolean) => void
  returnFocusRef?: React.RefObject<HTMLElement | null>
}
const presets = {
  letters: ['S', 'M', 'L', 'XL', 'XXL', 'XXXL'],
  shoe: ['38', '39', '40', '41', '42', '43', '44', '45', '46', '47'],
  waist: ['28', '30', '32', '34', '36', '38', '40', '42', '44'],
  one: ['one'],
}
const schema = z.object({
  name_en: z.string().trim().min(1, 'assets.uniform.required').max(120, 'assets.uniform.catalog.nameTooLong'),
  name_ar: z.string().trim().min(1, 'assets.uniform.required').max(120, 'assets.uniform.catalog.nameTooLong'),
  description_en: z.string().trim().max(500, 'assets.uniform.catalog.descriptionTooLong'),
  description_ar: z.string().trim().max(500, 'assets.uniform.catalog.descriptionTooLong'),
  group_key: z.enum(['', 'formal', 'guard', 'winter']).refine(value => value !== '', 'assets.uniform.groupRequired'),
  default_qty: z.string().refine(value => Number.isSafeInteger(Number(value)) && Number(value) >= 1, 'assets.uniform.qtyRequired'),
  sizes: z.array(z.string().trim().min(1, 'assets.uniform.sizeRequired').max(16, 'assets.uniform.errors.invalidSizeLabel')).min(1, 'assets.uniform.sizesRequired'),
  newSize: z.string(),
  preset: z.enum(['letters', 'shoe', 'waist', 'one']),
  drawing: z.enum(UNIFORM_ART_KINDS).nullable(),
})
type Values = z.input<typeof schema>

export function AddItemDialog(props: Props): React.JSX.Element | null {
  const editable = useCapabilities().has('uniform.edit')
  return editable && props.open ? <AddItemContent {...props} /> : null
}
function AddItemContent({ open, onOpenChange, returnFocusRef }: Props): React.JSX.Element {
  const { t } = useTranslation()
  const items = useUniformItems()
  const mutation = useCreateUniformItem()
  const id = useId()
  return <DialogShell open={open} onOpenChange={onOpenChange} title={t('assets.uniform.addItem')} description={t('assets.uniform.tagline')} size="xl" busy={mutation.isPending} returnFocusRef={returnFocusRef}>
    {items.data && !items.isError ? <AddItemForm items={items.data} mutation={mutation} onOpenChange={onOpenChange} /> : <>
      <DialogBody>{items.isError ? <div><p role="alert" className="text-sm text-destructive-text">{t('assets.uniform.error')}</p><Button type="button" variant="ghost" className="min-h-11" onClick={() => void items.refetch()}>{t('assets.uniform.retry')}</Button></div> : <p role="status">{t('assets.uniform.loading')}</p>}</DialogBody>
      <DialogFooter><p id={`${id}-load`} className="me-auto text-sm text-muted-foreground">{t(items.isError ? 'assets.uniform.error' : 'assets.uniform.loading')}</p><Button type="button" variant="secondary" className="min-h-11" onClick={() => onOpenChange(false)}>{t('assets.uniform.cancel')}</Button><Button disabled className="min-h-11" aria-describedby={`${id}-load`}>{t('assets.uniform.save')}</Button></DialogFooter>
    </>}
  </DialogShell>
}
function AddItemForm({ items, mutation, onOpenChange }: { items: UniformItemRead[]; mutation: UseMutationResult<UniformItemRead, Error, UniformItemCreate>; onOpenChange: Props['onOpenChange'] }): React.JSX.Element {
  const { t } = useTranslation()
  const editable = useCapabilities().has('uniform.edit')
  const id = useId()
  const occupied = new Set(items.filter(item => !item.archived_at).map(item => item.drawing))
  const available = UNIFORM_ART_GROUPS.flatMap(group => UNIFORM_ART_LABELS.filter(art => art.group === group.id && !occupied.has(art.kind)).map(art => art.kind))
  const { control, register, handleSubmit, getValues, setValue, setError, clearErrors, formState: { errors } } = useForm<Values, unknown, z.output<typeof schema>>({
    resolver: zodResolver(schema),
    defaultValues: { name_en: '', name_ar: '', description_en: '', description_ar: '', group_key: '', default_qty: '2', sizes: [...presets.letters], newSize: '', preset: 'letters', drawing: available[0] ?? null },
  })
  const sizes = useWatch({ control, name: 'sizes' })
  const drawing = useWatch({ control, name: 'drawing' })
  const reason = !available.length || !drawing || !available.includes(drawing) ? t('assets.uniform.saveDisabledReason') : ''
  const busy = mutation.isPending
  function stage() {
    if (!editable || busy) return
    const value = getValues('newSize').trim()
    const message = !value ? 'assets.uniform.sizeRequired' : value.length > 16 ? 'assets.uniform.errors.invalidSizeLabel' : sizes.some(size => size.toLowerCase() === value.toLowerCase()) ? 'assets.uniform.sizeDuplicate' : value.toLowerCase() === 'one' && sizes.length > 0 ? 'assets.uniform.errors.sizesFixed' : ''
    if (message) { setError('newSize', { message }); return }
    setValue('sizes', [...sizes.filter(size => size !== 'one'), value], { shouldValidate: true })
    setValue('newSize', '')
    clearErrors('newSize')
  }
  const fieldError = (key: 'name_en' | 'name_ar' | 'description_en' | 'description_ar' | 'group_key' | 'default_qty' | 'sizes') => errors[key]?.message ? <p id={`${id}-${key}-error`} role="alert" className="text-xs text-destructive-text">{t(errors[key].message)}</p> : null
  return <form noValidate className="flex min-h-0 flex-1 flex-col" aria-busy={busy} onSubmit={handleSubmit(values => {
    if (!editable || busy || reason || !values.drawing || !values.group_key) return
    mutation.mutate({ name_en: values.name_en, name_ar: values.name_ar, description_en: values.description_en || null, description_ar: values.description_ar || null, group_key: values.group_key, drawing: values.drawing, default_qty: Number(values.default_qty), sizes: values.sizes }, { onSuccess: () => { toast.success(t('assets.uniform.itemSaved')); onOpenChange(false) } })
  })}>
    <DialogBody>
      <FormAlert id={`${id}-server-error`} message={mutation.error ? uniformErrorMessage(mutation.error) : null} />
      <fieldset disabled={busy || !editable} className="min-w-0">
        <div className="grid gap-4 sm:grid-cols-2">{(['name_en', 'name_ar', 'description_en', 'description_ar'] as const).map(key => {
          const label = { name_en: 'nameEn', name_ar: 'nameAr', description_en: 'descEn', description_ar: 'descAr' }[key]
          return <div key={key} className="space-y-1.5"><label htmlFor={`${id}-${key}`} className="text-sm font-medium">{t(`assets.uniform.${label}`)}</label><Input id={`${id}-${key}`} {...register(key)} autoFocus={key === 'name_en'} dir={key.endsWith('_ar') ? 'rtl' : 'ltr'} required={key.startsWith('name')} maxLength={key.startsWith('name') ? 120 : 500} className="min-h-11" aria-invalid={!!errors[key]} aria-describedby={errors[key] ? `${id}-${key}-error` : undefined} />{fieldError(key)}</div>
        })}
          <div className="space-y-1.5"><label htmlFor={`${id}-group`} className="text-sm font-medium">{t('assets.uniform.group')}</label><select id={`${id}-group`} {...register('group_key')} className="min-h-11 w-full rounded-md border border-input bg-background px-3 text-sm" required aria-invalid={!!errors.group_key} aria-describedby={errors.group_key ? `${id}-group_key-error` : undefined}><option value="">{t('assets.uniform.chooseGroup')}</option>{(['formal', 'guard', 'winter'] as const).map(value => <option key={value} value={value}>{t(`assets.uniform.groups.${value}`)}</option>)}</select>{fieldError('group_key')}</div>
          <div className="space-y-1.5"><label htmlFor={`${id}-qty`} className="text-sm font-medium">{t('assets.uniform.defaultQty')}</label><Input id={`${id}-qty`} {...register('default_qty')} type="number" min={1} step={1} inputMode="numeric" dir="ltr" className="min-h-11" aria-invalid={!!errors.default_qty} aria-describedby={errors.default_qty ? `${id}-default_qty-error` : undefined} />{fieldError('default_qty')}</div>
        </div>
        <section className="mt-5 space-y-3" aria-labelledby={`${id}-sizes-title`}><h3 id={`${id}-sizes-title`} className="text-sm font-semibold">{t('assets.uniform.sizes')}</h3>
          <label className="flex flex-col gap-1.5 text-sm" htmlFor={`${id}-preset`}>{t('assets.uniform.preset')}<select id={`${id}-preset`} {...register('preset', { onChange: (event: React.ChangeEvent<HTMLSelectElement>) => { const key = event.target.value; if (key === 'letters' || key === 'shoe' || key === 'waist' || key === 'one') { setValue('sizes', [...presets[key]], { shouldValidate: true }); clearErrors('newSize') } } })} className="min-h-11 rounded-md border border-input bg-background px-3">{Object.keys(presets).map(key => <option key={key} value={key}>{t(`assets.uniform.presets.${key}`)}</option>)}</select></label>
          <div className="flex flex-wrap gap-2">{sizes.map(size => <Button key={size} type="button" variant="secondary" className="min-h-11 gap-2" disabled={sizes.length <= 1} aria-label={t('assets.uniform.removeSize', { size: size === 'one' ? t('assets.uniform.oneSize') : size })} onClick={() => setValue('sizes', sizes.filter(value => value !== size), { shouldValidate: true })}>{size === 'one' ? t('assets.uniform.oneSize') : <bdi dir="ltr">{size}</bdi>}<span aria-hidden>×</span></Button>)}</div>
          <div className="flex items-end gap-2"><div className="min-w-0 max-w-[200px] flex-1 space-y-1.5"><label htmlFor={`${id}-size`} className="text-sm font-medium">{t('assets.uniform.addSize')}</label><Input id={`${id}-size`} {...register('newSize')} className="min-h-11" dir="ltr" maxLength={16} aria-invalid={!!errors.newSize} aria-describedby={`${id}-size-error`} onKeyDown={event => { if (event.key === 'Enter') { event.preventDefault(); stage() } }} /></div><Button type="button" variant="secondary" className="min-h-11" onClick={stage}>{t('assets.uniform.add')}</Button></div>
          <p id={`${id}-size-error`} role={errors.newSize ? 'alert' : undefined} className="text-xs text-destructive-text">{errors.newSize?.message ? t(errors.newSize.message) : ''}</p>{fieldError('sizes')}
        </section>
        <div className="mt-5"><DrawingPicker items={items} value={drawing} onChange={value => setValue('drawing', value)} disabled={busy || !editable} /></div>
      </fieldset>
    </DialogBody>
    <DialogFooter><p id={`${id}-reason`} role="status" className="me-auto text-sm text-muted-foreground">{reason}</p><Button type="button" variant="secondary" className="min-h-11" disabled={busy} onClick={() => onOpenChange(false)}>{t('assets.uniform.cancel')}</Button><Button type="submit" className="min-h-11" disabled={!!reason || busy || !editable} aria-describedby={`${id}-reason`}>{t('assets.uniform.save')}</Button></DialogFooter>
  </form>
}
