import { afterEach, describe, expect, it } from 'vitest'

import { ApiError } from '@/lib/api'
import i18n from '@/lib/i18n'
import { todayIso } from '@/pages/vehicles/vehicleUtils'

import {
  batchExpiryDate,
  batchKey,
  expiryFromValue,
  formatExpiry,
  formatQuantity,
  isBusinessDate,
  quantityFromParts,
  quantityIssue,
  splitBase,
  storeErrorMessage,
  type StoreUnits,
  toBaseUnits,
} from './storeUtils'

const JARS: StoreUnits = {
  counting_unit_en: 'Carton',
  counting_unit_ar: 'كرتون',
  contains_qty: 24,
  contains_unit_en: 'Jar',
  contains_unit_ar: 'علبة',
}
const BOXES: StoreUnits = {
  counting_unit_en: 'Box',
  counting_unit_ar: 'صندوق',
  contains_qty: null,
  contains_unit_en: null,
  contains_unit_ar: null,
}

const t = i18n.t.bind(i18n)

afterEach(async () => {
  await i18n.changeLanguage('en')
})

describe('store quantities', () => {
  it('converts cartons + loose to base units only when the item has contains', () => {
    expect(toBaseUnits(3, 5, JARS)).toBe(77)
    expect(toBaseUnits(3, 5, BOXES)).toBe(3)
    expect(splitBase(77, JARS)).toEqual({ units: 3, loose: 5 })
    expect(splitBase(-26, JARS)).toEqual({ units: -1, loose: -2 })
  })

  it('treats blank input as missing, a lone blank part as 0, and junk as invalid', () => {
    expect(quantityFromParts({ units: '', loose: '' }, JARS)).toBeNull()
    expect(quantityFromParts({ units: '0', loose: '' }, JARS)).toBe(0)
    expect(quantityFromParts({ units: '', loose: '7' }, JARS)).toBe(7)
    expect(quantityFromParts({ units: '2', loose: '9' }, BOXES)).toBe(2)
    expect(quantityFromParts({ units: '-1', loose: '' }, JARS)).toBeNaN()
    expect(quantityFromParts({ units: '1.5', loose: '' }, BOXES)).toBeNaN()
  })

  it('reads as cartons and loose units in English and Arabic', async () => {
    expect(formatQuantity(77, JARS)).toBe('3 cartons + 5 jars')
    expect(formatQuantity(24, JARS)).toBe('1 carton')
    expect(formatQuantity(5, JARS)).toBe('5 jars')
    expect(formatQuantity(0, BOXES)).toBe('0 boxes')
    expect(formatQuantity(-26, JARS)).toBe('−1 carton + 2 jars')
    expect(formatQuantity(-3, BOXES)).toBe('−3 boxes')
    expect(formatQuantity(-24, JARS)).toBe('−1 carton')
    expect(formatQuantity(-3, JARS)).toBe('−3 jars')
    await i18n.changeLanguage('ar')
    expect(formatQuantity(77, JARS)).toBe('3 كرتون + 5 علبة')
    expect(formatQuantity(-3, BOXES)).toBe('−3 صندوق')
    expect(formatQuantity(-24, JARS)).toBe('−1 كرتون')
    expect(formatQuantity(-3, JARS)).toBe('−3 علبة')
  })
})

describe('store quantity and date rules', () => {
  it('applies each record type\'s bounds', () => {
    expect(quantityIssue(null, { min: 0 })).toBe('missing')
    expect(quantityIssue(null, { min: 0, allowBlank: true })).toBeNull()
    expect(quantityIssue(0, { min: 0 })).toBeNull()
    expect(quantityIssue(0, { min: 1 })).toBe('invalid')
    expect(quantityIssue(Number.NaN, { min: 0, allowBlank: true })).toBe('invalid')
    expect(quantityIssue(2 ** 53, { min: 1 })).toBe('invalid')
    expect(quantityIssue(5, { min: 1, max: 5 })).toBeNull()
    expect(quantityIssue(6, { min: 1, max: 5 })).toBe('aboveMax')
  })

  it('accepts only complete ISO dates up to today', () => {
    expect(isBusinessDate(todayIso())).toBe(true)
    expect(isBusinessDate('2026-01-05')).toBe(true)
    expect(isBusinessDate('9999-12-31')).toBe(false)
    expect(isBusinessDate('2026-1-5')).toBe(false)
    expect(isBusinessDate('')).toBe(false)
  })
})

describe('store expiry', () => {
  it('shows month-only expiries as the month and undated batches as no expiry', () => {
    expect(formatExpiry({ expiry_date: '2028-09-30', expiry_month_only: true }, t)).toBe('2028-09')
    expect(formatExpiry({ expiry_date: '2027-04-26', expiry_month_only: false }, t)).toBe('2027-04-26')
    expect(formatExpiry({ expiry_date: null, expiry_month_only: false }, t)).toBe('No expiry')
  })

  it('sends a full date, a month, null, or nothing while incomplete', () => {
    expect(expiryFromValue({ mode: 'date', date: '2027-04-26', month: '' })).toBe('2027-04-26')
    expect(expiryFromValue({ mode: 'month', date: '', month: '2029-01' })).toBe('2029-01')
    expect(expiryFromValue({ mode: 'none', date: '', month: '' })).toBeNull()
    expect(expiryFromValue({ mode: 'month', date: '2027-04-26', month: '' })).toBeUndefined()
  })

  // Delivery (duplicate lines) and Count (add batch) both key Batches through
  // batchKey; a month-only entry must land on the server's stored month end
  // (`schemas/store.py` parse_expiry) whatever the device timezone is.
  it.each(['UTC', 'Asia/Dubai', 'America/Los_Angeles', 'Pacific/Kiritimati', 'Pacific/Pago_Pago', 'America/Santiago'])(
    'keys a month-only expiry as its month end in %s',
    (zone) => {
      const previous = process.env.TZ
      process.env.TZ = zone
      try {
        if (zone === 'Pacific/Kiritimati') expect(new Date(2028, 0, 1).getTimezoneOffset()).toBe(-840)
        for (let year = 2024; year <= 2032; year += 1) {
          for (let month = 1; month <= 12; month += 1) {
            const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0)
            const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][month - 1]
            const ym = `${year}-${String(month).padStart(2, '0')}`
            expect(batchExpiryDate(ym)).toBe(`${ym}-${days}`)
            expect(batchKey(7, ym)).toBe(batchKey(7, `${ym}-${days}`))
            expect(batchKey(7, ym)).not.toBe(batchKey(7, `${ym}-${String(days - 1).padStart(2, '0')}`))
          }
        }
        expect(batchKey(7, null)).toBe('7:none')
        expect(batchKey(7, '2028-02-14')).toBe('7:2028-02-14')
      } finally {
        if (previous === undefined) delete process.env.TZ
        else process.env.TZ = previous
      }
    },
  )
})

describe('storeErrorMessage', () => {
  it('maps STORE_* codes to translated copy and falls back to the server message', () => {
    expect(
      storeErrorMessage(new ApiError(409, 'STORE_ITEM_CONTAINS_LOCKED', 'server text')),
    ).toBe('What a Counting unit contains cannot change once the item has stock records.')
    expect(storeErrorMessage(new ApiError(409, 'STORE_SOMETHING_NEW', 'server text'))).toBe(
      'server text',
    )
  })
})

