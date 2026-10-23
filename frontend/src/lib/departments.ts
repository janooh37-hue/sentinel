import type { TFunction } from 'i18next'
import { ApiError, apiErrorMessage, type DepartmentRead } from './api'

const DEPARTMENT_ERROR_KEYS: Record<string, string | undefined> = {
  DEPARTMENT_IN_USE: 'departments.errors.inUse',
  DEPARTMENT_NAME_TAKEN: 'departments.errors.nameTaken',
  DEPARTMENT_CYCLE: 'departments.errors.cycle',
  DEPARTMENT_PRIMARY_REQUIRED: 'departments.errors.primaryRequired',
  DEPARTMENT_MEMBERSHIP_DUPLICATE: 'departments.errors.membershipDuplicate',
  DEPARTMENT_SERVICE_UNKNOWN: 'departments.errors.serviceUnknown',
  DEPARTMENT_NOT_FOUND: 'departments.errors.notFound',
  DEPARTMENT_OUT_OF_SCOPE: 'departments.errors.outOfScope',
  EMPLOYEE_NOT_FOUND: 'departments.errors.employeeNotFound',
}

export function departmentErrorMessage(error: unknown, t: TFunction): string {
  const key = error instanceof ApiError ? DEPARTMENT_ERROR_KEYS[error.code] : undefined
  return key ? t(key) : apiErrorMessage(error)
}

export function departmentName(
  department: { name_en: string; name_ar: string },
  language: string,
): string {
  return language.startsWith('ar') ? department.name_ar : department.name_en
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

/** Includes the department itself, since neither it nor its children can be its parent. */
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
