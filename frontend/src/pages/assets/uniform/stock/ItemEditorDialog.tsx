import { useEffect, useId, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { DialogBody, DialogFooter, DialogShell, FormAlert } from '@/components/forms/DialogShell'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { type UniformItemRead } from '@/lib/api'
import { type UniformArtKind } from '@/components/uniformArtCatalog'
import { todayIso } from '@/lib/leaveDateMath'
import { toast } from '@/lib/toast'
import { useCapabilities } from '@/lib/useCapabilities'
import { uniformErrorMessage, useAddUniformSize, useCreateUniformAdjustments, useUniformItems, useUpdateUniformItem, useUpdateUniformSize } from '../uniformQueries'
import { DrawingPicker } from './DrawingPicker'

interface Props {
  open: boolean
  item: UniformItemRead
  onOpenChange: (open: boolean) => void
  returnFocusRef?: React.RefObject<HTMLElement | null>
  onSuccess?: (sizeIds: number[]) => void
}
interface SizeDraft {
  id: number | null
  label: string
  qty: string
  baseline: number
  min: string
  savedMin: number | null
}
function whole(value: string): number {
  const n = Number(value)
  return Math.min(Number.MAX_SAFE_INTEGER, Math.max(0, Number.isFinite(n) ? Math.floor(n) : 0))
}

export function ItemEditorDialog(props: Props): React.JSX.Element | null {
  return useCapabilities().has('uniform.edit') && props.open ? <ItemEditorContent {...props} /> : null
}

function ItemEditorContent({ item, open, onOpenChange, returnFocusRef, onSuccess }: Props): React.JSX.Element {
  const { t, i18n } = useTranslation()
  const id = useId()
  const items = useUniformItems()
  const updateItem = useUpdateUniformItem()
  const addSize = useAddUniformSize()
  const updateSize = useUpdateUniformSize()
  const adjust = useCreateUniformAdjustments()
  const [drawing, setDrawing] = useState<UniformArtKind>(item.drawing)
  const [savedDrawing, setSavedDrawing] = useState(item.drawing)
  const version = useRef(item.version)
  const [rows, setRows] = useState<SizeDraft[]>(() => item.tracking === 'holder' ? [] : item.sizes.filter(size => !size.archived_at).map(size => ({ id: size.id, label: size.label, qty: String(size.on_hand), baseline: size.on_hand, min: size.min_qty === null ? '' : String(size.min_qty), savedMin: size.min_qty })))
  const [newSize, setNewSize] = useState('')
  const [sizeError, setSizeError] = useState('')
  const [reason, setReason] = useState('')
  const [error, setError] = useState<unknown>(null)
  const [saving, setSaving] = useState(false)
  const changedIds = useRef(new Set<number>())
  const focusedDrawing = useRef(false)
  useEffect(() => {
    if (item.tracking === 'holder' && items.data && !focusedDrawing.current) {
      const checked = document.getElementById(`${id}-form`)?.querySelector<HTMLInputElement>('input[type="radio"]:checked')
      if (checked) { checked.focus(); focusedDrawing.current = true }
    }
  }, [id, item.tracking, items.data])
  const name = i18n.language.startsWith('ar') ? item.name_ar : item.name_en
  const quantityChanged = rows.some(row => whole(row.qty) !== row.baseline)
  const unavailable = !items.data || items.isError || items.data.some(other => !other.archived_at && other.id !== item.id && other.drawing === drawing)
  const disabledReason = unavailable ? t(items.isError ? 'assets.uniform.error' : items.isPending ? 'assets.uniform.loading' : 'assets.uniform.needDrawing') : quantityChanged && !reason.trim() ? t('uniform.catalog.adjustmentReasonRequired') : ''
  function changeRow(index: number, field: 'qty' | 'min', value: string) {
    setRows(previous => previous.map((row, k) => k === index ? { ...row, [field]: value } : row))
  }
  function stageSize() {
    const label = newSize.trim()
    if (!label) { setSizeError(t('assets.uniform.sizeRequired')); return }
    if (label.length > 16) { setSizeError(t('assets.uniform.errors.invalidSizeLabel')); return }
    if (rows.some(row => row.label.toLowerCase() === label.toLowerCase())) { setSizeError(t('assets.uniform.sizeDuplicate')); return }
    setRows(previous => [...previous, { id: null, label, qty: '0', baseline: 0, min: '', savedMin: null }])
    setNewSize('')
    setSizeError('')
  }
  async function save() {
    if (disabledReason || saving || reason.trim().length > 500 || rows.some(row => !Number.isSafeInteger(whole(row.qty)) || (row.min !== '' && !Number.isSafeInteger(whole(row.min))))) return
    setSaving(true)
    setError(null)
    // Each endpoint commits independently. Keep completed steps in the draft so
    // an error on a later step cannot repeat a size or reuse a stale ETag.
    const nextRows = rows.map(row => ({ ...row, qty: String(whole(row.qty)), min: row.min === '' ? '' : String(whole(row.min)) }))
    setRows(nextRows)
    try {
      if (drawing !== savedDrawing) {
        const updated = await updateItem.mutateAsync({ id: item.id, body: { drawing }, ifMatch: version.current })
        version.current = updated.version
        setSavedDrawing(drawing)
      }
      for (const row of nextRows) {
        const min = row.min === '' ? null : whole(row.min)
        if (row.id === null) {
          const created = await addSize.mutateAsync({ itemId: item.id, body: { label: row.label, min_qty: min } })
          row.id = created.id
          row.savedMin = min
          changedIds.current.add(created.id)
          setRows(nextRows.map(value => ({ ...value })))
        } else if (min !== row.savedMin) {
          await updateSize.mutateAsync({ id: row.id, body: { min_qty: min } })
          row.savedMin = min
          setRows(nextRows.map(value => ({ ...value })))
        }
      }
      const lines = nextRows.flatMap(row => row.id !== null && whole(row.qty) !== row.baseline ? [{ size_id: row.id, delta: whole(row.qty) - row.baseline }] : [])
      if (lines.length) {
        await adjust.mutateAsync({ lines, reason: reason.trim(), adjusted_on: todayIso() })
        for (const line of lines) changedIds.current.add(line.size_id)
      }
      toast.success(t('assets.uniform.saved'))
      onSuccess?.([...changedIds.current])
      onOpenChange(false)
    } catch (failure) {
      setError(failure)
    } finally {
      setSaving(false)
    }
  }
  const sizeLabel = (label: string) => label === 'one' ? t('assets.uniform.oneSize') : label
  return <DialogShell open={open} onOpenChange={onOpenChange} title={t('assets.uniform.editItem')} description={name} size="lg" busy={saving} returnFocusRef={returnFocusRef}
    onOpenAutoFocus={event => { const checked = document.getElementById(`${id}-form`)?.querySelector<HTMLInputElement>('input[type="number"], input[type="radio"]:checked'); if (checked) { event.preventDefault(); checked.focus() } }}>
    <form id={`${id}-form`} noValidate className="flex min-h-0 flex-1 flex-col" aria-busy={saving} onSubmit={event => { event.preventDefault(); void save() }}>
      <DialogBody>
        <FormAlert id={`${id}-error`} message={error ? uniformErrorMessage(error) : null} />
        <fieldset disabled={saving} className="min-w-0 space-y-5">
          {item.tracking === 'shelf' && <>
            <fieldset className="space-y-3"><legend className="mb-2 text-sm font-semibold">{t('assets.uniform.bySize')}</legend>
              {rows.map((row, index) => <div key={row.label} className="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)] items-end gap-3 border-b border-hairline pb-3 sm:grid-cols-[minmax(60px,1fr)_minmax(0,1fr)_minmax(0,1fr)]">
                <span className="col-span-full text-sm sm:col-span-1">{row.label === 'one' ? sizeLabel(row.label) : <bdi dir="ltr">{row.label}</bdi>}</span>
                <label className="min-w-0 space-y-1 text-sm"><span>{t('assets.uniform.qty')}</span><Input type="number" inputMode="numeric" min={0} step={1} dir="ltr" className="min-h-11" aria-label={t('assets.uniform.qtyOf', { name: sizeLabel(row.label) })} value={row.qty} onChange={event => changeRow(index, 'qty', event.target.value)} onBlur={() => changeRow(index, 'qty', String(whole(row.qty)))} /></label>
                <label className="min-w-0 space-y-1 text-sm"><span>{t('uniform.catalog.alertAt')}</span><Input type="number" inputMode="numeric" min={0} step={1} dir="ltr" className="min-h-11" aria-label={t('uniform.catalog.alertAtSize', { size: sizeLabel(row.label) })} aria-describedby={`${id}-threshold-hint`} value={row.min} onChange={event => changeRow(index, 'min', event.target.value)} onBlur={() => changeRow(index, 'min', row.min === '' ? '' : String(whole(row.min)))} /></label>
              </div>)}
              <p id={`${id}-threshold-hint`} className="text-xs text-muted-foreground">{t('assets.uniform.minQtyHint')}</p>
            </fieldset>
            {!rows.some(row => row.label.toLowerCase() === 'one') && <div><div className="flex items-end gap-2"><label className="grid w-full max-w-[200px] gap-1 text-sm">{t('assets.uniform.addSize')}<Input value={newSize} maxLength={16} dir="ltr" className="min-h-11" aria-invalid={!!sizeError} aria-describedby={`${id}-size-error`} onChange={event => setNewSize(event.target.value)} onKeyDown={event => { if (event.key === 'Enter') { event.preventDefault(); stageSize() } }} /></label><Button type="button" variant="secondary" className="min-h-11" onClick={stageSize}>{t('assets.uniform.add')}</Button></div>{sizeError && <p id={`${id}-size-error`} role="alert" className="mt-1 text-sm text-destructive-text">{sizeError}</p>}</div>}
            {quantityChanged && <label className="grid gap-1 text-sm">{t('assets.uniform.adjustmentReason')}<Input value={reason} maxLength={500} dir="auto" className="min-h-11" required aria-describedby={`${id}-reason`} onChange={event => setReason(event.target.value)} /></label>}
          </>}
          {items.isError ? <div><p role="alert">{t('assets.uniform.error')}</p><Button type="button" variant="ghost" className="min-h-11" onClick={() => void items.refetch()}>{t('assets.uniform.retry')}</Button></div> : items.data ? <DrawingPicker items={items.data} currentItemId={item.id} value={drawing} onChange={setDrawing} disabled={saving} /> : <p role="status">{t('assets.uniform.loading')}</p>}
        </fieldset>
      </DialogBody>
      <DialogFooter>
        <p id={`${id}-reason`} role="status" className="me-auto text-sm text-muted-foreground">{disabledReason}</p>
        <Button type="button" variant="secondary" className="min-h-11" disabled={saving} onClick={() => onOpenChange(false)}>{t('assets.uniform.cancel')}</Button>
        <Button type="submit" className="min-h-11" disabled={!!disabledReason || saving} aria-describedby={`${id}-reason`}>{t('assets.uniform.save')}</Button>
      </DialogFooter>
    </form>
  </DialogShell>
}
