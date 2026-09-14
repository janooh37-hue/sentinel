import { describe, expect, it } from 'vitest'

import { filsToEditableText, formatFilsNumber, parseAmountToFils } from './vehicleUtils'

describe('parseAmountToFils', () => {
  it('parses a whole AED amount to exact fils', () => {
    expect(parseAmountToFils('300')).toBe(30_000)
  })

  it('parses a fractional AED amount to exact fils, never rounded', () => {
    expect(parseAmountToFils('349.50')).toBe(34_950)
    expect(parseAmountToFils('349.5')).toBe(34_950)
    expect(parseAmountToFils('1.01')).toBe(101)
  })

  it('accepts Arabic-Indic digits and the Arabic decimal separator', () => {
    expect(parseAmountToFils('٣٤٩٫٥٠')).toBe(34_950)
    expect(parseAmountToFils('٣٠٠')).toBe(30_000)
  })

  it('enforces the domain minimum (1 AED / 100 fils)', () => {
    expect(parseAmountToFils('1')).toBe(100)
    expect(parseAmountToFils('0')).toBeNull()
    expect(parseAmountToFils('0.99')).toBeNull()
  })

  it('enforces the domain maximum (9,999,999 whole AED)', () => {
    expect(parseAmountToFils('9999999')).toBe(999_999_900)
    expect(parseAmountToFils('9999999.99')).toBe(999_999_999)
    expect(parseAmountToFils('10000000')).toBeNull()
  })

  it('rejects excess precision, grouping, signs, and non-numeric input', () => {
    expect(parseAmountToFils('300.123')).toBeNull()
    expect(parseAmountToFils('3,000')).toBeNull()
    expect(parseAmountToFils('-300')).toBeNull()
    expect(parseAmountToFils('300e2')).toBeNull()
    expect(parseAmountToFils('abc')).toBeNull()
    expect(parseAmountToFils('')).toBeNull()
  })
})

describe('formatFilsNumber', () => {
  it('prints a whole amount with no cents', () => {
    expect(formatFilsNumber(30_000)).toBe('300')
  })

  it('prints a fractional amount with exactly two digits', () => {
    expect(formatFilsNumber(34_950)).toBe('349.50')
  })

  it('groups thousands by default and can be told not to', () => {
    expect(formatFilsNumber(1_000_000)).toBe('10,000')
    expect(formatFilsNumber(1_000_000, { grouping: false })).toBe('10000')
  })
})

describe('filsToEditableText round-trip', () => {
  it('round-trips a fractional amount through parse -> format -> parse', () => {
    const fils = parseAmountToFils('349.50')
    expect(fils).not.toBeNull()
    const text = filsToEditableText(fils as number)
    expect(text).toBe('349.50')
    expect(parseAmountToFils(text)).toBe(fils)
  })

  it('round-trips a whole amount without introducing a fraction', () => {
    const fils = parseAmountToFils('300')
    expect(filsToEditableText(fils as number)).toBe('300')
  })
})
