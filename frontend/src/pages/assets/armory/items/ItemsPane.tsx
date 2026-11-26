import { ChevronRight, PackagePlus, Plus, Search, X } from 'lucide-react'
import { type RefObject, useId, useLayoutEffect, useRef, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import type { ArmoryItemFilters, ArmoryItemRead, ArmorySafeRead, ArmoryStockTotals } from '@/lib/api'
import { useDebouncedValue } from '@/lib/useDebouncedValue'
import { Ltr } from '../ArmoryLtr'
import { useArmoryLocale } from '../armoryFormat'
import { armoryErrorMessage, useArmoryAccess, useArmoryItems, useArmorySummary } from '../armoryQueries'
import { patchArmoryParams, readArmoryId } from '../armoryUrl'
import { ArmoryArt } from './ArmoryArt'
import { ItemDetail } from './ItemDetail'
import type { ReceivePreset } from './intakeTypes'

interface ItemsPaneProps {
  safeId: number | null
  safes: ArmorySafeRead[]
  onAddItem(opener: HTMLElement): void
  onReceive(opener: HTMLElement, preset?: ReceivePreset): void
}

const CATEGORIES = ['firearms', 'ammo', 'accessories', 'nonlethal', 'restraints', 'riot', 'comms'] as const satisfies readonly ArmoryItemRead['category'][]
const STOCK_COLUMNS = [
  ['in_safe', 'inSafe'], ['out_on_shift', 'onShift'], ['in_custody', 'inCustody'], ['in_repair', 'inRepair'],
] as const

export function ItemsPane(props: ItemsPaneProps) {
  const { canView, principal } = useArmoryAccess()
  return canView && principal !== null ? <ItemsWorkspace key={principal} {...props} /> : null
}

function ItemsWorkspace({ safeId, safes, onAddItem, onReceive }: ItemsPaneProps) {
  const [params] = useSearchParams()
  const itemId = readArmoryId(params, 'item')
  const [category, setCategory] = useState<ArmoryItemFilters['category']>()
  const [stockView, setStockView] = useState<NonNullable<ArmoryItemFilters['stock_view']>>('all')
  const [search, setSearch] = useState('')
  const q = useDebouncedValue(search, 250).trim()
  const returnItemRef = useRef<number | null>(null)

  useLayoutEffect(() => {
    if (itemId !== null) returnItemRef.current = itemId
  }, [itemId])

  return itemId === null ? <Catalogue
    safeId={safeId} safes={safes} onAddItem={onAddItem} onReceive={onReceive}
    filters={{ ...(safeId === null ? {} : { safe_id: safeId }), ...(category ? { category } : {}), ...(q && search.trim() ? { q } : {}), stock_view: stockView }}
    search={search} onSearch={setSearch} onCategory={setCategory} onStockView={setStockView} returnItemRef={returnItemRef}
  /> : <ItemDetail key={`${itemId}:${safeId ?? 'all'}`} itemId={itemId} safeId={safeId} safes={safes} onReceive={onReceive} />
}

interface CatalogueProps extends ItemsPaneProps {
  filters: ArmoryItemFilters
  search: string
  onSearch(value: string): void
  onCategory(value: ArmoryItemFilters['category']): void
  onStockView(value: NonNullable<ArmoryItemFilters['stock_view']>): void
  returnItemRef: RefObject<number | null>
}

function Catalogue({ safeId, safes, onAddItem, onReceive, filters, search, onSearch, onCategory, onStockView, returnItemRef }: CatalogueProps) {
  const { canEdit } = useArmoryAccess()
  const { t, isAr, name } = useArmoryLocale()
  const [params] = useSearchParams()
  const items = useArmoryItems(filters)
  const summary = useArmorySummary(safeId)
  const list = useRef<HTMLTableElement>(null)
  const searchInput = useRef<HTMLInputElement>(null)
  const headingId = useId()
  const { data, isError } = items
  const grouped = new Map<ArmoryItemRead['category'], ArmoryItemRead[]>()
  for (const item of data ?? []) {
    const group = grouped.get(item.category)
    if (group) group.push(item)
    else grouped.set(item.category, [item])
  }

  useLayoutEffect(() => {
    if (returnItemRef.current === null || (!data && !isError)) return
    const rowLink = list.current?.querySelector<HTMLAnchorElement>(`[data-armory-item="${returnItemRef.current}"]`)
    const target = rowLink ?? searchInput.current
    target?.focus()
    returnItemRef.current = null
  }, [data, isError, returnItemRef])

  return <section aria-labelledby={headingId} className="min-w-0 overflow-hidden rounded-lg border border-border bg-surface">
    <header className="flex flex-wrap items-start justify-between gap-3 px-3 py-3 sm:px-4">
      <div className="min-w-0 space-y-1">
        <h2 id={headingId} className="text-base font-semibold">{t('assets.armory.catalogueTitle')}</h2>
        {data ? <p role="status" className="text-xs text-muted-foreground">{t('assets.armory.itemCount', { count: data.length })}</p> : null}
      </div>
      {canEdit ? <div className="flex flex-wrap gap-2">
        <Button type="button" variant="outline" className="min-h-11" onClick={event => onAddItem(event.currentTarget)}><Plus aria-hidden />{t('assets.armory.addItem')}</Button>
        <Button type="button" className="min-h-11" disabled={!safes.length} aria-describedby={!safes.length ? `${headingId}-safe` : undefined}
          onClick={event => onReceive(event.currentTarget, safeId === null ? undefined : { safeId })}><PackagePlus aria-hidden />{t('assets.armory.receiveStock')}</Button>
        {!safes.length ? <p id={`${headingId}-safe`} className="basis-full text-xs text-muted-foreground">{t('assets.armory.noSafesEditor')}</p> : null}
      </div> : null}
      {summary.data && (summary.data.expired_batch_count > 0 || summary.data.expiring_batch_count > 0) ? <div className="flex basis-full flex-wrap gap-2 text-xs">
        {summary.data.expired_batch_count > 0 ? <span className="rounded bg-accent-soft px-2 py-1 text-destructive-text">{t('assets.armory.expiredBatchN', { count: summary.data.expired_batch_count })}</span> : null}
        {summary.data.expiring_batch_count > 0 ? <span className="rounded bg-warning-soft px-2 py-1 text-warning">{t('assets.armory.expiringBatchN', { count: summary.data.expiring_batch_count })}</span> : null}
      </div> : null}
    </header>

    <div className="grid grid-cols-2 items-end gap-2 border-y border-hairline px-3 py-3 sm:px-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,15rem)_minmax(0,12rem)]">
      <div className="relative col-span-2 min-w-0 lg:col-span-1">
        <Search aria-hidden className="pointer-events-none absolute start-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
        <Input ref={searchInput} type="search" dir="auto" maxLength={120} value={search} onChange={event => onSearch(event.currentTarget.value)}
          className="min-h-11 ps-9 pe-12 [&::-webkit-search-cancel-button]:hidden" aria-label={t('assets.armory.searchEquipment')} placeholder={t('assets.armory.searchEquipment')} />
        {search ? <Button type="button" variant="ghost" size="icon" className="absolute inset-y-0 end-0 min-h-11 min-w-11"
          aria-label={t('assets.armory.clearSearch')} onClick={() => { onSearch(''); searchInput.current?.focus() }}><X aria-hidden /></Button> : null}
      </div>
      <label className="grid min-w-0 gap-1 text-xs font-medium">{t('assets.armory.category')}
        <select className="min-h-11 w-full rounded-md border border-input bg-surface px-2 text-sm focus-visible:outline-2 focus-visible:outline-ring" value={filters.category ?? ''}
          onChange={event => onCategory(CATEGORIES.find(category => category === event.currentTarget.value))}>
          <option value="">{t('assets.armory.allCategories')}</option>
          {CATEGORIES.map(category => <option key={category} value={category}>{t(`assets.armory.categoryName.${category}`)}</option>)}
        </select>
      </label>
      <label className="grid min-w-0 gap-1 text-xs font-medium">{t('assets.armory.stockViews')}
        <select className="min-h-11 w-full rounded-md border border-input bg-surface px-2 text-sm focus-visible:outline-2 focus-visible:outline-ring" value={filters.stock_view}
          onChange={event => onStockView(event.currentTarget.value === 'needs_attention' ? 'needs_attention' : 'all')}>
          <option value="all">{t('assets.armory.all')}</option>
          <option value="needs_attention">{t('assets.armory.needsWork')}</option>
        </select>
      </label>
    </div>

    {isError ? <div className="space-y-2 px-3 py-4 sm:px-4">
      <p role="alert" className="text-sm text-destructive-text">{armoryErrorMessage(items.error)}</p>
      <Button type="button" variant="outline" className="min-h-11" onClick={() => void items.refetch()}>{t('assets.armory.retry')}</Button>
    </div> : !data ? <p role="status" className="px-3 py-4 text-sm text-muted-foreground sm:px-4">{t('assets.armory.loadingText')}</p>
      : data.length === 0 ? <p className="px-3 py-4 text-sm text-muted-foreground sm:px-4">{t('assets.armory.noEquipment')}</p>
      : <table ref={list} role="table" aria-labelledby={headingId} className="w-full table-fixed border-collapse text-start text-sm">
        <colgroup className="hidden lg:table-column-group"><col className="w-[26%]" /><col className="w-[12%]" />{STOCK_COLUMNS.map(([field]) => <col key={field} className="w-[8%]" />)}<col className="w-[9%]" /><col /></colgroup>
        <thead className="sr-only lg:not-sr-only">
          <tr className="border-b border-hairline text-xs text-muted-foreground">
            <th scope="col" className="px-3 py-2 text-start font-medium">{t('assets.armory.item')}</th>
            <th scope="col" className="px-2 py-2 text-start font-medium">{t('assets.armory.trackedBy')}</th>
            {STOCK_COLUMNS.map(([field, label]) => <th key={field} scope="col" className="px-2 py-2 text-end font-medium">{t(`assets.armory.${label}`)}</th>)}
            <th scope="col" className="px-2 py-2 text-end font-medium">{t('assets.armory.total')}</th>
            <th scope="col" className="px-3 py-2 text-start font-medium">{t('assets.armory.stockNote')}</th>
          </tr>
        </thead>
        {CATEGORIES.map(category => {
          const rows = grouped.get(category)
          return rows ? <tbody role="rowgroup" key={category}>
            <tr role="row" className="bg-surface-raised"><th scope="rowgroup" colSpan={8} className="px-3 py-2 text-start text-xs font-semibold sm:px-4">{t(`assets.armory.categoryName.${category}`)}</th></tr>
            {rows.map(item => {
              const stock = item.stock.find(row => row.safe.id === safeId) ?? item.totals
              return <tr key={item.id} role="row" className="grid grid-cols-[minmax(0,1fr)_auto] gap-x-2 border-b border-hairline px-3 py-1 last:border-b-0 hover:bg-surface-raised lg:table-row lg:p-0">
                <th role="rowheader" scope="row" className="min-w-0 text-start font-normal lg:px-3 lg:py-2">
                  <div className="flex items-start gap-2 lg:items-center">
                    <ArmoryArt drawing={item.drawing} className="mt-1 h-9 w-11 shrink-0 lg:h-10 lg:w-14" />
                    <div className="min-w-0">
                      <Link to={{ search: patchArmoryParams(params, { item: item.id, serial: null }).toString() }} data-armory-item={item.id}
                        className="flex min-h-11 items-center gap-1 rounded font-semibold text-primary-text hover:underline focus-visible:outline-2 focus-visible:outline-ring">
                        <bdi className="wrap-anywhere">{name(item)}</bdi><ChevronRight className="size-4 shrink-0 rtl:-scale-x-100" aria-hidden />
                      </Link>
                      <bdi lang={isAr ? 'en' : 'ar'} className="block wrap-anywhere text-xs text-muted-foreground">{isAr ? item.name_en : item.name_ar}</bdi>
                      <div className="flex flex-wrap gap-x-2 gap-y-0.5 pt-1 text-xs text-muted-foreground lg:hidden">
                        <span>{t(`assets.armory.kind_${item.kind}`)}</span>
                        {STOCK_COLUMNS.map(([field, label]) => <span key={field}>{t(`assets.armory.${label}`)}: {stock[field] === null ? t(`assets.armory.${field === 'in_safe' ? 'notCounted' : 'notApplicable'}`) : <Ltr>{stock[field]}</Ltr>}</span>)}
                      </div>
                    </div>
                  </div>
                </th>
                <td role="cell" className="hidden wrap-anywhere px-2 py-2 text-start text-xs text-muted-foreground lg:table-cell">{t(`assets.armory.kind_${item.kind}`)}</td>
                {STOCK_COLUMNS.map(([field]) => <td role="cell" key={field} className="hidden wrap-anywhere px-2 py-2 text-end tabular-nums lg:table-cell">
                  {stock[field] === null ? <span className="text-xs text-muted-foreground">{t(`assets.armory.${field === 'in_safe' ? 'notCounted' : 'notApplicable'}`)}</span> : <Ltr>{stock[field]}</Ltr>}
                </td>)}
                <td role="cell" className="self-start pt-3 text-end font-semibold tabular-nums lg:px-2 lg:py-2">
                  <span className="block text-xs font-normal text-muted-foreground lg:hidden">{t('assets.armory.total')}</span>{' '}
                  {stock.book_total === null ? <span className="text-xs font-normal text-muted-foreground">{t('assets.armory.notCounted')}</span> : <Ltr>{stock.book_total}</Ltr>}
                </td>
                <td role="cell" className="col-span-2 ms-[3.25rem] text-xs lg:ms-0 lg:px-3 lg:py-2"><StockNotes stock={stock} /></td>
              </tr>
            })}
          </tbody> : null
        })}
      </table>}
  </section>
}

function StockNotes({ stock }: { stock: ArmoryStockTotals }) {
  const { t } = useArmoryLocale()
  const notes = [
    ['items.missingN', stock.missing, 'text-destructive-text'],
    ['items.lostN', stock.lost, 'text-destructive-text'],
    ['expiredUnits', stock.expired_qty, 'text-warning'],
    ['unrecordedN', stock.unrecorded_qty, 'rounded bg-warning-soft px-1.5 py-0.5 text-warning'],
    ['writtenOffN', stock.written_off, 'text-muted-foreground'],
    ['awaitingN', stock.awaiting_rounds_decision, 'text-warning'],
    ['expendedN', stock.expended_rounds, 'text-muted-foreground'],
    ['receivedN', stock.received_qty, 'text-muted-foreground'],
    ['items.knownInSafeN', stock.in_safe === null ? stock.known_in_safe : 0, 'text-muted-foreground'],
  ] as const
  return <div className="flex flex-wrap items-start gap-1">
    {notes.map(([label, count, tone]) => count !== null && count > 0 ? <span key={label} className={tone}>{t(`assets.armory.${label}`, { count })}</span> : null)}
  </div>
}
