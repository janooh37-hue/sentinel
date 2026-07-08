import { beforeEach, describe, expect, it } from 'vitest'
import { getRecentEmployees, recordRecentEmployee } from './employeeRecents'

describe('employeeRecents', () => {
  beforeEach(() => window.localStorage.clear())

  it('records and returns most-recent first, deduped', () => {
    recordRecentEmployee({ id: 'G1', name_en: 'A' })
    recordRecentEmployee({ id: 'G2', name_en: 'B', name_ar: 'ب' })
    recordRecentEmployee({ id: 'G1', name_en: 'A' })
    const rec = getRecentEmployees()
    expect(rec.map((r) => r.id)).toEqual(['G1', 'G2'])
  })

  it('keeps at most 5 and respects limit', () => {
    for (let i = 0; i < 7; i++) recordRecentEmployee({ id: `G${i}`, name_en: `E${i}` })
    expect(getRecentEmployees()).toHaveLength(5)
    expect(getRecentEmployees(3)).toHaveLength(3)
  })

  it('survives corrupted storage', () => {
    window.localStorage.setItem('gssg.employees.recent', '{not json')
    expect(getRecentEmployees()).toEqual([])
  })
})
