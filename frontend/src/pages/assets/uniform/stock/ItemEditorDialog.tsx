import { zodResolver } from '@hookform/resolvers/zod'
import { useEffect, useId, useRef, useState } from 'react'
import { useFieldArray, useForm, useWatch } from 'react-hook-form'
import { useTranslation } from 'react-i18next'
import { z } from 'zod'

import { DialogBody, DialogFooter, DialogShell, FormAlert } from '@/components/forms/DialogShell'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { ApiError, type UniformItemRead, type UniformItemUpdate, type UniformSizeUpdate } from '@/lib/api'
import { UNIFORM_ART_KINDS, UNIFORM_ART_LABELS } from '@/components/uniformArtCatalog'
import { todayIso } from '@/lib/leaveDateMath'
import { toast } from '@/lib/toast'
import { useCapabilities } from '@/lib/useCapabilities'
import { whole } from '../quantity'
import { uniformErrorMessage, useAddUniformSize, useArchiveUniformItem, useCreateUniformAdjustments, useDeleteUniformItem, useRemoveUniformSize, useUniformItems, useUpdateUniformItem, useUpdateUniformSize } from '../uniformQueries'
import { DrawingPicker } from './DrawingPicker'

interface Props {
  open: boolean
  item: UniformItemRead
  onOpenChange: (open: boolean) => void
  returnFocusRef?: React.RefObject<HTMLElement | null>
  onSuccess?: (sizeIds: number[]) => void
}
const schema = z.object({
  name_en: z.string().trim().min(1, 'assets.uniform.required').max(120, 'assets.uniform.catalog.nameTooLong'),
  name_ar: z.string().trim().min(1, 'assets.uniform.required').max(120, 'assets.uniform.catalog.nameTooLong'),
  description_en: z.string().trim().max(500, 'assets.uniform.catalog.descriptionTooLong'),
  description_ar: z.string().trim().max(500, 'assets.uniform.catalog.descriptionTooLong'),
  group_key: z.enum(['formal', 'guard', 'winter']),
  default_qty: z.string().refine(value => Number.isSafeInteger(Number(value)) && Number(value) >= 1, 'assets.uniform.qtyRequired'),
  drawing: z.enum(UNIFORM_ART_KINDS),
  newSize: z.string(),
  reason: z.string().trim().max(500, 'assets.uniform.catalog.reasonTooLong'),
  rows: z.array(z.object({
    id: z.number().nullable(), label: z.string(), qty: z.string(), baseline: z.number(),
    min: z.string(), savedMin: z.number().nullable(), savedOrder: z.number(), held: z.number(), removed: z.boolean(),
  })),
}).superRefine((values, context) => {
  if (values.rows.some(row => !row.removed && whole(row.qty) !== row.baseline) && !values.reason) {
    context.addIssue({ code: 'custom', path: ['reason'], message: 'assets.uniform.catalog.adjustmentReasonRequired' })
  }
})
type Values = z.infer<typeof schema>
const metadata = (values: Pick<Values, 'name_en' | 'name_ar' | 'description_en' | 'description_ar' | 'group_key' | 'default_qty' | 'drawing'>) => ({
  name_en: values.name_en.trim(), name_ar: values.name_ar.trim(),
  description_en: values.description_en.trim() || null, description_ar: values.description_ar.trim() || null,
  group_key: values.group_key, default_qty: Number(values.default_qty), drawing: values.drawing,
})

export function ItemEditorDialog(props: Props): React.JSX.Element | null {
  return useCapabilities().has('uniform.edit') && props.open ? <ItemEditorContent {...props} /> : null
}

function ItemEditorContent({ item, open, onOpenChange, returnFocusRef, onSuccess }: Props): React.JSX.Element {
  const { t, i18n } = useTranslation()
  const id = useId()
  const editable = useCapabilities().has('uniform.edit')
  const items = useUniformItems()
  const updateItem = useUpdateUniformItem()
  const addSize = useAddUniformSize()
  const updateSize = useUpdateUniformSize()
  const removeSize = useRemoveUniformSize()
  const archiveItem = useArchiveUniformItem()
  const deleteItem = useDeleteUniformItem()
  const adjust = useCreateUniformAdjustments()
  const { control, register, handleSubmit, setValue, getValues, setError: setFieldError, clearErrors, formState: { errors, isSubmitting } } = useForm<Values>({
    resolver: zodResolver(schema),
    defaultValues: {
      name_en: item.name_en, name_ar: item.name_ar, description_en: item.description_en ?? '', description_ar: item.description_ar ?? '',
      group_key: item.group_key, default_qty: String(item.default_qty), drawing: item.drawing, newSize: '', reason: '',
      rows: item.tracking === 'holder' ? [] : item.sizes.filter(size => !size.archived_at).map(size => ({
        id: size.id, label: size.label, qty: String(size.on_hand), baseline: size.on_hand,
        min: size.min_qty === null ? '' : String(size.min_qty), savedMin: size.min_qty,
        savedOrder: size.sort_order, held: size.held_qty, removed: false,
      })),
    },
  })
  const { fields, append, move } = useFieldArray({ control, name: 'rows', keyName: 'formKey' })
  const rows = useWatch({ control, name: 'rows' })
  const drawing = useWatch({ control, name: 'drawing' })
  const reason = useWatch({ control, name: 'reason' })
  const pendingSize = !!useWatch({ control, name: 'newSize' }).trim()
  const savedMetadata = useRef(metadata({ ...item, default_qty: String(item.default_qty), description_en: item.description_en ?? '', description_ar: item.description_ar ?? '' }))
  const version = useRef(item.version)
  const [error, setError] = useState<unknown>(null)
  const [reviewSize, setReviewSize] = useState(false)
  const [draftConflict, setDraftConflict] = useState(false)
  const [latestItem, setLatestItem] = useState<UniformItemRead | null>(null)
  const [loadingLatest, setLoadingLatest] = useState(false)
  const [action, setAction] = useState<'archive' | 'delete' | null>(null)
  const actionLock = useRef(false)
  const changedIds = useRef(new Set<number>())
  const focusedDrawing = useRef(false)
  const busy = isSubmitting || archiveItem.isPending || deleteItem.isPending || loadingLatest
  useEffect(() => {
    if (item.tracking === 'holder' && items.data && !focusedDrawing.current) {
      const checked = document.getElementById(`${id}-form`)?.querySelector<HTMLInputElement>('input[type="radio"]:checked')
      if (checked) { checked.focus(); focusedDrawing.current = true }
    }
  }, [id, item.tracking, items.data])
  const name = i18n.language.startsWith('ar') ? item.name_ar : item.name_en
  const quantityChanged = rows.some(row => !row.removed && whole(row.qty) !== row.baseline)
  const unavailable = !items.data || items.data.some(other => !other.archived_at && other.id !== item.id && other.drawing === drawing)
  const disabledReason = unavailable ? t(!items.data && items.isError ? 'assets.uniform.error' : !items.data ? 'assets.uniform.loading' : 'assets.uniform.needDrawing') : quantityChanged && !reason.trim() ? t('assets.uniform.catalog.adjustmentReasonRequired') : ''
  const archiveBlocked = rows.some(row => row.baseline > 0 || row.held > 0) || item.holders.some(holder => holder.qty > 0)
  const activeIndices = rows.flatMap((row, index) => row.removed ? [] : [index])
  const sizeLabel = (label: string) => label === 'one' ? t('assets.uniform.oneSize') : label
  function stageSize(): boolean {
    if (busy || !editable || action) return false
    const label = getValues('newSize').trim()
    const matching = rows.findIndex(row => row.label.toLowerCase() === label.toLowerCase())
    const active = rows.filter(row => !row.removed)
    const oneSizeConflict = label.toLowerCase() === 'one'
      ? active.some(row => row.label.toLowerCase() !== 'one')
      : active.some(row => row.label.toLowerCase() === 'one')
    const message = !label ? 'assets.uniform.sizeRequired' : label.length > 16 ? 'assets.uniform.errors.invalidSizeLabel' : matching >= 0 && !rows[matching].removed ? 'assets.uniform.sizeDuplicate' : oneSizeConflict ? 'assets.uniform.errors.sizesFixed' : ''
    if (message) { setFieldError('newSize', { message }); return false }
    if (matching >= 0) setValue(`rows.${matching}.removed`, false)
    else append({ id: null, label, qty: '0', baseline: 0, min: '', savedMin: null, savedOrder: -1, held: 0, removed: false }, { shouldFocus: false })
    setValue('newSize', '')
    clearErrors('newSize')
    return true
  }
  async function reviewLatest() {
    if (busy || !editable || actionLock.current) return
    setLoadingLatest(true)
    try {
      const result = await items.refetch()
      if (result.isError) throw result.error
      const latest = result.data?.find(candidate => candidate.id === item.id)
      if (!latest) throw new Error('Item unavailable')
      setLatestItem(latest)
    } catch (failure) { setError(failure) }
    finally { setLoadingLatest(false) }
  }
  function keepDraft() {
    if (!latestItem || busy || !editable) return
    const current = metadata(getValues())
    const latest = metadata({ ...latestItem, default_qty: String(latestItem.default_qty), description_en: latestItem.description_en ?? '', description_ar: latestItem.description_ar ?? '' })
    // Adopt concurrent edits only where this operator has not changed the field.
    // Edited fields stay in the form for reconciliation before the next save.
    for (const key of ['name_en', 'name_ar', 'description_en', 'description_ar', 'group_key', 'default_qty', 'drawing'] as const) {
      if (current[key] === savedMetadata.current[key]) {
        if (key === 'default_qty') setValue(key, String(latest[key]))
        else if (key === 'group_key') setValue(key, latest[key])
        else if (key === 'drawing') setValue(key, latest[key])
        else setValue(key, latest[key] ?? '')
      }
    }
    savedMetadata.current = latest
    version.current = latestItem.version
    setValue('rows', getValues('rows').map(row => {
      const currentSize = latestItem.sizes.find(size => size.id === row.id)
      if (!currentSize) return row
      return {
        ...row,
        qty: whole(row.qty) === row.baseline ? String(currentSize.on_hand) : row.qty,
        baseline: currentSize.on_hand,
        held: currentSize.held_qty,
      }
    }))
    setLatestItem(null)
    setDraftConflict(false)
    setError(null)
  }
  async function save(values: Values) {
    if (disabledReason || busy || !editable || action || actionLock.current || draftConflict) return
    actionLock.current = true
    setError(null)
    // Endpoints commit independently. Advance only successfully saved baselines,
    // identifiers and versions so a later failure can be retried without replay.
    const nextRows = values.rows.map(row => ({ ...row, qty: String(whole(row.qty)), min: row.min === '' ? '' : String(whole(row.min)) }))
    const syncRows = () => setValue('rows', nextRows.map(row => ({ ...row })))
    const removeRow = async (row: Values['rows'][number]) => {
      if (row.id === null) return
      await removeSize.mutateAsync(row.id)
      changedIds.current.add(row.id)
      row.id = null
      row.baseline = 0
      row.savedMin = null
      row.savedOrder = -1
      syncRows()
    }
    syncRows()
    try {
      const nextMetadata = metadata(values)
      const body: UniformItemUpdate = {}
      for (const key of ['name_en', 'name_ar', 'description_en', 'description_ar', 'group_key', 'default_qty', 'drawing'] as const) {
        if (nextMetadata[key] !== savedMetadata.current[key]) Object.assign(body, { [key]: nextMetadata[key] })
      }
      if (Object.keys(body).length) {
        const updated = await updateItem.mutateAsync({ id: item.id, body, ifMatch: version.current })
        version.current = updated.version
        savedMetadata.current = nextMetadata
      }
      // The server forbids mixing active "one" and named sizes. Commit only
      // conflicting removals early; unrelated removals still follow adjustments.
      const replacements = nextRows.filter(row => !row.removed && row.id === null)
      for (const row of nextRows) {
        if (row.removed && replacements.some(replacement => (replacement.label.toLowerCase() === 'one') !== (row.label.toLowerCase() === 'one'))) {
          await removeRow(row)
        }
      }
      let order = 0
      for (const row of nextRows) {
        if (row.removed) continue
        const min = row.min === '' ? null : whole(row.min)
        if (row.id === null) {
          const created = await addSize.mutateAsync({ itemId: item.id, body: { label: row.label, min_qty: min } })
          row.id = created.id
          row.savedMin = min
          row.savedOrder = created.sort_order
          changedIds.current.add(created.id)
          syncRows()
        }
        const sizeBody: UniformSizeUpdate = {}
        if (min !== row.savedMin) sizeBody.min_qty = min
        if (order !== row.savedOrder) sizeBody.sort_order = order
        if (Object.keys(sizeBody).length) {
          await updateSize.mutateAsync({ id: row.id, body: sizeBody })
          row.savedMin = min
          row.savedOrder = order
          syncRows()
        }
        order += 1
      }
      const lines = nextRows.flatMap(row => !row.removed && row.id !== null && whole(row.qty) !== row.baseline ? [{ size_id: row.id, delta: whole(row.qty) - row.baseline, expected_on_hand: row.baseline }] : [])
      if (lines.length) {
        await adjust.mutateAsync({ lines, reason: values.reason, adjusted_on: todayIso() })
        for (const row of nextRows) {
          if (!row.removed && row.id !== null && whole(row.qty) !== row.baseline) { changedIds.current.add(row.id); row.baseline = whole(row.qty) }
        }
        syncRows()
      }
      for (const row of nextRows) {
        if (row.removed) await removeRow(row)
      }
      toast.success(t('assets.uniform.saved'))
      onSuccess?.([...changedIds.current])
      onOpenChange(false)
    } catch (failure) {
      setError(failure)
      if (failure instanceof ApiError && (failure.status === 412 || failure.code === 'uniform_stale_count')) {
        setDraftConflict(true)
        setLatestItem(null)
      }
    } finally {
      actionLock.current = false
    }
  }
  async function confirmAction() {
    if (!action || busy || !editable || actionLock.current || (action === 'archive' && archiveBlocked)) return
    actionLock.current = true
    setError(null)
    try {
      if (action === 'archive') await archiveItem.mutateAsync(item.id)
      else await deleteItem.mutateAsync(item.id)
      toast.success(t(action === 'archive' ? 'assets.uniform.catalog.archived' : 'assets.uniform.catalog.deleted'))
      onSuccess?.([])
      onOpenChange(false)
    } catch (failure) { setError(failure) }
    finally { actionLock.current = false }
  }
  const fieldError = (key: 'name_en' | 'name_ar' | 'description_en' | 'description_ar' | 'default_qty' | 'reason') => errors[key]?.message ? <p id={`${id}-${key}-error`} role="alert" className="text-sm text-destructive-text">{t(errors[key].message)}</p> : null
  return <DialogShell open={open} onOpenChange={onOpenChange} title={t('assets.uniform.editItem')} description={name} size="lg" busy={busy} returnFocusRef={returnFocusRef}
    onOpenAutoFocus={event => { const input = document.getElementById(`${id}-form`)?.querySelector<HTMLInputElement>('input[type="number"], input[type="radio"]:checked'); if (input) { event.preventDefault(); input.focus() } }}>
    <form id={`${id}-form`} noValidate className="flex min-h-0 flex-1 flex-col" aria-busy={busy} onSubmit={event => {
      setReviewSize(false)
      // Staging must precede RHF validation and writes, and always needs review.
      if (getValues('newSize').trim()) {
        event.preventDefault()
        if (stageSize()) setReviewSize(true)
        return
      }
      void handleSubmit(save)(event)
    }}>
      <DialogBody>
        <FormAlert id={`${id}-error`} message={error ? uniformErrorMessage(error) : null} />
        <FormAlert id={`${id}-refresh-error`} message={items.isError ? t(items.data ? 'assets.uniform.refreshError' : 'assets.uniform.error') : null} />
        {items.isError && <Button type="button" variant="ghost" className="min-h-11 self-start" disabled={busy} onClick={() => void items.refetch()}>{t('assets.uniform.retry')}</Button>}
        {draftConflict && <section className="space-y-3 rounded-md border border-border p-3" aria-label={t('assets.uniform.catalog.reviewLatest')}>
          <p className="text-sm">{t('assets.uniform.catalog.conflictDraftKept')}</p>
          <Button type="button" variant="secondary" className="min-h-11" disabled={busy || !editable} onClick={() => void reviewLatest()}>{t('assets.uniform.catalog.reviewLatest')}</Button>
          {latestItem && <>
            <dl className="grid grid-cols-2 gap-2 text-sm">
              {(['name_en', 'name_ar', 'description_en', 'description_ar'] as const).map(key => <div key={key}><dt className="font-medium">{t(`assets.uniform.${{ name_en: 'nameEn', name_ar: 'nameAr', description_en: 'descEn', description_ar: 'descAr' }[key]}`)}</dt><dd dir="auto">{latestItem[key] || t('assets.uniform.none')}</dd></div>)}
              <div><dt className="font-medium">{t('assets.uniform.group')}</dt><dd>{t(`assets.uniform.groups.${latestItem.group_key}`)}</dd></div>
              <div><dt className="font-medium">{t('assets.uniform.defaultQty')}</dt><dd><bdi>{latestItem.default_qty}</bdi></dd></div>
              <div><dt className="font-medium">{t('assets.uniform.drawing')}</dt><dd>{UNIFORM_ART_LABELS.find(art => art.kind === latestItem.drawing)?.[i18n.language.startsWith('ar') ? 'ar' : 'en']}</dd></div>
            </dl>
            <dl className="space-y-1 text-sm">
              {latestItem.sizes.filter(size => !size.archived_at).map(size => <div key={size.id} className="flex flex-wrap justify-between gap-2"><dt>{t('assets.uniform.qtyOf', { name: sizeLabel(size.label) })}</dt><dd><bdi>{size.on_hand}</bdi></dd></div>)}
            </dl>
            <Button type="button" variant="secondary" className="min-h-11" disabled={busy || !editable} onClick={keepDraft}>{t('assets.uniform.catalog.keepDraft')}</Button>
          </>}
        </section>}
        <fieldset disabled={busy || !editable || !!action} className="min-w-0 space-y-5">
          <div className="grid gap-4 sm:grid-cols-2">{(['name_en', 'name_ar', 'description_en', 'description_ar'] as const).map(key => <div key={key} className="space-y-1">
            <label htmlFor={`${id}-${key}`} className="text-sm font-medium">{t(`assets.uniform.${{ name_en: 'nameEn', name_ar: 'nameAr', description_en: 'descEn', description_ar: 'descAr' }[key]}`)}</label>
            <Input id={`${id}-${key}`} {...register(key)} dir={key.endsWith('_ar') ? 'rtl' : 'ltr'} required={key.startsWith('name')} maxLength={key.startsWith('name') ? 120 : 500} className="min-h-11" aria-invalid={!!errors[key]} aria-describedby={errors[key] ? `${id}-${key}-error` : undefined} />{fieldError(key)}
          </div>)}
            <label className="grid gap-1 text-sm">{t('assets.uniform.group')}<select {...register('group_key')} className="min-h-11 rounded-md border border-input bg-background px-3">{(['formal', 'guard', 'winter'] as const).map(group => <option key={group} value={group}>{t(`assets.uniform.groups.${group}`)}</option>)}</select></label>
            <div className="space-y-1"><label htmlFor={`${id}-default_qty`} className="text-sm">{t('assets.uniform.defaultQty')}</label><Input id={`${id}-default_qty`} {...register('default_qty')} type="number" min={1} step={1} inputMode="numeric" dir="ltr" className="min-h-11" aria-invalid={!!errors.default_qty} aria-describedby={errors.default_qty ? `${id}-default_qty-error` : undefined} />{fieldError('default_qty')}</div>
          </div>
          {item.tracking === 'shelf' && <>
            <fieldset className="space-y-3"><legend className="mb-2 text-sm font-semibold">{t('assets.uniform.bySize')}</legend>
              {fields.map((field, index) => {
                const row = rows[index]
                if (!row || row.removed) return null
                const position = activeIndices.indexOf(index)
                const removeBlocked = row.baseline > 0 || row.held > 0
                return <div key={field.formKey} className="grid grid-cols-2 items-end gap-3 border-b border-hairline pb-3 sm:grid-cols-[minmax(60px,1fr)_minmax(0,1fr)_minmax(0,1fr)]">
                  <span className="col-span-full text-sm sm:col-span-1">{row.label === 'one' ? sizeLabel(row.label) : <bdi dir="ltr">{row.label}</bdi>}</span>
                  <label className="min-w-0 space-y-1 text-sm"><span>{t('assets.uniform.qty')}</span><Input {...register(`rows.${index}.qty`)} type="number" inputMode="numeric" min={0} step={1} dir="ltr" className="min-h-11" aria-label={t('assets.uniform.qtyOf', { name: sizeLabel(row.label) })} onBlur={() => setValue(`rows.${index}.qty`, String(whole(getValues(`rows.${index}.qty`))))} /></label>
                  <label className="min-w-0 space-y-1 text-sm"><span>{t('assets.uniform.catalog.alertAt')}</span><Input {...register(`rows.${index}.min`)} type="number" inputMode="numeric" min={0} step={1} dir="ltr" className="min-h-11" aria-label={t('assets.uniform.catalog.alertAtSize', { size: sizeLabel(row.label) })} aria-describedby={`${id}-threshold-hint`} onBlur={() => { const value = getValues(`rows.${index}.min`); setValue(`rows.${index}.min`, value === '' ? '' : String(whole(value))) }} /></label>
                  <div className="col-span-full flex flex-wrap gap-2">
                    <Button type="button" variant="secondary" className="min-h-11" disabled={position === 0} aria-label={t('assets.uniform.catalog.moveSizeUp', { size: sizeLabel(row.label) })} onClick={() => move(index, activeIndices[position - 1])}>{t('assets.uniform.catalog.moveUp')}</Button>
                    <Button type="button" variant="secondary" className="min-h-11" disabled={position === activeIndices.length - 1} aria-label={t('assets.uniform.catalog.moveSizeDown', { size: sizeLabel(row.label) })} onClick={() => move(index, activeIndices[position + 1])}>{t('assets.uniform.catalog.moveDown')}</Button>
                    <Button type="button" variant="ghost" className="min-h-11" disabled={removeBlocked} aria-label={t('assets.uniform.removeSize', { size: sizeLabel(row.label) })} aria-describedby={removeBlocked ? `${id}-remove-${field.formKey}` : undefined} onClick={() => setValue(`rows.${index}.removed`, true)}>{t('assets.uniform.catalog.remove')}</Button>
                  </div>
                  {removeBlocked && <p id={`${id}-remove-${field.formKey}`} className="col-span-full text-xs text-muted-foreground">{t('assets.uniform.catalog.removeBlocked')}</p>}
                </div>
              })}
              <p id={`${id}-threshold-hint`} className="text-xs text-muted-foreground">{t('assets.uniform.minQtyHint')}</p>
            </fieldset>
            {!rows.some(row => !row.removed && row.label.toLowerCase() === 'one') && <div><div className="flex items-end gap-2"><label className="grid w-full max-w-[200px] gap-1 text-sm">{t('assets.uniform.addSize')}<Input {...register('newSize', { onChange: () => setReviewSize(false) })} maxLength={16} dir="ltr" className="min-h-11" aria-invalid={!!errors.newSize} aria-describedby={`${id}-size-error`} onKeyDown={event => { if (event.key === 'Enter') { event.preventDefault(); stageSize() } }} /></label><Button type="button" variant="secondary" className="min-h-11" onClick={stageSize}>{t('assets.uniform.add')}</Button></div>{errors.newSize?.message && <p id={`${id}-size-error`} role="alert" className="mt-1 text-sm text-destructive-text">{t(errors.newSize.message)}</p>}</div>}
            {quantityChanged && <div><label className="grid gap-1 text-sm">{t('assets.uniform.adjustmentReason')}<Input {...register('reason')} maxLength={500} dir="auto" className="min-h-11" required aria-invalid={!!errors.reason} aria-describedby={errors.reason ? `${id}-reason-error` : `${id}-reason`} /></label>{fieldError('reason')}</div>}
          </>}
          {items.data ? <DrawingPicker items={items.data} currentItemId={item.id} value={drawing} onChange={value => setValue('drawing', value)} disabled={busy || !!action} /> : !items.isError && <p role="status">{t('assets.uniform.loading')}</p>}
        </fieldset>
        <section className="mt-6 space-y-3" aria-label={t('assets.uniform.catalog.itemActions')}>
          {action ? <div className="space-y-3"><p id={`${id}-confirm`} className="text-sm">{t(action === 'archive' ? 'assets.uniform.catalog.archiveConfirm' : 'assets.uniform.catalog.deleteConfirm', { name })}</p><div className="flex flex-wrap gap-2"><Button type="button" variant={action === 'delete' ? 'destructive' : 'default'} className="min-h-11" disabled={busy || !editable} aria-describedby={`${id}-confirm`} onClick={() => void confirmAction()}>{t(action === 'archive' ? 'assets.uniform.catalog.confirmArchive' : 'assets.uniform.catalog.confirmDelete')}</Button><Button type="button" variant="secondary" className="min-h-11" disabled={busy} onClick={() => setAction(null)}>{t('assets.uniform.catalog.keepEditing')}</Button></div></div> : <><div className="flex flex-wrap gap-2"><Button type="button" variant="secondary" className="min-h-11" disabled={busy || !editable || archiveBlocked} aria-describedby={archiveBlocked ? `${id}-archive-blocked` : undefined} onClick={() => { setError(null); setAction('archive') }}>{t('assets.uniform.catalog.archiveItem')}</Button><Button type="button" variant="ghost" className="min-h-11 text-destructive-text" disabled={busy || !editable} onClick={() => { setError(null); setAction('delete') }}>{t('assets.uniform.catalog.deleteItem')}</Button></div>{archiveBlocked && <p id={`${id}-archive-blocked`} className="text-xs text-muted-foreground">{t('assets.uniform.catalog.archiveBlocked')}</p>}</>}
        </section>
      </DialogBody>
      <DialogFooter>
        <p id={`${id}-reason`} role="status" className="me-auto text-sm text-muted-foreground">{disabledReason}{reviewSize && <span className="block">{t('assets.uniform.sizeStaged')}</span>}</p>
        <Button type="button" variant="secondary" className="min-h-11" disabled={busy} onClick={() => onOpenChange(false)}>{t('assets.uniform.cancel')}</Button>
        <Button type="submit" className="min-h-11" disabled={(!!disabledReason && !pendingSize) || busy || !editable || !!action || draftConflict} aria-describedby={`${id}-reason`}>{t('assets.uniform.save')}</Button>
      </DialogFooter>
    </form>
  </DialogShell>
}
