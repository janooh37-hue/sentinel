import type { QueryClient } from '@tanstack/react-query'
import { AUTH_KEY } from './authContext'
import type { TFunction } from 'i18next'
import {
  ApiError,
  apiErrorMessage,
  type AdminUserRead,
  type DepartmentRead,
  type UserDepartmentRead,
} from './api'

const DEPARTMENT_ERROR_KEYS: Record<string, string | undefined> = {
  DEPARTMENT_IN_USE: 'departments.errors.inUse',
  DEPARTMENT_NAME_TAKEN: 'departments.errors.nameTaken',
  DEPARTMENT_HEAD_TAKEN: 'departments.errors.headTaken',
  DEPARTMENT_HEAD_EXCEPTION: 'departments.errors.headException',
  DEPARTMENT_SERVICE_UNKNOWN: 'departments.errors.serviceUnknown',
  DEPARTMENT_NOT_FOUND: 'departments.errors.notFound',
  DEPARTMENT_OUT_OF_SCOPE: 'departments.errors.outOfScope',
  EMPLOYEE_NOT_FOUND: 'departments.errors.employeeNotFound',
  PERSONAL_DEPARTMENT_SEND: 'books.send.errors.personalDepartment',
  DEPARTMENT_HAS_NO_HEAD: 'books.send.errors.noHead',
  DEPARTMENT_NO_CLEARED_HEAD: 'books.send.errors.noClearedHead',
  DEPARTMENT_SEND_REVOKED: 'books.send.errors.revoked',
  DISTRIBUTE_NOT_MEMBER: 'books.send.errors.notMember',
  DISTRIBUTE_NOT_SUBDEPARTMENT: 'books.send.errors.notSubdepartment',
  DEPARTMENT_SEND_NOT_FOUND: 'books.send.errors.sendNotFound',
}

export function departmentErrorMessage(error: unknown, t: TFunction): string {
  const key = error instanceof ApiError ? DEPARTMENT_ERROR_KEYS[error.code] : undefined
  return key ? t(key) : apiErrorMessage(error)
}

/** Departments derive from the org tree, so any tree or department write can
 *  move people between departments and change every scoped view, including
 *  the session's own `department_scope_kind` and `departments`. */
export function invalidateDepartmentData(qc: QueryClient): void {
  for (const queryKey of [
    AUTH_KEY,
    ['departments'],
    ['department-scoping'],
    ['org-tree'],
    ['employees'],
    ['employee-detail'],
    ['employee-lookup'],
    ['auth-users'],
    ['my-capabilities'],
    ['dashboard'],
  ]) {
    void qc.invalidateQueries({ queryKey })
  }
}

/** Who may open the org-tree editor: it reads the tree and the employee list
 *  (`employees.view`), then relinks (`employees.edit`) or runs departments
 *  (`departments.manage`). Route and tab gates must agree, so both use this. */
export function canOpenOrgEditor(has: (capability: string) => boolean): boolean {
  return has('employees.view') && (has('employees.edit') || has('departments.manage'))
}

export function departmentName(
  department: { name_en: string; name_ar: string },
  language: string,
): string {
  return language.startsWith('ar') ? department.name_ar : department.name_en
}

export function departmentHeadName(department: DepartmentRead, language: string): string {
  return language.startsWith('ar') && department.head_name_ar?.trim()
    ? department.head_name_ar
    : department.head_name_en
}

/** A department send needs someone to land on: the head's account or a deputy. */
export function departmentHasReceiver(department: DepartmentRead): boolean {
  return department.head_user_id !== null || department.deputies.length > 0
}

function childrenByParent(departments: DepartmentRead[]): Map<number | null, DepartmentRead[]> {
  const children = new Map<number | null, DepartmentRead[]>()
  for (const department of departments) {
    const siblings = children.get(department.parent_id) ?? []
    siblings.push(department)
    children.set(department.parent_id, siblings)
  }
  return children
}

/** Parents precede children; sibling order follows the server's catalogue. */
export function orderDepartments(
  departments: DepartmentRead[],
): Array<{ department: DepartmentRead; depth: number }> {
  const children = childrenByParent(departments)
  const ids = new Set(departments.map((department) => department.id))
  const visited = new Set<number>()
  const ordered: Array<{ department: DepartmentRead; depth: number }> = []
  function visit(department: DepartmentRead, depth: number): void {
    if (visited.has(department.id)) return
    visited.add(department.id)
    ordered.push({ department, depth })
    for (const child of children.get(department.id) ?? []) visit(child, depth + 1)
  }
  for (const department of departments) {
    if (department.parent_id === null || !ids.has(department.parent_id)) visit(department, 0)
  }
  // Keep a malformed disconnected cycle visible without recursing forever.
  for (const department of departments) visit(department, 0)
  return ordered
}

/** The department itself plus every derived sub-department below it. */
export function departmentDescendantIds(departments: DepartmentRead[], id: number): Set<number> {
  const children = childrenByParent(departments)
  const descendants = new Set<number>()
  const pending = [id]
  while (pending.length) {
    const next = pending.pop()!
    if (descendants.has(next)) continue
    descendants.add(next)
    for (const child of children.get(next) ?? []) pending.push(child.id)
  }
  return descendants
}

/**
 * Departments whose people a user may filter by: heads and deputies see their
 * department and every nested one, viewers see only that department, and
 * plain membership grants no department view at all.
 */
export function visibleDepartmentIds(
  departments: DepartmentRead[],
  memberships: UserDepartmentRead[],
): Set<number> {
  const visible = new Set<number>()
  for (const membership of memberships) {
    if (membership.role === 'viewer') visible.add(membership.department_id)
    else if (membership.role === 'head' || membership.role === 'deputy') {
      for (const id of departmentDescendantIds(departments, membership.department_id)) visible.add(id)
    }
  }
  return visible
}

/** The department a user sits in through the org tree, else their first grant. */
export function primaryDepartment(user: Pick<AdminUserRead, 'departments'>): UserDepartmentRead | undefined {
  return user.departments?.find((m) => m.role === 'head' || m.role === 'member') ?? user.departments?.[0]
}

export type DepartmentFilter = 'all' | 'none' | number

/** Users grouped by primary department, "no department" first; a number filter keeps any user tied to it. */
export function groupDepartmentUsers(
  users: AdminUserRead[],
  filter: DepartmentFilter,
): Array<[number | null, AdminUserRead[]]> {
  const groups = new Map<number | null, AdminUserRead[]>()
  for (const user of users) {
    const memberships = user.departments ?? []
    if (filter === 'none' && memberships.length > 0) continue
    if (typeof filter === 'number' && !memberships.some((m) => m.department_id === filter)) continue
    const id = typeof filter === 'number' ? filter : primaryDepartment(user)?.department_id ?? null
    const group = groups.get(id)
    if (group) group.push(user)
    else groups.set(id, [user])
  }
  return [...groups].sort(([a], [b]) => a === null ? -1 : b === null ? 1 : a - b)
}
