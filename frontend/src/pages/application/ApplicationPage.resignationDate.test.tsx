/**
 * The resignation-date input starts on today's date so an untouched form
 * renders exactly what it rendered before the field existed — but a restored
 * draft's own date always wins.
 */
import { describe, expect, it } from 'vitest'

import { seedResignationDate, todayIso } from './resignationDate'

describe('seedResignationDate', () => {
  it('returns today when the form has no value yet', () => {
    expect(seedResignationDate(undefined, '2026-07-30')).toBe('2026-07-30')
    expect(seedResignationDate('', '2026-07-30')).toBe('2026-07-30')
  })

  it('leaves a restored draft value alone', () => {
    expect(seedResignationDate('2026-08-15', '2026-07-30')).toBeNull()
  })

  it('leaves a whitespace-only value alone rather than treating it as empty', () => {
    // A blank-but-present value is still the operator's state; only truly
    // absent values get seeded.
    expect(seedResignationDate('   ', '2026-07-30')).toBeNull()
  })
})

describe('todayIso', () => {
  it('emits plain YYYY-MM-DD, matching the anchored Zod ISO_DATE regex', () => {
    // applicationFormSchema.ts:22 — ISO_DATE = /^\d{4}-\d{2}-\d{2}$/. A
    // toISOString()-style T-suffixed value would fail this outright.
    expect(todayIso()).toMatch(/^\d{4}-\d{2}-\d{2}$/)
  })

  it('pads single-digit month and day from local date parts', () => {
    expect(todayIso(new Date(2026, 0, 5))).toBe('2026-01-05')
  })

  it('uses local date parts, not UTC — an after-midnight local time stays on the local day', () => {
    expect(todayIso(new Date(2026, 6, 31, 0, 30))).toBe('2026-07-31')
  })
})
