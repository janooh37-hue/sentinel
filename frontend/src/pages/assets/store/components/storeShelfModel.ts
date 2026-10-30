import type { StoreBatchRead, StoreDashboard } from '@/lib/api'

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
