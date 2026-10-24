/**
 * Client-side department arithmetic for Organization & departments.
 *
 * The server owns the truth (`employees.department_id`, `departments.parent_id`),
 * but setup screens must show what a change *would* do before it is saved.
 * `deriveMembership` mirrors `department_tree_service._resolver` exactly: the
 * nearest active head or hand placement up the reporting line wins, a placement
 * into an inactive department falls through, and a supervisor cycle resolves to
 * no department. Everything here is pure so the preview rules stay testable.
 */

import type { DepartmentExceptionRead, DepartmentRead, OrgNodeRead } from '@/lib/api'
import { departmentHasReceiver } from '@/lib/departments'
import { compareOrgPeople } from '@/lib/orgTree'

/** The fields the derivation reads, so previews can pass edited copies. */
export type DepartmentAnchor = Pick<DepartmentRead, 'id' | 'active' | 'head_employee_id'>
export type Placement = Pick<DepartmentExceptionRead, 'employee_id' | 'department_id'>

export type Membership = Map<string, number | null>

export interface OrgIndex {
  people: readonly OrgNodeRead[]
  byId: ReadonlyMap<string, OrgNodeRead>
  /** Direct reports in reporting-line order. */
  reports: ReadonlyMap<string, OrgNodeRead[]>
  supervisorOf: (id: string) => string | null
  /** The person plus everyone below them, cycle-safe. */
  branchSize: (id: string) => number
  branchIds: (id: string) => string[]
}

export function buildOrgIndex(people: readonly OrgNodeRead[]): OrgIndex {
  const byId = new Map(people.map((person) => [person.id, person]))
  const reports = new Map<string, OrgNodeRead[]>()
  for (const person of people) {
    const supervisor = person.supervisor_id
    if (!supervisor || supervisor === person.id || !byId.has(supervisor)) continue
    const list = reports.get(supervisor) ?? []
    list.push(person)
    reports.set(supervisor, list)
  }
  for (const list of reports.values()) list.sort(compareOrgPeople)
  const supervisorOf = (id: string): string | null => {
    const supervisor = byId.get(id)?.supervisor_id
    return supervisor && supervisor !== id && byId.has(supervisor) ? supervisor : null
  }
  const branchIds = (id: string): string[] => {
    const seen = new Set<string>()
    const pending = [id]
    while (pending.length) {
      const next = pending.pop()!
      if (seen.has(next) || !byId.has(next)) continue
      seen.add(next)
      for (const report of reports.get(next) ?? []) pending.push(report.id)
    }
    return [...seen]
  }
  const sizes = new Map<string, number>()
  const branchSize = (id: string): number => {
    let size = sizes.get(id)
    if (size === undefined) {
      size = branchIds(id).length
      sizes.set(id, size)
    }
    return size
  }
  return { people, byId, reports, supervisorOf, branchSize, branchIds }
}

/** Anchors the server honours: active heads, and placements that are outside
 *  every department or point at an active one. */
function anchors(
  departments: readonly DepartmentAnchor[],
  exceptions: readonly Placement[],
  extraHeads?: ReadonlyMap<string, number>,
): { heads: Map<string, number>; placements: Map<string, number | null> } {
  const active = new Set(departments.filter((department) => department.active).map((department) => department.id))
  const heads = new Map<string, number>()
  for (const department of departments) {
    if (department.active) heads.set(department.head_employee_id, department.id)
  }
  for (const [headId, id] of extraHeads ?? []) heads.set(headId, id)
  const placements = new Map<string, number | null>()
  for (const exception of exceptions) {
    if (exception.department_id === null || active.has(exception.department_id)) {
      placements.set(exception.employee_id, exception.department_id)
    }
  }
  return { heads, placements }
}

/** Every employee's department, as `department_tree_service.recompute` would write it. */
export function deriveMembership(
  index: OrgIndex,
  departments: readonly DepartmentAnchor[],
  exceptions: readonly Placement[],
  extraHeads?: ReadonlyMap<string, number>,
): Membership {
  const { heads, placements } = anchors(departments, exceptions, extraHeads)
  const resolved: Membership = new Map()
  for (const start of index.people) {
    const path: string[] = []
    const onPath = new Set<string>()
    let node: string | null = start.id
    let value: number | null = null
    while (node !== null) {
      if (resolved.has(node)) {
        value = resolved.get(node)!
        break
      }
      if (onPath.has(node)) {
        value = null
        break
      }
      path.push(node)
      onPath.add(node)
      if (heads.has(node)) {
        value = heads.get(node)!
        break
      }
      if (placements.has(node)) {
        value = placements.get(node)!
        break
      }
      node = index.supervisorOf(node)
    }
    for (const item of path) resolved.set(item, value)
  }
  return resolved
}

export interface MembershipChange {
  employeeId: string
  from: number | null
  to: number | null
}

export function membershipChanges(before: Membership, after: Membership): MembershipChange[] {
  const changes: MembershipChange[] = []
  for (const [employeeId, from] of before) {
    const to = after.get(employeeId) ?? null
    if (to !== from) changes.push({ employeeId, from, to })
  }
  return changes
}

/** Group changes by where people come from, largest group first. */
export function countBy<T>(items: readonly T[], key: (item: T) => number | null): Array<{ from: number | null; count: number }> {
  const counts = new Map<number | null, number>()
  for (const item of items) counts.set(key(item), (counts.get(key(item)) ?? 0) + 1)
  return [...counts].map(([from, count]) => ({ from, count })).sort((a, b) => b.count - a.count)
}

export type DraftParent =
  | { kind: 'none' }
  | { kind: 'department'; id: number }
  | { kind: 'draft'; headId: string }

export interface DraftPreview {
  headId: string
  parent: DraftParent
  /** People whose department this draft becomes (sub-departments excluded). */
  memberIds: string[]
  /** The head plus everyone below them, whatever their department. */
  branchSize: number
  /** Where the members sit today. */
  movedFrom: Array<{ from: number | null; count: number }>
}

/**
 * What creating departments headed by `headIds` would do, computed together:
 * proposed heads nest under each other, and existing heads and hand placements
 * keep their effect.
 */
export function previewDrafts(
  index: OrgIndex,
  departments: readonly DepartmentAnchor[],
  exceptions: readonly Placement[],
  headIds: readonly string[],
): DraftPreview[] {
  const tempIds = new Map(headIds.map((headId, position) => [headId, -1 - position]))
  const headByTemp = new Map([...tempIds].map(([headId, temp]) => [temp, headId]))
  const before = deriveMembership(index, departments, exceptions)
  const after = deriveMembership(index, departments, exceptions, tempIds)
  return headIds.map((headId) => {
    const temp = tempIds.get(headId)!
    const memberIds = [...after].filter(([, value]) => value === temp).map(([id]) => id)
    const supervisor = index.supervisorOf(headId)
    const parentValue = supervisor === null ? null : after.get(supervisor) ?? null
    const parent: DraftParent = parentValue === null || parentValue === temp
      ? { kind: 'none' }
      : parentValue < 0
        ? { kind: 'draft', headId: headByTemp.get(parentValue)! }
        : { kind: 'department', id: parentValue }
    return {
      headId,
      parent,
      memberIds,
      branchSize: index.branchSize(headId),
      movedFrom: countBy(memberIds, (id) => before.get(id) ?? null),
    }
  })
}

export type WhyIncluded =
  | { kind: 'head' }
  | { kind: 'reporting' }
  | { kind: 'placed' }
  | { kind: 'placedOutside' }
  | { kind: 'placedThrough'; employeeId: string }
  | { kind: 'outsideThrough'; employeeId: string }
  | { kind: 'outside' }

/** Which anchor decides a person's department: the same walk as the derivation. */
export function whyIncluded(
  index: OrgIndex,
  departments: readonly DepartmentAnchor[],
  exceptions: readonly Placement[],
  personId: string,
): WhyIncluded {
  const { heads, placements } = anchors(departments, exceptions)
  const seen = new Set<string>()
  let node: string | null = personId
  while (node !== null && !seen.has(node)) {
    seen.add(node)
    if (heads.has(node)) return node === personId ? { kind: 'head' } : { kind: 'reporting' }
    if (placements.has(node)) {
      const placedIn = placements.get(node)
      if (node === personId) return placedIn === null ? { kind: 'placedOutside' } : { kind: 'placed' }
      return placedIn === null ? { kind: 'outsideThrough', employeeId: node } : { kind: 'placedThrough', employeeId: node }
    }
    node = index.supervisorOf(node)
  }
  return { kind: 'outside' }
}

export interface ManagerSuggestion {
  person: OrgNodeRead
  unit: string | null
  branchSize: number
}

/** The top of each reporting tree that has a team: one natural department per unit. */
export function unitSuggestions(index: OrgIndex): ManagerSuggestion[] {
  return index.people
    .filter((person) => index.supervisorOf(person.id) === null && (index.reports.get(person.id)?.length ?? 0) > 0)
    .map((person) => ({ person, unit: person.duty_unit, branchSize: index.branchSize(person.id) }))
    .sort((a, b) => b.branchSize - a.branchSize || compareOrgPeople(a.person, b.person))
}

/** Direct reports who manage people themselves, for splitting a unit. */
export function managersUnder(index: OrgIndex, id: string): ManagerSuggestion[] {
  return (index.reports.get(id) ?? [])
    .filter((person) => (index.reports.get(person.id)?.length ?? 0) > 0)
    .map((person) => ({ person, unit: person.duty_unit, branchSize: index.branchSize(person.id) }))
}

export interface Coverage {
  total: number
  inDepartment: number
  outside: number
}

export function coverageOf(people: readonly OrgNodeRead[]): Coverage {
  const inDepartment = people.filter((person) => person.department_id != null).length
  return { total: people.length, inDepartment, outside: people.length - inDepartment }
}

export type Attention = 'noReceiver' | 'noServices'

/** Configuration gaps worth fixing before (or while) access limits are on. */
export function attentionOf(department: DepartmentRead): Attention[] {
  if (!department.active) return []
  const issues: Attention[] = []
  if (!departmentHasReceiver(department)) issues.push('noReceiver')
  if (department.service_ids.length === 0) issues.push('noServices')
  return issues
}

export type ServiceMode = 'replace' | 'add'

export function applyServiceSelection(current: readonly string[], chosen: readonly string[], mode: ServiceMode): string[] {
  return mode === 'replace' ? [...chosen] : [...new Set([...current, ...chosen])]
}

/** Department ancestors from the top down, for a "Part of" line. */
export function departmentPath(departments: readonly DepartmentRead[], id: number): DepartmentRead[] {
  const byId = new Map(departments.map((department) => [department.id, department]))
  const path: DepartmentRead[] = []
  const seen = new Set<number>([id])
  let parentId = byId.get(id)?.parent_id ?? null
  while (parentId !== null && !seen.has(parentId)) {
    seen.add(parentId)
    const parent = byId.get(parentId)
    if (!parent) break
    path.unshift(parent)
    parentId = parent.parent_id
  }
  return path
}
