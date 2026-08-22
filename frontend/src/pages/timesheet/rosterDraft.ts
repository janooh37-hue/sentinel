/**
 * The staged roster: what the sheet prints while a move has not been saved yet.
 *
 * A drop changes one assignment, and the printed page changes in five places at
 * once — the row's designation id, its English and Arabic labels, its rank, and
 * every row number below it. Deriving all of that here, from the draft plus the
 * server's own rows, is what keeps the preview and the saved result the same
 * document: this ordering deliberately mirrors `timesheet_service`, which prints
 * by `rank_order` and then by the numeric part of the G-number (`_row_sort_key`,
 * `_id_sort_key`) and lists a man with no designation on the main sheet only
 * (`_lists_on`). Sorting ids as strings, or keeping a drivers row among the
 * guards, would show an order that Save silently rewrites.
 *
 * Two things it deliberately does not do. It never touches its inputs: the rows
 * are the React Query result and the rollback baseline that Cancel restores
 * without a request. And it never re-sorts a sheet with an empty draft — a
 * sealed month prints a frozen order whose rows carry no `designation_id` at
 * all, so with nothing staged the server's order is the only truth available.
 */

import type { TimesheetDesignationRead, TimesheetRow, TimesheetSheet } from '@/lib/api'

/**
 * Staged assignments by employee id. `null` is a real staged value — the man was
 * explicitly taken off every designation — which is why an absent key and a
 * `null` one must never be read as the same thing.
 */
export type RosterDraft = Map<string, number | null>

/** Sorts a row with no rank, or an id with no number, behind every other one. */
const LAST = 1e9

const G_PREFIX = /^[Gg]+/
const BARE_NUMBER = /^\d+$/

/** The tie-break inside a designation: `G712` comes before `G7014`, as it prints. */
function numberOf(employeeId: string): number {
  const digits = employeeId.replace(G_PREFIX, '')
  return BARE_NUMBER.test(digits) ? Number(digits) : LAST
}

/**
 * One row with the two numbers it is ordered by, so the key is computed once per
 * row instead of once per comparison.
 *
 * `next` is `undefined` when the draft says nothing about this row, `null` when
 * it stages him off the roster, and the designation itself when it moves him.
 */
interface Staged {
  row: TimesheetRow
  next: TimesheetDesignationRead | null | undefined
  rank: number
  tie: number
}

/**
 * The rows the grid should print for `sheet`, with the draft applied.
 *
 * Only rows the draft names are re-filtered and relabelled; the rest are passed
 * through by identity whenever their number also stays put, because the grid is
 * memoised per row over 31 cells and a single drop must not re-render a month.
 * A row the draft does name is rebuilt even if it lands back where it started —
 * one shallow clone, keeping its code arrays and notes — so its labels always
 * come from the catalog rather than from a name the operator has since renamed.
 */
export function applyRosterDraft(
  rows: readonly TimesheetRow[],
  designations: readonly TimesheetDesignationRead[],
  sheet: TimesheetSheet,
  draft: RosterDraft,
): TimesheetRow[] {
  // Nothing staged, nothing to resolve: the server order stands, in a copy of
  // its own so no caller can sort the query cache in place.
  if (draft.size === 0) return [...rows]

  const catalog = new Map(designations.map((each) => [each.id, each]))
  const staged: Staged[] = []

  for (const row of rows) {
    const assigned = draft.get(row.employee_id)
    // A staged id the catalog no longer holds lands on `undefined` with the
    // untouched rows on purpose: there is no name to print for it, so the row
    // keeps what the server sent instead of blanking out or vanishing.
    const next = typeof assigned === 'number' ? catalog.get(assigned) : assigned
    const tie = numberOf(row.employee_id)

    if (next === undefined) {
      staged.push({ row, next, rank: row.rank_order ?? LAST, tie })
      continue
    }
    // `_lists_on`: a designation routes to its own workbook, and a man with no
    // designation at all is printed on the main sheet only.
    if (next === null ? sheet !== 'main' : next.sheet !== sheet) continue
    staged.push({ row, next, rank: next?.rank_order ?? LAST, tie })
  }

  // `_id_sort_key`: rank first, then the number inside the id. The raw id is the
  // last resort only because the server falls back to it too, for the ids that
  // have no number to compare — equal on all three is the same id twice.
  staged.sort(
    (a, b) =>
      a.rank - b.rank || a.tie - b.tie || a.row.employee_id.localeCompare(b.row.employee_id),
  )

  return staged.map(({ row, next }, index) => {
    const row_no = index + 1
    if (next === undefined) return row.row_no === row_no ? row : { ...row, row_no }
    return {
      ...row,
      row_no,
      designation_id: next?.id ?? null,
      designation_en: next?.name_en ?? null,
      designation_ar: next?.name_ar ?? null,
      rank_order: next?.rank_order ?? null,
    }
  })
}
