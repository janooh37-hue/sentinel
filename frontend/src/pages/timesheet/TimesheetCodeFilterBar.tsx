/**
 * The filter navigation bar: one strip inside the sheet card that says what the
 * roster is filtered to, and walks the matches.
 *
 * It holds nothing. `TimesheetPage` owns `{ code, index }`, the modulo that
 * wraps Next past the last match, and the scroll into the grid viewport; this
 * bar is handed the already-resolved numbers and reports three intentions
 * back. That split is the whole reason the wrap is testable as arithmetic and
 * this file is testable as copy — and why nothing here reads `rows`.
 *
 * Everything the operator needs is stated in words: which code, how many
 * employees, how many cells, who the sheet is parked on, and where that is in
 * the list. The code's fill arrives through `data-code` and `index.css`, so
 * this is a second surface reading the workbook's own conditional formats
 * rather than a second palette (design §"Counts and colors"), and the strip
 * survives greyscale because none of it is signalled by colour.
 *
 * The identity is a live region: pressing Next changes only that text, and
 * without it a screen-reader operator presses Next and is told nothing.
 */

import { ChevronLeft, ChevronRight } from 'lucide-react'
import { useId } from 'react'
import { useTranslation } from 'react-i18next'

import { CODES, type CodeSlug } from './codes'

export interface TimesheetCodeFilterBarProps {
  code: CodeSlug
  cellCount: number
  employeeCount: number
  /** 1-based, as printed: the first match is `1`, never `0`. */
  position: number
  employeeId: string
  employeeName: string
  onPrevious(): void
  onNext(): void
  onClear(): void
}

/** Derived from CODES so the eight meanings stay declared exactly once. */
const LABEL_KEY: Record<string, string> = {}
for (const spec of CODES) LABEL_KEY[spec.slug] = spec.labelKey

/** The `-` code prints as a hyphen but reads as an en dash on screen. */
const glyphOf = (slug: CodeSlug): string => (slug === '-' ? '–' : slug)

/**
 * One pill for all three controls: the page states its actions as bordered
 * pills everywhere else (the legend swatches, the notice chips), and an exit
 * drawn as bare text in a strip that is otherwise all text stops reading as a
 * control at all. Hierarchy comes from order and from the chevrons, which
 * carry direction; Clear needs no glyph because its two words are the whole
 * instruction.
 */
const CONTROL =
  'inline-flex shrink-0 items-center gap-1 rounded-full border border-border bg-surface px-2 py-0.5 text-[0.72em] font-semibold text-muted-foreground transition-colors hover:border-primary hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring'

export function TimesheetCodeFilterBar({
  code,
  cellCount,
  employeeCount,
  position,
  employeeId,
  employeeName,
  onPrevious,
  onNext,
  onClear,
}: TimesheetCodeFilterBarProps): React.JSX.Element {
  const { t } = useTranslation()
  const id = useId()

  return (
    <div
      data-testid="code-filter-bar"
      role="group"
      // Named from its own visible words — "Filtered by Annual leave" — so
      // tabbing straight into Previous says which list is being walked. No
      // `dir` here: the strip inherits the page's direction and mirrors whole.
      aria-labelledby={`${id}-by ${id}-meaning`}
      className="flex shrink-0 flex-wrap items-center gap-x-3 gap-y-1.5 border-b border-hairline bg-primary-soft px-3.5 py-1.5"
    >
      <span
        id={`${id}-by`}
        data-ts-caps
        className="shrink-0 text-[0.62rem] font-semibold uppercase tracking-[0.14em] text-muted-foreground"
      >
        {t('timesheet.filter.by')}
      </span>
      {/* The glyph is decoration for the meaning beside it: read aloud it would
          spell a workbook letter no operator says out loud. */}
      <span
        data-code={code}
        aria-hidden
        className="grid h-[1.15rem] w-6 shrink-0 place-items-center rounded-[3px] border border-border font-mono text-[0.62rem] font-semibold"
      >
        {glyphOf(code)}
      </span>
      <b id={`${id}-meaning`} className="shrink-0 text-[0.78em] font-semibold">
        {t(LABEL_KEY[code])}
      </b>
      <span className="shrink-0 text-[0.78em] text-muted-foreground [unicode-bidi:isolate]">
        {t('timesheet.filter.employees', { count: employeeCount })}
      </span>
      <span aria-hidden className="text-[0.78em] text-muted-foreground">
        ·
      </span>
      <span className="shrink-0 text-[0.78em] text-muted-foreground [unicode-bidi:isolate]">
        {t('timesheet.cells', { count: cellCount })}
      </span>

      {/* Identity and navigator travel together: at narrow widths they wrap to
          the next line as one unit rather than orphaning the arrows. */}
      <div className="ms-auto flex min-w-0 items-center gap-2">
        <div
          aria-live="polite"
          className="flex min-w-0 items-center gap-2 rounded-full border border-border bg-surface py-0.5 pe-2 ps-2.5"
        >
          {/* A G-number is a Latin run in an Arabic paragraph: unisolated, bidi
              drags it to the far end of the strip, away from its own name. */}
          <span
            dir="ltr"
            className="shrink-0 font-mono text-[0.7rem] font-semibold text-muted-foreground [unicode-bidi:isolate]"
          >
            {employeeId}
          </span>
          <b className="truncate text-[0.78em] font-semibold">{employeeName}</b>
          <span className="shrink-0 font-mono text-[0.7rem] tabular-nums text-muted-foreground [unicode-bidi:isolate]">
            {t('timesheet.filter.position', { n: position, total: employeeCount })}
          </span>
        </div>

        <div className="flex shrink-0 items-center gap-1">
          {/* The strip carries the short word; the accessible name says what is
              stepped, because "Next" in a page that also steps months and days
              is three different lists. */}
          <button
            type="button"
            aria-label={t('timesheet.filter.previousEmployee')}
            onClick={onPrevious}
            className={CONTROL}
          >
            <ChevronLeft className="h-3.5 w-3.5 rtl:rotate-180" strokeWidth={2} aria-hidden />
            {t('common.previous')}
          </button>
          <button
            type="button"
            aria-label={t('timesheet.filter.nextEmployee')}
            onClick={onNext}
            className={CONTROL}
          >
            {t('common.next')}
            <ChevronRight className="h-3.5 w-3.5 rtl:rotate-180" strokeWidth={2} aria-hidden />
          </button>
          {/* Set off from the steppers: Next is pressed repeatedly, and the
              exit must not sit one mis-click away from it. */}
          <button type="button" onClick={onClear} className={`${CONTROL} ms-1.5`}>
            {t('timesheet.filter.clear')}
          </button>
        </div>
      </div>
    </div>
  )
}
