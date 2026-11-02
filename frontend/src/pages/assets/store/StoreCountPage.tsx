import { useEffect, useRef, useState, type FormEvent } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ClipboardList, Plus, Trash2 } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { Link, useNavigate, useParams } from 'react-router-dom'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { api, ApiError, type StoreCountRead, type StoreCountWrite } from '@/lib/api'
import { useAuth } from '@/lib/authContext'
import { toast } from '@/lib/toast'
import { useCapabilities } from '@/lib/useCapabilities'
import { formatNumber } from '@/lib/language'
import { todayIso } from '@/pages/vehicles/vehicleUtils'
import { StoreShell } from './StoreShell'
import { StoreQueryError, StoreQueryState } from './StoreQueryState'
import { ExpiryInput } from './components/ExpiryInput'
import { CountQuantityFields } from './components/CountQuantityFields'
import { StoreItemPicker } from './components/StoreItemPicker'
import { ExpiryText } from './components/ExpiryText'
import { StoreItemSummary } from './components/RecordParts'
import { sortForShelf } from './components/storeShelfModel'
import { storeDisplayName, type StorePresentationItem } from './storePresentation'
import {
  batchExpiryDate, batchKey, categoryName, DEFAULT_EXPIRY,
  EMPTY_QUANTITY, expiryFromValue, expiryInput, formatExpiry, formatQuantity, hasContains,
  invalidateStoreQueries, isBusinessDate, quantityFromParts, quantityIssue,
  type ExpiryValue, type QuantityParts, storeErrorMessage, storeKeys, useStorePickerItems,
} from './storeUtils'
import {
  clearCountDraft, countDraftChanged, countDraftKey, countedQuantity, emptyCountDraft, readCountDraft, readCountDraftDate,
  reconcileCountDraft, selectCountDraftDate, writeCountDraft, type CountBatch, type CountDraft, type DraftStorageResult,
} from './storeCountDraft'

interface MissingBatch { batch_id: number; item_code: string; expiry_date: string | null }
function isMissingBatch(value: unknown): value is MissingBatch {
  return typeof value === 'object' && value !== null && 'batch_id' in value && typeof value.batch_id === 'number'
    && 'item_code' in value && typeof value.item_code === 'string' && 'expiry_date' in value
    && (value.expiry_date === null || typeof value.expiry_date === 'string')
}

/** Whitelist identity only: never carry saved quantity or batch on-hand into entry state. */
function countMetadata(row: CountBatch & StorePresentationItem): CountBatch {
  return {
    item_id: row.item_id, item_code: row.item_code, item_name_en: row.item_name_en, item_name_ar: row.item_name_ar,
    counting_unit_en: row.counting_unit_en, counting_unit_ar: row.counting_unit_ar,
    contains_qty: row.contains_qty, contains_unit_en: row.contains_unit_en, contains_unit_ar: row.contains_unit_ar,
    art_kind: row.art_kind, art_color: row.art_color, expiry_date: row.expiry_date,
    expiry_month_only: row.expiry_month_only, batch_id: row.batch_id,
    ...presentation(row),
  }
}
function presentation(row: StorePresentationItem) {
  return {
    brand_label: row.brand_label, generic_label_en: row.generic_label_en, generic_label_ar: row.generic_label_ar,
    short_name_en: row.short_name_en, short_name_ar: row.short_name_ar,
    pack_description_en: row.pack_description_en, pack_description_ar: row.pack_description_ar,
  }
}

export function StoreCountPage(): React.JSX.Element {
  const { id } = useParams()
  const { t } = useTranslation()
  const { user } = useAuth()
  const editable = useCapabilities().has('store.edit')
  const countId = id === undefined ? null : Number(id)
  const count = useQuery({ queryKey: storeKeys.count(countId ?? 0), queryFn: () => api.getStoreCount(countId!), enabled: countId !== null && editable })
  // A failed background refresh keeps the cached count: replacing the form would discard every entry.
  const cached = count.data !== undefined

  return <StoreShell title={t(countId === null ? 'assets.store.counts.new' : 'assets.store.counts.edit')} description={t('assets.store.counts.focusInstruction')}>
    {!editable || !user ? <p role="alert">{t('assets.store.counts.readOnly')}</p> : <StoreQueryState isPending={countId !== null && count.isPending} error={cached ? null : count.error} onRetry={() => { void count.refetch() }} isEmpty={false} emptyMessage="" emptyDescription="">
      {cached && count.error && <StoreQueryError error={count.error} onRetry={() => { void count.refetch() }} />}
      <CountForm key={`${user.id}:${countId ?? 'new'}`} userId={user.id} target={countId === null ? 'new' : `edit-${countId}`} saved={count.data} />
    </StoreQueryState>}
  </StoreShell>
}

function CountForm({ userId, target, saved }: { userId: number; target: string; saved?: StoreCountRead }) {
  const [date, setDate] = useState(() => readCountDraftDate(userId, target, saved?.counted_on ?? todayIso()))
  return <CountWorkspace key={date} userId={userId} target={target} saved={saved} countedOn={date} onDateChange={setDate} />
}

function CountWorkspace({ userId, target, saved, countedOn, onDateChange }: { userId: number; target: string; saved?: StoreCountRead; countedOn: string; onDateChange: (date: string) => void }): React.JSX.Element {
  const { t, i18n } = useTranslation()
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const [initial] = useState(() => readCountDraft(userId, target, countedOn))
  const [draft, setDraft] = useState(initial.draft)
  const draftRef = useRef(draft)
  const persistedDraftRef = useRef(initial.draft)
  const [storageFailed, setStorageFailed] = useState(initial.failed)
  const [draftSaved, setDraftSaved] = useState(initial.restored)
  const [draftConflict, setDraftConflict] = useState(false)
  const conflictRef = useRef(false)
  const savingRef = useRef(false)
  const [savePending, setSavePending] = useState(false)
  const lastWriteRef = useRef<Promise<DraftStorageResult>>(Promise.resolve('saved'))
  const snapshotRef = useRef({ value: initial.snapshot.value })
  const [stage, setStage] = useState<'start' | 'count' | 'review'>(initial.draft.started ? 'count' : 'start')
  const [confirmed, setConfirmed] = useState(false)
  const [missing, setMissing] = useState<MissingBatch[]>([])
  const [acknowledgedMissing, setAcknowledgedMissing] = useState<string[]>([])
  const [itemId, setItemId] = useState<number | null>(null)
  const [expiry, setExpiry] = useState<ExpiryValue>(DEFAULT_EXPIRY)
  const [addError, setAddError] = useState('')
  const [focusRequest, setFocusRequest] = useState<{ key: string } | null>(null)
  const [reconciledKeys, setReconciledKeys] = useState<string | null>(null)
  const [discarding, setDiscarding] = useState(false)
  const discardTriggerRef = useRef<HTMLButtonElement | null>(null)
  const discardTitleRef = useRef<HTMLHeadingElement | null>(null)
  const reviewTitleRef = useRef<HTMLHeadingElement | null>(null)
  const validDate = isBusinessDate(countedOn)
  const expected = useQuery({ queryKey: storeKeys.expected(countedOn), queryFn: () => api.getStoreCountExpected(countedOn), enabled: validDate })
  const picker = useStorePickerItems()
  const items = useQuery({ queryKey: storeKeys.items(false), queryFn: () => api.listStoreItems() })
  const categories = useQuery({ queryKey: storeKeys.categories, queryFn: api.listStoreCategories })
  const missingBatches = useQuery({ queryKey: storeKeys.batches(), queryFn: () => api.listStoreBatches(), enabled: missing.length > 0 })

  function markDraftConflict() {
    conflictRef.current = true
    setDraftConflict(true)
    setConfirmed(false)
  }
  function checkDraftConflict() {
    if (initial.volatile) return false
    if (!conflictRef.current && !countDraftChanged(userId, target, countedOn, snapshotRef.current)) return false
    markDraftConflict()
    return true
  }
  function canEdit() {
    return !savingRef.current && !checkDraftConflict()
  }
  function blockChanges(event: React.SyntheticEvent) {
    if (canEdit()) return
    event.preventDefault()
    event.stopPropagation()
  }
  function persist(next: CountDraft) {
    persistedDraftRef.current = next
    const pending = writeCountDraft(userId, target, countedOn, next, snapshotRef.current).then(result => {
      if (result === 'conflict') markDraftConflict()
      else {
        setStorageFailed(result === 'failed')
        setDraftSaved(result === 'saved')
      }
      return result
    })
    lastWriteRef.current = pending
    return pending
  }
  function changeDraft(next: CountDraft) {
    if (!canEdit()) return
    draftRef.current = next
    setDraft(next)
    void persist(next)
    setConfirmed(false)
  }
  function unlockControls() {
    savingRef.current = false
    setSavePending(false)
  }

  const rowsByKey = new Map<string, CountBatch>()
  const savedRows = saved?.counted_on === countedOn ? saved.lines : []
  for (const row of [...(expected.data ?? []), ...savedRows]) {
    const key = batchKey(row.item_id, row.expiry_date)
    if (!rowsByKey.has(key)) rowsByKey.set(key, countMetadata(row))
  }
  for (const added of draft.added) {
    const item = picker.data?.find(entry => entry.id === added.itemId)
    if (!item) continue
    const key = batchKey(item.id, added.expiry)
    if (!rowsByKey.has(key)) rowsByKey.set(key, {
      item_id: item.id, item_code: item.code, item_name_en: item.name_en, item_name_ar: item.name_ar,
      counting_unit_en: item.counting_unit_en, counting_unit_ar: item.counting_unit_ar,
      contains_qty: item.contains_qty, contains_unit_en: item.contains_unit_en, contains_unit_ar: item.contains_unit_ar,
      art_kind: item.art_kind, art_color: item.art_color, ...presentation(item),
      expiry_date: batchExpiryDate(added.expiry), expiry_month_only: added.expiry?.length === 7, removable: true,
    })
  }
  for (const batch of missingBatches.data ?? []) {
    if (!missing.some(entry => entry.batch_id === batch.id)) continue
    const key = batchKey(batch.item_id, batch.expiry_date)
    if (!rowsByKey.has(key)) rowsByKey.set(key, countMetadata({ ...batch, batch_id: batch.id }))
  }
  const shelf = sortForShelf(items.data ?? [], i18n.language)
  const shelfRank = new Map(shelf.map((item, index) => [item.id, index]))
  const categoryRank = new Map((categories.data ?? []).map((category, index) => [category.id, index]))
  const itemById = new Map((items.data ?? []).map(item => [item.id, item]))
  const rows = [...rowsByKey.values()].sort((a, b) => {
    const aCat = itemById.get(a.item_id)?.category_id
    const bCat = itemById.get(b.item_id)?.category_id
    return (categoryRank.get(aCat ?? -1) ?? 999) - (categoryRank.get(bCat ?? -1) ?? 999)
      || (shelfRank.get(a.item_id) ?? 999) - (shelfRank.get(b.item_id) ?? 999)
      || a.item_id - b.item_id || (a.expiry_date ?? '9999').localeCompare(b.expiry_date ?? '9999')
  })
  const groups = new Map<number, CountBatch[]>()
  for (const row of rows) groups.set(row.item_id, [...(groups.get(row.item_id) ?? []), row])
  const itemIds = [...groups.keys()]
  const focusedId = draft.focusedItem !== null && groups.has(draft.focusedItem) ? draft.focusedItem : itemIds[0]
  const focused = groups.get(focusedId) ?? []
  const focusedIndex = itemIds.indexOf(focusedId)
  const unresolvedMissing = missing.some(entry => !rows.some(row => row.batch_id === entry.batch_id || (row.item_code === entry.item_code && row.expiry_date === entry.expiry_date)))
  const serverMissing = (row: CountBatch) => missing.some(entry => entry.batch_id === row.batch_id || (row.item_code === entry.item_code && row.expiry_date === entry.expiry_date)) && !acknowledgedMissing.includes(batchKey(row.item_id, row.expiry_date))
  const isCounted = (row: CountBatch) => countedQuantity(row, draft.quantities[batchKey(row.item_id, row.expiry_date)]) !== null && !serverMissing(row)
  const uncounted = rows.filter(row => !isCounted(row))
  const entered = rows.length - uncounted.length
  const ready = validDate && expected.isSuccess && picker.isSuccess && items.isSuccess && categories.isSuccess

  const rowKeys = rows.map(row => batchKey(row.item_id, row.expiry_date)).join('|')
  // Adjust derived membership before rendering. A temporarily pending refetch must
  // never erase an operator's work; only a complete metadata response reconciles it.
  if (ready && !savingRef.current && !draftConflict && rowKeys !== reconciledKeys) {
    setReconciledKeys(rowKeys)
    const next = reconcileCountDraft(draft, rows)
    if (next !== draft) setDraft(next)
  }

  useEffect(() => {
    // The persisted snapshot starts from the unmodified restored draft, not the
    // render-adjusted draft: initial metadata reconciliation must reach storage too.
    draftRef.current = draft
    if (persistedDraftRef.current === draft || savingRef.current || conflictRef.current) return
    void persist(draft)
  }, [draft, userId, target, countedOn])

  useEffect(() => {
    if (initial.volatile) return
    const key = countDraftKey(userId, target, countedOn)
    function check() { checkDraftConflict() }
    function changed(event: StorageEvent) {
      if (event.key === null || event.key === key) check()
    }
    window.addEventListener('storage', changed)
    window.addEventListener('focus', check)
    document.addEventListener('visibilitychange', check)
    return () => {
      window.removeEventListener('storage', changed)
      window.removeEventListener('focus', check)
      document.removeEventListener('visibilitychange', check)
    }
  }, [userId, target, countedOn, initial])

  useEffect(() => {
    if (stage !== 'count' || !focusRequest) return
    document.getElementById(`quantity-${focusRequest.key}`)?.focus()
  }, [stage, focusedId, focusRequest])

  useEffect(() => {
    if (stage === 'review') reviewTitleRef.current?.focus()
  }, [stage])

  useEffect(() => {
    if (discarding) discardTitleRef.current?.focus()
  }, [discarding])

  useEffect(() => {
    if (!storageFailed) return
    function warn(event: BeforeUnloadEvent) {
      event.preventDefault()
      event.returnValue = ''
    }
    function protectDraft(event: MouseEvent) {
      if (!(event.target instanceof Element)) return
      const link = event.target.closest('a[href]')
      if (!link) return
      event.preventDefault()
      event.stopPropagation()
    }
    window.addEventListener('beforeunload', warn)
    document.addEventListener('click', protectDraft, true)
    return () => {
      window.removeEventListener('beforeunload', warn)
      document.removeEventListener('click', protectDraft, true)
    }
  }, [storageFailed])

  const mutation = useMutation({
    mutationFn: (body: StoreCountWrite) => saved ? api.updateStoreCount(saved.id, body) : api.createStoreCount(body),
    onSuccess: async () => {
      await lastWriteRef.current
      const cleared = initial.volatile ? 'failed' : conflictRef.current ? 'conflict' : await clearCountDraft(userId, target, countedOn, snapshotRef.current)
      invalidateStoreQueries(queryClient)
      toast.success(t('assets.store.counts.saved'))
      if (cleared !== 'saved') toast.error(t(initial.volatile ? 'assets.store.counts.volatileSaved' : cleared === 'conflict' ? 'assets.store.counts.draftConflict' : 'assets.store.counts.clearFailed'))
      void navigate('/holdings/store/counts')
    },
    onError: error => {
      setConfirmed(false)
      if (error instanceof ApiError && error.code === 'STORE_COUNT_MISSING_BATCHES' && Array.isArray(error.details.batches)) {
        setAcknowledgedMissing([])
        setMissing(error.details.batches.filter(isMissingBatch))
        void queryClient.invalidateQueries({ queryKey: storeKeys.batches() })
        void queryClient.invalidateQueries({ queryKey: storeKeys.expected(countedOn) })
      }
    },
    onSettled: unlockControls,
  })

  function chooseItem(next: number, key?: string) {
    if (!canEdit()) return
    changeDraft({ ...draftRef.current, started: true, focusedItem: next })
    setStage('count')
    setFocusRequest({ key: key ?? batchKey(groups.get(next)?.[0]?.item_id ?? next, groups.get(next)?.[0]?.expiry_date ?? null) })
    setAddError('')
  }
  function setQuantity(row: CountBatch, value: QuantityParts) {
    if (!canEdit()) return
    const key = batchKey(row.item_id, row.expiry_date)
    changeDraft({ ...draftRef.current, quantities: { ...draftRef.current.quantities, [key]: value } })
    setAcknowledgedMissing(previous => [...previous, key])
  }
  function addBatch(selectedId: number | null) {
    if (!canEdit()) return
    const value = expiryFromValue(expiry)
    const item = picker.data?.find(entry => entry.id === selectedId)
    if (!item || value === undefined) { setAddError(t('assets.store.counts.chooseBatch')); return }
    const key = batchKey(item.id, value)
    if (rowsByKey.has(key)) { setAddError(t('assets.store.counts.duplicateBatch')); return }
    changeDraft({ ...draftRef.current, started: true, focusedItem: item.id, added: [...draftRef.current.added, { itemId: item.id, expiry: value }] })
    setAddError('')
    setStage('count')
    setFocusRequest({ key })
  }
  function removeBatch(row: CountBatch) {
    if (!canEdit()) return
    const key = batchKey(row.item_id, row.expiry_date)
    const quantities = { ...draftRef.current.quantities }
    delete quantities[key]
    changeDraft({ ...draftRef.current, quantities, added: draftRef.current.added.filter(entry => batchKey(entry.itemId, entry.expiry) !== key) })
  }
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!canEdit() || stage !== 'review' || !confirmed || !ready || uncounted.length || unresolvedMissing) return
    savingRef.current = true
    setSavePending(true)
    await lastWriteRef.current
    if (checkDraftConflict()) { unlockControls(); return }
    const lines: StoreCountWrite['lines'] = rows.map(row => ({ item_id: row.item_id, expiry: expiryInput(row), quantity: countedQuantity(row, draft.quantities[batchKey(row.item_id, row.expiry_date)])! }))
    mutation.mutate({ counted_on: countedOn, note: draft.note.trim() || null, lines })
  }
  async function exit() {
    if (!canEdit()) return
    savingRef.current = true
    setSavePending(true)
    const result = await persist(draftRef.current)
    if (result === 'saved') void navigate('/holdings/store/counts')
    unlockControls()
  }
  async function discard() {
    if (!canEdit()) return
    savingRef.current = true
    setSavePending(true)
    await lastWriteRef.current
    const cleared = initial.volatile ? 'saved' : await clearCountDraft(userId, target, countedOn, snapshotRef.current)
    unlockControls()
    if (cleared === 'conflict') { markDraftConflict(); return }
    if (cleared === 'failed') { setStorageFailed(true); return }
    const next = emptyCountDraft()
    draftRef.current = next
    persistedDraftRef.current = next
    setDraft(next)
    setDraftSaved(false)
    setStorageFailed(false)
    setDiscarding(false)
    setConfirmed(false)
    setStage('start')
    setMissing([])
    mutation.reset()
    discardTriggerRef.current?.focus()
  }
  const existingId = mutation.error instanceof ApiError && mutation.error.code === 'STORE_COUNT_MONTH_EXISTS' && typeof mutation.error.details.count_id === 'number' ? mutation.error.details.count_id : null
  const panel = 'rounded-2xl border border-border bg-surface p-4 md:p-5'
  const progress = t('assets.store.counts.batchProgress', { entered: formatNumber(entered, i18n.language), total: formatNumber(rows.length, i18n.language) })
  const storageStatus = <p role={draftConflict || initial.volatile || storageFailed ? 'alert' : 'status'} className={`text-sm ${draftConflict || initial.volatile || storageFailed ? 'text-destructive-text' : 'text-muted-foreground'}`}>{t(draftConflict ? 'assets.store.counts.draftConflict' : initial.volatile ? 'assets.store.counts.volatileDraft' : storageFailed ? 'assets.store.counts.storageFailed' : draftSaved ? 'assets.store.counts.draftSaved' : 'assets.store.counts.deviceDraft')}</p>
  function enteredSummary(row: CountBatch) {
    const parts = draft.quantities[batchKey(row.item_id, row.expiry_date)]
    if (!isCounted(row) || !parts) return t('assets.store.counts.notCounted')
    return <bdi dir="auto">{formatQuantity(countedQuantity(row, parts)!, row, i18n.language)}</bdi>
  }
  function reviewRow(row: CountBatch) {
    const key = batchKey(row.item_id, row.expiry_date)
    return <button type="button" key={key} className="flex w-full flex-wrap items-center justify-between gap-3 rounded-xl border border-border p-3 text-start hover:bg-surface-tinted focus-visible:ring-2 focus-visible:ring-ring" onClick={() => chooseItem(row.item_id, key)}>
      <span className="min-w-0 flex-1"><StoreItemSummary item={row} size={64} /><span className="mt-2 block text-sm">{t('assets.store.counts.expiry')}: <ExpiryText batch={row} /></span><span className={`mt-1 block text-sm ${isCounted(row) ? 'font-semibold' : 'text-warning'}`}>{enteredSummary(row)}</span></span><span className="text-sm underline">{t(isCounted(row) ? 'assets.store.counts.editEntry' : 'assets.store.counts.countBatch')}</span>
    </button>
  }

  return <form onSubmit={submit} noValidate className="flex flex-col gap-5">
    <fieldset disabled={savePending || mutation.isPending || draftConflict} className="m-0 flex min-w-0 flex-col gap-5 border-0 p-0" onClickCapture={blockChanges} onChangeCapture={blockChanges}>
    <fieldset disabled={mutation.isPending} className={`${panel} grid gap-4 md:grid-cols-2`}>
      <div>
        <label htmlFor="counted-on" className="mb-1.5 block text-sm font-medium">{t('assets.store.counts.countedOn')}</label>
        <Input id="counted-on" type="date" dir="ltr" className="h-11 font-mono tabular-nums" value={countedOn} max={todayIso()} required aria-invalid={!validDate || undefined} aria-describedby="count-date-help" onChange={event => {
          if (!canEdit() || storageFailed && !initial.volatile) return
          const nextDate = event.target.value
          if (!initial.volatile && isBusinessDate(nextDate) && !selectCountDraftDate(userId, target, nextDate)) {
            setStorageFailed(true)
            return
          }
          onDateChange(nextDate)
        }} />
        <p id="count-date-help" className={`mt-2 text-sm ${validDate ? 'text-muted-foreground' : 'text-destructive-text'}`}>{t(validDate ? 'assets.store.counts.dateDraftHelp' : 'assets.store.counts.invalidDate')}</p>
      </div>
      <div><label htmlFor="count-note" className="mb-1.5 block text-sm font-medium">{t('assets.store.counts.optionalNote')}</label><Textarea id="count-note" dir="auto" value={draft.note} onChange={event => changeDraft({ ...draftRef.current, note: event.target.value })} /></div>
    </fieldset>
    {storageStatus}
    {mutation.error && <div role="alert" className="rounded-2xl border border-destructive/40 bg-accent-soft p-4 text-sm text-destructive-text"><p>{storeErrorMessage(mutation.error)}</p>{existingId !== null && <Link className="mt-2 inline-flex min-h-11 items-center font-medium underline" to={`/holdings/store/counts/${existingId}`}>{t('assets.store.counts.openExisting')}</Link>}</div>}
    <StoreQueryState isPending={validDate && (expected.isPending || picker.isPending || items.isPending || categories.isPending)} error={expected.error || picker.error || items.error || categories.error} onRetry={() => { void expected.refetch(); void picker.refetch(); void items.refetch(); void categories.refetch() }} isEmpty={false} emptyMessage="" emptyDescription="">
      {validDate && <>
        <div className={panel}><p role="status" className="font-semibold">{progress}</p><progress aria-label={t('assets.store.counts.batchesCounted')} value={entered} max={Math.max(1, rows.length)} className="mt-3 h-2 w-full accent-primary" /><p className="mt-2 text-sm text-muted-foreground">{t('assets.store.counts.itemProgress', { current: formatNumber(focusedIndex + 1, i18n.language), total: formatNumber(itemIds.length, i18n.language) })}</p></div>
        {stage === 'start' ? <section className={`${panel} space-y-4`}>
          <h2 className="text-lg font-semibold">{t('assets.store.counts.beforeBegin')}</h2>
          <ol className="list-decimal space-y-3 ps-5 text-sm">
            <li>{t('assets.store.counts.guideDate')}</li>
            <li>{t('assets.store.counts.guideBatches')}</li>
            <li>{t('assets.store.counts.guideZero')}</li>
            <li>{t('assets.store.counts.guideReview')}</li>
          </ol>
          <Button type="button" className="min-h-11" disabled={!ready} onClick={() => { changeDraft({ ...draftRef.current, started: true }); setStage('count') }}>{t(draftSaved ? 'assets.store.counts.resume' : 'assets.store.counts.start')}</Button>
        </section> : stage === 'review' ? <>
          <section className={`${panel} space-y-3`}><div className="flex flex-wrap items-center justify-between gap-3"><h2 ref={reviewTitleRef} tabIndex={-1} className="text-lg font-semibold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">{t('assets.store.counts.reviewTitle')}</h2><Button type="button" variant="secondary" className="min-h-11" onClick={() => setStage('count')}>{t('assets.store.counts.continue')}</Button></div><p className="text-sm text-muted-foreground">{t('assets.store.counts.reviewOnlyEntered')}</p></section>
          {(uncounted.length > 0 || unresolvedMissing) && <section className={`${panel} space-y-3`} aria-labelledby="missing-heading"><h2 id="missing-heading" className="font-semibold">{t('assets.store.counts.stillToCount', { count: uncounted.length })}</h2><p className="text-sm text-muted-foreground">{t('assets.store.counts.missingInstruction')}</p>{uncounted.map(reviewRow)}{unresolvedMissing && <StoreQueryState isPending={missingBatches.isPending} error={missingBatches.error} onRetry={() => { void missingBatches.refetch() }} isEmpty={!missingBatches.isPending && !missingBatches.error} emptyMessage={t('assets.store.counts.missingBatch')} emptyDescription={t('assets.store.counts.refreshMissing')}><span /></StoreQueryState>}</section>}
          <section className={`${panel} space-y-3`} aria-labelledby="entered-heading"><h2 id="entered-heading" className="font-semibold">{t('assets.store.counts.enteredTitle')}</h2>{rows.filter(isCounted).map(reviewRow)}{!entered && <p className="text-sm text-muted-foreground">{t('assets.store.counts.noEntered')}</p>}</section>
          <section className={`${panel} space-y-4`}><label className="flex min-h-11 items-center gap-3 text-sm"><input type="checkbox" checked={confirmed} disabled={uncounted.length > 0 || unresolvedMissing || mutation.isPending} onChange={event => setConfirmed(event.target.checked)} className="h-5 w-5 accent-primary" />{t('assets.store.counts.confirmReview')}</label><Button type="submit" className="min-h-11" disabled={!confirmed || !ready || uncounted.length > 0 || unresolvedMissing || mutation.isPending}>{t(mutation.isPending ? 'assets.store.counts.saving' : 'assets.store.counts.save')}</Button></section>
        </> : <div className="grid items-start gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(16em,22em)]">
          <section className={`${panel} min-w-0 space-y-4`} aria-label={t('assets.store.counts.focusedItem')}>
            {focused.length ? <><h2><StoreItemSummary item={focused[0]} size={112} showCode /></h2><p className="text-sm text-muted-foreground">{t(hasContains(focused[0]) ? 'assets.store.counts.bothFields' : 'assets.store.counts.wholeUnits')}</p>{focused.map(row => {
              const key = batchKey(row.item_id, row.expiry_date)
              const value = draft.quantities[key] ?? EMPTY_QUANTITY
              const rawQuantity = quantityFromParts(value, row)
              const invalid = rawQuantity !== null && quantityIssue(rawQuantity, { min: 0 }) !== null
              const label = `${storeDisplayName(row, i18n.language)} · ${formatExpiry(row, t)}`
              return <section key={key} className="space-y-3 rounded-xl border border-border bg-surface-raised p-4">
                <div className="flex flex-wrap justify-between gap-2 text-sm">
                  <h3 className="font-semibold">{t('assets.store.counts.expiry')}: <ExpiryText batch={row} /></h3>
                  <span className={`rounded-full px-2 py-1 text-xs ${isCounted(row) ? 'bg-success-soft text-success' : 'bg-warning-soft text-warning'}`}>{t(isCounted(row) ? 'assets.store.counts.counted' : 'assets.store.counts.notCounted')}</span>
                </div>
                <CountQuantityFields id={`quantity-${key}`} item={row} label={label} value={value} invalid={invalid || serverMissing(row)} describedBy={`summary-${key}`} disabled={mutation.isPending} onChange={next => setQuantity(row, next)} />
                <Button type="button" variant="secondary" className="min-h-11" onClick={() => setQuantity(row, { units: '0', loose: hasContains(row) ? '0' : '' })}>{t('assets.store.counts.countedNone')}</Button>
                <p id={`summary-${key}`} role="status" className={`text-sm ${invalid ? 'text-destructive-text' : 'text-muted-foreground'}`}>{invalid ? t('assets.store.counts.invalidQuantity') : isCounted(row) ? enteredSummary(row) : t('assets.store.counts.blankNotZero')}</p>
                {row.removable && !serverMissing(row) && <Button type="button" variant="ghost" className="min-h-11" aria-label={t('assets.store.counts.removeBatch', { label })} onClick={() => removeBatch(row)}><Trash2 aria-hidden className="h-4 w-4" />{t('assets.store.counts.remove')}</Button>}
              </section>
            })}<details className="rounded-xl border border-dashed border-border p-4"><summary className="cursor-pointer py-2 text-sm font-medium">{t('assets.store.counts.foundExpiry')}</summary><div className="mt-3 space-y-3"><p className="text-sm text-muted-foreground">{t('assets.store.counts.addBlankHelp')}</p><ExpiryInput id="new-batch-expiry" value={expiry} onChange={setExpiry} invalid={Boolean(addError)} describedBy={addError ? 'add-batch-error' : undefined} /><Button type="button" variant="secondary" className="min-h-11" onClick={() => addBatch(focusedId)}><Plus aria-hidden className="h-4 w-4" />{t('assets.store.counts.addBatch')}</Button></div></details></> : <div className="space-y-3"><ClipboardList aria-hidden className="h-8 w-8 text-muted-foreground" /><h2 className="font-semibold">{t('assets.store.counts.noBatches')}</h2><p className="text-sm text-muted-foreground">{t('assets.store.counts.noBatchesDescription')}</p></div>}
            {addError && <p id="add-batch-error" role="alert" className="text-sm text-destructive-text">{addError}</p>}
            <div className="flex flex-wrap justify-between gap-3 border-t border-border pt-4">
              <Button type="button" variant="secondary" className="min-h-11" disabled={focusedIndex <= 0} onClick={() => chooseItem(itemIds[focusedIndex - 1])}>{t('assets.store.counts.previous')}</Button>
              <div className="flex flex-wrap gap-2">
                <Button type="button" variant="ghost" className="min-h-11" onClick={() => focusedIndex < itemIds.length - 1 ? chooseItem(itemIds[focusedIndex + 1]) : setStage('review')}>{t('assets.store.counts.skip')}</Button>
                <Button type="button" className="min-h-11" onClick={() => focusedIndex < itemIds.length - 1 ? chooseItem(itemIds[focusedIndex + 1]) : setStage('review')}>{t(focusedIndex < itemIds.length - 1 ? 'assets.store.counts.next' : 'assets.store.counts.reviewAll')}</Button>
              </div>
            </div>
          </section>
          <aside className={`${panel} space-y-3`} aria-label={t('assets.store.counts.navigator')}><h2 className="font-semibold">{t('assets.store.counts.navigator')}</h2>{itemIds.map((currentId, index) => {
            const batches = groups.get(currentId)!
            const item = itemById.get(currentId)
            const previous = itemById.get(itemIds[index - 1])
            const category = item?.category
            return <div key={currentId}>{category && category.id !== previous?.category_id && <h3 className="mb-2 mt-4 text-sm font-semibold text-muted-foreground">{categoryName(category, i18n.language)}</h3>}<button type="button" aria-current={currentId === focusedId ? 'step' : undefined} className={`w-full rounded-xl border p-3 text-start hover:bg-surface-tinted focus-visible:ring-2 focus-visible:ring-ring ${currentId === focusedId ? 'border-primary bg-primary-soft' : 'border-border'}`} onClick={() => chooseItem(currentId)}><StoreItemSummary item={batches[0]} size={56} /><span className="mt-2 block text-xs text-muted-foreground">{t('assets.store.counts.batchProgress', { entered: formatNumber(batches.filter(isCounted).length, i18n.language), total: formatNumber(batches.length, i18n.language) })}</span></button></div>
          })}</aside>
        </div>}
        {stage !== 'review' && <details className={`${panel} space-y-3`}><summary className="cursor-pointer py-2 text-sm font-medium">{t('assets.store.counts.foundItem')}</summary><div className="mt-3 grid gap-3 md:grid-cols-2"><div><label htmlFor="batch-item" className="mb-1.5 block text-sm font-medium">{t('assets.store.counts.item')}</label><StoreItemPicker id="batch-item" value={itemId} onChange={next => setItemId(next?.id ?? null)} placeholder={t('assets.store.counts.chooseItem')} /></div><ExpiryInput id="other-batch-expiry" value={expiry} onChange={setExpiry} /></div><Button type="button" variant="secondary" className="mt-3 min-h-11" onClick={() => addBatch(itemId)}>{t('assets.store.counts.addBatch')}</Button></details>}
      </>}
    </StoreQueryState>
    <p className="rounded-2xl border border-border bg-primary-soft p-4 text-sm text-primary-text">{t('assets.store.counts.blindRule')}</p>
    <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border pt-4">
      <Button type="button" variant="secondary" className="min-h-11" disabled={mutation.isPending} onClick={exit}>{t('assets.store.counts.saveExit')}</Button>
      <div className="flex flex-wrap gap-2">
        <Button ref={discardTriggerRef} type="button" variant="ghost" className="min-h-11" disabled={mutation.isPending} onClick={() => setDiscarding(true)}>{t('assets.store.counts.discard')}</Button>
        {stage !== 'review' && <Button type="button" className="min-h-11" disabled={!ready} onClick={() => { setConfirmed(false); setStage('review') }}>{t('assets.store.counts.review')}</Button>}
      </div>
    </div>
    {discarding && <section role="alertdialog" aria-modal="false" aria-labelledby="discard-title" aria-describedby="discard-description" className={`${panel} space-y-3`} onKeyDown={event => {
      if (event.key !== 'Escape') return
      event.preventDefault()
      setDiscarding(false)
      discardTriggerRef.current?.focus()
    }}>
      <h2 ref={discardTitleRef} id="discard-title" tabIndex={-1} className="font-semibold">{t('assets.store.counts.discardTitle')}</h2>
      <p id="discard-description" className="text-sm">{t('assets.store.counts.discardDescription')}</p>
      <div className="flex gap-3">
        <Button type="button" variant="destructive" className="min-h-11" onClick={discard}>{t('assets.store.counts.discardConfirm')}</Button>
        <Button type="button" variant="secondary" className="min-h-11" onClick={() => { setDiscarding(false); discardTriggerRef.current?.focus() }}>{t('assets.store.counts.keepDraft')}</Button>
      </div>
    </section>}
    </fieldset>
    {draftConflict && <Button type="button" variant="secondary" className="min-h-11" disabled={savePending || mutation.isPending} onClick={() => window.location.reload()}>{t('assets.store.counts.reloadDraft')}</Button>}
  </form>
}
