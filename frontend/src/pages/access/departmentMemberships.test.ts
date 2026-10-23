import { describe, expect, it } from 'vitest'
import type { AdminUserRead, DepartmentMembership } from '@/lib/api'
import { groupDepartmentUsers, membershipsSchema, primaryDepartment, removeMembership } from './departmentMemberships'

const memberships: DepartmentMembership[] = [
  { department_id: 1, role: 'head', is_primary: true },
  { department_id: 2, role: 'deputy', is_primary: false },
]

function user(id: number, departments: DepartmentMembership[]): AdminUserRead {
  return {
    id, email: `${id}@example.com`, employee_id: null, display_name: null, name_en: null,
    role: 'operator', status: 'active', failed_attempts: 0, last_login_at: null, created_at: null,
    is_default_manager: false, password_change_required: false,
    departments: departments.map((m) => ({ ...m, name_en: `Department ${m.department_id}`, name_ar: 'قسم' })),
  }
}

describe('department memberships', () => {
  it('allows no memberships and head, deputy, member with exactly one primary', () => {
    expect(membershipsSchema.safeParse({ memberships: [] }).success).toBe(true)
    expect(membershipsSchema.safeParse({ memberships }).success).toBe(true)
    expect(membershipsSchema.safeParse({ memberships: [{ ...memberships[0], role: 'member' }] }).success).toBe(true)
  })
  it('rejects duplicate departments, missing primary, and multiple primaries', () => {
    expect(membershipsSchema.safeParse({ memberships: [memberships[0], memberships[0]] }).success).toBe(false)
    expect(membershipsSchema.safeParse({ memberships: memberships.map((m) => ({ ...m, is_primary: false })) }).success).toBe(false)
    expect(membershipsSchema.safeParse({ memberships: memberships.map((m) => ({ ...m, is_primary: true })) }).success).toBe(false)
  })
  it('promotes the remaining membership when removing the primary, without mutating input', () => {
    expect(removeMembership(memberships, 1)).toEqual([{ ...memberships[1], is_primary: true }])
    expect(removeMembership(memberships, 2)).toEqual([memberships[0]])
    expect(removeMembership([memberships[0]!], 1)).toEqual([])
    expect(memberships[1]?.is_primary).toBe(false)
  })
  it('groups by primary, highlights unassigned first, and filters across secondary memberships', () => {
    const users = [user(1, memberships), user(2, []), user(3, [{ ...memberships[1]!, is_primary: true }])]
    expect(primaryDepartment(users[0]!)?.department_id).toBe(1)
    expect(groupDepartmentUsers(users, 'all').map(([id, rows]) => [id, rows.map((u) => u.id)])).toEqual([[null, [2]], [1, [1]], [2, [3]]])
    expect(groupDepartmentUsers(users, 'none').map(([, rows]) => rows.map((u) => u.id))).toEqual([[2]])
    expect(groupDepartmentUsers(users, 2).map(([, rows]) => rows.map((u) => u.id))).toEqual([[1, 3]])
  })
})
