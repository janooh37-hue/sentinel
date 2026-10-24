import { describe, expect, it } from 'vitest'

import type { DepartmentExceptionRead, DepartmentRead, OrgNodeRead } from '@/lib/api'
import {
  applyServiceSelection,
  attentionOf,
  buildOrgIndex,
  coverageOf,
  deriveMembership,
  managersUnder,
  membershipChanges,
  previewDrafts,
  unitSuggestions,
  whyIncluded,
} from './model'

function person(id: string, supervisor_id: string | null, over: Partial<OrgNodeRead> = {}): OrgNodeRead {
  return {
    id, name_en: id, name_ar: null, position: null, position_ar: null, department: null,
    duty_unit: 'Admin office', duty_post: null, status: 'Active', supervisor_id, department_id: null, ...over,
  }
}

function department(id: number, head: string, over: Partial<DepartmentRead> = {}): DepartmentRead {
  return {
    id, name_en: `D${id}`, name_ar: `ق${id}`, head_employee_id: head, head_name_en: head, head_name_ar: null,
    head_user_id: 1, parent_id: null, active: true, employee_count: 0, deputies: [], viewers: [],
    service_ids: ['leave'], exception_count: 0, ...over,
  }
}

function exception(employee_id: string, department_id: number | null): DepartmentExceptionRead {
  return {
    employee_id, name_en: employee_id, name_ar: null, department_id, tree_department_id: null,
    created_by: null, created_at: '2026-10-24T00:00:00Z',
  }
}

// G1 heads D1 and runs the admin office; G2 and G3 manage under G1.
// G7 is a second root with no department.
const PEOPLE = [
  person('G1', null, { department_id: 1, head_of_department_id: 1 }),
  person('G2', 'G1', { department_id: 1 }),
  person('G3', 'G1', { department_id: 1 }),
  person('G4', 'G2', { department_id: 1 }),
  person('G5', 'G2', { department_id: 1 }),
  person('G6', 'G3', { department_id: 1 }),
  person('G7', null, { duty_unit: 'First company' }),
  person('G8', 'G7', { duty_unit: 'First company' }),
]
const D1 = department(1, 'G1')

describe('deriveMembership', () => {
  it('follows the nearest head up the reporting line, like the server', () => {
    const index = buildOrgIndex(PEOPLE)
    const membership = deriveMembership(index, [D1], [])
    expect(membership.get('G6')).toBe(1)
    expect(membership.get('G8')).toBeNull()
  })

  it('moves a branch with a hand placement and stops at a lower head', () => {
    const index = buildOrgIndex(PEOPLE)
    const d2 = department(2, 'G6')
    const membership = deriveMembership(index, [D1, d2], [exception('G3', null)])
    expect(membership.get('G3')).toBeNull()
    expect(membership.get('G6')).toBe(2)
  })

  it('lets an inactive department and a placement into it fall through to the department above', () => {
    const index = buildOrgIndex(PEOPLE)
    const inactive = department(2, 'G2', { active: false })
    const membership = deriveMembership(index, [D1, inactive], [exception('G6', 2)])
    expect(membership.get('G4')).toBe(1)
    expect(membership.get('G6')).toBe(1)
  })

  it('resolves people on a supervisor cycle to no department', () => {
    const index = buildOrgIndex([person('A', 'B'), person('B', 'A'), person('C', 'A')])
    const membership = deriveMembership(index, [], [])
    expect([...membership.values()]).toEqual([null, null, null])
  })
})

describe('previewDrafts', () => {
  it('derives the parent, members and moves of a proposed head before anything is saved', () => {
    const index = buildOrgIndex(PEOPLE)
    const [preview] = previewDrafts(index, [D1], [], ['G2'])
    expect(preview).toMatchObject({ headId: 'G2', parent: { kind: 'department', id: 1 }, branchSize: 3 })
    expect(preview!.memberIds.toSorted()).toEqual(['G2', 'G4', 'G5'])
    expect(preview!.movedFrom).toEqual([{ from: 1, count: 3 }])
  })

  it('nests one proposed head under another and counts members separately from the branch', () => {
    const index = buildOrgIndex(PEOPLE)
    const [unit, section] = previewDrafts(index, [], [], ['G1', 'G3'])
    expect(unit).toMatchObject({ parent: { kind: 'none' }, branchSize: 6 })
    expect(unit!.memberIds.toSorted()).toEqual(['G1', 'G2', 'G4', 'G5'])
    expect(section).toMatchObject({ parent: { kind: 'draft', headId: 'G1' }, branchSize: 2 })
    expect(section!.memberIds.toSorted()).toEqual(['G3', 'G6'])
  })

  it('keeps hand placements in the calculation', () => {
    const index = buildOrgIndex(PEOPLE)
    const [preview] = previewDrafts(index, [D1], [exception('G5', null)], ['G2'])
    expect(preview!.memberIds.toSorted()).toEqual(['G2', 'G4'])
    expect(preview!.branchSize).toBe(3)
  })

  it('counts derived sub-department members apart from people placed elsewhere or outside', () => {
    const index = buildOrgIndex(PEOPLE)
    // G1's branch: G1..G6. G3 heads a proposed sub-department; G5 is placed outside by hand.
    const [unit] = previewDrafts(index, [], [exception('G5', null)], ['G1', 'G3'])
    expect(unit!.memberIds.toSorted()).toEqual(['G1', 'G2', 'G4'])
    expect(unit).toMatchObject({ branchSize: 6, inSubDepartments: 2, elsewhere: 1 })
  })

  it('breaks a derived department-parent cycle, like the server', () => {
    // Two roots whose reports are placed by hand into each other's proposed department.
    const people = [person('A', null), person('A2', 'A'), person('B', null), person('B2', 'B'), person('HA', 'B2'), person('HB', 'A2')]
    const index = buildOrgIndex(people)
    const departments = [department(1, 'A'), department(2, 'B')]
    // HA reports into department 2's branch, HB into department 1's: drafts nest both ways only via the existing ones.
    const previews = previewDrafts(index, departments, [exception('A2', 2), exception('B2', 1)], ['HA', 'HB'])
    // HA's supervisor B2 is placed in 1 → parent 1; HB's supervisor A2 in 2 → parent 2: no cycle here.
    expect(previews.map((item) => item.parent)).toEqual([{ kind: 'department', id: 1 }, { kind: 'department', id: 2 }])
    // Department heads whose supervisors sit in each other's drafts form a cycle and resolve to top-level.
    const loop = [person('X', 'Y2'), person('X2', 'X'), person('Y', 'X2'), person('Y2', 'Y')]
    const [x, y] = previewDrafts(buildOrgIndex(loop), [], [], ['X', 'Y'])
    expect([x!.parent, y!.parent]).toEqual([{ kind: 'none' }, { kind: 'none' }])
  })
})

describe('whyIncluded', () => {
  it('names the head, the reporting line, an own placement and a placement inherited from a manager', () => {
    const index = buildOrgIndex(PEOPLE)
    const d2 = department(2, 'G7')
    const departments = [D1, d2]
    const exceptions = [exception('G3', 2)]
    expect(whyIncluded(index, departments, exceptions, 'G1')).toEqual({ kind: 'head' })
    expect(whyIncluded(index, departments, exceptions, 'G4')).toEqual({ kind: 'reporting' })
    expect(whyIncluded(index, departments, exceptions, 'G3')).toEqual({ kind: 'placed' })
    expect(whyIncluded(index, departments, exceptions, 'G6')).toEqual({ kind: 'placedThrough', employeeId: 'G3' })
    expect(whyIncluded(index, departments, [exception('G3', null)], 'G6')).toEqual({ kind: 'outsideThrough', employeeId: 'G3' })
    expect(whyIncluded(index, [], [], 'G8')).toEqual({ kind: 'outside' })
  })
})

describe('suggestions', () => {
  it('suggests each unit top with its whole team, and splits a unit into its managers', () => {
    const index = buildOrgIndex(PEOPLE)
    expect(unitSuggestions(index).map(({ person: p, branchSize, unit }) => [p.id, unit, branchSize])).toEqual([
      ['G1', 'Admin office', 6],
      ['G7', 'First company', 2],
    ])
    expect(managersUnder(index, 'G1').map(({ person: p, branchSize }) => [p.id, branchSize])).toEqual([
      ['G2', 3],
      ['G3', 2],
    ])
  })
})

describe('register helpers', () => {
  it('counts working employees once for coverage, like the outside-departments review', () => {
    expect(coverageOf(PEOPLE)).toEqual({ total: 8, inDepartment: 6, outside: 2 })
    const withLeavers = [...PEOPLE, person('G9', null, { status: 'Resigned' }), person('G10', 'G1', { status: 'Loaned', department_id: 1 })]
    expect(coverageOf(withLeavers)).toEqual({ total: 9, inDepartment: 7, outside: 2 })
  })

  it('reports a missing receiver before missing services and ignores inactive departments', () => {
    expect(attentionOf(department(1, 'G1', { head_user_id: null, service_ids: [] }))).toEqual(['noReceiver', 'noServices'])
    expect(attentionOf(department(1, 'G1', { head_user_id: null, deputies: [{ user_id: 4, display_name: 'D', role: 'deputy' }] }))).toEqual([])
    expect(attentionOf(department(1, 'G1', { active: false, service_ids: [] }))).toEqual([])
  })

  it('replaces or adds a batch service selection', () => {
    expect(applyServiceSelection(['a', 'b'], ['c'], 'replace')).toEqual(['c'])
    expect(applyServiceSelection(['a', 'b'], ['b', 'c'], 'add')).toEqual(['a', 'b', 'c'])
  })

  it('lists who moves when the inputs change', () => {
    const index = buildOrgIndex(PEOPLE)
    const before = deriveMembership(index, [D1], [])
    const after = deriveMembership(index, [D1], [exception('G3', null)])
    expect(membershipChanges(before, after)).toEqual([
      { employeeId: 'G3', from: 1, to: null },
      { employeeId: 'G6', from: 1, to: null },
    ])
  })
})
