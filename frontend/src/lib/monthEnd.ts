/** Calendar month arithmetic on plain ISO strings, independent of the host
 *  timezone: every computation runs in UTC. */

/** Day number of the last day of `month` (1-12) in `year`. */
export function lastDayOfMonth(year: number, month: number): number {
  // Day 0 of the next month is the last day of this one.
  return new Date(Date.UTC(year, month, 0)).getUTCDate()
}

/** `YYYY-MM` → the ISO date of that month's last day (`2028-02` → `2028-02-29`). */
export function monthEndIso(month: string): string {
  const [year, monthNumber] = month.split('-').map(Number)
  return `${month}-${String(lastDayOfMonth(year, monthNumber)).padStart(2, '0')}`
}
