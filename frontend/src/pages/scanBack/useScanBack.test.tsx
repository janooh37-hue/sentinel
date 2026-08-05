import { describe, it, expect } from 'vitest'
import { ageDays, ageGroup } from './useScanBack'

describe('ageDays', () => {
  it('reads a naive local timestamp without shifting it', () => {
    // Book.created_at arrives as naive LOCAL time. Appending 'Z' (or letting
    // Date parse it as UTC) would shift it 4h on this box and mis-bucket a
    // record sitting near a group boundary.
    const d = new Date()
    d.setDate(d.getDate() - 10)
    const naive = d.toISOString().slice(0, 19).replace('T', ' ')
    expect(ageDays(naive)).toBe(10)
  })

  it('is 0 for a record created moments ago', () => {
    const naive = new Date().toISOString().slice(0, 19).replace('T', ' ')
    expect(ageDays(naive)).toBe(0)
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
