import { describe, expect, it } from 'vitest'

import {
  MARGIN,
  buildForest,
  directReports,
  isBelow,
  layoutForest,
  supervisorChain,
  type OrgPerson,
} from '../orgTree'

function person(id: string, supervisor_id: string | null = null, position = 'Security Guard'): OrgPerson {
  return {
    id,
    name_en: id,
    name_ar: null,
    position,
    position_ar: null,
    department: null,
    duty_unit: 'Unit A',
    duty_post: 'Main Gate',
    status: 'Active',
    supervisor_id,
  }
}

describe('orgTree', () => {
  it('treats a dangling supervisor as a root', () => {
    const roots = buildForest([person('G-1', 'missing')])

    expect(roots.map((node) => node.person.id)).toEqual(['G-1'])
    expect(roots[0]?.children).toEqual([])
  })

  it('does not hang when stored data already contains a supervisor cycle', () => {
    const people = [person('G-1', 'G-2'), person('G-2', 'G-1')]
    const roots = buildForest(people)

    expect(roots.flatMap((root) => [root.person.id, ...root.children.map((child) => child.person.id)])).toEqual(
      expect.arrayContaining(['G-1', 'G-2']),
    )
    expect(supervisorChain(people, 'G-1').map((entry) => entry.id)).toEqual(['G-2', 'G-1'])
  })

  it('places a single root at the canvas margin', () => {
    const layout = layoutForest(buildForest([person('G-1')]), {
      collapsed: new Set(),
      maxLevel: Number.POSITIVE_INFINITY,
    })

    expect(layout.nodes[0]).toMatchObject({ x: MARGIN, y: MARGIN })
  })

  it('centres a parent between its first and last child centres', () => {
    const layout = layoutForest(buildForest([person('G-1'), person('G-2', 'G-1'), person('G-3', 'G-1')]), {
      collapsed: new Set(),
      maxLevel: Number.POSITIVE_INFINITY,
    })
    const parent = layout.nodes.find((node) => node.node.person.id === 'G-1')!
    const children = layout.nodes.filter((node) => node.node.person.supervisor_id === 'G-1')
    const first = children[0]!
    const last = children.at(-1)!

    expect(parent.x + parent.w / 2).toBe((first.x + first.w / 2 + last.x + last.w / 2) / 2)
  })

  it('caps rendered depth and shrinks the canvas width', () => {
    const roots = buildForest([
      person('G-1'),
      person('G-2', 'G-1'),
      person('G-3', 'G-1'),
      person('G-4', 'G-2'),
      person('G-5', 'G-2'),
      person('G-6', 'G-3'),
      person('G-7', 'G-3'),
    ])
    const full = layoutForest(roots, { collapsed: new Set(), maxLevel: Number.POSITIVE_INFINITY })
    const capped = layoutForest(roots, { collapsed: new Set(), maxLevel: 2 })

    expect(capped.nodes.every((node) => node.level < 2)).toBe(true)
    expect(capped.width).toBeLessThan(full.width)
  })

  it('removes a collapsed subtree from nodes and links', () => {
    const roots = buildForest([person('G-1'), person('G-2', 'G-1'), person('G-3', 'G-2')])
    const layout = layoutForest(roots, { collapsed: new Set(['G-2']), maxLevel: Number.POSITIVE_INFINITY })

    expect(layout.nodes.map((node) => node.node.person.id)).toEqual(['G-1', 'G-2'])
    expect(layout.links).toEqual([expect.objectContaining({ parentId: 'G-1', id: 'G-2' })])
  })

  it('recognises descendants but not siblings as below an employee', () => {
    const people = [person('G-1'), person('G-2', 'G-1'), person('G-3', 'G-1'), person('G-4', 'G-2')]

    expect(isBelow(people, 'G-4', 'G-1')).toBe(true)
    expect(isBelow(people, 'G-3', 'G-2')).toBe(false)
    expect(directReports(people, 'G-1').map((entry) => entry.id)).toEqual(['G-2', 'G-3'])
  })
})
