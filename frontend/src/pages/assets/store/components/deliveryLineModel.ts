/**
 * Delivery line model and validator shared by every surface that records what
 * arrived: the manual delivery dialog today, a prefilled confirm page later.
 */

import type { StoreDeliveryCreate, StorePickerItem } from '@/lib/api'
import {
  batchKey,
  DEFAULT_EXPIRY,
  EMPTY_QUANTITY,
  expiryFromValue,
  type ExpiryValue,
  quantityFromParts,
  quantityIssue,
  type QuantityParts,
  type Translate,
} from '../storeUtils'

export interface DeliveryLine {
  /** Stable React key; also keys `DeliveryLineErrors` and any per-line state the caller keeps. */
  key: number
  item: StorePickerItem | null
  expiry: ExpiryValue
  quantity: QuantityParts
}

export type DeliveryLineInit = Partial<Omit<DeliveryLine, 'key'>>

export type DeliveryLineErrors = Record<number, { item?: string; expiry?: string; quantity?: string }>

/** Per-line errors and the API lines. When `errors` is empty, `payload[i]` is `lines[i]`. */
export interface DeliveryLinesCheck {
  errors: DeliveryLineErrors
  payload: StoreDeliveryCreate['lines']
}

export function newDeliveryLine(key: number, init: DeliveryLineInit = {}): DeliveryLine {
  return { key, item: null, expiry: { ...DEFAULT_EXPIRY }, quantity: { ...EMPTY_QUANTITY }, ...init }
}

/** Editor lines keyed 0..n-1: one blank line by default, or prefilled ones. */
export function createDeliveryLines(initial: DeliveryLineInit[] = [{}]): DeliveryLine[] {
  return initial.map((init, key) => newDeliveryLine(key, init))
}

/**
 * Each line needs an item, a complete expiry and at least one base unit; two
 * lines may not name the same Batch (a month and its last day are one Batch).
 */
export function validateDeliveryLines(
  lines: readonly DeliveryLine[],
  t: Translate,
): DeliveryLinesCheck {
  const errors: DeliveryLineErrors = {}
  const seen = new Set<string>()
  const payload: StoreDeliveryCreate['lines'] = []
  for (const line of lines) {
    const issue: DeliveryLineErrors[number] = {}
    if (!line.item) issue.item = t('assets.store.deliveries.itemRequired')
    const expiry = expiryFromValue(line.expiry)
    if (expiry === undefined) issue.expiry = t('assets.store.deliveries.expiryRequired')
    const quantity = line.item ? quantityFromParts(line.quantity, line.item) : null
    if (quantityIssue(quantity, { min: 1 })) issue.quantity = t('assets.store.deliveries.quantityRequired')
    if (line.item && expiry !== undefined) {
      const key = batchKey(line.item.id, expiry)
      if (seen.has(key)) issue.expiry = t('assets.store.deliveries.duplicateLine')
      seen.add(key)
      if (quantity != null) payload.push({ item_id: line.item.id, expiry, quantity })
    }
    if (Object.keys(issue).length) errors[line.key] = issue
  }
  return { errors, payload }
}
