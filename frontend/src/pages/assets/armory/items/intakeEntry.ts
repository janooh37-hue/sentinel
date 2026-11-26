import type { ArmoryBatchIntake, ArmoryIntakeLineInput, ArmoryItemCreate } from '@/lib/api'

import { orgDateIso } from '../armoryFormat'
import { normalizeArmoryCode, parseSerialEntry, type ParsedSerialEntry } from './serialCodes'

export const MAX_STOCK_QUANTITY = 2_147_483_647

type ItemKind = ArmoryItemCreate['kind']
type IntakeEntry = ArmoryIntakeLineInput['entry']

export const KIND_DEFAULTS = {
  firearm: { category: 'firearms', drawing: 'pistol', entry: 'serial' },
  ammunition: { category: 'ammo', drawing: 'rounds', entry: 'quantity' },
  serial: { category: 'comms', drawing: 'radio', entry: 'serial' },
  quantity: { category: 'accessories', drawing: 'case', entry: 'quantity' },
  expiry: { category: 'nonlethal', drawing: 'spray', entry: 'expiry' },
} as const satisfies Record<ItemKind, Pick<ArmoryItemCreate, 'category' | 'drawing'> & { entry: IntakeEntry['type'] }>

export function isControlled(kind: ItemKind): boolean {
  return kind === 'firearm' || kind === 'ammunition'
}

export interface BatchDraft {
  key: number
  reference: string
  expiry: string
  quantity: string
}

export interface IntakeEntryDraft {
  quantity: string
  serialText: string
  unrecordedQty: string
  batches: readonly BatchDraft[]
  countedZero: boolean
}

export function blankBatch(key: number): BatchDraft {
  return { key, reference: '', expiry: '', quantity: '' }
}

export const BLANK_ENTRY: IntakeEntryDraft = {
  quantity: '', serialText: '', unrecordedQty: '', batches: [blankBatch(0)], countedZero: false,
}

function daysInMonth(year: number, month: number): number {
  if (month === 2) return year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0) ? 29 : 28
  return month === 4 || month === 6 || month === 9 || month === 11 ? 30 : 31
}

/** Accept unambiguous year-first dates and day/month/year. Keep month precision on the wire. */
export function parseStockDate(raw: string, allowMonth = false): string | null {
  const { code } = normalizeArmoryCode(raw)
  const iso = /^(\d{4})-(\d{2})(?:-(\d{2}))?$/.exec(code)
  const dmy = iso ? null : /^(?:(\d{1,2})\/)?(\d{1,2})\/(\d{4})$/.exec(code)
  const year = iso?.[1] ?? dmy?.[3]
  const month = iso?.[2] ?? dmy?.[2]
  const day = iso?.[3] ?? dmy?.[1]
  if (!year || !month || Number(year) < 1 || Number(month) < 1 || Number(month) > 12) return null
  const yearMonth = `${year}-${month.padStart(2, '0')}`
  if (!day) return allowMonth ? yearMonth : null
  if (Number(day) < 1 || Number(day) > daysInMonth(Number(year), Number(month))) return null
  return `${yearMonth}-${day.padStart(2, '0')}`
}

export function stockToday(): string {
  return orgDateIso(new Date().toISOString())
}

export function validStockDate(value: string, today: string): boolean {
  return value !== '' && value <= today && parseStockDate(value) === value
}

function readQuantity(raw: string): number | null {
  const { code } = normalizeArmoryCode(raw)
  if (!/^\d+$/.test(code)) return null
  const quantity = Number(code)
  return quantity <= MAX_STOCK_QUANTITY ? quantity : null
}

type EntryError = 'needStockQuantity' | 'needSerialEntry' | 'fixSerials' | 'needBatchDetails' | 'zeroOrBatches' | 'batchRepeated' | 'batchExpiryConflict' | 'enterStock'

export interface IntakeInspection {
  entry: IntakeEntry | null
  quantity: number
  error: EntryError | null
  serials: ParsedSerialEntry[]
}

const EMPTY: IntakeInspection = { entry: null, quantity: 0, error: null, serials: [] }

function readEntry(draft: IntakeEntryDraft, type: IntakeEntry['type'], opening: boolean, serials: ParsedSerialEntry[]): IntakeInspection {
  if (type === 'quantity') {
    if (!draft.quantity.trim()) return EMPTY
    const qty = readQuantity(draft.quantity)
    if (qty === null) return { ...EMPTY, error: 'needStockQuantity' }
    if (qty === 0 && !opening) return { ...EMPTY, error: 'enterStock' }
    return { ...EMPTY, entry: { type, qty }, quantity: qty }
  }
  if (type === 'serial') {
    if (serials.some(({ valid, duplicate }) => !valid || duplicate)) return { ...EMPTY, serials, error: 'fixSerials' }
    if (!serials.length && draft.serialText.trim()) return { ...EMPTY, error: 'needSerialEntry' }
    const hasUnrecorded = opening && !!draft.unrecordedQty.trim()
    const unrecorded = hasUnrecorded ? readQuantity(draft.unrecordedQty) : undefined
    if (unrecorded === null || (unrecorded ?? 0) + serials.length > MAX_STOCK_QUANTITY) {
      return { ...EMPTY, serials, error: 'needStockQuantity' }
    }
    if (!serials.length && unrecorded === undefined) return EMPTY
    return { ...EMPTY, serials, quantity: serials.length + (unrecorded ?? 0),
      entry: { type, serial_codes: serials.map(({ code }) => code), ...(unrecorded === undefined ? {} : { unrecorded_qty: unrecorded }) } }
  }

  const batches: ArmoryBatchIntake[] = []
  const seen = new Set<string>()
  const zero = opening && draft.countedZero
  let quantity = 0
  for (const row of draft.batches) {
    if (!row.reference.trim() && !row.expiry.trim() && !row.quantity.trim()) continue
    if (zero) return { ...EMPTY, error: 'zeroOrBatches' }
    const { code, valid } = normalizeArmoryCode(row.reference)
    const expires_on = parseStockDate(row.expiry, true)
    const qty = readQuantity(row.quantity)
    if (!valid || !expires_on || !qty) return { ...EMPTY, error: 'needBatchDetails' }
    if (seen.has(code)) return { ...EMPTY, error: 'batchRepeated' }
    seen.add(code)
    batches.push({ batch_ref: code, expires_on, qty })
    quantity += qty
  }
  if (!batches.length && !zero) return EMPTY
  if (opening && quantity > MAX_STOCK_QUANTITY) return { ...EMPTY, error: 'needStockQuantity' }
  return { ...EMPTY, quantity, entry: { type, batches, counted_zero: zero } }
}

function effectiveExpiry(value: string): string {
  if (value.length !== 7) return value
  return `${value}-${daysInMonth(Number(value.slice(0, 4)), Number(value.slice(5, 7)))}`
}

/** Validate each draft and check serial uniqueness across rows and batch expiry across safes. */
export function inspectIntakeEntries(rows: readonly { itemId: number | null; kind: ItemKind | null; draft: IntakeEntryDraft }[], opening: boolean): IntakeInspection[] {
  const seenSerials = new Set<string>()
  const repeatedSerials = new Set<string>()
  const reviews = rows.map(({ kind, draft }) => {
    if (!kind || KIND_DEFAULTS[kind].entry !== 'serial') return EMPTY.serials
    const serials = parseSerialEntry(draft.serialText)
    for (const { code, valid } of serials) {
      if (!valid) continue
      if (seenSerials.has(code)) repeatedSerials.add(code)
      seenSerials.add(code)
    }
    return serials
  })
  const batchDates = new Map<number | null, Map<string, string>>()
  return rows.map(({ itemId, kind, draft }, index) => {
    if (!kind) return EMPTY
    const review = repeatedSerials.size ? reviews[index].map(serial =>
      serial.valid && repeatedSerials.has(serial.code) && !serial.duplicate ? { ...serial, duplicate: true } : serial,
    ) : reviews[index]
    const result = readEntry(draft, KIND_DEFAULTS[kind].entry, opening, review)
    if (result.entry?.type !== 'expiry') return result
    let dates = batchDates.get(itemId)
    if (!dates) batchDates.set(itemId, dates = new Map())
    for (const batch of result.entry.batches) {
      const expiry = effectiveExpiry(batch.expires_on)
      const earlier = dates.get(batch.batch_ref)
      if (earlier && earlier !== expiry) return { ...result, error: 'batchExpiryConflict' }
      dates.set(batch.batch_ref, expiry)
    }
    return result
  })
}
