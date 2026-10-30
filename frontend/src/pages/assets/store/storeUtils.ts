/**
 * Shared Store helpers: query keys, cache invalidation, quantity and expiry
 * formatting, and `STORE_*` error mapping.
 *
 * Quantities travel as integers in **base units** (loose units when the item
 * has `contains_qty`, otherwise Counting units). The UI enters and shows them
 * as "N cartons + M loose" and converts with `toBaseUnits` / `splitBase`.
 */

import { type QueryClient, useQuery } from '@tanstack/react-query'

import { api, ApiError, apiErrorMessage } from '@/lib/api'
import i18n from '@/lib/i18n'
import { formatNumber, isArabic, localized } from '@/lib/language'
import { monthEndIso } from '@/lib/monthEnd'
import { todayIso } from '@/pages/vehicles/vehicleUtils'

export type Translate = (key: string, options?: Record<string, unknown>) => string

/** The unit fields every Store item and Batch-level row carries. */
export interface StoreUnits {
  counting_unit_en: string
  counting_unit_ar: string
  contains_qty: number | null
  contains_unit_en: string | null
  contains_unit_ar: string | null
}

// ── Query keys ──────────────────────────────────────────────────────────────

/** `['store-dashboard']` is shared with the Home widgets: one cache entry. */
export const STORE_DASHBOARD_KEY = ['store-dashboard'] as const

export const storeKeys = {
  all: ['store'] as const,
  dashboard: STORE_DASHBOARD_KEY,
  categories: ['store', 'categories'] as const,
  items: (includeArchived: boolean) => ['store', 'items', { includeArchived }] as const,
  picker: ['store', 'picker'] as const,
  batches: (itemId?: number) => ['store', 'batches', itemId ?? 'all'] as const,
  deliveries: ['store', 'deliveries'] as const,
  counts: ['store', 'counts'] as const,
  count: (id: number) => ['store', 'counts', id] as const,
  expected: (countedOn: string) => ['store', 'counts', 'expected', countedOn] as const,
  disposals: ['store', 'disposals'] as const,
}

/** Every Store write can move on-hand, usage and the dashboard: refresh all. */
export function invalidateStoreQueries(queryClient: QueryClient): void {
  void queryClient.invalidateQueries({ queryKey: storeKeys.all })
  void queryClient.invalidateQueries({ queryKey: STORE_DASHBOARD_KEY })
}

/** The active-item picker list (one cache entry, refreshed by every Store write).
 *  `optional`: a surface outside Store whose user may lack store access, such as
 *  the material-request items table; it fails quietly and refetches rarely. */
export function useStorePickerItems({ optional = false }: { optional?: boolean } = {}) {
  return useQuery({
    queryKey: storeKeys.picker,
    queryFn: api.listStorePickerItems,
    ...(optional
      ? { staleTime: 5 * 60_000, retry: false, retryOnMount: false, refetchOnWindowFocus: false, refetchOnReconnect: false }
      : { staleTime: 60_000 }),
  })
}

// ── Language ────────────────────────────────────────────────────────────────

/** Item name in the active language, falling back to the other language. */
export function itemName(
  row: { name_en?: string; name_ar?: string | null; item_name_en?: string; item_name_ar?: string | null },
  language: string = i18n.language,
): string {
  return localized(row.name_ar ?? row.item_name_ar, row.name_en ?? row.item_name_en, language)
}

export function categoryName(
  category: { name_en: string; name_ar: string },
  language: string = i18n.language,
): string {
  return isArabic(language) ? category.name_ar : category.name_en
}

export function countingUnit(item: StoreUnits, language: string = i18n.language): string {
  return isArabic(language) ? item.counting_unit_ar : item.counting_unit_en
}

export function containsUnit(item: StoreUnits, language: string = i18n.language): string {
  return (isArabic(language) ? item.contains_unit_ar : item.contains_unit_en) ?? ''
}

// ── Quantities ──────────────────────────────────────────────────────────────

/** True when the item is counted as Counting units plus loose contents. */
export function hasContains(item: StoreUnits): item is StoreUnits & { contains_qty: number } {
  return item.contains_qty != null && item.contains_qty > 1
}

/** "N cartons + M loose" → base units. Blank parts count as 0. */
export function toBaseUnits(units: number, loose: number, item: StoreUnits): number {
  const whole = Number.isFinite(units) ? Math.trunc(units) : 0
  const rest = Number.isFinite(loose) ? Math.trunc(loose) : 0
  return hasContains(item) ? whole * item.contains_qty + rest : whole
}

/** Base units → whole Counting units and the loose remainder. */
export function splitBase(base: number, item: StoreUnits): { units: number; loose: number } {
  if (!hasContains(item)) return { units: base, loose: 0 }
  const sign = base < 0 ? -1 : 1
  const abs = Math.abs(base)
  return {
    units: sign * Math.floor(abs / item.contains_qty),
    loose: sign * (abs % item.contains_qty),
  }
}

/** English plural for a free-text unit noun ("Carton" → "cartons"). */
function pluralEn(unit: string, count: number): string {
  const word = unit.trim().toLowerCase()
  if (Math.abs(count) === 1 || word === '') return word
  if (/[^aeiou]y$/.test(word)) return `${word.slice(0, -1)}ies`
  if (/(s|x|z|ch|sh)$/.test(word)) return `${word}es`
  return `${word}s`
}

function unitPhrase(count: number, unit: string, language: string): string {
  const number = formatNumber(count, language)
  return isArabic(language) ? `${number} ${unit.trim()}` : `${number} ${pluralEn(unit, count)}`
}

/**
 * Base units as the storekeeper reads them: "3 cartons + 5 jars" /
 * "٣ كرتون + ٥ علبة". Zero parts are dropped; zero overall shows "0 cartons".
 * Wrap the result in `<bdi>` at the render site.
 */
export function formatQuantity(
  base: number,
  item: StoreUnits,
  language: string = i18n.language,
): string {
  const unit = countingUnit(item, language)
  const sign = base < 0 ? '−' : ''
  if (!hasContains(item)) return `${sign}${unitPhrase(Math.abs(base), unit, language)}`
  const { units, loose } = splitBase(base, item)
  const looseUnit = containsUnit(item, language)
  if (loose === 0) return `${sign}${unitPhrase(Math.abs(units), unit, language)}`
  if (units === 0) return `${sign}${unitPhrase(Math.abs(loose), looseUnit, language)}`
  return `${sign}${unitPhrase(Math.abs(units), unit, language)} + ${unitPhrase(Math.abs(loose), looseUnit, language)}`
}

/** "1 Carton = 24 jars" — the contains rule, for hints and item rows. */
export function formatContains(item: StoreUnits, language: string = i18n.language): string | null {
  if (!hasContains(item)) return null
  return `1 ${countingUnit(item, language)} = ${unitPhrase(item.contains_qty, containsUnit(item, language), language)}`
}

// ── Expiry ──────────────────────────────────────────────────────────────────

export interface ExpiryParts {
  expiry_date: string | null
  expiry_month_only: boolean
}

/** Month-only expiries show `YYYY-MM`; undated batches show the "no expiry" copy. */
export function formatExpiry(batch: ExpiryParts, t: Translate): string {
  if (batch.expiry_date == null) return t('assets.store.expiry.none')
  return batch.expiry_month_only ? batch.expiry_date.slice(0, 7) : batch.expiry_date
}

/** The API line `expiry` value for a Batch: `YYYY-MM`, `YYYY-MM-DD`, or null. */
export function expiryInput(batch: ExpiryParts): string | null {
  if (batch.expiry_date == null) return null
  return batch.expiry_month_only ? batch.expiry_date.slice(0, 7) : batch.expiry_date
}

/** The stored expiry date of a Batch: a month-only `YYYY-MM` is the last day of
 *  that month, exactly as the server stores it; full dates and null pass through. */
export function batchExpiryDate(expiry: string | null): string | null {
  return expiry != null && /^\d{4}-\d{2}$/.test(expiry) ? monthEndIso(expiry) : expiry
}

/** Stable identity of a Batch within an item: (item, expiry). `YYYY-MM` and its
 *  month-end date are the same Batch. */
export function batchKey(itemId: number, expiry: string | null): string {
  return `${itemId}:${batchExpiryDate(expiry) ?? 'none'}`
}

// ── Form inputs (QuantityInput / ExpiryInput values) ────────────────────────

export interface QuantityParts {
  units: string
  loose: string
}

export const EMPTY_QUANTITY: QuantityParts = { units: '', loose: '' }

/** Base units, or null when nothing was entered. Either part blank counts as 0
 *  once the other is filled. Negative or non-integer input yields NaN. */
export function quantityFromParts(parts: QuantityParts, item: StoreUnits): number | null {
  const units = parts.units.trim()
  const loose = hasContains(item) ? parts.loose.trim() : ''
  if (units === '' && loose === '') return null
  const parse = (raw: string): number => (raw === '' ? 0 : /^\d+$/.test(raw) ? Number(raw) : NaN)
  const whole = parse(units)
  const rest = parse(loose)
  if (Number.isNaN(whole) || Number.isNaN(rest)) return NaN
  return toBaseUnits(whole, rest, item)
}

/** Why a `quantityFromParts` result cannot be saved, or null when it can.
 *  `missing`: nothing entered (unless `allowBlank`); `invalid`: not a safe whole
 *  number or below `min`; `aboveMax`: more than `max`. Callers own the copy. */
export type QuantityIssue = 'missing' | 'invalid' | 'aboveMax'

export function quantityIssue(
  quantity: number | null,
  rules: { min: number; max?: number; allowBlank?: boolean },
): QuantityIssue | null {
  if (quantity === null) return rules.allowBlank ? null : 'missing'
  if (!Number.isSafeInteger(quantity) || quantity < rules.min) return 'invalid'
  if (rules.max !== undefined && quantity > rules.max) return 'aboveMax'
  return null
}

/** A record's business date: a complete ISO `YYYY-MM-DD` that is not in the future. */
export function isBusinessDate(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(value) && value <= todayIso()
}

export type ExpiryMode = 'date' | 'month' | 'none'

export interface ExpiryValue {
  mode: ExpiryMode
  date: string
  month: string
}

export const DEFAULT_EXPIRY: ExpiryValue = { mode: 'date', date: '', month: '' }

/** API `expiry`: `YYYY-MM-DD`, `YYYY-MM`, or null. `undefined` = incomplete. */
export function expiryFromValue(value: ExpiryValue): string | null | undefined {
  if (value.mode === 'none') return null
  if (value.mode === 'month') return /^\d{4}-\d{2}$/.test(value.month) ? value.month : undefined
  return /^\d{4}-\d{2}-\d{2}$/.test(value.date) ? value.date : undefined
}

// ── Errors ──────────────────────────────────────────────────────────────────

/** `STORE_COUNT_MISSING_BATCHES` → `assets.store.errors.countMissingBatches`. */
function storeErrorKey(code: string): string | null {
  if (!code.startsWith('STORE_')) return null
  const camel = code
    .slice('STORE_'.length)
    .toLowerCase()
    .replace(/_([a-z])/g, (_, letter: string) => letter.toUpperCase())
  return `assets.store.errors.${camel}`
}

export function storeErrorMessage(err: unknown, t: Translate): string {
  if (err instanceof ApiError) {
    const key = storeErrorKey(err.code)
    if (key && i18n.exists(key)) return t(key)
  }
  return apiErrorMessage(err)
}
