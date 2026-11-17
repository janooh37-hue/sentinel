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
import {
  ENDED_SERVICE,
  SEED_UNITS,
  TRANSFERRED,
  UNASSIGNED,
  departedTallies,
  groupByUnit,
  groupRoster,
  unitTallies,
} from '@/lib/dutyUnits'

function person(id: string, unit: string | null, post = 'Gate 1', status = 'Active'): EmployeeListItem {
  return {
    id,
    name_en: `Person ${id}`,
    name_ar: null,
    status,
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

describe('groupRoster', () => {
  const labels = { [ENDED_SERVICE]: 'Ended service', [TRANSFERRED]: 'Transferred' }
  const rail = (people: EmployeeListItem[]) => {
    const grouped = groupRoster(people)
    return [...unitTallies(grouped.units, 'Unassigned'), ...departedTallies(grouped.departed, labels)]
  }

  it('keeps departed staff out of their old unit and out of Unassigned', () => {
    const grouped = groupRoster([
      person('G-1', SEED_UNITS[0]),
      person('G-2', SEED_UNITS[0], 'Gate 1', 'Resigned'),
      person('G-3', null, '', 'Transferred'),
      person('G-4', SEED_UNITS[0], 'Gate 1', 'Loaned'),
    ])

    expect(grouped.units.get(SEED_UNITS[0])?.get('Gate 1')?.map((e) => e.id)).toEqual(['G-1', 'G-4'])
    expect(grouped.units.has(UNASSIGNED)).toBe(false)
    expect([...grouped.departed.keys()]).toEqual([ENDED_SERVICE, TRANSFERRED])
  })

  it('lists Ended service then Transferred after Unassigned, counting only departed staff', () => {
    const items = rail([
      person('G-1', null),
      person('G-2', SEED_UNITS[0], 'Gate 1', 'Transferred'),
      person('G-3', null, '', 'Terminated'),
      person('G-4', null, '', 'Resigned'),
    ])

    expect(items.slice(-3)).toEqual([
      { key: UNASSIGNED, label: 'Unassigned', count: 1 },
      { key: ENDED_SERVICE, label: 'Ended service', count: 2 },
      { key: TRANSFERRED, label: 'Transferred', count: 1 },
    ])
    expect(items.find((item) => item.key === SEED_UNITS[0])?.count).toBe(0)
  })

  it('groups Ended service by status, Resigned before Terminated', () => {
    const grouped = groupRoster([
      person('G-1', null, '', 'Terminated'),
      person('G-2', null, '', 'Resigned'),
    ])

    expect([...(grouped.departed.get(ENDED_SERVICE)?.keys() ?? [])]).toEqual(['Resigned', 'Terminated'])
  })

  it('shows a departed group only when someone is in it', () => {
    const items = rail([person('G-1', SEED_UNITS[0]), person('G-2', null, '', 'Resigned')])

    expect(items.some((item) => item.key === TRANSFERRED)).toBe(false)
    expect(items.at(-1)?.key).toBe(ENDED_SERVICE)
  })
})
