import type { EmployeeListItem } from '@/lib/api'

export function buildMention(
  emp: EmployeeListItem,
  lang: string,
  includeDesignation: boolean,
): string {
  const ar = lang.startsWith('ar')
  const name = (ar ? emp.name_ar : emp.name_en) || emp.name_en || emp.name_ar || emp.id
  let out = `${name} (${emp.id})`
  if (includeDesignation) {
    const desig = (ar ? emp.position_ar : emp.position) || emp.position || emp.position_ar
    if (desig) out += ar ? `، ${desig}` : `, ${desig}`
  }
  return out
}
