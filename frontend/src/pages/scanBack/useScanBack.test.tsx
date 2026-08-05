import { describe, it, expect } from 'vitest'
import { ageDays, ageGroup } from './useScanBack'

// Real wire shape: `Book.created_at` is stored naive LOCAL (Asia/Dubai) but is
// serialized with an explicit `+04:00` offset by `ORMBase._tag_timezone`
// (backend/app/schemas/_base.py) — never bare, never space-separated. Build the
// fixture from an absolute instant `t`, portably (no hardcoding the test
// runner's own timezone): shift the instant 4h forward, format as UTC so the
// printed digits are the Dubai wall-clock face, then swap 'Z' for the explicit
// offset that's actually on the wire.
function dubaiWire(t: number): string {
  return new Date(t + 4 * 3600_000).toISOString().replace('Z', '+04:00')
}

describe('ageDays', () => {
  it('is 0 for a record created moments ago', () => {
    expect(ageDays(dubaiWire(Date.now()))).toBe(0)
  })

  it('floors 10 days + 1 hour to 10 (a +4h misparse would floor this to 9)', () => {
    const t = Date.now() - (10 * 24 + 1) * 3600_000
    expect(ageDays(dubaiWire(t))).toBe(10)
  })

  it('floors 10 days + 23 hours to 10 (a -4h misparse would floor this to 11)', () => {
    const t = Date.now() - (10 * 24 + 23) * 3600_000
    expect(ageDays(dubaiWire(t))).toBe(10)
  })
})

describe('ageGroup', () => {
  it('buckets by the spec boundaries', () => {
    expect(ageGroup(40)).toBe('overMonth')
    expect(ageGroup(30)).toBe('overMonth')
    expect(ageGroup(29)).toBe('weeks')
    expect(ageGroup(14)).toBe('weeks')
    expect(ageGroup(13)).toBe('recent')
    expect(ageGroup(2)).toBe('recent')
  })
})
