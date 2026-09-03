/**
 * The one-pass code index behind the code filter bar.
 *
 * Two numbers per code that look alike and are not: `cellCounts` is how many
 * DAYS carry the code across the whole sheet, `employeeIds` is who to walk when
 * the operator cycles matches. A guard on annual leave for three days is three
 * cells and one name, so the two must be derived in the same pass but with
 * different arithmetic — the bug this file exists to catch is `cellCounts`
 * being a headcount (3 → 1) or `employeeIds` carrying a duplicate per day
 * (['G7014', 'G7014', 'G7014']), either of which makes "1 of 4" navigation lie.
 *
 * The other three traps are all trailing-edge ones. `daysInMonth` is the real
 * length of the month, so a 30-day month must never read `codes[30]`; the
 * statistics sheet is a DIFFERENT code array (`stat_codes`) on the same row;
 * and the wire codes are not their own slugs — `'SL '` keeps a load-bearing
 * trailing space and a blank-but-present cell means off roster. All of that is
 * `slugOf`'s job, and this file asserts the index actually routes through it
 * instead of using the raw wire string as a key.
 *
 * No mocks and no render: this is a pure function over rows.
 */
import { describe, expect, it } from 'vitest'

import type { TimesheetRow } from '@/lib/api'

import { CODES } from './codes'
import { buildTimesheetCodeIndex } from './timesheetCodeIndex'

/**
 * A 31-slot code array. `at` maps a 1-based day to its wire code; every other
 * slot is `null`, which is what the backend sends for a day the month does not
 * have and what `slugOf` reads as "no cell".
 */
function days(at: Record<number, string>): (string | null)[] {
  const out: (string | null)[] = Array<string | null>(31).fill(null)
  for (const [day, code] of Object.entries(at)) out[Number(day) - 1] = code
  return out
}

/** A printable row: only the identity and the two code arrays matter here. */
function row(
  employeeId: string,
  arrays: { codes?: (string | null)[]; stat_codes?: (string | null)[] },
  rowNo = 1,
): TimesheetRow {
  return {
    employee_id: employeeId,
    row_no: rowNo,
    name_en: 'TEST GUARD',
    nationality_en: 'Oman',
    designation_en: 'Security Guard',
    designation_ar: 'حارس امن',
    rank_order: 15,
    codes: arrays.codes ?? [],
    stat_codes: arrays.stat_codes ?? [],
    stat_block: 1,
    stat_filler: null,
    joined_day: null,
    left_day: null,
    start_confirmed: false,
    notes: {},
    edits: {},
  }
}

describe('buildTimesheetCodeIndex', () => {
  it('counts every matching cell but lists an employee once per code', () => {
    // G7014 takes three days of annual leave, G7068 takes two. Five cells, two
    // names: the count is per-cell and the list is per-employee.
    const rows = [
      row('G7014', { codes: days({ 1: 'AL', 2: 'AL', 3: 'AL' }) }, 1),
      row('G7068', { codes: days({ 5: 'AL', 6: 'AL' }) }, 2),
    ]

    const index = buildTimesheetCodeIndex(rows, 'attendance', 30)

    expect(index.cellCounts.AL).toBe(5)
    expect(index.employeeIds.AL).toEqual(['G7014', 'G7068'])
  })

  it('keeps employee ids in roster order, not G-number order', () => {
    // The filter walks the sheet top to bottom, so the list must follow the row
    // order the server sent. Sorting by id would put G7014 first and send
    // "next employee" jumping backwards up the grid.
    const rows = [
      row('G7068', { codes: days({ 4: 'AL' }) }, 1),
      row('G7014', { codes: days({ 9: 'AL' }) }, 2),
    ]

    const index = buildTimesheetCodeIndex(rows, 'attendance', 30)

    expect(index.employeeIds.AL).toEqual(['G7068', 'G7014'])
  })

  it('reads codes on attendance and stat_codes on statistics', () => {
    // The same row carries both arrays and they disagree by design: the
    // statistics sheet is derived. Reading the wrong one indexes a sheet the
    // operator is not looking at.
    const rows = [
      row('G7014', {
        codes: days({ 1: 'AL', 2: 'AL' }),
        stat_codes: days({ 1: 'SL ' }),
      }),
    ]

    const attendance = buildTimesheetCodeIndex(rows, 'attendance', 30)
    expect(attendance.cellCounts.AL).toBe(2)
    expect(attendance.cellCounts.SL).toBe(0)
    expect(attendance.employeeIds.SL).toEqual([])

    const statistics = buildTimesheetCodeIndex(rows, 'statistics', 30)
    expect(statistics.cellCounts.SL).toBe(1)
    expect(statistics.cellCounts.AL).toBe(0)
    expect(statistics.employeeIds.AL).toEqual([])
    expect(statistics.employeeIds.SL).toEqual(['G7014'])
  })

  it('ignores days past the end of the month', () => {
    // A February sheet still ships a 31-slot array. Days 29-31 are not days,
    // so counting them would invent three cells and — for an employee with no
    // real match — a whole phantom entry in the navigation list.
    const rows = [
      row('G7014', { codes: days({ 1: 'AL', 2: 'AL', 3: 'AL', 29: 'AL', 30: 'AL', 31: 'AL' }) }, 1),
      row('G7068', { codes: days({ 30: 'TR' }) }, 2),
    ]

    const february = buildTimesheetCodeIndex(rows, 'attendance', 28)
    expect(february.cellCounts.AL).toBe(3)
    expect(february.cellCounts.TR).toBe(0)
    expect(february.employeeIds.TR).toEqual([])

    // The same rows in a 31-day month DO have those days.
    const march = buildTimesheetCodeIndex(rows, 'attendance', 31)
    expect(march.cellCounts.AL).toBe(6)
    expect(march.cellCounts.TR).toBe(1)
    expect(march.employeeIds.TR).toEqual(['G7068'])
  })

  it('initialises every code, including ones no row uses', () => {
    // The filter bar renders all eight chips and reads `cellCounts[slug]`
    // unconditionally. A missing key would render `undefined` and make the
    // disabled-chip check (`=== 0`) fall through to enabled.
    const index = buildTimesheetCodeIndex([row('G7014', { codes: days({ 1: 'P' }) })], 'attendance', 30)

    for (const { slug } of CODES) {
      expect(index.cellCounts[slug], `cellCounts.${slug}`).toBe(slug === 'P' ? 1 : 0)
      expect(index.employeeIds[slug], `employeeIds.${slug}`).toEqual(slug === 'P' ? ['G7014'] : [])
    }
  })

  it('indexes by slug, so the wire codes land under their DOM form', () => {
    // `'SL '` keeps the trailing space the workbook COUNTIF matches, and a
    // blank-but-present cell is off roster. Keying on the raw wire string would
    // file sick leave under `'SL '` — a key the chips never ask for.
    const rows = [row('G7014', { codes: days({ 1: 'SL ', 2: 'SL ', 3: ' ', 4: '' }) })]

    const index = buildTimesheetCodeIndex(rows, 'attendance', 30)

    expect(index.cellCounts.SL).toBe(2)
    expect(index.employeeIds.SL).toEqual(['G7014'])
    expect(index.cellCounts['-']).toBe(2)
    expect(index.employeeIds['-']).toEqual(['G7014'])
  })

  it('is empty for no rows and for a month with no days read', () => {
    const empty = buildTimesheetCodeIndex([], 'attendance', 31)
    expect(empty.cellCounts.P).toBe(0)
    expect(empty.employeeIds.P).toEqual([])

    // Guards the loop bound itself: `daysInMonth` of 0 must read no cell.
    const noDays = buildTimesheetCodeIndex([row('G7014', { codes: days({ 1: 'P' }) })], 'attendance', 0)
    expect(noDays.cellCounts.P).toBe(0)
    expect(noDays.employeeIds.P).toEqual([])
  })
})
