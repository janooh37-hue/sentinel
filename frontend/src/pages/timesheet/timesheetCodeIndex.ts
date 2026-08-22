/**
 * The two numbers the code filter needs, built in one pass over the sheet.
 *
 * `cellCounts` is what the chips print: how many DAYS carry each code across
 * every row. `employeeIds` is what Previous/Next walk: who carries the code, in
 * roster order, once each. They are different arithmetic over the same cells —
 * a guard on three days of annual leave is three cells and one name — which is
 * exactly why they are derived together rather than by two callers each doing
 * half the work and disagreeing about the trailing edge of the month.
 *
 * No colour and no code list of its own: `codes.ts` owns the eight codes and
 * `slugOf` owns the wire→DOM mapping, so `'SL '` (trailing space, load-bearing
 * for the workbook's COUNTIF) and a blank-but-present off-roster cell land on
 * the same keys the chips and the `data-code` attributes already use.
 */

import type { TimesheetRow, TimesheetVariant } from '@/lib/api'

import { type CodeSlug, slugOf } from './codes'

export interface TimesheetCodeIndex {
  cellCounts: Record<CodeSlug, number>
  employeeIds: Record<CodeSlug, string[]>
}

/**
 * `daysInMonth` is the length the month ACTUALLY has, never 31 blindly — the
 * row always ships 31 slots, so a 30-day month reading `codes[30]` would invent
 * a cell and, for a row whose only match is in that dead slot, a whole phantom
 * entry in the navigation list. Same bound as `tallyOf`.
 */
export function buildTimesheetCodeIndex(
  rows: readonly TimesheetRow[],
  variant: TimesheetVariant,
  daysInMonth: number,
): TimesheetCodeIndex {
  const cellCounts: Record<CodeSlug, number> = { P: 0, AL: 0, SL: 0, AB: 0, TR: 0, NG: 0, '-': 0, X: 0 }
  const employeeIds: Record<CodeSlug, string[]> = { P: [], AL: [], SL: [], AB: [], TR: [], NG: [], '-': [], X: [] }

  const statistics = variant === 'statistics'
  // Hoisted and cleared per row rather than allocated per row: the dedup is
  // strictly row-local either way, and this is one Set for the whole sheet
  // instead of one per guard.
  const seen = new Set<CodeSlug>()

  for (const row of rows) {
    const codes = statistics ? row.stat_codes : row.codes
    seen.clear()

    for (let day = 1; day <= daysInMonth; day += 1) {
      const slug = slugOf(codes[day - 1] ?? null)
      // `''` is a day the month does not have, which is not a code.
      if (slug === '') continue
      cellCounts[slug] += 1
      seen.add(slug)
    }

    // Appending after the day loop is what keeps an employee to one entry per
    // code while the cells above counted every one of them.
    for (const slug of seen) employeeIds[slug].push(row.employee_id)
  }

  return { cellCounts, employeeIds }
}
