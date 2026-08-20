/**
 * The sheet — 31 day columns, a frozen identity block, and 806 cells that are
 * each a real button (UI spec §5, §7, §8, §16).
 *
 * Five decisions worth knowing before changing anything here:
 *
 * 1. **31 columns in every month.** The workbook's row 5 carries `1..31`
 *    always and leaves column `AJ` blank in a 30-day month, so the screen keeps
 *    the column, quiets its header (`data-out="1"`) and renders an empty,
 *    `aria-hidden`, untabbable cell. The grid therefore never reflows when the
 *    month changes — which is the whole reason the loading skeleton can be laid
 *    out on the real metrics.
 *
 * 2. **No `AK..AP` totals columns.** They still print. On screen the same six
 *    numbers (and two more) arrive on hover, as `RowTally`.
 *
 * 3. **Events are delegated to `<tbody>`, not attached per cell.** 806 cells
 *    times five handlers is 4030 closures re-created on every render; one set
 *    on the body reads `data-employee` / `data-day` off the target instead. The
 *    rows are `memo`ised for the same reason: hovering a row must not re-render
 *    the sheet.
 *
 * 4. **A sweep touches the DOM, never React state.** `pointermove` writes
 *    `data-preview="1"` on the swept cells directly and the commit happens once
 *    on `pointerup`. Committing per move would repaint the grid and tear the
 *    cell out from under the pointer (UI spec §15 change 3, measured).
 *
 * 5. **Roster edges outrank everything.** `NG` before `joined_day` and `-`
 *    after `left_day` are the engine's own precedence, and `set_cell` refuses
 *    an override there (`TIMESHEET_OFF_ROSTER`). Those days are readable,
 *    focusable and reachable — and not paintable, so a sweep across them fills
 *    the days it may and says why for the ones it may not.
 *
 * Read-only is three different facts with one shape: a sealed month, the
 * derived statistics variant, and an operator holding only `timesheet.view`
 * (amendment A3). In every one of them the cells stay buttons and the
 * activation is blocked in a CAPTURE-phase handler, because `pointer-events:
 * none` blocks the pointer and not `Enter` (UI spec §14).
 */

import { memo, useCallback, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'

import type { TimesheetIssue, TimesheetRow, TimesheetVariant } from '@/lib/api'
import { cn } from '@/lib/utils'

import { CodePicker } from './CodePicker'
import { RowTally } from './RowTally'
import { CODES, type Code, isCode, slugOf } from './codes'

/** One cell a fill is asked to paint. */
export interface FillCell {
  employeeId: string
  day: number
}

/**
 * The five identity columns, in printed order. `index.css` declares
 * `--id-block` as exactly this sum, so the loading skeleton's day strip and the
 * grid's first day column start at the same offset by arithmetic rather than by
 * two people remembering the same number.
 */
export const ID_COLUMNS = ['--id-no', '--id-id', '--id-name', '--id-nat', '--id-desig'] as const

/** Always 31, in every month. */
const DAYS: readonly number[] = Array.from({ length: 31 }, (_, i) => i + 1)

/** 5 identity columns + 31 days: what a full-width heading has to span. */
const SPAN = ID_COLUMNS.length + DAYS.length

const MONTH_STAMPS = [
  'JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC',
] as const

/** The `-` code prints as a hyphen but reads as an en dash on screen. */
const glyphOf = (slug: string): string => (slug === '-' ? '–' : slug)

/**
 * The quoted workbook header — the design's signature element, and a
 * quotation: the double spaces and `Clent Code` are the template's own and are
 * reproduced exactly (UI spec §15 change 8).
 *
 * It lives in the grid CARD, above the scroll region, per UI spec §16.1's shell
 * diagram and the A3 mockup (`.docmast` inside `.card`, above `.sheetwrap`) —
 * fixed furniture, so it does not scroll away with the roster.
 *
 * `pre-wrap`, not the mockup's `pre` + `overflow-x: auto`: UI spec §4 specifies
 * `pre-wrap` for this band, and a horizontally scrollable strip would be a
 * second scroll region on a page whose entire premise is that only the grid
 * scrolls.
 */
export function TimesheetMasthead({
  year,
  month,
}: {
  year: number
  month: number
}): React.JSX.Element {
  const { t } = useTranslation()
  const stamp = `${MONTH_STAMPS[month - 1]}-${year}`
  return (
    <div className="flex shrink-0 flex-wrap items-center gap-x-3.5 gap-y-1.5 border-b border-hairline bg-surface-raised px-3.5 py-2">
      <span
        data-ts-caps
        className="text-[0.6rem] font-semibold uppercase tracking-[0.14em] text-faint"
      >
        {t('timesheet.asPrinted')}
      </span>
      <div
        data-testid="timesheet-masthead-quote"
        dir="ltr"
        className="min-w-0 whitespace-pre-wrap font-mono text-[0.68rem] leading-relaxed text-muted-foreground [unicode-bidi:isolate]"
      >
        <b className="font-semibold text-foreground">
          Global Security Service Group- MONTHLY  TIME SHEET
        </b>
        {'   Client : JUDICIAL DEPARTMENT   Site Name :   JD 908   Clent Code : P0331_JD_PRN_908EXT   GSSG-HR   For the Month of :'}
        <span className="font-semibold text-primary">{stamp}</span>
      </div>
      {/* The template's three empty boxes. Not app copy in either language —
          they are printed on the form the client signs. */}
      <div
        data-ts-caps
        className="ms-auto flex gap-1.5 text-[0.58rem] uppercase tracking-[0.1em] text-faint"
      >
        <span className="rounded border border-dashed border-border-strong px-1.5 py-0.5">
          Date Of Issued
        </span>
        <span className="rounded border border-dashed border-border-strong px-1.5 py-0.5">
          Issue No
        </span>
        <span className="rounded border border-dashed border-border-strong px-1.5 py-0.5">
          Révision
        </span>
      </div>
    </div>
  )
}

/** The strings a row needs, built once so `memo` on the row actually holds. */
interface RowStrings {
  cell: (id: string, day: number, meaning: string) => string
  meaning: Record<string, string>
  select: (id: string) => string
  badgeNew: string
  badgeFrom: (day: number) => string
  badgeTo: (day: number) => string
  startedOn: (day: number) => string
  lastWorked: (day: number) => string
}

interface GridRowProps {
  row: TimesheetRow
  codes: readonly (string | null)[]
  daysInMonth: number
  designation: string | null
  /** The whole sheet is read-only: cells keep the ring but lose the cursor. */
  locked: boolean
  selected: boolean
  editedDays: ReadonlySet<number> | undefined
  /** A blocking check's own sentence, or `undefined` — never joined from `rows`. */
  blocked: string | undefined
  strings: RowStrings
  onSelect: (employeeId: string | null) => void
}

const GridRow = memo(function GridRow({
  row,
  codes,
  daysInMonth,
  designation,
  locked,
  selected,
  editedDays,
  blocked,
  strings,
  onSelect,
}: GridRowProps): React.JSX.Element {
  const badge =
    row.joined_day !== null
      ? {
          text: row.start_confirmed ? strings.badgeFrom(row.joined_day) : strings.badgeNew,
          title: strings.startedOn(row.joined_day),
          tone: row.start_confirmed
            ? 'bg-surface-tinted text-muted-foreground'
            : 'bg-warning-soft text-warning-foreground',
        }
      : row.left_day !== null
        ? {
            text: strings.badgeTo(row.left_day),
            title: strings.lastWorked(row.left_day),
            tone: 'bg-accent-soft text-accent',
          }
        : null

  const flag = blocked ? (
    <span
      role="img"
      title={blocked}
      aria-label={blocked}
      className="ms-1.5 inline-grid h-[0.95rem] w-[0.95rem] place-items-center rounded-full bg-accent font-mono text-[0.62rem] font-bold text-on-primary align-text-bottom"
    >
      !
    </span>
  ) : null

  return (
    <tr
      data-testid="timesheet-row"
      data-employee={row.employee_id}
      data-selected={selected ? '1' : undefined}
      style={{ blockSize: 'var(--row)' }}
    >
      <td className="ts-stick ts-c-no">{row.row_no}</td>
      <td className="ts-stick ts-c-id">
        {/* The row handle: what points the dock's panels and the two-month
            extract at one employee (UI spec §16.2, §16.3). */}
        <button
          type="button"
          aria-pressed={selected}
          aria-label={strings.select(row.employee_id)}
          title={strings.select(row.employee_id)}
          onClick={() => onSelect(selected ? null : row.employee_id)}
          className="w-full px-1.5 text-start font-mono text-[0.68rem] text-muted-foreground hover:text-primary focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-ring"
        >
          {row.employee_id}
        </button>
      </td>
      <td className="ts-stick ts-c-name" title={row.name_en}>
        <b>{row.name_en}</b>
        {badge && (
          <span
            title={badge.title}
            className={cn(
              'ms-1.5 inline-flex items-center rounded-full px-1.5 text-[0.58rem] font-semibold uppercase tracking-[0.06em] align-text-bottom',
              badge.tone,
            )}
          >
            {badge.text}
          </span>
        )}
      </td>
      <td className="ts-c-nat" title={row.nationality_en ?? undefined}>
        {row.nationality_en ?? '—'}
        {flag}
      </td>
      <td className="ts-c-desig" title={designation ?? undefined}>
        {designation ?? '—'}
      </td>
      {DAYS.map((day) => {
        const code = day <= daysInMonth ? codes[day - 1] ?? null : null
        // A day the month does not have: the column stays, the cell holds
        // nothing and is not a target (UI spec §7).
        if (code === null) {
          return (
            <td key={day} className="ts-cellcell">
              <button
                type="button"
                className="ts-cell"
                data-code=""
                tabIndex={-1}
                aria-hidden
              />
            </td>
          )
        }
        const slug = slugOf(code)
        const note = row.notes[String(day)]
        return (
          <td key={day} className="ts-cellcell">
            <button
              type="button"
              className="ts-cell"
              data-code={slug}
              data-employee={row.employee_id}
              data-day={day}
              data-edited={editedDays?.has(day) ? '1' : undefined}
              data-locked={locked ? '1' : undefined}
              title={note}
              aria-label={strings.cell(row.employee_id, day, strings.meaning[slug] ?? slug)}
            >
              {glyphOf(slug)}
            </button>
          </td>
        )
      })}
    </tr>
  )
})

export interface TimesheetGridProps {
  rows: TimesheetRow[]
  year: number
  month: number
  daysInMonth: number
  variant: TimesheetVariant
  closed: boolean
  /** The operator holds `timesheet.edit` (amendment A3). */
  canEdit: boolean
  brush: Code | null
  selected: string | null
  /** `employeeId|day` for every cell corrected in this session. */
  edited?: ReadonlySet<string>
  /** Keyed by employee and never joined to `rows`: an issue may name nobody here. */
  blocking?: TimesheetIssue[]
  /** The contracted post count, so a day below it can be flagged. */
  postCount?: number
  onSetCell: (employeeId: string, day: number, code: Code | null, note?: string) => void
  onFill: (cells: FillCell[], code: Code) => void
  onSelect: (employeeId: string | null) => void
}

/** A heading, a drawn gap, or an employee — the sheet as one flat list. */
type Line =
  | { kind: 'group'; key: string; label: string; lang: string }
  | { kind: 'gap'; key: string }
  | { kind: 'row'; key: string; row: TimesheetRow }

interface Drag {
  anchor: FillCell
  code: Code
  cells: FillCell[]
  painted: HTMLElement[]
  stop: AbortController
}

export function TimesheetGrid({
  rows,
  year,
  month,
  daysInMonth,
  variant,
  closed,
  canEdit,
  brush,
  selected,
  edited,
  blocking,
  postCount = 0,
  onSetCell,
  onFill,
  onSelect,
}: TimesheetGridProps): React.JSX.Element {
  const { t, i18n } = useTranslation()
  const root = useRef<HTMLDivElement | null>(null)
  const tag = useRef<HTMLDivElement | null>(null)
  const drag = useRef<Drag | null>(null)
  /** Where the last paint landed, so shift-click knows what run to extend. */
  const lastPaint = useRef<FillCell | null>(null)
  /** A committed sweep ends in a click; it must not also open the picker. */
  const swallow = useRef(false)
  const [picker, setPicker] = useState<{ cell: FillCell; anchor: HTMLElement } | null>(null)
  const [hover, setHover] = useState<{ employeeId: string; anchor: HTMLElement } | null>(null)

  const statistics = variant === 'statistics'
  /** Cells are correctable only on the attendance grid of an open month. */
  const editable = canEdit && !closed && !statistics

  const byId = useMemo(() => {
    const index = new Map<string, TimesheetRow>()
    for (const row of rows) index.set(row.employee_id, row)
    return index
  }, [rows])

  const order = useMemo(() => {
    const index = new Map<string, number>()
    rows.forEach((row, i) => index.set(row.employee_id, i))
    return index
  }, [rows])

  const blockedBy = useMemo(() => {
    const index = new Map<string, string>()
    // Keyed by employee. `blocking` is recomputed live even on a sealed month,
    // so an issue may name somebody with no row here at all — which is simply
    // an entry nothing looks up.
    for (const issue of blocking ?? []) {
      if (!index.has(issue.employee_id)) index.set(issue.employee_id, issue.detail)
    }
    return index
  }, [blocking])

  const editedByRow = useMemo(() => {
    if (!edited || edited.size === 0) return null
    const index = new Map<string, Set<number>>()
    for (const key of edited) {
      const split = key.lastIndexOf('|')
      const id = key.slice(0, split)
      const day = Number(key.slice(split + 1))
      const days = index.get(id)
      if (days) days.add(day)
      else index.set(id, new Set([day]))
    }
    return index
  }, [edited])

  const codesOf = useCallback(
    (row: TimesheetRow): readonly (string | null)[] => (statistics ? row.stat_codes : row.codes),
    [statistics],
  )

  /**
   * Why this cell cannot be painted: `null` when it can, `''` when it is a day
   * the month does not have (locked with nothing to say), otherwise the one
   * line the operator is owed.
   */
  const whyLocked = useCallback(
    (row: TimesheetRow, day: number): string | null => {
      if (day > daysInMonth || codesOf(row)[day - 1] === null) return ''
      if (statistics) return t('timesheet.derivedHint')
      if (closed) return t('timesheet.frozen')
      if (!canEdit) return t('timesheet.readOnlyHint')
      // The roster edge owns these days; the engine applies overrides last and
      // unconditionally, so one here would paint over an `NG` or `-` the edge
      // is entitled to.
      if (day < (row.joined_day ?? 1) || day > (row.left_day ?? 31)) {
        return t('timesheet.rosterEdge', { day, id: row.employee_id })
      }
      return null
    },
    [canEdit, closed, codesOf, daysInMonth, statistics, t],
  )

  const strings = useMemo<RowStrings>(() => {
    const meaning: Record<string, string> = {}
    for (const spec of CODES) meaning[spec.slug] = t(spec.labelKey)
    return {
      meaning,
      cell: (id, day, sense) => t('timesheet.cellLabel', { id, day, meaning: sense }),
      select: (id) => t('timesheet.selectRow', { id }),
      badgeNew: t('timesheet.badgeNew'),
      badgeFrom: (day) => t('timesheet.badgeFrom', { day }),
      badgeTo: (day) => t('timesheet.badgeTo', { day }),
      startedOn: (day) => t('timesheet.startedOn', { day, before: Math.max(1, day - 1) }),
      lastWorked: (day) => t('timesheet.lastWorked', { day }),
    }
  }, [t])

  /** One narrow letter per day, from the month itself rather than 14 more keys. */
  const weekdays = useMemo(() => {
    const format = new Intl.DateTimeFormat(i18n.language, { weekday: 'narrow' })
    return DAYS.map((day) =>
      day <= daysInMonth ? format.format(new Date(year, month - 1, day)) : '',
    )
  }, [daysInMonth, i18n.language, month, year])

  const lines = useMemo<Line[]>(() => {
    const out: Line[] = []
    let group: string | null = null
    for (const row of rows) {
      // Attendance groups by the rank order the client asked for; statistics
      // replaces the groups with the two blocks and draws the printed gap
      // between them (UI spec §5, §9).
      const key = statistics ? `b${row.stat_block}` : `r${row.rank_order}|${row.designation_en}`
      if (key !== group) {
        if (statistics && group !== null) out.push({ kind: 'gap', key: `gap-${key}` })
        out.push({
          kind: 'group',
          key: `g-${key}`,
          label: statistics
            ? t(row.stat_block === 1 ? 'timesheet.block1' : 'timesheet.block2')
            : (row.designation_en ?? '—'),
          lang: statistics ? i18n.language : 'en',
        })
        group = key
      }
      out.push({ kind: 'row', key: row.employee_id, row })
    }
    return out
  }, [i18n.language, rows, statistics, t])

  /** Posts manned per day — not on the paper, and the cheapest drift detector. */
  const manned = useMemo(() => {
    const counts = DAYS.map(() => 0)
    for (const row of rows) {
      const codes = codesOf(row)
      for (let day = 1; day <= daysInMonth; day += 1) {
        if (codes[day - 1] === 'P') counts[day - 1] += 1
      }
    }
    return counts
  }, [codesOf, daysInMonth, rows])

  // --------------------------------------------------------------- utilities

  const cellNode = useCallback(
    (employeeId: string, day: number): HTMLElement | null =>
      root.current?.querySelector<HTMLElement>(
        `.ts-cell[data-employee="${employeeId}"][data-day="${day}"]`,
      ) ?? null,
    [],
  )

  const cellFrom = useCallback((target: EventTarget | null): FillCell | null => {
    const node = (target as HTMLElement | null)?.closest?.('.ts-cell') as HTMLElement | null
    const employeeId = node?.dataset.employee
    const day = node?.dataset.day
    return employeeId && day ? { employeeId, day: Number(day) } : null
  }, [])

  /** One message per gesture, keyed so a burst collapses into one toast. */
  const refuse = useCallback((reason: string) => {
    if (reason) toast.warning(reason, { id: 'timesheet-cell-locked' })
  }, [])

  const commitMark = useCallback((node: HTMLElement | null) => {
    if (!node) return
    node.removeAttribute('data-commit')
    void node.offsetWidth // force a reflow so a repeat paint re-triggers
    node.setAttribute('data-commit', '1')
    window.setTimeout(() => node.removeAttribute('data-commit'), 200)
  }, [])

  /** The days of one row a fill may actually touch, inclusive. */
  const runOf = useCallback(
    (row: TimesheetRow, from: number, to: number): FillCell[] => {
      const [first, last] = from <= to ? [from, to] : [to, from]
      const out: FillCell[] = []
      for (let day = first; day <= last; day += 1) {
        if (whyLocked(row, day) === null) out.push({ employeeId: row.employee_id, day })
      }
      return out
    },
    [whyLocked],
  )

  // ------------------------------------------------------------- drag to fill

  const clearPreview = useCallback((state: Drag | null) => {
    for (const node of state?.painted ?? []) node.removeAttribute('data-preview')
    if (state) state.painted = []
  }, [])

  const preview = useCallback(
    (to: FillCell) => {
      const state = drag.current
      if (!state) return
      clearPreview(state)
      const a = order.get(state.anchor.employeeId)
      const b = order.get(to.employeeId)
      if (a === undefined || b === undefined) return
      const [firstRow, lastRow] = a <= b ? [a, b] : [b, a]
      const cells: FillCell[] = []
      for (let index = firstRow; index <= lastRow; index += 1) {
        const row = rows[index]
        if (!row) continue
        for (const cell of runOf(row, state.anchor.day, to.day)) {
          const node = cellNode(cell.employeeId, cell.day)
          if (!node) continue
          node.setAttribute('data-preview', '1')
          state.painted.push(node)
          cells.push(cell)
        }
      }
      state.cells = cells
      const node = tag.current
      if (node) node.textContent = `${cells.length} → ${slugOf(state.code)}`
    },
    [cellNode, clearPreview, order, rows, runOf],
  )

  const endDrag = useCallback(
    (commit: boolean) => {
      const state = drag.current
      drag.current = null
      if (!state) return
      state.stop.abort()
      clearPreview(state)
      root.current?.removeAttribute('data-dragging')
      tag.current?.setAttribute('hidden', '')
      // A one-cell sweep is a click; the click handler owns it. Anything larger
      // commits exactly once, and its trailing click is swallowed so it cannot
      // also open the picker.
      if (!commit || state.cells.length < 2) return
      swallow.current = true
      lastPaint.current = state.cells[state.cells.length - 1]
      onFill(state.cells, state.code)
    },
    [clearPreview, onFill],
  )

  const onPointerDown = useCallback(
    (event: React.PointerEvent) => {
      if (event.button !== 0 || !editable) return
      const cell = cellFrom(event.target)
      const row = cell && byId.get(cell.employeeId)
      if (!cell || !row || whyLocked(row, cell.day) !== null) return
      // With nothing armed the sweep spreads the anchor's own code — the
      // spreadsheet reflex (UI spec §15 change 3).
      const anchorCode = codesOf(row)[cell.day - 1]
      const code = brush ?? (anchorCode !== null && isCode(anchorCode) ? anchorCode : null)
      if (!code) return
      // Touch pointers capture implicitly, which would send every later
      // `pointerover` to this one button and freeze the preview at one cell.
      const node = event.target as HTMLElement
      if (node.hasPointerCapture?.(event.pointerId)) node.releasePointerCapture(event.pointerId)

      const stop = new AbortController()
      drag.current = { anchor: cell, code, cells: [], painted: [], stop }
      root.current?.setAttribute('data-dragging', '1')
      setHover(null)
      tag.current?.removeAttribute('hidden')
      preview(cell)
      window.addEventListener('pointerup', () => endDrag(true), { signal: stop.signal })
      window.addEventListener(
        'pointermove',
        (move: PointerEvent) => {
          const node2 = tag.current
          if (node2) {
            node2.style.transform = `translate3d(${move.clientX + 14}px, ${move.clientY + 14}px, 0)`
          }
        },
        { signal: stop.signal },
      )
      window.addEventListener(
        'keydown',
        (key: KeyboardEvent) => {
          if (key.key === 'Escape') endDrag(false)
        },
        { signal: stop.signal },
      )
    },
    [brush, byId, cellFrom, codesOf, editable, endDrag, preview, whyLocked],
  )

  /** Row counts follow the pointer AND the keyboard, so focus arrives here too. */
  const showTally = useCallback((target: EventTarget | null) => {
    const tr = (target as HTMLElement | null)?.closest?.('tr[data-employee]') as
      | HTMLElement
      | null
    const employeeId = tr?.dataset.employee
    if (!tr || !employeeId) return
    setHover((prev) => (prev?.employeeId === employeeId ? prev : { employeeId, anchor: tr }))
  }, [])

  const onPointerOver = useCallback(
    (event: React.PointerEvent) => {
      // Mid-sweep the pointer is extending the rectangle, and the tally must
      // not appear over it (UI spec §15 change 4).
      if (drag.current) {
        const cell = cellFrom(event.target)
        if (cell) preview(cell)
        return
      }
      showTally(event.target)
    },
    [cellFrom, preview, showTally],
  )

  const onFocusIn = useCallback(
    (event: React.FocusEvent) => {
      if (drag.current) return
      showTally(event.target)
    },
    [showTally],
  )

  // -------------------------------------------------------------- activation

  /** UI spec §14: `pointer-events: none` stops the pointer, not `Enter`. */
  const onClickCapture = useCallback(
    (event: React.MouseEvent) => {
      if (swallow.current) {
        swallow.current = false
        event.preventDefault()
        event.stopPropagation()
        return
      }
      const cell = cellFrom(event.target)
      const row = cell && byId.get(cell.employeeId)
      if (!cell || !row) return
      const why = whyLocked(row, cell.day)
      if (why === null) return
      event.preventDefault()
      event.stopPropagation()
      refuse(why)
    },
    [byId, cellFrom, refuse, whyLocked],
  )

  const onKeyDownCapture = useCallback(
    (event: React.KeyboardEvent) => {
      const key = event.key
      const activates =
        key === 'Enter' || key === ' ' || CODES.some((spec) => spec.key === key.toLowerCase())
      if (!activates) return
      const cell = cellFrom(event.target)
      const row = cell && byId.get(cell.employeeId)
      if (!cell || !row) return
      const why = whyLocked(row, cell.day)
      if (why === null) return
      event.preventDefault()
      event.stopPropagation()
      refuse(why)
    },
    [byId, cellFrom, refuse, whyLocked],
  )

  const paint = useCallback(
    (cell: FillCell, code: Code, node: HTMLElement | null) => {
      lastPaint.current = cell
      commitMark(node)
      onSetCell(cell.employeeId, cell.day, code)
    },
    [commitMark, onSetCell],
  )

  const onClick = useCallback(
    (event: React.MouseEvent) => {
      const cell = cellFrom(event.target)
      const row = cell && byId.get(cell.employeeId)
      if (!cell || !row || whyLocked(row, cell.day) !== null) return
      const node = (event.target as HTMLElement).closest?.('.ts-cell') as HTMLElement | null
      if (brush) {
        // Shift-click is the sweep without the sweep: the run from the last
        // painted day, which turns a 12-day annual leave into two clicks.
        const from = lastPaint.current
        if (event.shiftKey && from && from.employeeId === cell.employeeId) {
          const cells = runOf(row, from.day, cell.day)
          lastPaint.current = cell
          if (cells.length > 1) {
            onFill(cells, brush)
            return
          }
        }
        paint(cell, brush, node)
        return
      }
      if (node) setPicker({ cell, anchor: node })
    },
    [brush, byId, cellFrom, onFill, paint, runOf, whyLocked],
  )

  const onKeyDown = useCallback(
    (event: React.KeyboardEvent) => {
      const cell = cellFrom(event.target)
      const row = cell && byId.get(cell.employeeId)
      if (!cell || !row) return
      const key = event.key
      // Arrows follow the reading direction, so ArrowRight decrements the day
      // in RTL (UI spec §8, §10).
      const rtl = i18n.dir() === 'rtl'
      const sideways = key === 'ArrowRight' ? 1 : key === 'ArrowLeft' ? -1 : 0
      if (sideways !== 0) {
        event.preventDefault()
        cellNode(cell.employeeId, cell.day + (rtl ? -sideways : sideways))?.focus()
        return
      }
      const vertical = key === 'ArrowDown' ? 1 : key === 'ArrowUp' ? -1 : 0
      if (vertical !== 0) {
        event.preventDefault()
        const here = order.get(cell.employeeId)
        const next = here === undefined ? undefined : rows[here + vertical]
        if (next) cellNode(next.employee_id, cell.day)?.focus()
        return
      }
      if (whyLocked(row, cell.day) !== null) return
      const node = (event.target as HTMLElement).closest?.('.ts-cell') as HTMLElement | null
      if (key === 'Enter' || key === ' ') {
        event.preventDefault()
        if (node) setPicker({ cell, anchor: node })
        return
      }
      const hit = CODES.find((spec) => spec.key === key.toLowerCase())
      if (hit) {
        event.preventDefault()
        paint(cell, hit.code, node)
      }
    },
    [byId, cellFrom, cellNode, i18n, order, paint, rows, whyLocked],
  )

  const closePicker = useCallback(
    (restore: boolean) => {
      setPicker((open) => {
        if (restore) open?.anchor.focus()
        return null
      })
    },
    [],
  )

  const hoverRow = hover && byId.get(hover.employeeId)

  return (
    <div
      ref={root}
      onClickCapture={onClickCapture}
      onKeyDownCapture={onKeyDownCapture}
      onPointerLeave={() => setHover(null)}
    >
      <table
        className="ts-sheet"
        // The EXACT sum, not `max-content`: measured in Chromium on the locked
        // mockup, a fixed-layout table sized `max-content` hands ~5px of
        // leftover width to one identity column, and the day strip then starts
        // past `--id-block` — 5px out of step with the loading skeleton.
        style={{ inlineSize: 'calc(var(--id-block) + var(--cell) * 31)' }}
      >
        <thead>
          <tr style={{ blockSize: 'var(--row)' }}>
            <th
              scope="col"
              className="ts-stick ts-c-no"
              aria-label={t('timesheet.colRow')}
              style={{ inlineSize: `var(${ID_COLUMNS[0]})` }}
            >
              #
            </th>
            <th
              scope="col"
              className="ts-stick ts-c-id"
              style={{ inlineSize: `var(${ID_COLUMNS[1]})` }}
            >
              {t('timesheet.colId')}
            </th>
            <th
              scope="col"
              className="ts-stick ts-c-name"
              style={{ inlineSize: `var(${ID_COLUMNS[2]})` }}
            >
              {t('timesheet.colName')}
            </th>
            <th scope="col" className="ts-c-nat" style={{ inlineSize: `var(${ID_COLUMNS[3]})` }}>
              {t('timesheet.colNat')}
            </th>
            <th
              scope="col"
              className="ts-c-desig"
              style={{ inlineSize: `var(${ID_COLUMNS[4]})` }}
            >
              {t('timesheet.colDesig')}
            </th>
            {DAYS.map((day) => (
              <th
                key={day}
                scope="col"
                className="ts-day"
                data-out={day > daysInMonth ? '1' : undefined}
                style={{ inlineSize: 'var(--cell)' }}
              >
                {day}
                <small>{weekdays[day - 1]}</small>
              </th>
            ))}
          </tr>
        </thead>
        <tbody
          onClick={onClick}
          onKeyDown={onKeyDown}
          onPointerDown={onPointerDown}
          onPointerOver={onPointerOver}
          onFocus={onFocusIn}
        >
          {lines.map((line) => {
            if (line.kind === 'gap') {
              return (
                <tr key={line.key} className="ts-gap" data-testid="timesheet-block-gap">
                  <td colSpan={SPAN} />
                </tr>
              )
            }
            if (line.kind === 'group') {
              return (
                <tr key={line.key} className="ts-group" style={{ blockSize: 'var(--row)' }}>
                  {/* The printed designation, so its language follows the
                      DELIVERABLE and not the interface (UI spec §10). */}
                  <th colSpan={SPAN} lang={line.lang} data-ts-caps scope="colgroup">
                    {line.label}
                  </th>
                </tr>
              )
            }
            return (
              <GridRow
                key={line.key}
                row={line.row}
                codes={codesOf(line.row)}
                daysInMonth={daysInMonth}
                designation={statistics ? line.row.designation_ar : line.row.designation_en}
                locked={!editable}
                selected={selected === line.row.employee_id}
                editedDays={editedByRow?.get(line.row.employee_id)}
                blocked={blockedBy.get(line.row.employee_id)}
                strings={strings}
                onSelect={onSelect}
              />
            )
          })}
        </tbody>
        <tfoot>
          <tr style={{ blockSize: 'var(--row)' }}>
            <th colSpan={ID_COLUMNS.length} className="ts-stick ts-c-no" scope="row">
              {t('timesheet.headcount')}
            </th>
            {DAYS.map((day) => {
              if (day > daysInMonth) return <td key={day} />
              const count = manned[day - 1]
              return (
                <td
                  key={day}
                  data-testid="timesheet-headcount"
                  data-low={postCount > 0 && count < postCount ? '1' : undefined}
                  title={`${t('timesheet.colRow')} ${day}: ${count}`}
                >
                  {count}
                </td>
              )
            })}
          </tr>
        </tfoot>
      </table>

      <div ref={tag} className="ts-dragtag" aria-hidden hidden />

      {picker && (
        <CodePicker
          employeeId={picker.cell.employeeId}
          day={picker.cell.day}
          name={byId.get(picker.cell.employeeId)?.name_en ?? ''}
          anchor={picker.anchor}
          onPick={(code, note) => {
            const node = picker.anchor
            commitMark(node)
            if (code !== null) lastPaint.current = picker.cell
            if (note === undefined) onSetCell(picker.cell.employeeId, picker.cell.day, code)
            else onSetCell(picker.cell.employeeId, picker.cell.day, code, note)
            closePicker(true)
          }}
          onClose={closePicker}
        />
      )}

      {hover && hoverRow && (
        <RowTally
          row={hoverRow}
          codes={codesOf(hoverRow)}
          daysInMonth={daysInMonth}
          anchor={hover.anchor}
          onDismiss={() => setHover(null)}
        />
      )}
    </div>
  )
}
