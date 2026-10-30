import { afterEach, describe, expect, it } from 'vitest'

import { ApiError } from '@/lib/api'
import i18n from '@/lib/i18n'

import {
  expiryFromValue,
  formatExpiry,
  formatQuantity,
  quantityFromParts,
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
})

describe('storeErrorMessage', () => {
  it('maps STORE_* codes to translated copy and falls back to the server message', () => {
    expect(
      storeErrorMessage(new ApiError(409, 'STORE_ITEM_CONTAINS_LOCKED', 'server text'), t),
    ).toBe('What a Counting unit contains cannot change once the item has stock records.')
    expect(storeErrorMessage(new ApiError(409, 'STORE_SOMETHING_NEW', 'server text'), t)).toBe(
      'server text',
    )
  })
})

