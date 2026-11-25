import { api, type EmployeeActivityKind, type EmployeeListItem } from '@/lib/api'

export type ActivityFilter = EmployeeActivityKind | 'all'

export const ACTIVITY_FILTERS = [
  'all', 'employee_added', 'document', 'leave', 'violation', 'ledger', 'duty_location', 'status', 'id_change',
] as const satisfies readonly ActivityFilter[]

export function activityEmployeeKey(id: string | null) {
  return ['employees', 'activity-selection', id] as const
}

export async function resolveActivityEmployee(id: string): Promise<EmployeeListItem | null> {
  const needle = id.toLowerCase()
  let formerMatch: EmployeeListItem | null = null
  let offset = 0
  // The roster query is a substring search ordered by name. An exact ID can
  // appear after unrelated hits or a former ID, even on a later page.
  for (;;) {
    const { items, total } = await api.listEmployees({ q: id, limit: 30, offset })
    for (const row of items) {
      if (row.id.toLowerCase() === needle) return row
      if (!formerMatch && row.former_ids?.some((former) => former.toLowerCase() === needle)) {
        formerMatch = row
      }
    }
    offset += items.length
    if (offset >= total || items.length === 0) return formerMatch
  }
}
