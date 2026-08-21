/**
 * unitTallies — the unit rail two pages share.
 *
 * The roster (/duty-locations) and the ORG-tree (/employees/org-tree) render
 * this same rail over the same roster, so the order and the counts are a
 * contract: a rail that disagreed between them would read as two different
 * organisations.
 */

import { describe, expect, it } from 'vitest'

import type { EmployeeListItem } from '@/lib/api'
import { SEED_UNITS, UNASSIGNED, groupByUnit, unitTallies } from '@/lib/dutyUnits'

function person(id: string, unit: string | null, post = 'Gate 1'): EmployeeListItem {
  return {
    id,
    name_en: `Person ${id}`,
    name_ar: null,
    status: 'Active',
    duty_unit: unit,
    duty_post: post,
  } as EmployeeListItem
}

const tally = (people: EmployeeListItem[]) =>
  unitTallies(groupByUnit(people), 'Unassigned')

describe('unitTallies', () => {
  it('always lists all six seed units, in seed order, even at zero', () => {
    const rail = tally([person('G-1', SEED_UNITS[2])])

    expect(rail.map((item) => item.key)).toEqual([...SEED_UNITS])
    expect(rail[2].count).toBe(1)
    // Empty seed units are kept: they carry the org structure and are valid
    // transfer destinations.
    expect(rail.filter((item) => item.count === 0)).toHaveLength(SEED_UNITS.length - 1)
  })

  it('counts every post in a unit, not just the first', () => {
    const rail = tally([
      person('G-1', SEED_UNITS[0], 'Gate 1'),
      person('G-2', SEED_UNITS[0], 'Gate 2'),
      person('G-3', SEED_UNITS[0], ''),
    ])

    expect(rail.find((item) => item.key === SEED_UNITS[0])?.count).toBe(3)
  })

  it('appends unknown units after the seeds and labels them by key', () => {
    const rail = tally([person('G-1', 'Temporary Detachment')])

    expect(rail.at(-1)).toEqual({ key: 'Temporary Detachment', label: 'Temporary Detachment', count: 1 })
  })

  it('puts Unassigned last and gives it the supplied label', () => {
    const rail = tally([person('G-1', null), person('G-2', SEED_UNITS[0])])

    expect(rail.at(-1)).toEqual({ key: UNASSIGNED, label: 'Unassigned', count: 1 })
  })

  it('omits Unassigned entirely when nobody is unassigned', () => {
    const rail = tally([person('G-1', SEED_UNITS[1])])

    expect(rail.some((item) => item.key === UNASSIGNED)).toBe(false)
  })

  it('treats a blank duty unit as unassigned rather than a unit named ""', () => {
    const rail = tally([person('G-1', '   ')])

    expect(rail.at(-1)?.key).toBe(UNASSIGNED)
    expect(rail.filter((item) => item.key === '')).toHaveLength(0)
  })
})
