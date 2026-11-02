import { useEffect, useRef, useState, type ReactNode } from 'react'
import { useQuery } from '@tanstack/react-query'
import { ArrowDownToLine, BarChart3, Boxes, ClipboardCheck, Send, Truck } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'

import { Button } from '@/components/ui/button'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { api, type StoreItemRead, type StoreMovementRead } from '@/lib/api'
import { useCapabilities } from '@/lib/useCapabilities'
import { useIsMobile } from '@/lib/useIsMobile'
import { StoreShell } from './StoreShell'
import { StoreQueryState } from './StoreQueryState'
import { canOpenHqMaterialRequest, openHqMaterialRequest } from './hqRequest'
import { itemName, storeKeys } from './storeUtils'
import { StoreQuantity } from './components/RecordParts'
import { StoreShelves } from './components/StoreShelves'
import { availableStock, itemFlags, type ShelfFilter } from './components/storeShelfModel'
import { HandoverTray, type HandoverDraft } from './components/HandoverTray'
import { ItemDrawer } from './components/ItemDrawer'
import { MovementRow, MovementDetailDialog } from './components/MovementRow'
import { DisposalDialog } from './components/DisposalDialog'

const ns = 'assets.store.dashboard.'

function Run({ children }: { children: ReactNode }) {
  return <bdi dir="ltr" className="font-mono tabular-nums">{children}</bdi>
}

/** The same labelled values become cards on phones and columns on desktops. */
function Records({ title, headers, rows, empty, mobile }: {
  title: string
  headers: string[]
  rows: { key: string | number; cells: ReactNode[] }[]
  empty: string
  mobile: boolean
}) {
  return <section aria-label={title} className="space-y-3">
    <h2 className="text-lg font-semibold">{title}</h2>
    {rows.length === 0 ? <p className="rounded-xl border border-dashed border-border p-4 text-sm text-muted-foreground">{empty}</p>
      : mobile ? <div className="space-y-3">{rows.map(row => <dl key={row.key} className="space-y-3 rounded-xl border border-border bg-surface p-4">{row.cells.map((cell, index) => <div key={headers[index]} className="flex flex-wrap items-baseline justify-between gap-2"><dt className="text-sm text-muted-foreground">{/^\d{4}-\d{2}$/.test(headers[index]) ? <Run>{headers[index]}</Run> : headers[index]}</dt><dd className="text-sm">{cell}</dd></div>)}</dl>)}</div>
        : <Table aria-label={title}><TableHeader><TableRow className="motion-reduce:transition-none">{headers.map(header => <TableHead key={header} scope="col">{/^\d{4}-\d{2}$/.test(header) ? <Run>{header}</Run> : header}</TableHead>)}</TableRow></TableHeader><TableBody>{rows.map(row => <TableRow key={row.key} className="motion-reduce:transition-none">{row.cells.map((cell, index) => <TableCell key={headers[index]}>{cell}</TableCell>)}</TableRow>)}</TableBody></Table>}
  </section>
}

export function StoreDashboardPage() {
  const { t, i18n } = useTranslation()
  const navigate = useNavigate()
  const { has } = useCapabilities()
  const mobile = useIsMobile()
  const [search, setSearch] = useSearchParams()
  const editable = has('store.edit')
  const picking = editable && search.get('pick') === '1'
  const [picked, setPicked] = useState<Record<number, number>>({})
  const [filter, setFilter] = useState<ShelfFilter>('all')
  const [selected, setSelected] = useState<StoreItemRead | null>(null)
  const itemOpener = useRef<HTMLButtonElement>(null)
  const handOutOpener = useRef<HTMLButtonElement>(null)
  const wasPicking = useRef(picking)
  useEffect(() => {
    if (wasPicking.current && !picking) handOutOpener.current?.focus()
    wasPicking.current = picking
  }, [picking])
  const [handoverDraft, setHandoverDraft] = useState<HandoverDraft>({ takenBy: '', note: '' })
  const [movement, setMovement] = useState<StoreMovementRead | null>(null)
  const [disposal, setDisposal] = useState(false)
  const [busy, setBusy] = useState(false)
  const query = useQuery({ queryKey: storeKeys.dashboard, queryFn: api.getStoreDashboard })
  // The dashboard omits healthy items without usage; only the catalogue can establish an empty store.
  const items = useQuery({ queryKey: storeKeys.items(false), queryFn: () => api.listStoreItems() })
  const categories = useQuery({ queryKey: storeKeys.categories, queryFn: api.listStoreCategories })
  const batches = useQuery({ queryKey: storeKeys.batches(), queryFn: () => api.listStoreBatches() })
  const handovers = useQuery({ queryKey: [...storeKeys.movements, { kind: 'out' }], queryFn: () => api.listStoreMovements({ kind: 'out' }) })
  const maximum = (id: number) => availableStock(id, batches.data ?? [])
  const effectivePicked = Object.fromEntries(Object.entries(picked).map(([id, quantity]) => [id, Math.min(quantity, maximum(Number(id)))]))
  const changeQuantity = (id: number, quantity: number) => setPicked(previous => ({ ...previous, [id]: Math.max(0, Math.min(quantity, maximum(id))) }))
  const startPicking = () => { setSearch(previous => { const next = new URLSearchParams(previous); next.set('pick', '1'); return next }) }
  const stopPicking = () => { setPicked({}); setHandoverDraft({ takenBy: '', note: '' }); setSearch(previous => { const next = new URLSearchParams(previous); next.delete('pick'); return next }) }
  const data = query.data
  const label = (key: string) => t(ns + key)
  const name = (row: { item_code: string; item_name_en: string; item_name_ar?: string | null }) => <span className="inline-flex flex-wrap gap-2"><Run>{row.item_code}</Run><span dir="auto">{itemName(row, i18n.language)}</span></span>
  const requestRows = data?.suggestions.filter(row => row.suggested_units > 0).map(row => ({ code: row.item_code, description: row.item_name_en, unit: row.counting_unit_en, qty: row.suggested_units })) ?? []
  const months = data?.usage.months.slice(-6) ?? []
  const offset = (data?.usage.months.length ?? 0) - months.length
  const negative = data?.usage.rows.some(row => row.values.slice(offset).some(value => value != null && value < 0))

  return <StoreShell title={label('title')} description={label('description')} actions={<div className="flex flex-wrap gap-2">{canOpenHqMaterialRequest(has) && requestRows.length > 0 && <Button variant="secondary" className="min-h-11" onClick={() => openHqMaterialRequest(navigate, requestRows)}>{label('createRequest')}</Button>}{editable && !picking && <Button ref={handOutOpener} className="min-h-11" onClick={startPicking}><ArrowDownToLine aria-hidden className="h-4 w-4" />{t('assets.store.handovers.handOut')}</Button>}</div>}>
    <StoreQueryState isPending={query.isPending || items.isPending || categories.isPending || batches.isPending} error={query.error || items.error || categories.error || batches.error} onRetry={() => { void query.refetch(); void items.refetch(); void categories.refetch(); void batches.refetch() }} isEmpty={items.data?.length === 0} emptyIcon={Boxes} emptyMessage={label('empty')} emptyDescription={label('emptyDescription')}>
      {data && <div className="space-y-5">
        <section aria-label={label('monthStrip')} tabIndex={0} className="flex overflow-x-auto rounded-2xl border border-border bg-surface focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring sm:grid sm:grid-cols-2 md:grid-cols-4">
          {[
            { key: 'monthlyDelivery', icon: Truck, value: data.last_delivery_on, hint: !data.last_delivery_on ? label('deliveryHint') : '' },
            { key: 'stockCount', icon: ClipboardCheck, value: data.last_count_on, hint: data.counts_recorded < 2 ? t(ns + 'countsRecorded', { count: data.counts_recorded }) : '' },
            { key: 'monthlyUsage', icon: BarChart3, value: label(data.usage_ready ? 'calculated' : 'needsSecondCount'), hint: !data.usage_ready ? t(ns + 'countsRecorded', { count: data.counts_recorded }) : '' },
            { key: 'hqRequest', icon: Send, value: data.suggestion_count ? t(ns + 'itemsSuggested', { count: data.suggestion_count }) : label('noSuggestionsYet'), hint: !data.usage_ready ? label('suggestionsHint') : '' },
          ].map(({ key, icon: Icon, value, hint }) => <div key={key} className="flex w-56 shrink-0 gap-2 p-4 sm:w-auto"><Icon aria-hidden className="mt-0.5 h-5 w-5 shrink-0 text-primary" /><div className="min-w-0"><p className="text-xs text-muted-foreground">{label(key)}</p><p className="mt-1 text-sm font-semibold">{value ? /^\d{4}-/.test(value) ? <Run>{value}</Run> : value : label('noneYet')}</p>{hint && <p className="mt-1 text-xs text-muted-foreground">{hint}</p>}</div></div>)}
        </section>
        <div className="flex flex-wrap items-center gap-2">{(['all', 'expired', 'expiring', 'low'] as const).map(key => {
          const count = key === 'all' ? items.data?.length ?? 0 : items.data?.filter(item => itemFlags(item.id, data).includes(key)).length ?? 0
          return <button key={key} type="button" aria-pressed={filter === key} onClick={() => setFilter(key)} className={`min-h-11 rounded-full border px-3 text-xs font-medium focus-visible:ring-2 focus-visible:ring-ring ${filter === key ? 'border-primary bg-primary-soft text-primary-text' : count ? 'border-border bg-surface text-foreground' : 'border-border bg-surface-tinted text-muted-foreground'}`}><Run>{count}</Run>{' '}{label({ all: 'allItems', expired: 'expiredStatus', expiring: 'soonStatus', low: 'belowMinimum' }[key])}</button>
        })}<span className="text-xs text-muted-foreground">{t(ns + 'soonWindow', { count: data.expiring_soon_days })}</span></div>
        {picking && <p className="rounded-lg bg-primary-soft p-3 text-sm text-primary-text">{t('assets.store.handovers.pickingHint')}</p>}
        <StoreShelves items={items.data ?? []} categories={categories.data ?? []} batches={batches.data ?? []} dashboard={data} filter={filter} picking={picking} picked={effectivePicked} busy={busy} onSelect={(item, opener) => { itemOpener.current = opener; setSelected(item); setHandoverDraft({ takenBy: '', note: '' }) }} onAdd={item => changeQuantity(item.id, (effectivePicked[item.id] ?? 0) + 1)} />
        <section aria-label={label('recentHandovers')} className="rounded-2xl border border-border bg-surface p-4"><header className="mb-3 flex flex-wrap items-start justify-between gap-2"><div><h2 className="font-semibold">{label('recentHandovers')}</h2><p className="text-xs text-muted-foreground">{label('recentHint')}</p></div><Link to="/holdings/store/movements" className="inline-flex min-h-11 items-center text-sm text-primary-text underline">{label('seeAll')}</Link></header>
          <StoreQueryState isPending={handovers.isPending} error={handovers.error} onRetry={() => { void handovers.refetch() }} isEmpty={handovers.data?.length === 0} emptyMessage={t('assets.store.handovers.noneYet')} emptyDescription={label('recentHint')}>
            {handovers.data?.slice(0, 4).map(record => <MovementRow key={record.id} movement={record} showLineUnits onSelect={setMovement} />)}
          </StoreQueryState>
        </section>
        <section className="space-y-3" aria-label={label('usageSection')}>
          <Records title={label('usage')} headers={[label('item'), ...months]} rows={data.usage.rows.map(row => ({ key: row.item_id, cells: [name(row), ...row.values.slice(offset).map(value => value == null ? <><span aria-hidden>—</span><span className="sr-only">{label('noData')}</span></> : <span className="inline-flex flex-wrap gap-2"><StoreQuantity value={value} item={row} />{value < 0 && <span className="font-medium text-warning">{label('negativeFlag')}</span>}</span>)] }))} empty={label('noUsage')} mobile={mobile} />
          {negative && <p className="text-sm text-muted-foreground">{label('negativeNote')}</p>}
        </section>
        <Records title={label('suggestions')} headers={['item', 'average', 'onHand', 'suggested', 'wholeUnits'].map(label)} rows={data.suggestions.map(row => ({ key: row.item_id, cells: [name(row), <Run>{new Intl.NumberFormat(i18n.language, { maximumFractionDigits: 2 }).format(row.average_usage)}</Run>, <StoreQuantity value={row.on_hand} item={row} />, <StoreQuantity value={row.suggested} item={row} />, <StoreQuantity value={row.suggested_units} item={{ ...row, contains_qty: null }} />] }))} empty={label('noSuggestions')} mobile={mobile} />
        {data.suggestions.length > 0 && <p className="text-sm text-muted-foreground">{label('averageNote')}</p>}
      </div>}
      {data && selected && <ItemDrawer key={selected.id} item={items.data?.find(item => item.id === selected.id) ?? selected} batches={batches.data ?? []} dashboard={data} movements={handovers.data ?? []} editable={editable} open={!disposal} returnFocusRef={itemOpener} draft={handoverDraft} onDraftChange={setHandoverDraft} onClose={() => { setSelected(null); setHandoverDraft({ takenBy: '', note: '' }) }} onAddMulti={(item, quantity) => { changeQuantity(item.id, quantity); setSelected(null); startPicking() }} onMovement={record => { setSelected(null); setMovement(record) }} onDisposal={() => setDisposal(true)} />}
      {picking && <HandoverTray items={items.data ?? []} picked={effectivePicked} maximum={maximum} draft={handoverDraft} onDraftChange={setHandoverDraft} onChange={changeQuantity} onCancel={stopPicking} onSuccess={stopPicking} busy={busy} busyChanged={setBusy} />}
      <MovementDetailDialog movement={movement} open={movement != null} onOpenChange={open => { if (!open) setMovement(null) }} />
      {editable && disposal && <DisposalDialog open={disposal} itemId={selected?.id} onOpenChange={setDisposal} />}
    </StoreQueryState>
  </StoreShell>
}
