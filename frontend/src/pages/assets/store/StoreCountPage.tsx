import { useState, type FormEvent } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ClipboardList, Plus, Trash2 } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { Link, useNavigate, useParams } from 'react-router-dom'

import { Button } from '@/components/ui/button'
import { buttonVariants } from '@/components/ui/button-variants'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { api, ApiError, type StoreCountRead, type StoreCountWrite, type StoreExpectedBatch } from '@/lib/api'
import { toast } from '@/lib/toast'
import { useCapabilities } from '@/lib/useCapabilities'
import { useIsMobile } from '@/lib/useIsMobile'
import { formatNumber } from '@/lib/language'
import { todayIso } from '@/pages/vehicles/vehicleUtils'
import { StoreShell } from './StoreShell'
import { StoreQueryState } from './StoreQueryState'
import { ExpiryInput } from './components/ExpiryInput'
import { QuantityInput } from './components/QuantityInput'
import {
  batchExpiryDate,
  batchKey,
  DEFAULT_EXPIRY,
  EMPTY_QUANTITY,
  expiryFromValue,
  expiryInput,
  type ExpiryValue,
  formatExpiry,
  invalidateStoreQueries,
  isBusinessDate,
  itemName,
  quantityFromParts,
  quantityIssue,
  type QuantityParts,
  storeErrorMessage,
  storeKeys,
} from './storeUtils'
import { ExpiryText } from './components/ExpiryText'

type CountBatch = Omit<StoreExpectedBatch, 'batch_id'> & { batch_id?: number; removable?: boolean }
interface MissingBatch { batch_id: number; item_code: string; expiry_date: string | null }

function isMissingBatch(value: unknown): value is MissingBatch {
  return typeof value === 'object' && value !== null && 'batch_id' in value && typeof value.batch_id === 'number'
    && 'item_code' in value && typeof value.item_code === 'string' && 'expiry_date' in value
    && (value.expiry_date === null || typeof value.expiry_date === 'string')
}

export function StoreCountPage(): React.JSX.Element {
  const { id } = useParams()
  const { t } = useTranslation()
  const editable = useCapabilities().has('store.edit')
  const countId = id === undefined ? null : Number(id)
  const count = useQuery({ queryKey: storeKeys.count(countId ?? 0), queryFn: () => api.getStoreCount(countId!), enabled: countId !== null && editable })

  return (
    <StoreShell title={t(countId === null ? 'assets.store.counts.new' : 'assets.store.counts.edit')} description={t('assets.store.counts.blankInstruction')}>
      {!editable ? <p role="alert">{t('assets.store.counts.readOnly')}</p> : (
        <StoreQueryState isPending={countId !== null && count.isPending} error={count.error} onRetry={() => { void count.refetch() }} isEmpty={false} emptyMessage="" emptyDescription="">
          <CountForm key={countId ?? 'new'} saved={count.data} />
        </StoreQueryState>
      )}
    </StoreShell>
  )
}

function CountForm({ saved }: { saved?: StoreCountRead }): React.JSX.Element {
  const { t, i18n } = useTranslation()
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const mobile = useIsMobile()
  const [countedOn, setCountedOn] = useState(saved?.counted_on ?? todayIso())
  const [note, setNote] = useState(saved?.note ?? '')
  const [added, setAdded] = useState<CountBatch[]>([])
  const [quantities, setQuantities] = useState<Record<string, QuantityParts>>({})
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [missing, setMissing] = useState<MissingBatch[]>([])
  const [itemId, setItemId] = useState('')
  const [acknowledgedMissing, setAcknowledgedMissing] = useState<string[]>([])
  const [expiry, setExpiry] = useState<ExpiryValue>(DEFAULT_EXPIRY)
  const [addError, setAddError] = useState('')
  const validDate = isBusinessDate(countedOn)
  const expected = useQuery({ queryKey: storeKeys.expected(countedOn), queryFn: () => api.getStoreCountExpected(countedOn), enabled: validDate })
  const picker = useQuery({ queryKey: storeKeys.picker, queryFn: api.listStorePickerItems })
  // Missing-batch details identify batches but omit their units and month-only flag.
  // Resolve them through the batch endpoint rather than inventing either field.
  const missingBatches = useQuery({ queryKey: storeKeys.batches(), queryFn: () => api.listStoreBatches(), enabled: missing.length > 0 })
  const rowsByKey = new Map<string, CountBatch>()
  for (const row of [...(expected.data ?? []), ...(saved?.lines ?? []), ...added]) {
    const key = batchKey(row.item_id, row.expiry_date)
    if (!rowsByKey.has(key)) rowsByKey.set(key, row)
  }
  for (const batch of missingBatches.data ?? []) {
    if (missing.some((entry) => entry.batch_id === batch.id)) {
      const key = batchKey(batch.item_id, batch.expiry_date)
      if (!rowsByKey.has(key)) rowsByKey.set(key, { ...batch, batch_id: batch.id })
    }
  }
  const rows = [...rowsByKey.values()]
  const groups = new Map<number, CountBatch[]>()
  for (const row of rows) {
    const group = groups.get(row.item_id)
    if (group) group.push(row)
    else groups.set(row.item_id, [row])
  }
  const unresolvedMissing = missing.some((entry) => !rows.some((row) => row.batch_id === entry.batch_id || (row.item_code === entry.item_code && row.expiry_date === entry.expiry_date)))
  const entered = rows.filter((row) => {
    return quantityIssue(quantityFromParts(quantities[batchKey(row.item_id, row.expiry_date)] ?? EMPTY_QUANTITY, row), { min: 0 }) === null
  }).length

  const mutation = useMutation({
    mutationFn: (body: StoreCountWrite) => saved ? api.updateStoreCount(saved.id, body) : api.createStoreCount(body),
    onSuccess: () => {
      invalidateStoreQueries(queryClient)
      toast.success(t('assets.store.counts.saved'))
      void navigate('/holdings/store/counts')
    },
    onError: (error) => {
      setAcknowledgedMissing([])
      if (error instanceof ApiError && error.code === 'STORE_COUNT_MISSING_BATCHES' && Array.isArray(error.details.batches)) {
        setMissing(error.details.batches.filter(isMissingBatch))
        void queryClient.invalidateQueries({ queryKey: storeKeys.batches() })
      }
    },
  })

  function addBatch() {
    const item = picker.data?.find((entry) => entry.id === Number(itemId))
    const value = expiryFromValue(expiry)
    if (!item || value === undefined) {
      setAddError(t('assets.store.counts.chooseBatch'))
      return
    }
    const expiryDate = batchExpiryDate(value)
    const key = batchKey(item.id, value)
    if (rowsByKey.has(key)) {
      setAddError(t('assets.store.counts.duplicateBatch'))
      return
    }
    setAdded((previous) => [...previous, {
      item_id: item.id, item_code: item.code, item_name_en: item.name_en, item_name_ar: item.name_ar,
      counting_unit_en: item.counting_unit_en, counting_unit_ar: item.counting_unit_ar,
      contains_qty: item.contains_qty, contains_unit_en: item.contains_unit_en, contains_unit_ar: item.contains_unit_ar,
      expiry_date: expiryDate, expiry_month_only: value?.length === 7, removable: true,
    }])
    setAddError('')
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (mutation.isPending || expected.isPending || expected.error || !validDate || unresolvedMissing) return
    const nextErrors: Record<string, string> = {}
    const lines: StoreCountWrite['lines'] = []
    for (const row of rows) {
      const key = batchKey(row.item_id, row.expiry_date)
      const quantity = quantityFromParts(quantities[key] ?? EMPTY_QUANTITY, row)
      const issue = quantityIssue(quantity, { min: 0 })
      if (quantity === null || issue) nextErrors[key] = t(issue === 'missing' ? 'assets.store.counts.required' : 'assets.store.counts.invalidQuantity')
      else lines.push({ item_id: row.item_id, expiry: expiryInput(row), quantity })
    }
    setErrors(nextErrors)
    const firstError = Object.keys(nextErrors)[0]
    if (firstError) {
      document.getElementById(`quantity-${firstError}`)?.focus()
      return
    }
    mutation.mutate({ counted_on: countedOn, note: note.trim() || null, lines })
  }

  const existingId = mutation.error instanceof ApiError && mutation.error.code === 'STORE_COUNT_MONTH_EXISTS' && typeof mutation.error.details.count_id === 'number' ? mutation.error.details.count_id : null

  return (
    <form onSubmit={submit} noValidate className="flex flex-col gap-5">
      <fieldset disabled={mutation.isPending} className="grid gap-4 rounded-xl border border-border bg-surface p-4 sm:grid-cols-2">
        <div><label htmlFor="counted-on" className="mb-1.5 block text-sm font-medium">{t('assets.store.counts.countedOn')}</label><Input id="counted-on" type="date" dir="ltr" className="h-11 font-mono tabular-nums" value={countedOn} max={todayIso()} required aria-invalid={!validDate || undefined} aria-describedby={!validDate ? 'count-date-error' : undefined} onChange={(event) => { setCountedOn(event.target.value); setMissing([]); mutation.reset() }} />{!validDate && <p id="count-date-error" role="alert" className="mt-1 text-sm text-destructive">{t('assets.store.counts.invalidDate')}</p>}</div>
        <div><label htmlFor="count-note" className="mb-1.5 block text-sm font-medium">{t('assets.store.counts.note')}</label><Textarea id="count-note" dir="auto" value={note} onChange={(event) => setNote(event.target.value)} /></div>
      </fieldset>
      {mutation.error && <div role="alert" className="rounded-xl border border-destructive/40 bg-destructive/5 p-4 text-sm text-destructive"><p>{storeErrorMessage(mutation.error, t)}</p>{existingId !== null && <Link className="mt-2 inline-flex min-h-11 items-center font-medium underline" to={`/holdings/store/counts/${existingId}`}>{t('assets.store.counts.openExisting')}</Link>}</div>}
      <StoreQueryState isPending={validDate && expected.isPending} error={expected.error} onRetry={() => { void expected.refetch() }} isEmpty={validDate && rows.length === 0} emptyIcon={ClipboardList} emptyMessage={t('assets.store.counts.noBatches')} emptyDescription={t('assets.store.counts.noBatchesDescription')}>
        <div className="flex flex-col gap-4">{[...groups.values()].map((batches) => {
          const item = batches[0]
          return <section key={item.item_id} aria-label={itemName(item, i18n.language)} className="overflow-hidden rounded-xl border border-border bg-surface">
            <header className="flex flex-wrap items-center gap-2 border-b border-border bg-surface-raised px-4 py-3"><bdi dir="ltr" className="font-mono text-sm tabular-nums text-muted-foreground">{item.item_code}</bdi><h2 dir="auto" className="font-semibold">{itemName(item, i18n.language)}</h2></header>
            <div className="divide-y divide-border">{batches.map((row) => {
              const key = batchKey(row.item_id, row.expiry_date)
              const value = quantities[key] ?? EMPTY_QUANTITY
              const serverMissing = missing.some((entry) => entry.batch_id === row.batch_id || (entry.item_code === row.item_code && entry.expiry_date === row.expiry_date))
              const error = errors[key] || (serverMissing && !acknowledgedMissing.includes(key) ? t('assets.store.counts.missingBatch') : '')
              const label = `${itemName(row, i18n.language)} · ${formatExpiry(row, t)}`
              return <div key={key} className="grid gap-3 p-4 md:grid-cols-[minmax(10rem,1fr)_minmax(15rem,2fr)_auto] md:items-center">
                <p className="text-sm"><span className="me-2 text-muted-foreground">{t('assets.store.counts.expiry')}</span><ExpiryText batch={row} /></p>
                <div><QuantityInput id={`quantity-${key}`} item={row} label={label} value={value} required invalid={Boolean(error)} describedBy={error ? `error-${key}` : undefined} disabled={mutation.isPending} onChange={(next) => { setQuantities((previous) => ({ ...previous, [key]: next })); setErrors((previous) => ({ ...previous, [key]: '' })); setAcknowledgedMissing((previous) => [...previous, key]) }} />{error && <p id={`error-${key}`} role="alert" className="mt-1 text-sm text-destructive">{error}</p>}</div>
                {row.removable && !serverMissing && <Button type="button" variant="ghost" className="min-h-11" aria-label={t('assets.store.counts.removeBatch', { label })} disabled={mutation.isPending} onClick={() => { setAdded((previous) => previous.filter((entry) => batchKey(entry.item_id, entry.expiry_date) !== key)); setQuantities((previous) => { const next = { ...previous }; delete next[key]; return next }) }}><Trash2 aria-hidden className="h-4 w-4" /><span>{t('assets.store.counts.remove')}</span></Button>}
              </div>
            })}</div>
          </section>
        })}</div>
      </StoreQueryState>
      {unresolvedMissing && <StoreQueryState isPending={missingBatches.isPending} error={missingBatches.error} onRetry={() => { void missingBatches.refetch() }} isEmpty={!missingBatches.isPending && !missingBatches.error} emptyMessage={t('assets.store.counts.missingBatch')} emptyDescription={t('assets.store.counts.refreshMissing')}><span /></StoreQueryState>}
      <fieldset disabled={mutation.isPending} className="flex flex-col gap-3 rounded-xl border border-dashed border-border bg-surface p-4">
        <legend className="px-2 font-semibold">{t('assets.store.counts.addBatch')}</legend>
        <StoreQueryState isPending={picker.isPending} error={picker.error} onRetry={() => { void picker.refetch() }} isEmpty={picker.data?.length === 0} emptyMessage={t('assets.store.counts.noItems')} emptyDescription={t('assets.store.counts.noItemsDescription')}>
          <div className="grid gap-3 md:grid-cols-2">
            <div><label htmlFor="batch-item" className="mb-1.5 block text-sm font-medium">{t('assets.store.counts.item')}</label><select id="batch-item" className="min-h-11 w-full rounded-md border border-input bg-surface px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" value={itemId} onChange={(event) => setItemId(event.target.value)}><option value="">{t('assets.store.counts.chooseItem')}</option>{picker.data?.map((item) => <option key={item.id} value={item.id}>{`\u2066${item.code}\u2069 — ${itemName(item, i18n.language)}`}</option>)}</select></div>
            <ExpiryInput id="new-batch-expiry" value={expiry} onChange={setExpiry} invalid={Boolean(addError)} describedBy={addError ? 'add-batch-error' : undefined} />
          </div>
          {addError && <p id="add-batch-error" role="alert" className="text-sm text-destructive">{addError}</p>}
          <Button type="button" variant="secondary" className="min-h-11 self-start" onClick={addBatch}><Plus aria-hidden className="h-4 w-4" />{t('assets.store.counts.addBatch')}</Button>
        </StoreQueryState>
      </fieldset>
      <div className={mobile ? 'sticky bottom-0 z-10 -mx-4 flex flex-wrap items-center justify-between gap-3 border-t border-border bg-surface px-4 py-3' : 'flex flex-wrap items-center justify-between gap-3 border-t border-border pt-4'}>
        <p role="status" className="text-sm text-muted-foreground">{t('assets.store.counts.progress', { entered: formatNumber(entered, i18n.language), total: formatNumber(rows.length, i18n.language) })}</p>
        <div className="flex gap-2"><Link className={buttonVariants({ variant: 'secondary', className: 'min-h-11' })} to="/holdings/store/counts">{t('assets.store.counts.cancel')}</Link><Button type="submit" className="min-h-11" disabled={mutation.isPending || expected.isPending || Boolean(expected.error) || !validDate || unresolvedMissing}>{t(mutation.isPending ? 'assets.store.counts.saving' : 'assets.store.counts.save')}</Button></div>
      </div>
    </form>
  )
}

