/**
 * Pick the locale-appropriate employee name.
 *
 * Falls back to name_en when:
 *  - language is not 'ar'
 *  - or `name_ar` is null/empty
 *
 * Use this everywhere an employee name is rendered, instead of `emp.name_en`.
 */
export function pickEmployeeName(
  emp: {
    name_en: string
    name_ar?: string | null
  },
  language: string,
): string {
  if (language === 'ar' && emp.name_ar && emp.name_ar.trim().length > 0) {
    return emp.name_ar
  }
  return emp.name_en
}
