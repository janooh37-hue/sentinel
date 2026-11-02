import type { StoreExpectedBatch } from '@/lib/api'
import { batchKey, hasContains, quantityFromParts, quantityIssue, type QuantityParts } from './storeUtils'

export type CountBatch = Omit<StoreExpectedBatch, 'batch_id'> & { batch_id?: number; removable?: boolean }
export interface AddedCountBatch { itemId: number; expiry: string | null }
export interface CountDraft {
  started: boolean
  note: string
  focusedItem: number | null
  quantities: Record<string, QuantityParts>
  added: AddedCountBatch[]
}

export interface CountDraftSnapshot { value: string | null }
export type DraftStorageResult = 'saved' | 'failed' | 'conflict'

export const emptyCountDraft = (): CountDraft => ({ started: false, note: '', focusedItem: null, quantities: {}, added: [] })
const prefix = 'sentinel:store-count:v1'
export const countDraftKey = (userId: number, target: string, date: string) => `${prefix}:${userId}:${target}:${date}`
const activeKey = (userId: number, target: string) => `${prefix}:${userId}:${target}:active`

export function readCountDraftDate(userId: number, target: string, fallback: string): string {
  if (!navigator.locks?.request) return fallback
  try {
    const date = localStorage.getItem(activeKey(userId, target))
    return date && /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : fallback
  } catch { return fallback }
}

export function selectCountDraftDate(userId: number, target: string, date: string): boolean {
  try {
    localStorage.setItem(activeKey(userId, target), date)
    return true
  } catch { return false }
}

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export function readCountDraft(userId: number, target: string, date: string): { draft: CountDraft; restored: boolean; failed: boolean; volatile: boolean; snapshot: CountDraftSnapshot } {
  const snapshot: CountDraftSnapshot = { value: null }
  const volatile = !navigator.locks?.request
  if (volatile) return { draft: emptyCountDraft(), restored: false, failed: false, volatile, snapshot }
  try {
    const raw = localStorage.getItem(countDraftKey(userId, target, date))
    snapshot.value = raw
    if (!raw) return { draft: emptyCountDraft(), restored: false, failed: false, volatile, snapshot }
    const value: unknown = JSON.parse(raw)
    if (!record(value)) throw new Error('Invalid draft')
    const draft = emptyCountDraft()
    draft.started = value.started === true
    draft.note = typeof value.note === 'string' ? value.note : ''
    draft.focusedItem = typeof value.focusedItem === 'number' ? value.focusedItem : null
    if (record(value.quantities)) {
      for (const [key, parts] of Object.entries(value.quantities)) {
        if (/^\d+:/.test(key) && record(parts) && typeof parts.units === 'string' && typeof parts.loose === 'string') {
          draft.quantities[key] = { units: parts.units, loose: parts.loose }
        }
      }
    }
    if (Array.isArray(value.added)) {
      for (const batch of value.added) {
        if (record(batch) && Number.isSafeInteger(batch.itemId) && typeof batch.itemId === 'number' && (batch.expiry === null || (typeof batch.expiry === 'string' && /^\d{4}-\d{2}(-\d{2})?$/.test(batch.expiry)))) {
          draft.added.push({ itemId: batch.itemId, expiry: batch.expiry })
        }
      }
    }
    return { draft, restored: true, failed: false, volatile, snapshot }
  } catch { return { draft: emptyCountDraft(), restored: false, failed: true, volatile, snapshot } }
}

/** Compare against this workspace's last successful write, never another tab's event. */
export function countDraftChanged(userId: number, target: string, date: string, snapshot: CountDraftSnapshot): boolean {
  try {
    return localStorage.getItem(countDraftKey(userId, target, date)) !== snapshot.value
  } catch { return false }
}

export async function writeCountDraft(userId: number, target: string, date: string, draft: CountDraft, snapshot: CountDraftSnapshot): Promise<DraftStorageResult> {
  if (!navigator.locks?.request) return 'failed'
  try {
    const key = countDraftKey(userId, target, date)
    return await navigator.locks.request<DraftStorageResult>(key, () => {
      if (localStorage.getItem(key) !== snapshot.value) return 'conflict'
      const next = JSON.stringify(draft)
      localStorage.setItem(key, next)
      snapshot.value = next
      localStorage.setItem(activeKey(userId, target), date)
      return 'saved'
    })
  } catch { return 'failed' }
}

export async function clearCountDraft(userId: number, target: string, date: string, snapshot: CountDraftSnapshot): Promise<DraftStorageResult> {
  if (!navigator.locks?.request) return 'failed'
  try {
    const key = countDraftKey(userId, target, date)
    return await navigator.locks.request<DraftStorageResult>(key, () => {
      if (localStorage.getItem(key) !== snapshot.value) return 'conflict'
      localStorage.removeItem(key)
      snapshot.value = null
      if (localStorage.getItem(activeKey(userId, target)) === date) localStorage.removeItem(activeKey(userId, target))
      return 'saved'
    })
  } catch { return 'failed' }
}

/** Unlike receiving, blind counting requires every visible field explicitly entered. */
export function countedQuantity(row: CountBatch, parts: QuantityParts | undefined): number | null {
  if (!parts || !parts.units.trim() || (hasContains(row) && !parts.loose.trim())) return null
  const quantity = quantityFromParts(parts, row)
  return quantityIssue(quantity, { min: 0 }) === null ? quantity : null
}

export function reconcileCountDraft(draft: CountDraft, rows: CountBatch[]): CountDraft {
  const keys = new Set(rows.map(row => batchKey(row.item_id, row.expiry_date)))
  const quantities = Object.fromEntries(Object.entries(draft.quantities).filter(([key]) => keys.has(key)))
  return Object.keys(quantities).length === Object.keys(draft.quantities).length ? draft : { ...draft, quantities }
}
