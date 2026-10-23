import { z } from 'zod'
import type { AdminUserRead, DepartmentMembership } from '@/lib/api'

export const membershipsSchema = z.object({
  memberships: z.array(z.object({
    department_id: z.number().int().positive(),
    role: z.enum(['head', 'deputy', 'member']),
    is_primary: z.boolean(),
  })).superRefine((memberships, ctx) => {
    if (new Set(memberships.map((m) => m.department_id)).size !== memberships.length) {
      ctx.addIssue({ code: 'custom', message: 'departmentAccess.duplicateDepartment' })
    }
    if (memberships.length > 0 && memberships.filter((m) => m.is_primary).length !== 1) {
      ctx.addIssue({ code: 'custom', message: 'departmentAccess.primaryRequired' })
    }
  }),
})

export function removeMembership(memberships: DepartmentMembership[], departmentId: number): DepartmentMembership[] {
  const remaining = memberships.filter((m) => m.department_id !== departmentId)
  if (remaining.length > 0 && !remaining.some((m) => m.is_primary)) {
    return remaining.map((m, index) => ({ ...m, is_primary: index === 0 }))
  }
  return remaining
}

export function primaryDepartment(user: Pick<AdminUserRead, 'departments'>) {
  return user.departments?.find((m) => m.is_primary) ?? user.departments?.[0]
}

export type DepartmentFilter = 'all' | 'none' | number

export function groupDepartmentUsers(users: AdminUserRead[], filter: DepartmentFilter) {
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
