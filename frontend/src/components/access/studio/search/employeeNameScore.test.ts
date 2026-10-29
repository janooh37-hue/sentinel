import { describe, expect, it } from 'vitest'
import { EMPLOYEE_NAME_MATCH_THRESHOLD, employeeNameScore } from './employeeNameScore'

describe('employeeNameScore: existing RapidFuzz token-sort Indel semantics', () => {
  it('retains the employee search threshold of 70', () => {
    expect(EMPLOYEE_NAME_MATCH_THRESHOLD).toBe(70)
    expect(employeeNameScore('abcdefghij', 'abcdefgxyz')).toBe(70)
    expect(employeeNameScore('abcdefghij', 'abcdefwxyz')).toBeLessThan(70)
  })

  it.each([
    ['Ali Mohammed', 'Mohammed Ali'],
    ['محمد علي', 'علي محمد'],
    [' ALI-MOHAMMED. ', 'mohammed ali'],
    ['Ali\t\nMohammed', 'ali mohammed'],
  ])('ignores token order, case and punctuation for %j / %j', (query, candidate) => {
    expect(employeeNameScore(query, candidate)).toBe(100)
  })

  it('uses insertion/deletion similarity rather than substitution-cost-one edit distance', () => {
    expect(employeeNameScore('ab', 'ac')).toBe(50)
    expect(employeeNameScore('kitten', 'sitting')).toBeCloseTo((8 / 13) * 100)
    expect(employeeNameScore('mohamed', 'mohammed')).toBeCloseTo((14 / 15) * 100)
  })

  it('uses a longest common subsequence, not a substring or a partial ratio', () => {
    expect(employeeNameScore('abc', 'axbyc')).toBe(75)
    expect(employeeNameScore('ali', 'ali hassan')).toBeCloseTo((6 / 13) * 100)
    expect(employeeNameScore('ab', 'ba')).toBe(50)
  })

  it('retains duplicate tokens rather than using token-set similarity', () => {
    expect(employeeNameScore('ali ali', 'ali')).toBe(60)
  })

  it('preserves native Unicode alphanumeric processing and Arabic letters', () => {
    expect(employeeNameScore('ali_hassan', 'ali hassan')).toBe(100)
    expect(employeeNameScore('أحمد', 'احمد')).toBe(75)
    expect(employeeNameScore('محمد-علي', 'علي محمد')).toBe(100)
    expect(employeeNameScore('İ', 'i')).toBe(100)
    expect(employeeNameScore('ΟΣ', 'οσ')).toBe(100)
  })

  it('counts Unicode code points rather than UTF-16 code units', () => {
    expect(employeeNameScore('𐐨a', '𐐨b')).toBe(50)
    expect(employeeNameScore('𐐀 a', 'a 𐐨')).toBe(100)
  })

  it('retains the primitive scorer empty-string behavior', () => {
    expect(employeeNameScore('', '')).toBe(100)
    expect(employeeNameScore('... ', '!!!')).toBe(100)
    expect(employeeNameScore('', 'ali')).toBe(0)
    expect(employeeNameScore('ali', '')).toBe(0)
  })

  it.each([
    ['محمد علي', 'محمد عادل'],
    ['Alice', 'Alise'],
    ['abc xyz', 'axy zbc'],
  ])('is symmetric for %j and %j', (left, right) => {
    expect(employeeNameScore(left, right)).toBe(employeeNameScore(right, left))
  })
})
