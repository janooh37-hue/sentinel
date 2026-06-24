/**
 * Pick the locale-appropriate employee position / job title.
 *
 * Falls back to `position` when:
 *  - language is not 'ar'
 *  - or `position_ar` is null/empty
 *
 * Mirrors `pickEmployeeName` — use this everywhere a position is rendered,
 * instead of `emp.position` directly.
 */
export function pickPosition(
  emp: {
    position?: string | null
    position_ar?: string | null
  },
  language: string,
): string | null | undefined {
  if (language === 'ar' && emp.position_ar && emp.position_ar.trim().length > 0) {
    return emp.position_ar
  }
  return emp.position
}
