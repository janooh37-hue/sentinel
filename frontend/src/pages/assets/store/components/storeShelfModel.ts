import { STORE_ART_KINDS } from '@/components/storeArtCatalog'
import type { StoreBatchRead, StoreDashboard, StoreItemRead } from '@/lib/api'
import { itemName } from '../storeUtils'

export type ShelfFilter = 'all' | 'expired' | 'expiring' | 'low'

export function availableStock(itemId: number, batches: StoreBatchRead[]): number {
  return batches.reduce((sum, batch) => batch.item_id === itemId && (batch.days_to_expiry == null || batch.days_to_expiry >= 0) ? sum + Math.max(0, batch.on_hand) : sum, 0)
}

export function itemFlags(itemId: number, dashboard: StoreDashboard): Exclude<ShelfFilter, 'all'>[] {
  const flags: Exclude<ShelfFilter, 'all'>[] = []
  if (dashboard.expired.some(batch => batch.item_id === itemId)) flags.push('expired')
  if (dashboard.expiring_soon.some(batch => batch.item_id === itemId)) flags.push('expiring')
  if (dashboard.low_stock.some(item => item.item_id === itemId)) flags.push('low')
  return flags
}

/**
 * Shelf order: grouped by what the item is (its drawing: coffee jars, then tea
 * boxes, milk tins, water, cups, tissues, gloves, masks), then by name in the
 * reader's language. Items with the plain carton drawing, or none, come last.
 */
export function sortForShelf(items: StoreItemRead[], language: string): StoreItemRead[] {
  const collator = new Intl.Collator(language, { numeric: true, sensitivity: 'base' })
  const rank = (kind: string | null) => {
    const index = STORE_ART_KINDS.indexOf(kind as (typeof STORE_ART_KINDS)[number])
    return index <= 0 ? STORE_ART_KINDS.length : index
  }
  return [...items].sort((a, b) => rank(a.art_kind) - rank(b.art_kind) || collator.compare(itemName(a, language), itemName(b, language)))
}
