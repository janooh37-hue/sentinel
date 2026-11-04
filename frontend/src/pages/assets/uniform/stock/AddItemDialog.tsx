import { useId, useState } from 'react'
import { type UseMutationResult } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { DialogBody, DialogFooter, DialogShell, FormAlert } from '@/components/forms/DialogShell'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { UNIFORM_ART_GROUPS, UNIFORM_ART_LABELS, type UniformArtKind } from '@/components/uniformArtCatalog'
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
  const [names, setNames] = useState({ name_en: '', name_ar: '', description_en: '', description_ar: '' })
  const [group, setGroup] = useState<UniformItemCreate['group_key'] | ''>('')
  const [qty, setQty] = useState('2')
  const [sizes, setSizes] = useState<string[]>([...presets.letters])
  const [newSize, setNewSize] = useState('')
  const [sizeError, setSizeError] = useState('')
  const [errors, setErrors] = useState<Record<string, string>>({})
  const occupied = new Set(items.filter(item => !item.archived_at).map(item => item.drawing))
  const available = UNIFORM_ART_GROUPS.flatMap(group => UNIFORM_ART_LABELS.filter(art => art.group === group.id && !occupied.has(art.kind)).map(art => art.kind))
  const [drawing, setDrawing] = useState<UniformArtKind | null>(() => available[0] ?? null)
  const reason = !available.length || !drawing || !available.includes(drawing) ? t('assets.uniform.saveDisabledReason') : ''
  const busy = mutation.isPending
  const stage = () => {
    const value = newSize.trim()
    const error = !value ? 'sizeRequired' : value.length > 16 ? 'errors.invalidSizeLabel' : sizes.some(size => size.toLowerCase() === value.toLowerCase()) ? 'sizeDuplicate' : ''
    setSizeError(error)
    if (!error) { setSizes(previous => [...previous.filter(size => size !== 'one'), value]); setNewSize('') }
  }
  const fieldError = (key: string) => errors[key] ? <p id={`${id}-${key}-error`} role="alert" className="text-xs text-destructive-text">{t(`assets.uniform.${errors[key]}`)}</p> : null
  return <form noValidate className="flex min-h-0 flex-1 flex-col" aria-busy={busy} onSubmit={event => {
    event.preventDefault()
    if (!editable || busy || reason || !drawing) return
    const next: Record<string, string> = {}
    if (!names.name_en.trim()) next.name_en = 'required'
    if (!names.name_ar.trim()) next.name_ar = 'required'
    if (!group) next.group = 'groupRequired'
    if (!Number.isSafeInteger(Number(qty)) || Number(qty) < 1) next.qty = 'qtyRequired'
    if (!sizes.length) next.sizes = 'sizesRequired'
    setErrors(next)
    if (Object.keys(next).length || !group) { document.getElementById(`${id}-${Object.keys(next)[0]}`)?.focus(); return }
    mutation.mutate({ name_en: names.name_en.trim(), name_ar: names.name_ar.trim(), description_en: names.description_en.trim() || null, description_ar: names.description_ar.trim() || null, group_key: group, drawing, default_qty: Number(qty), sizes }, { onSuccess: () => { toast.success(t('assets.uniform.itemSaved')); onOpenChange(false) } })
  }}>
    <DialogBody>
      <FormAlert id={`${id}-server-error`} message={mutation.error ? uniformErrorMessage(mutation.error) : null} />
      <div className="grid gap-4 sm:grid-cols-2">{(['name_en', 'name_ar', 'description_en', 'description_ar'] as const).map(key => {
        const label = { name_en: 'nameEn', name_ar: 'nameAr', description_en: 'descEn', description_ar: 'descAr' }[key]
        return <div key={key} className="space-y-1.5"><label htmlFor={`${id}-${key}`} className="text-sm font-medium">{t(`assets.uniform.${label}`)}</label><Input id={`${id}-${key}`} value={names[key]} autoFocus={key === 'name_en'} dir={key.endsWith('_ar') ? 'rtl' : 'ltr'} required={key.startsWith('name')} maxLength={key.startsWith('name') ? 120 : 500} disabled={busy} className="min-h-11" aria-invalid={!!errors[key]} aria-describedby={errors[key] ? `${id}-${key}-error` : undefined} onChange={event => setNames(previous => ({ ...previous, [key]: event.target.value }))} />{fieldError(key)}</div>
      })}
        <div className="space-y-1.5"><label htmlFor={`${id}-group`} className="text-sm font-medium">{t('assets.uniform.group')}</label><select id={`${id}-group`} className="min-h-11 w-full rounded-md border border-input bg-background px-3 text-sm" value={group} disabled={busy} required aria-invalid={!!errors.group} aria-describedby={errors.group ? `${id}-group-error` : undefined} onChange={event => { const value = event.target.value; if (value === 'formal' || value === 'guard' || value === 'winter' || value === '') setGroup(value) }}><option value="">{t('assets.uniform.chooseGroup')}</option>{(['formal', 'guard', 'winter'] as const).map(value => <option key={value} value={value}>{t(`assets.uniform.groups.${value}`)}</option>)}</select>{fieldError('group')}</div>
        <div className="space-y-1.5"><label htmlFor={`${id}-qty`} className="text-sm font-medium">{t('assets.uniform.defaultQty')}</label><Input id={`${id}-qty`} type="number" min={1} step={1} inputMode="numeric" dir="ltr" value={qty} disabled={busy} className="min-h-11" aria-invalid={!!errors.qty} aria-describedby={errors.qty ? `${id}-qty-error` : undefined} onChange={event => setQty(event.target.value)} />{fieldError('qty')}</div>
      </div>
      <section className="mt-5 space-y-3" aria-labelledby={`${id}-sizes-title`}><h3 id={`${id}-sizes-title`} className="text-sm font-semibold">{t('assets.uniform.sizes')}</h3>
        <label className="flex flex-col gap-1.5 text-sm" htmlFor={`${id}-preset`}>{t('assets.uniform.preset')}<select id={`${id}-preset`} disabled={busy} className="min-h-11 rounded-md border border-input bg-background px-3" defaultValue="letters" onChange={event => { const key = event.target.value; if (key === 'letters' || key === 'shoe' || key === 'waist' || key === 'one') { setSizes([...presets[key]]); setSizeError('') } }}>{Object.keys(presets).map(key => <option key={key} value={key}>{t(`assets.uniform.presets.${key}`)}</option>)}</select></label>
        <div className="flex flex-wrap gap-2">{sizes.map(size => <Button key={size} type="button" variant="secondary" className="min-h-11 gap-2" disabled={busy || sizes.length <= 1} aria-label={t('assets.uniform.removeSize', { size: size === 'one' ? t('assets.uniform.oneSize') : size })} onClick={() => setSizes(previous => previous.filter(value => value !== size))}>{size === 'one' ? t('assets.uniform.oneSize') : <bdi dir="ltr">{size}</bdi>}<span aria-hidden>×</span></Button>)}</div>
        <div className="flex items-end gap-2"><div className="min-w-0 max-w-[200px] flex-1 space-y-1.5"><label htmlFor={`${id}-size`} className="text-sm font-medium">{t('assets.uniform.addSize')}</label><Input id={`${id}-size`} className="min-h-11" dir="ltr" value={newSize} disabled={busy} maxLength={16} aria-invalid={!!sizeError} aria-describedby={`${id}-size-error`} onChange={event => setNewSize(event.target.value)} onKeyDown={event => { if (event.key === 'Enter') { event.preventDefault(); stage() } }} /></div><Button type="button" variant="secondary" className="min-h-11" disabled={busy} onClick={stage}>{t('assets.uniform.add')}</Button></div>
        <p id={`${id}-size-error`} role={sizeError ? 'alert' : undefined} className="text-xs text-destructive-text">{sizeError ? t(`assets.uniform.${sizeError}`) : ''}</p>{fieldError('sizes')}
      </section>
      <div className="mt-5"><DrawingPicker items={items} value={drawing} onChange={setDrawing} disabled={busy} /></div>
    </DialogBody>
    <DialogFooter><p id={`${id}-reason`} role="status" className="me-auto text-sm text-muted-foreground">{reason}</p><Button type="button" variant="secondary" className="min-h-11" disabled={busy} onClick={() => onOpenChange(false)}>{t('assets.uniform.cancel')}</Button><Button type="submit" className="min-h-11" disabled={!!reason || busy || !editable} aria-describedby={`${id}-reason`}>{t('assets.uniform.save')}</Button></DialogFooter>
  </form>
}
