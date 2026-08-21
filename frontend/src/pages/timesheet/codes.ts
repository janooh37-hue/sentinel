/**
 * The eight day codes, declared once.
 *
 * No colour here: `index.css` owns the `--code-<SLUG>-fill` / `-ink` pairs and
 * a cell only ever renders `data-code={slug}` (UI spec §3.2 — "components never
 * carry a code hex"). That is what makes the dark-theme remap a one-file
 * change, and it is why the label lives in the locale files rather than here.
 *
 * `'SL '` keeps its trailing space. The workbook's `$AO$5` COUNTIF matches the
 * literal `"SL "`, so the wire value is load-bearing — but a CSS identifier and
 * a `data-code` selector cannot carry a space, and `-` is not an identifier at
 * all. Everything that reaches the DOM or a token name therefore goes through
 * `slugOf`, and `-` is spelled `OFFROSTER` in the token segment only.
 */

export type Code = 'P' | 'AL' | 'SL ' | 'AB' | 'TR' | 'NG' | '-' | 'X'
export type CodeSlug = 'P' | 'AL' | 'SL' | 'AB' | 'TR' | 'NG' | '-' | 'X'

export interface CodeSpec {
  code: Code
  slug: CodeSlug
  /** The keyboard letter: p a s b t n - x */
  key: string
  /** i18n key under the `timesheet.codes` namespace */
  labelKey: string
}

/** Printing order, which is also the legend order the client already reads. */
export const CODES: readonly CodeSpec[] = [
  { code: 'P', slug: 'P', key: 'p', labelKey: 'timesheet.codes.present' },
  { code: 'AL', slug: 'AL', key: 'a', labelKey: 'timesheet.codes.annual' },
  { code: 'SL ', slug: 'SL', key: 's', labelKey: 'timesheet.codes.sick' },
  { code: 'AB', slug: 'AB', key: 'b', labelKey: 'timesheet.codes.absence' },
  { code: 'TR', slug: 'TR', key: 't', labelKey: 'timesheet.codes.national' },
  { code: 'NG', slug: 'NG', key: 'n', labelKey: 'timesheet.codes.newGuard' },
  { code: '-', slug: '-', key: '-', labelKey: 'timesheet.codes.offRoster' },
  { code: 'X', slug: 'X', key: 'x', labelKey: 'timesheet.codes.notBilled' },
]

/**
 * The DOM form of a wire code. `null` is a day the month does not have, which
 * renders as an empty, untabbable cell; anything blank-but-present is off
 * roster.
 */
export const slugOf = (code: string | null): CodeSlug | '' =>
  code === null ? '' : ((code.trim() || '-') as CodeSlug)

const IS_CODE: Record<string, true> = {
  P: true,
  AL: true,
  'SL ': true,
  AB: true,
  TR: true,
  NG: true,
  '-': true,
  X: true,
}

export const isCode = (value: string): value is Code => IS_CODE[value] === true

/**
 * Every code counted across the days the month ACTUALLY has — never 31 blindly,
 * or a 30-day month would count `codes[30]` (which is `null`) as a day.
 *
 * It lives here rather than beside its first caller because two very different
 * surfaces need the same eight numbers: the hover overlay (`RowTally`) and the
 * dock's employee sheet (`EmployeePanel`). A counting function in a floating
 * box's module made the panel import from the overlay for no reason.
 */
export function tallyOf(
  codes: readonly (string | null)[],
  daysInMonth: number,
): Record<CodeSlug, number> {
  const out = { P: 0, AL: 0, SL: 0, AB: 0, TR: 0, NG: 0, '-': 0, X: 0 }
  for (let day = 1; day <= daysInMonth; day += 1) {
    const slug = slugOf(codes[day - 1] ?? null)
    if (slug !== '') out[slug] += 1
  }
  return out
}
