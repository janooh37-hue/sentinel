/**
 * The pure half of staged roster editing: what the grid prints while a move is
 * still only a draft.
 *
 * `applyRosterDraft` sits between a dropped row and the sheet the operator
 * reads, and it has to agree with the server that will persist the same draft a
 * moment later. The backend prints by `rank_order` and then by the numeric part
 * of the G-number, lists an employee with no designation on the main sheet only,
 * and routes a Drivers designation to its own workbook
 * (`timesheet_service._row_sort_key`, `._lists_on`, `._id_sort_key`). A
 * transform that sorted ids as strings, grouped by designation name, or left a
 * drivers row on the main sheet would show a roster that Save silently
 * rearranges — the operator would be approving an order he never saw.
 *
 * Three classes of bug this file exists to catch:
 *
 * 1. **Half-applied moves.** The id rewritten without the two printed names, or
 *    the row moved without `row_no` following it. Either prints a roster that
 *    contradicts itself: the band says one designation, the row says another,
 *    and the numbers down the margin skip or repeat.
 * 2. **Mutation of the query cache.** The rows come straight out of React Query
 *    and are the rollback baseline that Cancel restores without a request. Every
 *    fixture below is frozen, so an in-place `sort` or a field write throws here
 *    instead of quietly destroying what the draft is diffed against.
 * 3. **Lost identity.** The grid is memoized per row over 31 cells. Cloning rows
 *    the move never touched, or rebuilding the code arrays and the notes map of
 *    the one it did, re-renders a whole month for a single drop.
 *
 * No mocks and no render: this is a pure function over rows.
 */
import { describe, expect, it } from 'vitest'

import type { TimesheetDesignationRead, TimesheetRow } from '@/lib/api'

import { applyRosterDraft, type RosterDraft } from './rosterDraft'

/** Freezes in place, so a stray write throws instead of landing silently. */
function frozen<T>(value: T): T {
  Object.freeze(value)
  return value
}

function designation(
  id: number,
  rank: number,
  name_en: string,
  name_ar: string,
  sheet: string,
): TimesheetDesignationRead {
  return frozen({ id, name_en, name_ar, rank_order: rank, sheet, active: true, system_key: null })
}

// Three real catalog rows: two ranks apart on the main sheet, plus the one
// designation that routes to the drivers workbook.
const DUTY_IN_CHARGE = designation(105, 5, 'Duty In charge', 'مناوب عام', 'main')
const SECURITY_GUARD = designation(115, 15, 'Security Guard', 'حارس امن', 'main')
const DRIVER = designation(116, 16, 'Driver', 'سائق', 'drivers')
const DESIGNATIONS = frozen([DUTY_IN_CHARGE, SECURITY_GUARD, DRIVER])

/**
 * One printable row, frozen with its nested containers: identity, designation
 * block and `row_no` are all this transform is allowed to read, and none of it
 * is allowed to change.
 */
function row(
  employeeId: string,
  rowNo: number,
  from: TimesheetDesignationRead | null,
): TimesheetRow {
  return frozen({
    employee_id: employeeId,
    row_no: rowNo,
    name_en: `GUARD ${employeeId}`,
    nationality_en: 'Oman',
    designation_id: from?.id ?? null,
    designation_en: from?.name_en ?? null,
    designation_ar: from?.name_ar ?? null,
    rank_order: from?.rank_order ?? null,
    codes: frozen(Array<string | null>(31).fill('P')),
    stat_codes: frozen(Array<string | null>(31).fill('P')),
    stat_block: 1,
    stat_filler: null,
    joined_day: null,
    left_day: null,
    start_confirmed: false,
    notes: frozen({ 3: 'clinic' }),
    edits: frozen({}),
  })
}

// The main sheet exactly as the server sends it: rank 5 first, then the rank-15
// guards by G-number, then the one man with no designation at all. `G712` is a
// three-digit id on purpose — it sorts first numerically and third as a string.
const G6001 = row('G6001', 1, DUTY_IN_CHARGE)
const G7014 = row('G7014', 2, SECURITY_GUARD)
const G7068 = row('G7068', 3, SECURITY_GUARD)
const G7160 = row('G7160', 4, SECURITY_GUARD)
const G712 = row('G712', 5, null)
const ROWS = frozen([G6001, G7014, G7068, G7160, G712])

// The drivers workbook, whose rows leave it the moment their designation stops
// being a drivers one.
const G8001 = row('G8001', 1, DRIVER)
const G8002 = row('G8002', 2, DRIVER)
const G8003 = row('G8003', 3, DRIVER)
const DRIVER_ROWS = frozen([G8001, G8002, G8003])

// A sealed sheet, as `_sealed_rows` builds it: the frozen order the month was
// printed in, carrying no `designation_id` at all. Its two guards are in an
// order no rank-and-G-number key can reconstruct.
const SEALED = frozen([
  frozen({ ...row('G7500', 1, SECURITY_GUARD), designation_id: null }),
  frozen({ ...row('G7100', 2, SECURITY_GUARD), designation_id: null }),
])

const ids = (rows: readonly TimesheetRow[]): string[] => rows.map((each) => each.employee_id)

describe('applyRosterDraft', () => {
  it('rewrites the id and both printed names of a moved row together', () => {
    // The band, the English attendance label and the Arabic statistics label all
    // read off this one row. Rewriting the id alone leaves the row printing the
    // designation it just left.
    const draft: RosterDraft = new Map([['G7160', DUTY_IN_CHARGE.id]])

    const moved = applyRosterDraft(ROWS, DESIGNATIONS, 'main', draft)

    expect(moved.find((each) => each.employee_id === 'G7160')).toMatchObject({
      designation_id: DUTY_IN_CHARGE.id,
      designation_en: DUTY_IN_CHARGE.name_en,
      designation_ar: DUTY_IN_CHARGE.name_ar,
      rank_order: DUTY_IN_CHARGE.rank_order,
    })
  })

  it('moves the row under its new designation and renumbers the sheet from 1', () => {
    // G7160 becomes rank 5, so it lands in that group — behind G6001, which is
    // the lower G-number of the two — and every row number below it shifts.
    const draft: RosterDraft = new Map([['G7160', DUTY_IN_CHARGE.id]])

    const moved = applyRosterDraft(ROWS, DESIGNATIONS, 'main', draft)

    expect(ids(moved)).toEqual(['G6001', 'G7160', 'G7014', 'G7068', 'G712'])
    expect(moved.map((each) => each.row_no)).toEqual(moved.map((_, index) => index + 1))
    expect(moved.map((each) => each.row_no)).toEqual([1, 2, 3, 4, 5])
  })

  it('breaks an equal-rank tie by G-number, not by string order', () => {
    // Everyone in a designation shares its rank, so the tie inside the group is
    // the whole ordering. As strings 'G7014' < 'G712'; as numbers 712 < 7014,
    // which is what the server prints and therefore what the draft must show.
    const draft: RosterDraft = new Map([['G712', SECURITY_GUARD.id]])

    const moved = applyRosterDraft(ROWS, DESIGNATIONS, 'main', draft)

    expect(ids(moved)).toEqual(['G6001', 'G712', 'G7014', 'G7068', 'G7160'])
  })

  it('drops a row staged onto a drivers designation from the main sheet', () => {
    // Drivers are a separate workbook. A main sheet that kept the row would
    // print a driver among the guards and count him twice across deliverables.
    const draft: RosterDraft = new Map([['G7068', DRIVER.id]])

    const moved = applyRosterDraft(ROWS, DESIGNATIONS, 'main', draft)

    expect(ids(moved)).toEqual(['G6001', 'G7014', 'G7160', 'G712'])
    expect(moved.map((each) => each.row_no)).toEqual([1, 2, 3, 4])
  })

  it('keeps a row unassigned by the draft last on the main sheet', () => {
    // An explicit null is a real staged value, not a missing entry: the row loses
    // its whole designation block and falls behind every ranked row, where the
    // blocking check will find it. Two unranked rows still order by G-number.
    const draft: RosterDraft = new Map([['G6001', null]])

    const moved = applyRosterDraft(ROWS, DESIGNATIONS, 'main', draft)

    expect(ids(moved)).toEqual(['G7014', 'G7068', 'G7160', 'G712', 'G6001'])
    expect(moved.at(-1)).toMatchObject({
      employee_id: 'G6001',
      designation_id: null,
      designation_en: null,
      designation_ar: null,
      rank_order: null,
    })
  })

  it('drops rows that leave the drivers workbook, unassigned or moved to main', () => {
    // Mirror image of the main sheet: the drivers workbook prints drivers only,
    // so neither an unassigned man nor one staged onto a main designation stays.
    const draft: RosterDraft = new Map<string, number | null>([
      ['G8001', null],
      ['G8002', SECURITY_GUARD.id],
    ])

    const moved = applyRosterDraft(DRIVER_ROWS, DESIGNATIONS, 'drivers', draft)

    expect(ids(moved)).toEqual(['G8003'])
    expect(moved[0].row_no).toBe(1)
  })

  it('leaves the rows, the catalog and the draft untouched', () => {
    // The server rows are the baseline Cancel restores and the draft is what Save
    // sends. Sorting the input in place, or writing the resolved designation back
    // onto the source row, destroys both.
    const draft: RosterDraft = new Map([['G7160', DUTY_IN_CHARGE.id]])

    const moved = applyRosterDraft(ROWS, DESIGNATIONS, 'main', draft)

    expect(moved).not.toBe(ROWS)
    expect(ids(ROWS)).toEqual(['G6001', 'G7014', 'G7068', 'G7160', 'G712'])
    expect(G7160).toMatchObject({
      row_no: 4,
      designation_id: SECURITY_GUARD.id,
      designation_en: SECURITY_GUARD.name_en,
      rank_order: SECURITY_GUARD.rank_order,
    })
    expect(DESIGNATIONS.map((each) => each.id)).toEqual([105, 115, 116])
    expect([...draft]).toEqual([['G7160', DUTY_IN_CHARGE.id]])
  })

  it('reuses whole rows that did not move and the nested arrays of the one that did', () => {
    // Row identity is what the memoized grid diffs on. Only the moved row and the
    // rows whose number shifted may be new objects, and even the moved one keeps
    // its 31-cell arrays and its notes map.
    const draft: RosterDraft = new Map([['G7160', DUTY_IN_CHARGE.id]])

    const moved = applyRosterDraft(ROWS, DESIGNATIONS, 'main', draft)

    expect(moved[0]).toBe(G6001) // rank 5, still row 1
    expect(moved[4]).toBe(G712) // unranked, still row 5
    expect(moved[1]).not.toBe(G7160)
    expect(moved[1].codes).toBe(G7160.codes)
    expect(moved[1].stat_codes).toBe(G7160.stat_codes)
    expect(moved[1].notes).toBe(G7160.notes)
    // Same designation as before, new row number: a clone, but only of the shell.
    expect(moved[2]).not.toBe(G7014)
    expect(moved[2]).toMatchObject({ employee_id: 'G7014', row_no: 3 })
    expect(moved[2].codes).toBe(G7014.codes)
    expect(moved[2].notes).toBe(G7014.notes)
  })

  it('is the server order, row for row, when the draft is empty', () => {
    // Not in edit mode, and a sealed month prints a frozen order this transform
    // cannot reconstruct (`designation_id` is null on every frozen row). With
    // nothing staged there is nothing to resolve, so nothing may be re-sorted.
    const moved = applyRosterDraft(ROWS, DESIGNATIONS, 'main', new Map())

    expect(moved).not.toBe(ROWS)
    expect(moved).toEqual([...ROWS])
    ROWS.forEach((each, index) => expect(moved[index]).toBe(each))
    // The frozen sheet is the case that makes this load-bearing rather than
    // merely cheap: G7500 was printed above G7100, and a rank-and-G-number sort
    // would reorder a month that has already been delivered.
    expect(ids(applyRosterDraft(SEALED, DESIGNATIONS, 'main', new Map()))).toEqual([
      'G7500',
      'G7100',
    ])
  })

  it('ignores a draft entry whose designation is gone from the catalog', () => {
    // The catalog can change under an open draft. There is no name to print for
    // an id that no longer exists, so the row keeps what the server sent rather
    // than being invented into a blank designation or dropped off the sheet.
    const draft: RosterDraft = new Map([['G7160', 9999]])

    const moved = applyRosterDraft(ROWS, DESIGNATIONS, 'main', draft)

    expect(ids(moved)).toEqual(['G6001', 'G7014', 'G7068', 'G7160', 'G712'])
    expect(moved[3]).toBe(G7160)
  })
})
