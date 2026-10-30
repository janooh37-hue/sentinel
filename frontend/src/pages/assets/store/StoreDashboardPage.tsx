import type { ReactNode } from 'react'
import { useQuery } from '@tanstack/react-query'
import { AlertTriangle, Boxes } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { useNavigate } from 'react-router-dom'

import { Button } from '@/components/ui/button'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { api, type StoreDashboardBatch } from '@/lib/api'
import { useCapabilities } from '@/lib/useCapabilities'
import { useIsMobile } from '@/lib/useIsMobile'
import { StoreShell } from './StoreShell'
import { StoreQueryState } from './StoreQueryState'
import { canOpenHqMaterialRequest, openHqMaterialRequest } from './hqRequest'
import { itemName, storeKeys } from './storeUtils'
import { ExpiryText } from './components/ExpiryText'
import { StoreQuantity } from './components/RecordParts'

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
  const query = useQuery({ queryKey: storeKeys.dashboard, queryFn: api.getStoreDashboard })
  // The dashboard omits healthy items without usage; only the catalogue can establish an empty store.
  const items = useQuery({ queryKey: storeKeys.items(false), queryFn: () => api.listStoreItems() })
  const data = query.data
  const label = (key: string) => t(ns + key)
  const name = (row: { item_code: string; item_name_en: string; item_name_ar?: string | null }) => <span className="inline-flex flex-wrap gap-2"><Run>{row.item_code}</Run><span dir="auto">{itemName(row, i18n.language)}</span></span>
  const requestRows = data?.suggestions.filter(row => row.suggested_units > 0).map(row => ({ code: row.item_code, description: row.item_name_en, unit: row.counting_unit_en, qty: row.suggested_units })) ?? []
  const batches = (rows: StoreDashboardBatch[], expired: boolean) => rows.map(row => ({ key: row.batch_id, cells: [name(row), <StoreQuantity value={row.on_hand} item={row} />, <ExpiryText batch={row} />, <span className={`inline-flex items-center gap-2 ${expired ? 'text-accent' : 'text-warning'}`}><AlertTriangle aria-hidden className="h-4 w-4 shrink-0" />{label(expired ? 'expiredStatus' : 'soonStatus')} · {t(ns + (expired ? 'daysOverdue' : 'daysLeft'), { count: Math.abs(row.days_left ?? 0) })}</span>] }))
  const months = data?.usage.months.slice(-6) ?? []
  const offset = (data?.usage.months.length ?? 0) - months.length
  const negative = data?.usage.rows.some(row => row.values.slice(offset).some(value => value != null && value < 0))

  return <StoreShell title={label('title')} description={label('description')} actions={canOpenHqMaterialRequest(has) && requestRows.length > 0 ? <Button className="min-h-11" onClick={() => openHqMaterialRequest(navigate, requestRows)}>{label('createRequest')}</Button> : undefined}>
    <StoreQueryState isPending={query.isPending || items.isPending} error={query.error || items.error} onRetry={() => { void query.refetch(); void items.refetch() }} isEmpty={items.data?.length === 0} emptyIcon={Boxes} emptyMessage={label('empty')} emptyDescription={label('emptyDescription')}>
      {data && <div className="space-y-8">
        <dl className="flex flex-wrap gap-x-12 gap-y-4 border-b border-border pb-5">{[['lastCount', data.last_count_on], ['lastDelivery', data.last_delivery_on]].map(([key, date]) => <div key={key}><dt className="text-sm text-muted-foreground">{label(key!)}</dt><dd className="mt-1 font-medium">{date ? <Run>{date}</Run> : label('noneYet')}</dd></div>)}</dl>
        <Records title={label('expired')} headers={['item', 'onHand', 'expiry', 'status'].map(label)} rows={batches(data.expired, true)} empty={label('noExpired')} mobile={mobile} />
        <Records title={label('soon')} headers={['item', 'onHand', 'expiry', 'status'].map(label)} rows={batches(data.expiring_soon, false)} empty={label('noSoon')} mobile={mobile} />
        <p className="text-sm text-muted-foreground">{t(ns + 'soonWindow', { count: data.expiring_soon_days })}</p>
        <Records title={label('lowStock')} headers={['item', 'onHand', 'minimum'].map(label)} rows={data.low_stock.map(row => ({ key: row.item_id, cells: [name(row), <StoreQuantity value={row.on_hand} item={row} />, <StoreQuantity value={row.minimum_level} item={row} />] }))} empty={label('noLowStock')} mobile={mobile} />
        <section className="space-y-3" aria-label={label('usageSection')}>
          <Records title={label('usage')} headers={[label('item'), ...months]} rows={data.usage.rows.map(row => ({ key: row.item_id, cells: [name(row), ...row.values.slice(offset).map(value => value == null ? <><span aria-hidden>—</span><span className="sr-only">{label('noData')}</span></> : <span className="inline-flex flex-wrap gap-2"><StoreQuantity value={value} item={row} />{value < 0 && <span className="font-medium text-warning">{label('negativeFlag')}</span>}</span>)] }))} empty={label('noUsage')} mobile={mobile} />
          {negative && <p className="text-sm text-muted-foreground">{label('negativeNote')}</p>}
        </section>
        <Records title={label('suggestions')} headers={['item', 'average', 'onHand', 'suggested', 'wholeUnits'].map(label)} rows={data.suggestions.map(row => ({ key: row.item_id, cells: [name(row), <Run>{new Intl.NumberFormat(i18n.language, { maximumFractionDigits: 2 }).format(row.average_usage)}</Run>, <StoreQuantity value={row.on_hand} item={row} />, <StoreQuantity value={row.suggested} item={row} />, <StoreQuantity value={row.suggested_units} item={{ ...row, contains_qty: null }} />] }))} empty={label('noSuggestions')} mobile={mobile} />
        {data.suggestions.length > 0 && <p className="text-sm text-muted-foreground">{label('averageNote')}</p>}
      </div>}
    </StoreQueryState>
  </StoreShell>
}
