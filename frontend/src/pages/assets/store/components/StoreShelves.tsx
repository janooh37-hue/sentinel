import { useTranslation } from 'react-i18next'
import { StoreItemArt } from '@/components/StoreItemArt'
import type { StoreBatchRead, StoreCategoryRead, StoreDashboard, StoreItemRead } from '@/lib/api'
import { categoryName, itemName } from '../storeUtils'
import { StoreQuantity } from './RecordParts'

import { availableStock, itemFlags, sortForShelf, type ShelfFilter } from './storeShelfModel'

export function ItemStatus({ itemId, dashboard, all = false }: { itemId: number; dashboard: StoreDashboard; all?: boolean }) {
  const { t } = useTranslation()
  const flags = itemFlags(itemId, dashboard)
  const days = Math.min(...dashboard.expiring_soon.filter(batch => batch.item_id === itemId).map(batch => batch.days_left ?? 0))
  return <>{(all ? flags : flags.slice(0, 1)).map(flag => <span key={flag} className={`rounded-full px-2 py-0.5 text-xs font-medium ${flag === 'expired' ? 'bg-accent-soft text-accent' : 'bg-warning-soft text-warning'}`}>{flag === 'expiring' ? t('assets.store.dashboard.shortExpiring', { count: days }) : t(`assets.store.dashboard.${flag === 'low' ? 'shortLow' : 'expiredStatus'}`)}</span>)}{all && !flags.length && <span className="rounded-full bg-success-soft px-2 py-0.5 text-xs text-success">{t('assets.store.dashboard.inStock')}</span>}</>
}
export function StoreShelves({ items, categories, batches, dashboard, filter, picking, picked, busy, onSelect, onAdd }: {
  items: StoreItemRead[]; categories: StoreCategoryRead[]; batches: StoreBatchRead[]; dashboard: StoreDashboard; filter: ShelfFilter; picking: boolean; picked: Record<number, number>; busy: boolean; onSelect: (item: StoreItemRead, opener: HTMLButtonElement) => void; onAdd: (item: StoreItemRead) => void
}) {
  const { t, i18n } = useTranslation()
  const shelved = sortForShelf(items, i18n.language)
  const matching = filter === 'all' ? shelved : shelved.filter(item => itemFlags(item.id, dashboard).includes(filter))
  if (!matching.length) return <p role="status" className="rounded-xl border border-dashed border-border p-4 text-sm text-muted-foreground">{t(`assets.store.dashboard.${{ all: 'empty', expired: 'noExpiredItems', expiring: 'noExpiringItems', low: 'noLowStock' }[filter]}`)}</p>
  return <div className="space-y-4">{categories.map(category => {
    const list = matching.filter(item => item.category_id === category.id)
    if (!list.length) return null
    const attention = list.filter(item => itemFlags(item.id, dashboard).length > 0).length
    return <section key={category.id} aria-label={categoryName(category, i18n.language)} className="rounded-2xl border border-border bg-surface p-3 md:p-4">
      <header className="mb-3 flex flex-wrap items-baseline justify-between gap-2"><h2 className="font-semibold">{categoryName(category, i18n.language)}</h2><span className="text-xs text-muted-foreground">{t('assets.store.dashboard.shelfItems', { count: list.length })}{attention > 0 && ` · ${t('assets.store.dashboard.attention', { count: attention })}`}</span></header>
      <div className="grid grid-cols-3 gap-x-2 gap-y-5 md:grid-cols-[repeat(auto-fill,minmax(128px,1fr))]">{list.map(item => {
        const available = availableStock(item.id, batches)
        const disabled = picking && (busy || available === 0)
        // Named by its own visible content (name, quantity, then the status
        // badge, which is drawn at the top but read last), so the accessible
        // name always contains the visible label (WCAG 2.5.3).
        return <button key={item.id} type="button" disabled={disabled} onClick={event => picking ? onAdd(item) : onSelect(item, event.currentTarget)} className={`relative flex min-h-52 min-w-0 flex-col items-center justify-end gap-1 border-b-[6px] border-[var(--shelf)] px-1 pb-2 pt-7 text-center hover:bg-surface-tinted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${disabled ? 'opacity-35' : ''}`}>
          <StoreItemArt kind={item.art_kind} color={item.art_color} categoryId={item.category_id} size={104} className="-mb-2 max-w-full" />
          <span dir="auto" className="line-clamp-2 min-h-10 text-sm leading-snug">{itemName(item, i18n.language)}</span>{' '}
          <span className="text-balance text-sm font-semibold [&_bdi]:whitespace-normal"><StoreQuantity value={item.on_hand} item={item} /></span>{' '}
          <span className="absolute inset-x-0 top-0 flex min-h-6 justify-center">{picking ? available > 0 && <span aria-hidden className="flex h-7 min-w-7 items-center justify-center rounded-full bg-primary px-1 text-sm font-semibold text-primary-foreground">{picked[item.id] || '+'}</span> : <ItemStatus itemId={item.id} dashboard={dashboard} />}</span>
        </button>
      })}</div>
    </section>
  })}</div>
}
