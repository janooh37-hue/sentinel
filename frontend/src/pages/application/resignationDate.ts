/**
 * Seed rule for the Resignation Letter's date input.
 *
 * Returns the value to write, or `null` to leave the form as-is. Only a truly
 * absent value is seeded: a restored draft or a revise snapshot is the
 * operator's own state and must never be overwritten by today's date.
 */
export function seedResignationDate(
  current: unknown,
  todayIso: string,
): string | null {
  if (current === undefined || current === null || current === '') return todayIso
  return null
}

/** Today as `YYYY-MM-DD` in the browser's local timezone. */
export function todayIso(now: Date = new Date()): string {
  const y = now.getFullYear()
  const m = String(now.getMonth() + 1).padStart(2, '0')
  const d = String(now.getDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}
