import { useTranslation } from 'react-i18next'
import { StoreItemArt } from '@/components/StoreItemArt'
import type { StoreBatchRead, StoreCategoryRead, StoreDashboard, StoreItemRead } from '@/lib/api'
import { categoryName, itemName } from '../storeUtils'
import { StoreQuantity } from './RecordParts'

import { availableStock, itemFlags, type ShelfFilter } from './storeShelfModel'

export function ItemStatus({ itemId, dashboard, all = false }: { itemId: number; dashboard: StoreDashboard; all?: boolean }) {
  const { t } = useTranslation()
  const flags = itemFlags(itemId, dashboard)
  const days = Math.min(...dashboard.expiring_soon.filter(batch => batch.item_id === itemId).map(batch => batch.days_left ?? 0))
  return <>{(all ? flags : flags.slice(0, 1)).map(flag => <span key={flag} className={`rounded-full px-2 py-0.5 text-xs font-medium ${flag === 'expired' ? 'bg-accent-soft text-accent' : 'bg-warning-soft text-warning'}`}>{flag === 'expiring' ? t('assets.store.dashboard.shortExpiring', { count: days }) : t(`assets.store.dashboard.${flag === 'low' ? 'shortLow' : 'expiredStatus'}`)}</span>)}{all && !flags.length && <span className="rounded-full bg-success-soft px-2 py-0.5 text-xs text-success">{t('assets.store.dashboard.inStock')}</span>}</>
}
export function StoreShelves({ items, categories, batches, dashboard, filter, picking, picked, busy, onSelect, onAdd }: {
  items: StoreItemRead[]; categories: StoreCategoryRead[]; batches: StoreBatchRead[]; dashboard: StoreDashboard; filter: ShelfFilter; picking: boolean; picked: Record<number, number>; busy: boolean; onSelect: (item: StoreItemRead) => void; onAdd: (item: StoreItemRead) => void
}) {
  const { t, i18n } = useTranslation()
  return <div className="space-y-4">{categories.map(category => {
    const list = items.filter(item => item.category_id === category.id)
    const attention = list.filter(item => itemFlags(item.id, dashboard).length > 0).length
    return <section key={category.id} aria-label={categoryName(category, i18n.language)} className="rounded-2xl border border-border bg-surface p-3 md:p-4">
      <header className="mb-3 flex flex-wrap items-baseline justify-between gap-2"><h2 className="font-semibold">{categoryName(category, i18n.language)}</h2><span className="text-xs text-muted-foreground">{t('assets.store.dashboard.shelfItems', { count: list.length })}{attention > 0 && ` · ${t('assets.store.dashboard.attention', { count: attention })}`}</span></header>
      <div className="grid grid-cols-3 gap-x-2 gap-y-5 md:grid-cols-[repeat(auto-fill,minmax(88px,1fr))]">{list.map(item => {
        const available = availableStock(item.id, batches)
        const dimmed = filter !== 'all' && !itemFlags(item.id, dashboard).includes(filter)
        const disabled = picking && (busy || available === 0)
        return <button key={item.id} type="button" aria-label={itemName(item, i18n.language)} disabled={disabled} onClick={() => picking ? onAdd(item) : onSelect(item)} className={`relative flex min-h-44 min-w-0 flex-col items-center justify-end gap-1 border-b-[6px] border-[var(--shelf)] px-1 pb-2 pt-8 text-center hover:bg-surface-tinted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${dimmed || disabled ? 'opacity-35' : ''}`}>
          <span className="absolute inset-x-0 top-0 flex min-h-6 justify-center">{picking ? available > 0 && <span aria-hidden className="flex h-7 min-w-7 items-center justify-center rounded-full bg-primary px-1 text-sm font-semibold text-primary-foreground">{picked[item.id] || '+'}</span> : <ItemStatus itemId={item.id} dashboard={dashboard} />}</span>
          <StoreItemArt kind={item.art_kind} color={item.art_color} categoryId={item.category_id} size={72} />
          <span dir="auto" className="line-clamp-2 min-h-9 text-xs leading-snug">{itemName(item, i18n.language)}</span>
          <span className="text-xs font-medium"><StoreQuantity value={item.on_hand} item={item} /></span>
        </button>
      })}</div>
    </section>
  })}</div>
}
