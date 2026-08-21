/**
 * One employee's month: the G-number picker, the handover extract and the red
 * block (UI spec §16.3, and §15 changes 5 and 6).
 *
 * Two panes, following `ReferencePicker`: results on the reading-start side, a
 * preview on the other. The panel owns ONLY the keyboard cursor and the billing
 * day — the selected employee lives in `TimesheetPage`, because the grid
 * highlights the same row and scrolls it into view.
 *
 * The search is deliberately forgiving: `7141`, `g7141`, `G7141`, a name, or a
 * designation in either language all find the row. It is client-side over the
 * roster the grid response already carried; there is no picker endpoint.
 *
 * Two facts about the extract that the mockup predates, and the reviewed
 * backend settles:
 *
 * 1. `months=2` returns **one** `.xlsx` with two sheets, earlier month first,
 *    named from the LATER month. It is not two workbooks, so this panel prints
 *    one filename and says the file carries both months.
 * 2. Both spans name the file from the month on screen, so `months=1` and
 *    `months=2` land under the same name. The sentence says which is which.
 */

import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Link } from 'react-router-dom'

import type { TimesheetRow, TimesheetVariant } from '@/lib/api'
import { cn } from '@/lib/utils'

import { CODES, slugOf } from '../codes'
import { tallyOf } from '../RowTally'
import { employeeWorkbookName, previousMonth } from '../useTimesheet'

export interface EmployeePanelProps {
  rows: TimesheetRow[]
  year: number
  month: number
  /** The month is sealed: no cell may be written, so no red block. */
  closed: boolean
  /** The operator holds `timesheet.edit` (amendment A3). The extract never needs it. */
  canEdit: boolean
  /** Which code array and which designation language the sheet is showing. */
  variant: TimesheetVariant
  selected: string | null
  query: string
  onQuery: (query: string) => void
  onSelect: (employeeId: string | null) => void
  onEmployeeDownload: (args: {
    employeeId: string
    year: number
    month: number
    months: 1 | 2
  }) => void
  /** One call carrying every day to block, roster edges already excluded. */
  onFillRedBlock: (employeeId: string, days: number[]) => void
}

/** The `-` code prints as a hyphen but reads as an en dash on screen. */
const glyphOf = (slug: string): string => (slug === '-' ? '–' : slug)

export function EmployeePanel({
  rows,
  year,
  month,
  closed,
  canEdit,
  variant,
  selected,
  query,
  onQuery,
  onSelect,
  onEmployeeDownload,
  onFillRedBlock,
}: EmployeePanelProps): React.JSX.Element {
  const { t, i18n } = useTranslation()
  const [cursor, setCursor] = useState(0)
  /**
   * The raw field, not a number. Parsing on every keystroke and writing the
   * clamped value back turns `clear` + type `23` into `123`: the field would
   * re-fill with `1` the moment it emptied, and the next character appends.
   */
  const [billRaw, setBillRaw] = useState('')

  const daysInMonth = new Date(year, month, 0).getDate()
  const statistics = variant === 'statistics'

  const found = useMemo(() => {
    const needle = query.trim().toLowerCase()
    if (!needle) return rows
    // `g7141` and `7141` both mean the same G-number; the digits are matched
    // from the start so `41` does not find every row ending in it.
    const digits = needle.replace(/^g/, '')
    return rows.filter((row) => {
      const id = row.employee_id.toLowerCase()
      return (
        id.includes(needle) ||
        id.replace(/^g/, '').startsWith(digits) ||
        row.name_en.toLowerCase().includes(needle) ||
        (row.designation_en ?? '').toLowerCase().includes(needle) ||
        (row.designation_ar ?? '').includes(needle)
      )
    })
  }, [query, rows])

  const at = found.length === 0 ? 0 : Math.min(cursor, found.length - 1)
  /**
   * The selected employee wins over the cursor: the page's selection is what
   * the grid is highlighting, so the preview must agree with it. Falling back to
   * the cursor is what makes the arrow keys preview as they move.
   */
  const target = useMemo(
    () => rows.find((row) => row.employee_id === selected) ?? found[at] ?? null,
    [at, found, rows, selected],
  )

  const designationOf = (row: TimesheetRow): string =>
    (statistics ? row.designation_ar : row.designation_en) ?? ''

  /** The code array in play: `codes` on the attendance sheet, `stat_codes` on the other. */
  const targetCodes: readonly (string | null)[] | null =
    target === null ? null : statistics ? target.stat_codes : target.codes

  const counts = targetCodes === null ? null : tallyOf(targetCodes, daysInMonth)

  /**
   * The days a red block would actually take, edges excluded.
   *
   * `set_cell` refuses **per cell**: a day outside the roster window answers 422
   * `TIMESHEET_OFF_ROSTER` while its neighbours are taken. A naive `1..N-1`
   * therefore posts one refusal per edge day and collects one error each. Two
   * rules narrow it here instead, before anything is sent:
   *
   * - the roster window `[joined_day, left_day]`, which is what the server
   *   enforces, and
   * - the code the day already holds: `NG` and `-` are the edge the engine
   *   applies last and unconditionally, so a block over one would be painting
   *   over a value the edge is entitled to (UI spec §15 change 6).
   */
  const blockDays = useMemo(() => {
    const start = Number(billRaw)
    if (!target || !targetCodes || !Number.isInteger(start) || start < 2) return []
    const from = target.joined_day ?? 1
    const to = target.left_day ?? daysInMonth
    const out: number[] = []
    for (let day = 1; day < Math.min(start, daysInMonth + 1); day += 1) {
      if (day < from || day > to) continue
      const held = targetCodes[day - 1] ?? null
      if (held === null) continue
      const slug = slugOf(held)
      if (slug === 'NG' || slug === '-') continue
      out.push(day)
    }
    return out
  }, [billRaw, daysInMonth, target, targetCodes])

  const billStart = Number(billRaw)
  const billAsked = Number.isInteger(billStart) && billStart >= 2
  const monthName = (y: number, m: number, lang = i18n.language): string =>
    new Intl.DateTimeFormat(lang, { month: 'long' }).format(new Date(y, m - 1, 1))
  const prev = previousMonth(year, month)
  /**
   * The later month always carries the year, because it names the file. The
   * earlier one carries its own only when the span crosses a new year, which is
   * the only case where "December and January 2026" would be a lie.
   */
  const spanFirst =
    prev.year === year ? monthName(prev.year, prev.month) : `${monthName(prev.year, prev.month)} ${prev.year}`
  const spanSecond = `${monthName(year, month)} ${year}`
  /**
   * The deliverable's own name, from ONE declaration shared with the hook that
   * actually sends it — a second copy of the template is a name this panel can
   * print after the download has stopped using it.
   */
  const filename = target ? employeeWorkbookName(target.employee_id, year, month) : ''

  const onKeyDown = (event: React.KeyboardEvent<HTMLInputElement>): void => {
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault()
      setCursor(Math.max(0, Math.min(found.length - 1, at + (event.key === 'ArrowDown' ? 1 : -1))))
      return
    }
    if (event.key === 'Enter' && found[at]) {
      event.preventDefault()
      onSelect(found[at].employee_id)
    }
  }

  const rosterLine = (row: TimesheetRow): string | null => {
    if (row.joined_day !== null) {
      return t('timesheet.startedOn', {
        day: row.joined_day,
        before: Math.max(1, row.joined_day - 1),
      })
    }
    if (row.left_day !== null) return t('timesheet.lastWorked', { day: row.left_day })
    return null
  }

  const badge = (row: TimesheetRow): string | null => {
    if (row.joined_day !== null) {
      return row.start_confirmed
        ? t('timesheet.badgeFrom', { day: row.joined_day })
        : t('timesheet.badgeNew')
    }
    if (row.left_day !== null) return t('timesheet.badgeTo', { day: row.left_day })
    return null
  }

  return (
    <div className="grid gap-3.5 md:grid-cols-[minmax(17rem,1fr)_minmax(19rem,1fr)]">
      <div className="flex min-w-0 flex-col gap-2">
        <label className="sr-only" htmlFor="ts-picker-q">
          {t('timesheet.searchLabel')}
        </label>
        <input
          id="ts-picker-q"
          type="search"
          value={query}
          placeholder={t('timesheet.employee.placeholder')}
          onChange={(event) => {
            setCursor(0)
            onQuery(event.target.value)
          }}
          onKeyDown={onKeyDown}
          className="rounded-full border border-border-strong bg-surface px-3 py-1.5 text-[0.8em] text-foreground placeholder:text-faint focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        />
        <div
          role="listbox"
          aria-label={t('timesheet.employee.results')}
          className="max-h-[18rem] min-h-0 overflow-auto rounded-lg border border-hairline bg-surface"
        >
          {found.length === 0 ? (
            <p className="px-3 py-4 text-[0.78em] text-muted-foreground">
              {t('timesheet.employee.noMatch')}
            </p>
          ) : (
            found.map((row, index) => {
              const mark = badge(row)
              return (
                <button
                  key={row.employee_id}
                  type="button"
                  role="option"
                  aria-selected={index === at}
                  onClick={() => {
                    setCursor(index)
                    onSelect(row.employee_id)
                  }}
                  className={cn(
                    'flex w-full items-center gap-2.5 px-2.5 py-1.5 text-start transition-colors hover:bg-surface-tinted focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-ring',
                    index === at && 'bg-primary-soft',
                  )}
                >
                  <span
                    dir="ltr"
                    className="shrink-0 font-mono text-[0.7rem] font-semibold text-muted-foreground [unicode-bidi:isolate]"
                  >
                    {row.employee_id}
                  </span>
                  <span className="min-w-0 flex-1">
                    <b className="block truncate text-[0.8em] font-semibold">{row.name_en}</b>
                    <small className="block truncate text-[0.7em] text-muted-foreground">
                      {designationOf(row)}
                      {row.nationality_en ? ` · ${row.nationality_en}` : ''}
                    </small>
                  </span>
                  {mark && (
                    <span className="shrink-0 rounded-full bg-warning-soft px-1.5 py-0.5 text-[0.62rem] font-semibold text-warning">
                      {mark}
                    </span>
                  )}
                </button>
              )
            })
          )}
        </div>
        {/* Locked rule 8: adding an employee is NOT owned here. The mockup's
            inline create form is a demonstration of the trigger; in the app the
            create flow is local dialog state inside `EmployeeLookupPage` with no
            route of its own, so there is no flow to open from here and building
            a second one is what the rule forbids. This points at the page that
            owns it. */}
        <Link
          to="/employees"
          className="self-start text-[0.72em] font-semibold text-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          + {t('timesheet.openLookup')}
        </Link>
      </div>

      {target === null || counts === null ? (
        <p className="self-center text-[0.8em] text-muted-foreground">
          {t('timesheet.employee.prompt')}
        </p>
      ) : (
        <div className="flex min-w-0 flex-col gap-2.5 rounded-lg border border-hairline bg-surface p-3">
          <div>
            <div className="flex flex-wrap items-baseline gap-2">
              <b className="text-[0.92em] font-semibold">{target.name_en}</b>
              {/* The new/leaving badge, which §16.3 enumerates as part of the
                  preview and the A3 mockup puts right here beside the name. */}
              {badge(target) && (
                <span className="shrink-0 rounded-full bg-warning-soft px-1.5 py-0.5 text-[0.62rem] font-semibold text-warning">
                  {badge(target)}
                </span>
              )}
              {/* §9: the route from a finding to the employee that fixes it.
                  A record link, not a grid row — it works whether or not this
                  month has a row for him. */}
              <Link
                to={`/employees/${encodeURIComponent(target.employee_id)}`}
                dir="ltr"
                className="font-mono text-[0.72rem] text-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring [unicode-bidi:isolate]"
              >
                {target.employee_id}
              </Link>
            </div>
            <div className="text-[0.74em] text-muted-foreground">
              {designationOf(target)}
              {target.nationality_en ? ` · ${target.nationality_en}` : ''} ·{' '}
              <span className="[unicode-bidi:isolate]">
                {t('timesheet.employee.printedRow', { no: target.row_no })}
              </span>
            </div>
            {rosterLine(target) && (
              <p className="mt-1 text-[0.74em] text-warning">{rosterLine(target)}</p>
            )}
          </div>

          {/* All eight counts, the same numbers the workbook's `AK..AP` block
              prints and the row tally shows on hover. */}
          <div className="flex flex-wrap items-center gap-2">
            {CODES.map((spec) => (
              <span
                key={spec.slug}
                className={cn(
                  'inline-flex items-center gap-1 font-mono text-[0.7rem]',
                  counts[spec.slug] === 0 && 'opacity-35',
                )}
              >
                <span
                  data-code={spec.slug}
                  aria-hidden
                  className="grid h-[0.95rem] w-[1.4rem] place-items-center rounded-[3px] border border-border text-[0.6rem] font-semibold"
                >
                  {glyphOf(spec.slug)}
                </span>
                <span className="sr-only">{t(spec.labelKey)}</span>
                <span data-testid={`preview-count-${spec.slug}`} className="tabular-nums">
                  {counts[spec.slug]}
                </span>
              </span>
            ))}
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => onSelect(target.employee_id)}
              className="rounded-full border border-border-strong bg-surface px-3 py-1 text-[0.75em] font-semibold text-muted-foreground transition-colors hover:bg-surface-tinted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              {t('timesheet.employee.showInGrid')}
            </button>
            {/* The per-employee export needs only `timesheet.view`: it freezes
                nothing. `download()` never rejects, so no `.catch` here. */}
            <button
              type="button"
              onClick={() =>
                onEmployeeDownload({ employeeId: target.employee_id, year, month, months: 1 })
              }
              className="rounded-full border border-border-strong bg-surface px-3 py-1 text-[0.75em] font-semibold text-muted-foreground transition-colors hover:bg-surface-tinted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              {t('timesheet.employee.extractOne')}
            </button>
            <button
              type="button"
              onClick={() =>
                onEmployeeDownload({ employeeId: target.employee_id, year, month, months: 2 })
              }
              className="rounded-full bg-primary px-3 py-1 text-[0.75em] font-semibold text-primary-foreground transition-colors hover:bg-primary-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              {t('timesheet.employee.extractTwo')}
            </button>
          </div>

          <p className="text-[0.74em] text-muted-foreground">
            {t('timesheet.employee.spanMonths', { first: spanFirst, second: spanSecond })}
          </p>
          {/* A quoted filename needs `direction: ltr` AND isolate: isolation
              alone inherits its base direction from the Arabic around it and
              `.xlsx` jumps to the wrong end (UI spec §14). */}
          <span
            dir="ltr"
            className="truncate font-mono text-[0.68rem] text-faint [unicode-bidi:isolate]"
          >
            {filename}
          </span>

          {/* The red block writes cells, so it is `timesheet.edit` and it is not
              offered on a sealed month. Absent rather than disabled: a disabled
              control still answers Enter and Space (UI spec §14). */}
          {/* `!statistics` matters as much as the other two. The grid computes
              `editable = canEdit && !closed && !statistics` and §9 says the
              statistics cells are read-only because the sheet is DERIVED — the
              fix belongs in the attendance grid or the filler assignment.
              Without it this panel is a cell-write path out of the surface Task
              8 deliberately made inert, and a wrong one twice over: `blockDays`
              would be chosen from `stat_codes` while `set_cell` writes the
              attendance override, and `paintCell` only touches `row.codes`, so
              nothing would move on screen until the server answered. */}
          {canEdit && !closed && !statistics && (
            <div className="flex flex-wrap items-center gap-2 border-t border-hairline pt-2.5">
              <label
                htmlFor="ts-bill-start"
                className="text-[0.74em] font-medium text-muted-foreground"
              >
                {t('timesheet.employee.billStart')}
              </label>
              <input
                id="ts-bill-start"
                type="number"
                min={1}
                max={daysInMonth}
                value={billRaw}
                onChange={(event) => setBillRaw(event.target.value)}
                className="w-[4.5rem] rounded-sm border border-border-strong bg-surface px-2 py-1 font-mono text-[0.78em] tabular-nums text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              />
              <button
                type="button"
                disabled={blockDays.length === 0}
                onClick={() => onFillRedBlock(target.employee_id, blockDays)}
                className="inline-flex items-center gap-1.5 rounded-full border border-border-strong bg-surface px-3 py-1 text-[0.75em] font-semibold text-muted-foreground transition-colors hover:bg-surface-tinted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-40"
              >
                <span
                  data-code="X"
                  aria-hidden
                  className="rounded-[3px] px-1.5 font-mono text-[0.62rem] font-semibold"
                >
                  X
                </span>
                {blockDays.length > 0
                  ? t('timesheet.employee.redBlockRange', {
                      from: blockDays[0],
                      to: blockDays[blockDays.length - 1],
                    })
                  : t('timesheet.employee.redBlock')}
              </button>
              <span className="max-w-[42ch] text-[0.72em] text-muted-foreground">
                {billAsked && blockDays.length === 0
                  ? t('timesheet.employee.nothingToBlock')
                  : t('timesheet.employee.blockNote')}
              </span>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
