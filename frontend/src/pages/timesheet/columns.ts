/**
 * The sheet's column geometry, declared once and away from the grid so that
 * `TimesheetGrid.tsx` exports components and nothing else — a module that
 * exports both a component and a constant cannot be hot-reloaded
 * (`react-refresh/only-export-components`), and the constant is what the grid's
 * test reads to check the token arithmetic.
 *
 * Widths are NOT here. `index.css` owns them; these are the token names, so a
 * column can change width without this file moving.
 */

/**
 * The five identity columns, in printed order. `index.css` declares
 * `--id-block` as exactly this sum, so the loading skeleton's day strip and the
 * grid's first day column start at the same offset by arithmetic rather than by
 * two people remembering the same number.
 */
export const ID_COLUMNS = ['--id-no', '--id-id', '--id-name', '--id-nat', '--id-desig'] as const

/** Always 31, in every month: the workbook's row 5 carries `1..31` regardless. */
export const DAYS: readonly number[] = Array.from({ length: 31 }, (_, i) => i + 1)

/** 5 identity columns + 31 days: what a full-width heading has to span. */
export const SPAN = ID_COLUMNS.length + DAYS.length
