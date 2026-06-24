/**
 * Shared employee-name resolution for leave rows (TabRecords list/drawer/CSV +
 * the report's EmployeeProfileStrip). Pure module — kept out of TabRecords.tsx
 * because react-refresh forbids non-component exports in component files.
 */
import { pickEmployeeName } from '@/lib/employeeName'

/** Resolve the locale-appropriate employee name for a leave row, falling back
 * to the G-number when the name fields aren't populated (legacy / backfilled
 * rows). */
export function leaveEmployeeName(
  row: { employee_id: string; employee_name_en?: string | null; employee_name_ar?: string | null },
  language: string,
): string {
  const nameEn = row.employee_name_en?.trim()
  if (!nameEn) return row.employee_id
  return pickEmployeeName({ name_en: nameEn, name_ar: row.employee_name_ar }, language)
}
