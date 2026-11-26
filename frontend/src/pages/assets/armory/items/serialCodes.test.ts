import { describe, expect, it } from 'vitest'

import { normalizeArmoryCode, parseSerialEntry } from './serialCodes'

describe('armory serial entry', () => {
  it('normalizes Arabic and Eastern digits, case and leading and trailing whitespace', () => {
    expect(normalizeArmoryCode('  test-١۲/٣۴.a_٥  ')).toEqual({ code: 'TEST-12/34.A_5', valid: true })
  })

  it.each(['', '-TEST', 'TEST#1', 'TEST 1', 'A'.repeat(81)])('rejects invalid code %j', raw => {
    expect(normalizeArmoryCode(raw).valid).toBe(false)
  })

  it('retains scan/paste order and flags every occurrence of a normalized duplicate', () => {
    expect(parseSerialEntry(' test-١\nTEST-2, test-۱; bad#\tTEST-3،TEST-4؛ ')).toEqual([
      { code: 'TEST-1', valid: true, duplicate: true },
      { code: 'TEST-2', valid: true, duplicate: false },
      { code: 'TEST-1', valid: true, duplicate: true },
      { code: 'BAD#', valid: false, duplicate: false },
      { code: 'TEST-3', valid: true, duplicate: false },
      { code: 'TEST-4', valid: true, duplicate: false },
    ])
  })
})
