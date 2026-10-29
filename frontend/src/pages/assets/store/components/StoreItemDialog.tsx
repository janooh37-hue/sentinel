import { useId, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'

import { DialogBody, DialogFooter, DialogShell, Field, FieldGrid, FormAlert } from '@/components/forms/DialogShell'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { ApiError, api, type StoreCategoryCreate, type StoreCategoryRead, type StoreItemCreate, type StoreItemRead, type StoreItemUpdate } from '@/lib/api'
import { toast } from '@/lib/toast'
import {
  categoryName,
  EMPTY_QUANTITY,
  invalidateStoreQueries,
  quantityFromParts,
  type QuantityParts,
  splitBase,
  storeErrorMessage,
  storeKeys,
  type StoreUnits,
} from '../storeUtils'
import { QuantityInput } from './QuantityInput'

interface Props {
  open: boolean
  onOpenChange: (open: boolean) => void
  item?: StoreItemRead | null
}

export function StoreItemDialog({ open, onOpenChange, item = null }: Props): React.JSX.Element {
  const { t } = useTranslation()
  const [busy, setBusy] = useState(false)
  return (
    <DialogShell open={open} onOpenChange={onOpenChange} busy={busy}
      title={t(item ? 'assets.store.items.editTitle' : 'assets.store.items.addTitle')}
      description={t('assets.store.items.dialogDescription')}>
      {open && <ItemForm key={item?.id ?? 'new'} item={item} onOpenChange={onOpenChange} onBusyChange={setBusy} />}
    </DialogShell>
  )
}

function ItemForm({ item, onOpenChange, onBusyChange }: {
  item: StoreItemRead | null
  onOpenChange: (open: boolean) => void
  onBusyChange: (busy: boolean) => void
}): React.JSX.Element {
  const { t, i18n } = useTranslation()
  const qc = useQueryClient()
  const id = useId()
  const alertId = `${id}-alert`
  const lockId = `${id}-contains-lock`
  const [values, setValues] = useState({
    name_en: item?.name_en ?? '', name_ar: item?.name_ar ?? '',
    category_id: item ? String(item.category_id) : '',
    counting_unit_en: item?.counting_unit_en ?? 'Carton', counting_unit_ar: item?.counting_unit_ar ?? 'كرتون',
    contains_qty: item?.contains_qty == null ? '' : String(item.contains_qty),
    contains_unit_en: item?.contains_unit_en ?? '', contains_unit_ar: item?.contains_unit_ar ?? '',
  })
  const [contains, setContains] = useState(item?.contains_qty != null)
  const [locked, setLocked] = useState(item != null && item.on_hand > 0)
  const [minimum, setMinimum] = useState<QuantityParts>(() => {
    if (!item || item.minimum_level == null) return EMPTY_QUANTITY
    const parts = splitBase(item.minimum_level, item)
    return { units: String(parts.units), loose: parts.loose ? String(parts.loose) : '' }
  })
  const [error, setError] = useState<string | null>(null)
  const [addingCategory, setAddingCategory] = useState(false)
  const [category, setCategory] = useState({ name_en: '', name_ar: '' })
  const [categoryError, setCategoryError] = useState<string | null>(null)
  const categories = useQuery({ queryKey: storeKeys.categories, queryFn: api.listStoreCategories })
  const units: StoreUnits = locked && item ? { ...item, counting_unit_en: values.counting_unit_en, counting_unit_ar: values.counting_unit_ar } : {
    counting_unit_en: values.counting_unit_en, counting_unit_ar: values.counting_unit_ar,
    contains_qty: contains ? Number(values.contains_qty) || null : null,
    contains_unit_en: contains ? values.contains_unit_en : null,
    contains_unit_ar: contains ? values.contains_unit_ar : null,
  }
  const categoryMutation = useMutation({
    mutationFn: (body: StoreCategoryCreate) => api.createStoreCategory(body),
    onMutate: () => onBusyChange(true),
    onSettled: () => onBusyChange(false),
    onSuccess: (record) => {
      qc.setQueryData<StoreCategoryRead[]>(storeKeys.categories, (old) => [...(old ?? []), record])
      invalidateStoreQueries(qc)
      setValues((old) => ({ ...old, category_id: String(record.id) }))
      setAddingCategory(false)
      setCategory({ name_en: '', name_ar: '' })
      setCategoryError(null)
      toast.success(t('assets.store.items.categoryAdded'))
    },
    onError: (err) => setCategoryError(storeErrorMessage(err, t)),
  })
  const mutation = useMutation({
    mutationFn: (body: StoreItemCreate) => {
      if (!item) return api.createStoreItem(body)
      const { contains_qty, contains_unit_en, contains_unit_ar, ...other } = body
      const update: StoreItemUpdate = { ...other }
      if (!locked) {
        if (contains_qty !== item.contains_qty) update.contains_qty = contains_qty
        if (contains_unit_en !== item.contains_unit_en) update.contains_unit_en = contains_unit_en
        if (contains_unit_ar !== item.contains_unit_ar) update.contains_unit_ar = contains_unit_ar
      }
      return api.updateStoreItem(item.id, update, item.version)
    },
    onMutate: () => onBusyChange(true),
    onSettled: () => onBusyChange(false),
    onSuccess: () => {
      invalidateStoreQueries(qc)
      toast.success(t(item ? 'assets.store.items.updated' : 'assets.store.items.created'))
      onOpenChange(false)
    },
    onError: (err) => {
      if (item && err instanceof ApiError && err.code === 'STORE_ITEM_CONTAINS_LOCKED') {
        setLocked(true)
        setContains(item.contains_qty != null)
        setValues((old) => ({ ...old, contains_qty: item.contains_qty == null ? '' : String(item.contains_qty), contains_unit_en: item.contains_unit_en ?? '', contains_unit_ar: item.contains_unit_ar ?? '' }))
      }
      setError(storeErrorMessage(err, t))
    },
  })
  const busy = mutation.isPending || categoryMutation.isPending
  const textField = (key: 'name_en' | 'name_ar' | 'counting_unit_en' | 'counting_unit_ar' | 'contains_unit_en' | 'contains_unit_ar', label: string, required: boolean, disabled = false) => (
    <Field id={`${id}-${key}`} label={t(`assets.store.items.${label}`)} required={required}>
      <Input id={`${id}-${key}`} value={values[key]} onChange={(e) => setValues({ ...values, [key]: e.target.value })}
        dir="auto" maxLength={key.startsWith('name') ? 255 : 64} required={required} disabled={busy || disabled}
        aria-describedby={disabled && locked ? lockId : undefined} className="min-h-11" />
    </Field>
  )
  return (
    <form className="flex min-h-0 flex-1 flex-col" onSubmit={(event) => {
      event.preventDefault()
      if (busy) return
      const minimumLevel = quantityFromParts(minimum, units)
      if (!values.name_en.trim() || !values.category_id || !values.counting_unit_en.trim() || !values.counting_unit_ar.trim() ||
        (!locked && contains && (!/^\d+$/.test(values.contains_qty) || !Number.isSafeInteger(Number(values.contains_qty)) || Number(values.contains_qty) < 2 || !values.contains_unit_en.trim() || !values.contains_unit_ar.trim())) ||
        (minimumLevel != null && (!Number.isSafeInteger(minimumLevel) || minimumLevel < 0))) {
        setError(t('assets.store.items.validation'))
        return
      }
      setError(null)
      mutation.mutate({ name_en: values.name_en.trim(), name_ar: values.name_ar.trim() || null,
        category_id: Number(values.category_id), counting_unit_en: values.counting_unit_en.trim(), counting_unit_ar: values.counting_unit_ar.trim(),
        contains_qty: units.contains_qty, contains_unit_en: units.contains_unit_en?.trim() || null, contains_unit_ar: units.contains_unit_ar?.trim() || null,
        minimum_level: minimumLevel })
    }}>
      <DialogBody>
        <FormAlert id={alertId} message={error} />
        <FieldGrid>
          {textField('name_en', 'nameEn', true)}
          {textField('name_ar', 'nameAr', false)}
          <Field id={`${id}-category`} label={t('assets.store.items.category')} required full>
            <Select value={values.category_id} onValueChange={(value) => setValues({ ...values, category_id: value })} disabled={busy || categories.isPending || !!categories.error}>
              <SelectTrigger id={`${id}-category`} className="min-h-11" aria-required="true"><SelectValue placeholder={t('assets.store.items.selectCategory')} /></SelectTrigger>
              <SelectContent>{(categories.data ?? []).map((row) => <SelectItem key={row.id} value={String(row.id)}><span dir="auto">{categoryName(row, i18n.language)}</span></SelectItem>)}</SelectContent>
            </Select>
            {categories.isPending && <p role="status" className="text-xs text-muted-foreground">{t('assets.store.state.loading')}</p>}
            {categories.error && <><FormAlert id={`${id}-categories-error`} message={storeErrorMessage(categories.error, t)} /><Button type="button" variant="secondary" className="min-h-11 self-start" onClick={() => void categories.refetch()}>{t('assets.store.state.retry')}</Button></>}
            {!addingCategory && <Button type="button" variant="ghost" disabled={busy} className="min-h-11 self-start" onClick={() => setAddingCategory(true)}>{t('assets.store.items.addCategory')}</Button>}
          </Field>
        </FieldGrid>
        {addingCategory && <fieldset className="space-y-3 rounded-lg border border-border bg-surface-raised p-3" disabled={busy}>
          <legend className="px-1 text-sm font-semibold">{t('assets.store.items.addCategory')}</legend>
          <FormAlert id={`${id}-category-alert`} message={categoryError} />
          <FieldGrid>{(['name_en', 'name_ar'] as const).map((key) => <Field key={key} id={`${id}-category-${key}`} label={t(key === 'name_en' ? 'assets.store.items.categoryNameEn' : 'assets.store.items.categoryNameAr')} required>
            <Input id={`${id}-category-${key}`} dir="auto" maxLength={128} value={category[key]} onChange={(event) => setCategory({ ...category, [key]: event.target.value })} className="min-h-11" />
          </Field>)}</FieldGrid>
          <div className="flex flex-wrap justify-end gap-2">
            <Button type="button" variant="ghost" className="min-h-11" onClick={() => { setAddingCategory(false); setCategoryError(null) }}>{t('common.cancel')}</Button>
            <Button type="button" className="min-h-11" onClick={() => {
              if (!category.name_en.trim() || !category.name_ar.trim()) { setCategoryError(t('assets.store.items.categoryValidation')); return }
              setCategoryError(null)
              categoryMutation.mutate({ name_en: category.name_en.trim(), name_ar: category.name_ar.trim() })
            }}>{t('assets.store.items.saveCategory')}</Button>
          </div>
        </fieldset>}
        <FieldGrid>
          {textField('counting_unit_en', 'countingUnitEn', true)}
          {textField('counting_unit_ar', 'countingUnitAr', true)}
        </FieldGrid>
        <section className="space-y-3 rounded-lg border border-border p-3" aria-label={t('assets.store.items.contains')}>
          <label className="flex min-h-11 items-center gap-2 text-sm font-medium">
            <input type="checkbox" checked={contains} disabled={busy || locked} onChange={(event) => setContains(event.target.checked)} aria-describedby={locked ? lockId : undefined} className="h-4 w-4 accent-primary" />
            {t('assets.store.items.contains')}
          </label>
          {locked && <p id={lockId} className="text-sm text-muted-foreground">{t('assets.store.items.containsLocked')}</p>}
          {contains && <>
            <Field id={`${id}-contains-qty`} label={t('assets.store.items.containsQty')} required>
              <Input id={`${id}-contains-qty`} type="number" dir="ltr" min={2} step={1} value={values.contains_qty} required disabled={busy || locked}
                aria-describedby={locked ? lockId : undefined} onChange={(event) => setValues({ ...values, contains_qty: event.target.value })} className="min-h-11 font-mono tabular-nums" />
            </Field>
            <FieldGrid>{textField('contains_unit_en', 'containsUnitEn', true, locked)}{textField('contains_unit_ar', 'containsUnitAr', true, locked)}</FieldGrid>
          </>}
        </section>
        <Field id={`${id}-minimum`} label={t('assets.store.items.minimum')} hint={t('assets.store.items.minimumHint')}>
          <QuantityInput id={`${id}-minimum`} item={units} value={minimum} onChange={setMinimum} label={t('assets.store.items.minimum')} disabled={busy} describedBy={error ? alertId : undefined} />
        </Field>
      </DialogBody>
      <DialogFooter>
        <Button type="button" variant="secondary" className="min-h-11" disabled={busy} onClick={() => onOpenChange(false)}>{t('common.cancel')}</Button>
        <Button type="submit" className="min-h-11" disabled={busy || categories.isPending || !!categories.error || addingCategory}>{t(busy ? 'assets.store.items.saving' : 'assets.store.items.save')}</Button>
      </DialogFooter>
    </form>
  )
}

