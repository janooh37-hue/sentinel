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

import { GripVertical } from 'lucide-react'
import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'

import type {
  TimesheetDesignationRead,
  TimesheetIssue,
  TimesheetRow,
  TimesheetVariant,
} from '@/lib/api'
import { cn } from '@/lib/utils'

import { CodePicker } from './CodePicker'
import { RowTally } from './RowTally'
import { CODES, type Code, type CodeSlug, isCode, slugOf } from './codes'
import { DAYS, ID_COLUMNS, SPAN } from './columns'

/** One cell a fill is asked to paint. */
export interface FillCell {
  employeeId: string
  day: number
}

const MONTH_STAMPS = [
  'JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC',
] as const

/** The `-` code prints as a hyphen but reads as an en dash on screen. */
const glyphOf = (slug: string): string => (slug === '-' ? '–' : slug)

/** A band with no rank of its own sorts behind every designation. */
const LAST_RANK = 1e9

/**
 * The keyboard half of a roster move: the same targets a drag offers, opened
 * from the same grip button (design §"Keyboard and reduced motion").
 *
 * A menu rather than a listbox, because choosing one is an action and not a
 * selection to be committed later — and the same shape as `CodePicker`, which
 * is the other popover this sheet opens from a cell. Placement is that file's
 * arithmetic: a viewport coordinate is physical and so is a transform, so the
 * anchor's rect becomes a translation and RTL subtracts the far-edge origin
 * `.ts-popover` gives it.
 */
function DesignationPicker({
  employeeId,
  designations,
  anchor,
  onPick,
  onClose,
}: {
  employeeId: string
  designations: readonly TimesheetDesignationRead[]
  anchor: HTMLElement
  onPick: (designationId: number) => void
  onClose: (restore: boolean) => void
}): React.JSX.Element {
  const { t } = useTranslation()
  const popover = useRef<HTMLDivElement | null>(null)

  useLayoutEffect(() => {
    const node = popover.current
    if (!node) return
    const rect = anchor.getBoundingClientRect()
    const size = node.getBoundingClientRect()
    const rtl = document.documentElement.dir === 'rtl'
    const raw = rtl ? rect.right - size.width : rect.left
    const x = Math.max(8, Math.min(raw, window.innerWidth - size.width - 8))
    const below = rect.bottom + 6
    const y = below + size.height > window.innerHeight - 8 ? rect.top - size.height - 6 : below
    const origin = rtl ? window.innerWidth - size.width : 0
    node.style.transform = `translate3d(${x - origin}px, ${Math.max(8, y)}px, 0)`
  }, [anchor])

  useEffect(() => {
    popover.current?.querySelector<HTMLElement>('[role="menuitem"]')?.focus()
  }, [])

  useEffect(() => {
    const outside = (event: MouseEvent): void => {
      if (!popover.current?.contains(event.target as Node)) onClose(false)
    }
    document.addEventListener('mousedown', outside)
    return () => document.removeEventListener('mousedown', outside)
  }, [onClose])

  const onKeyDown = (event: React.KeyboardEvent): void => {
    if (event.key === 'Escape') {
      event.preventDefault()
      event.stopPropagation()
      onClose(true)
      return
    }
    const items = Array.from(
      popover.current?.querySelectorAll<HTMLElement>('[role="menuitem"]') ?? [],
    )
    const step = event.key === 'ArrowDown' ? 1 : event.key === 'ArrowUp' ? -1 : 0
    if (step === 0 || items.length === 0) return
    event.preventDefault()
    const here = items.indexOf(document.activeElement as HTMLElement)
    items[(here + step + items.length) % items.length]?.focus()
  }

  return createPortal(
    <div
      ref={popover}
      role="menu"
      aria-label={t('timesheet.rosterEdit.targets')}
      onKeyDown={onKeyDown}
      className="ts-popover min-w-[14rem] rounded-xl border border-border bg-surface p-1.5 shadow-lg"
    >
      <div className="border-b border-hairline px-2 pb-1.5 pt-1 text-[0.7rem] text-muted-foreground">
        <span dir="ltr" className="font-mono text-foreground [unicode-bidi:isolate]">
          {employeeId}
        </span>
      </div>
      {designations.map((designation) => (
        <button
          key={designation.id}
          type="button"
          role="menuitem"
          onClick={() => onPick(designation.id)}
          // The printed name, in the language it prints in — the band the row
          // will land under says exactly this.
          lang="en"
          className="flex w-full items-center rounded-lg px-2 py-1.5 text-start text-[0.78rem] text-foreground hover:bg-surface-tinted focus-visible:bg-surface-tinted focus-visible:outline-none"
        >
          {designation.name_en}
        </button>
      ))}
    </div>,
    document.body,
  )
}

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
        data-testid="timesheet-masthead-form"
        data-ts-caps
        dir="ltr"
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
  editedBy: (by: string | null, at: string) => string
  grip: (id: string) => string
}

interface GridRowProps {
  row: TimesheetRow
  codes: readonly (string | null)[]
  daysInMonth: number
  designation: string | null
  /** The whole sheet is read-only: cells keep the ring but lose the cursor. */
  locked: boolean
  selected: boolean
  /** The active filter's code, or null when the sheet is unfiltered. */
  filterCode: CodeSlug | null
  /** This row is the current employee in the cyclic filter. */
  filterCurrent: boolean
  editedDays: ReadonlySet<number> | undefined
  /** A blocking check's own sentence, or `undefined` — never joined from `rows`. */
  blocked: string | undefined
  /**
   * The drag grip's accessible name in roster edit mode, `undefined` outside
   * it. A string rather than a flag, so `memo` still holds by value.
   */
  grip: string | undefined
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
  filterCode,
  filterCurrent,
  editedDays,
  blocked,
  grip,
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
      data-code-filter-current={filterCurrent ? '1' : undefined}
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
      {/* In roster edit mode the designation cell becomes the handle for the
          thing it names — no sixth identity column, because `--id-block` is
          the sum of five and the loading skeleton starts its day strip at it.
          A real button, so the keyboard reaches the same targets the pointer
          drags to. */}
      <td className="ts-c-desig" title={grip ?? designation ?? undefined}>
        {grip === undefined ? (
          (designation ?? '—')
        ) : (
          <button
            type="button"
            draggable
            data-ts-grip
            data-employee={row.employee_id}
            aria-label={grip}
            className="inline-flex w-full cursor-grab items-center gap-1 rounded text-start text-inherit hover:text-primary focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-ring"
          >
            <GripVertical className="h-3 w-3 shrink-0" strokeWidth={2} aria-hidden />
            <span className="truncate">{designation ?? '—'}</span>
          </button>
        )}
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
        const filterMatch = filterCode !== null && slug === filterCode
        const note = row.notes[String(day)]
        const edit = row.edits[String(day)]
        return (
          <td key={day} className="ts-cellcell">
            <button
              type="button"
              className={cn(
                'ts-cell',
                filterMatch && 'ring-1 ring-inset ring-primary',
                filterMatch && filterCurrent && 'ring-2 ring-inset ring-primary',
              )}
              data-code={slug}
              data-employee={row.employee_id}
              data-day={day}
              data-edited={editedDays?.has(day) || edit !== undefined ? '1' : undefined}
              data-locked={locked ? '1' : undefined}
              data-code-filter-match={filterMatch ? '1' : undefined}
              data-code-filter-current={filterMatch && filterCurrent ? '1' : undefined}
              title={
                [note, edit ? strings.editedBy(edit.by, edit.at) : undefined]
                  .filter(Boolean)
                  .join(' — ') || undefined
              }
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

/**
 * Roster edit mode, as the sheet needs it: the valid targets and one way to
 * stage a move. Present only while the page is in that mode, absent otherwise
 * — an affordance nobody may use is not rendered disabled (UI spec §14).
 *
 * The grid holds no query of its own, which is the reason `renameControl` is a
 * node the page builds rather than a callback the grid wires: the catalog
 * dialogs need react-query, and the sheet is a props component that 30 test
 * cases render with no provider at all.
 */
export interface RosterEdit {
  /** Active designations of the displayed workbook, in printed rank order. */
  designations: readonly TimesheetDesignationRead[]
  /** Stage one move. The id is always one of `designations`. */
  onAssign: (employeeId: string, designationId: number) => void
  /** The rename affordance for one band, or nothing. */
  renameControl?: (designation: TimesheetDesignationRead) => React.ReactNode
}

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
  /** The code whose matching cells receive the filter outline. */
  activeFilterCode?: CodeSlug | null
  /** Render only these employee rows; null means the complete sheet. */
  filteredEmployeeIds?: ReadonlySet<string> | null
  /** The current employee in the cyclic filter. */
  currentFilterEmployeeId?: string | null
  /** `employeeId|day` for every cell corrected in this session. */
  edited?: ReadonlySet<string>
  /** Keyed by employee and never joined to `rows`: an issue may name nobody here. */
  blocking?: TimesheetIssue[]
  /** The contracted post count, so a day below it can be flagged. */
  postCount?: number
  /** Roster edit mode is on: grips, drop bands, and no cell corrections. */
  roster?: RosterEdit
  onSetCell: (employeeId: string, day: number, code: Code | null, note?: string) => void
  onFill: (cells: FillCell[], code: Code) => void
  onSelect: (employeeId: string | null) => void
  /**
   * Ctrl+Z, from inside the sheet — UI spec §8's keyboard model ends with it.
   * The session's correction log lives on the page, so the grid only reports
   * the chord; it is the same `undo` the ribbon button calls.
   */
  onUndo: () => void
}

/** A heading, a drawn gap, or an employee — the sheet as one flat list. */
type Line =
  | {
      kind: 'group'
      key: string
      label: string
      lang: string
      /** How many rows the band holds — printed while the roster is edited. */
      count?: number
      /** The designation a drop on this band assigns, when it takes drops. */
      drop?: number
    }
  | { kind: 'gap'; key: string }
  | { kind: 'row'; key: string; row: TimesheetRow }

interface Drag {
  anchor: FillCell
  code: Code
  cells: FillCell[]
  painted: HTMLElement[]
  stop: AbortController
  /**
   * The employee `<tr>`s in document order — i.e. in `rows` order — captured
   * once when the gesture starts, so the preview can index a cell positionally
   * instead of asking the DOM for it. `preview` re-reads this on any mismatch,
   * so a re-render under the pointer cannot leave it stale.
   */
  trs: HTMLTableRowElement[]
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
  activeFilterCode = null,
  filteredEmployeeIds = null,
  currentFilterEmployeeId = null,
  edited,
  blocking,
  postCount = 0,
  roster,
  onSetCell,
  onFill,
  onSelect,
  onUndo,
}: TimesheetGridProps): React.JSX.Element {
  const { t, i18n } = useTranslation()
  const root = useRef<HTMLDivElement | null>(null)
  const tag = useRef<HTMLDivElement | null>(null)
  const drag = useRef<Drag | null>(null)
  /** Where the last paint landed, so shift-click knows what run to extend. */
  const lastPaint = useRef<FillCell | null>(null)
  /** A committed sweep ends in a click; it must not also open the picker. */
  const swallow = useRef(false)
  /**
   * The employee a native drag is carrying. The `DataTransfer` payload is set
   * as well, because a browser drag without one is not a drag — but it is
   * advisory: jsdom has none, and any other drop target on the page can read
   * it, so the grid trusts its own ref for what it is moving.
   */
  const dragged = useRef<string | null>(null)
  /** The band the drag is currently over, marked by attribute, never state. */
  const over = useRef<HTMLElement | null>(null)
  /** Where the moved row was before the draft changed, for the FLIP. */
  const flip = useRef<{ employeeId: string; top: number } | null>(null)
  const [picker, setPicker] = useState<{ cell: FillCell; anchor: HTMLElement } | null>(null)
  const [moving, setMoving] = useState<{ employeeId: string; anchor: HTMLElement } | null>(null)
  const [hover, setHover] = useState<{ employeeId: string; anchor: HTMLElement } | null>(null)

  const statistics = variant === 'statistics'
  /**
   * The roster is a property of the attendance grid: statistics groups by the
   * two blocks, not by designation, so there is nothing there to drop onto.
   * Switching variants mid-draft therefore hides the grips and keeps the
   * draft, rather than offering targets the sheet is not printing.
   */
  const rosterEdit = statistics ? undefined : roster
  /**
   * Cells are correctable only on the attendance grid of an open month — and
   * not while the roster is being edited: a move is staged and a correction is
   * live, and mixing the two in one gesture set is how an operator loses track
   * of which of the two Save applies to.
   */
  const editable = canEdit && !closed && !statistics && rosterEdit === undefined

  const visibleRows = useMemo(
    () =>
      rosterEdit || filteredEmployeeIds === null
        ? rows
        : rows.filter((row) => filteredEmployeeIds.has(row.employee_id)),
    [filteredEmployeeIds, rosterEdit, rows],
  )

  const byId = useMemo(() => {
    const index = new Map<string, TimesheetRow>()
    for (const row of rows) index.set(row.employee_id, row)
    return index
  }, [rows])

  /** The drop targets by id, so a band can name the row its control renames. */
  const targets = useMemo(() => {
    const index = new Map<number, TimesheetDesignationRead>()
    for (const designation of rosterEdit?.designations ?? []) index.set(designation.id, designation)
    return index
  }, [rosterEdit])

  const order = useMemo(() => {
    const index = new Map<string, number>()
    visibleRows.forEach((row, i) => index.set(row.employee_id, i))
    return index
  }, [visibleRows])

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
      // Roster mode first: it is the state the operator just chose, so it is
      // the reason they need to hear. Refused rather than disabled, so the
      // cell still answers Enter with the sentence (UI spec §14).
      if (rosterEdit) return t('timesheet.rosterEdit.cellsLocked')
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
    [canEdit, closed, codesOf, daysInMonth, rosterEdit, statistics, t],
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
      editedBy: (by, at) =>
        t('timesheet.editedBy', {
          by: by ?? t('timesheet.editedByUnknown'),
          date: new Date(at).toLocaleDateString(i18n.language, {
            day: '2-digit',
            month: 'short',
            year: 'numeric',
          }),
        }),
      grip: (id) => t('timesheet.rosterEdit.grip', { id }),
    }
  }, [i18n.language, t])

  /** One narrow letter per day, from the month itself rather than 14 more keys. */
  const weekdays = useMemo(() => {
    const format = new Intl.DateTimeFormat(i18n.language, { weekday: 'narrow' })
    return DAYS.map((day) =>
      day <= daysInMonth ? format.format(new Date(year, month - 1, day)) : '',
    )
  }, [daysInMonth, i18n.language, month, year])

  const lines = useMemo<Line[]>(() => {
    const out: Line[] = []
    if (rosterEdit) {
      // Grouped by designation ID and not by printed name: the id is what a
      // drop writes, two catalog rows may print the same name at different
      // ranks, and a rename mid-draft must not split a band in two.
      const held = new Map<number | null, TimesheetRow[]>()
      for (const row of visibleRows) {
        const key = row.designation_id ?? null
        const bucket = held.get(key)
        if (bucket) bucket.push(row)
        else held.set(key, [row])
      }
      const sections: {
        rank: number
        id: number
        label: string
        lang: string
        drop?: number
        rows: TimesheetRow[]
      }[] = []
      // Every active designation of this workbook is a band, EMPTY ONES
      // INCLUDED: a vacancy is a place to drop somebody, and hiding it until
      // it has an occupant is how a designation nobody holds becomes
      // unreachable (design goal 6).
      for (const designation of rosterEdit.designations) {
        sections.push({
          rank: designation.rank_order,
          id: designation.id,
          label: designation.name_en,
          lang: 'en',
          drop: designation.id,
          rows: held.get(designation.id) ?? [],
        })
        held.delete(designation.id)
      }
      // What the catalog no longer offers as a target still has to print. A man
      // on a designation since deactivated keeps his own printed heading, and
      // the men on no designation at all come last, under the words the checks
      // panel already uses for them — a heading, not a drop target: taking
      // somebody off every designation is not a move between two.
      for (const [key, rows_] of held) {
        sections.push({
          rank: key === null ? LAST_RANK : rows_[0].rank_order ?? LAST_RANK,
          id: key ?? LAST_RANK,
          label: key === null ? t('timesheet.issues.no_designation') : rows_[0].designation_en ?? '—',
          lang: key === null ? i18n.language : 'en',
          rows: rows_,
        })
      }
      sections.sort((a, b) => a.rank - b.rank || a.id - b.id)
      for (const section of sections) {
        out.push({
          kind: 'group',
          key: `g-${section.id}`,
          label: section.label,
          lang: section.lang,
          count: section.rows.length,
          drop: section.drop,
        })
        for (const row of section.rows) out.push({ kind: 'row', key: row.employee_id, row })
      }
      return out
    }
    let group: string | null = null
    for (const row of visibleRows) {
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
  }, [i18n.language, rosterEdit, statistics, t, visibleRows])

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


  useEffect(() => () => drag.current?.stop.abort(), [])

  // --------------------------------------------------------------- utilities

  const cellNode = useCallback(
    (employeeId: string, day: number): HTMLElement | null =>
      root.current?.querySelector<HTMLElement>(
        `.ts-cell[data-employee="${employeeId}"][data-day="${day}"]`,
      ) ?? null,
    [],
  )

  /**
   * The employee rows in document order, in ONE query. `preview` used to
   * resolve every swept cell through `cellNode` above — a two-attribute
   * selector against a ~10,000-node subtree, once per cell per pointer step, so
   * a 100x20 rectangle cost 2,000 DOM queries per `pointerover` and a
   * full-sheet sweep 8,525. The rest of the sweep machinery is careful about
   * exactly this (no React state per cell, attributes written directly); this
   * was the last O(cells) cost in the inner loop.
   */
  const rowNodes = useCallback(
    (): HTMLTableRowElement[] =>
      Array.from(
        root.current?.querySelectorAll<HTMLTableRowElement>('tr[data-employee]') ?? [],
      ),
    [],
  )

  const rowNode = useCallback(
    (employeeId: string): HTMLTableRowElement | null =>
      root.current?.querySelector<HTMLTableRowElement>(`tr[data-employee="${employeeId}"]`) ??
      null,
    [],
  )

  // ------------------------------------------------------------- roster moves

  const bandOf = useCallback(
    (target: EventTarget | null): HTMLElement | null =>
      ((target as HTMLElement | null)?.closest?.('[data-ts-drop]') as HTMLElement | null) ?? null,
    [],
  )

  const clearOver = useCallback(() => {
    over.current?.removeAttribute('data-ts-over')
    over.current = null
  }, [])

  /**
   * Stage one move, remembering where the row was first.
   *
   * The rectangle has to be read HERE, before the draft changes: by the time
   * the layout effect below runs, the sheet has already been reprinted and the
   * row's old position is gone.
   *
   * A drop on the band the row is ALREADY under is not a move, and measuring it
   * is worse than pointless: nothing re-renders, so the layout effect never
   * runs to spend the rectangle, and the next real move then animates from a
   * position the row left minutes ago — or, when the two happen to match, from
   * nowhere at all.
   */
  const assign = useCallback(
    (employeeId: string, designationId: number) => {
      if (byId.get(employeeId)?.designation_id === designationId) return
      const tr = rowNode(employeeId)
      flip.current = tr ? { employeeId, top: tr.getBoundingClientRect().top } : null
      rosterEdit?.onAssign(employeeId, designationId)
    },
    [byId, rosterEdit, rowNode],
  )

  /**
   * The move, animated from where the row was to where it now is (FLIP).
   *
   * Guarded on the method existing as well as on the preference, and one guard
   * serves both: jsdom implements no Web Animations API at all, and an
   * operator who asked for reduced motion asked for the new layout without the
   * travel — not for the move to be refused. The travel scales the duration
   * inside the plan's calm band, so a hop between neighbouring bands does not
   * take as long as a move across 200 rows.
   */
  useLayoutEffect(() => {
    const from = flip.current
    flip.current = null
    if (!from) return
    const tr = rowNode(from.employeeId)
    if (!tr || typeof tr.animate !== 'function') return
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return
    const delta = from.top - tr.getBoundingClientRect().top
    if (delta === 0) return
    tr.animate([{ transform: `translateY(${delta}px)` }, { transform: 'none' }], {
      duration: Math.min(460, 220 + Math.abs(delta) * 0.4),
      // The sheet's own calm curve, read from the token rather than restated.
      easing: getComputedStyle(tr).getPropertyValue('--ease-out-expo').trim() || 'ease-out',
    })
  }, [rowNode, rows])

  const onDragStart = useCallback((event: React.DragEvent) => {
    const node = (event.target as HTMLElement).closest?.('[data-ts-grip]') as HTMLElement | null
    const employeeId = node?.dataset.employee
    if (!employeeId) return
    dragged.current = employeeId
    const payload = event.dataTransfer
    if (payload) {
      payload.setData('text/plain', employeeId)
      payload.effectAllowed = 'move'
    }
  }, [])

  const onDragOver = useCallback(
    (event: React.DragEvent) => {
      if (dragged.current === null) return
      const band = bandOf(event.target)
      if (!band) return
      // Without this the browser refuses the drop: preventing the default on
      // dragover IS "this is a valid target".
      event.preventDefault()
      if (event.dataTransfer) event.dataTransfer.dropEffect = 'move'
      if (over.current === band) return
      clearOver()
      over.current = band
      band.setAttribute('data-ts-over', '1')
    },
    [bandOf, clearOver],
  )

  const onDragLeave = useCallback(
    (event: React.DragEvent) => {
      const band = bandOf(event.target)
      if (band && band === over.current && !band.contains(event.relatedTarget as Node | null)) {
        clearOver()
      }
    },
    [bandOf, clearOver],
  )

  const onDrop = useCallback(
    (event: React.DragEvent) => {
      const employeeId = dragged.current
      const band = bandOf(event.target)
      const target = band?.dataset.tsDrop
      dragged.current = null
      clearOver()
      if (!employeeId || !target) return
      event.preventDefault()
      assign(employeeId, Number(target))
    },
    [assign, bandOf, clearOver],
  )

  const onDragEnd = useCallback(() => {
    dragged.current = null
    clearOver()
  }, [clearOver])

  const closeMoving = useCallback((restore: boolean) => {
    setMoving((open) => {
      if (restore) open?.anchor.focus()
      return null
    })
  }, [])

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
        const row = visibleRows[index]
        if (!row) continue
        // Positional, not a selector: the day cells follow the five identity
        // cells in every row, so day N is `cells[5 + N - 1]` and its button is
        // that cell's only child. One string compare per row keeps it honest if
        // the sheet re-rendered under the pointer and the cached list went
        // stale — one query then, not one per cell.
        let tr = state.trs[index]
        if (tr?.dataset.employee !== row.employee_id) {
          state.trs = rowNodes()
          tr = state.trs[index]
        }
        if (!tr) continue
        for (const cell of runOf(row, state.anchor.day, to.day)) {
          const node = tr.cells[ID_COLUMNS.length + cell.day - 1]
            ?.firstElementChild as HTMLElement | null
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
    [clearPreview, order, rowNodes, runOf, visibleRows],
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
      if (!cell || !row) return
      // A roster-edge anchor still starts a sweep. The edge days are not
      // paintable, but requiring the operator to START on a paintable one is
      // the wrong contract: a mid-month joiner's row opens with NG, and
      // dragging 1→8 to mark the leave they took is the natural gesture.
      // `runOf` drops the days the edge owns, the preview ring shows exactly
      // which cells will take the code, and the live count says how many — so
      // the rectangle narrows visibly instead of being refused wholesale
      // (UI spec §7; the same rule the module note above states).
      //
      // `whyLocked` is not consulted here at all. Inside an editable sheet the
      // only cell it can refuse that `cellFrom` also resolves IS a roster
      // edge: a day the month lacks carries no `data-employee`/`data-day`, so
      // `cellFrom` already returned null for it above.
      const locked = whyLocked(row, cell.day) !== null
      // With nothing armed the sweep spreads the anchor's own code — the
      // spreadsheet reflex (UI spec §15 change 3). A locked anchor has no code
      // to offer: what it shows is the engine's own `NG`/`-`, and spreading
      // that as an override is not what grabbing a greyed cell meant. So the
      // edge starts a sweep only with a brush armed, which is the case that
      // gesture exists for.
      const anchorCode = codesOf(row)[cell.day - 1]
      const code = locked
        ? brush
        : brush ?? (anchorCode !== null && isCode(anchorCode) ? anchorCode : null)
      if (!code) return
      // Touch pointers capture implicitly, which would send every later
      // `pointerover` to this one button and freeze the preview at one cell.
      const node = event.target as HTMLElement
      if (node.hasPointerCapture?.(event.pointerId)) node.releasePointerCapture(event.pointerId)

      const stop = new AbortController()
      drag.current = { anchor: cell, code, cells: [], painted: [], stop, trs: rowNodes() }
      root.current?.setAttribute('data-dragging', '1')
      setHover(null)
      tag.current?.removeAttribute('hidden')
      preview(cell)
      window.addEventListener('pointerup', () => endDrag(true), { signal: stop.signal })
      window.addEventListener('pointercancel', () => endDrag(false), { signal: stop.signal })
      window.addEventListener(
        'pointermove',
        (move: PointerEvent) => {
          const node2 = tag.current
          if (node2) {
            // `.ts-dragtag` is anchored at `inset-inline-start: 0`, which is
            // the viewport's RIGHT edge under `dir="rtl"` — subtract that
            // origin, the same way `CodePicker.tsx:73` and `RowTally.tsx:80`
            // already do.
            const origin =
              document.documentElement.dir === 'rtl' ? window.innerWidth - node2.offsetWidth : 0
            node2.style.transform = `translate3d(${move.clientX + 14 - origin}px, ${move.clientY + 14}px, 0)`
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
    [brush, byId, cellFrom, codesOf, editable, endDrag, preview, rowNodes, whyLocked],
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

  /**
   * The trailing click of a committed sweep must not also open the picker, so
   * `endDrag` arms `swallow`. Clearing it in `onClickCapture` alone leaks:
   * per UI Events, a `click` whose `pointerdown` and `pointerup` have different
   * targets is dispatched at their **nearest common inclusive ancestor**, and a
   * sweep released above the sheet or past the table's edge puts that ancestor
   * outside this component — the page's scroll region, an ancestor of `root` —
   * so the capture handler below is never on the path and the flag survives the
   * gesture. The operator's next click anywhere in the grid was then consumed
   * in silence: no picker, no paint, no selection, nothing said, and the click
   * after it worked, so it read as a dropped input rather than a bug.
   *
   * A `pointerdown` always precedes the click it must not eat, so clearing at
   * the start of every gesture is ordering-safe and the flag cannot outlive
   * one.
   */
  const onPointerDownCapture = useCallback(() => {
    swallow.current = false
  }, [])

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
      // UI spec §8's keyboard model ends `… Enter / Space opens the picker,
      // Escape closes it, Ctrl+Z undoes.` Without this an operator working the
      // sheet from the keyboard had to leave it and mouse to the ribbon.
      // `metaKey` for parity.
      //
      // Scoped by DOM CONTAINMENT — anywhere inside the sheet, which is what
      // "from the grid" was always meant to be. Not `cellFrom`, which was a
      // cell and nothing else: the row handle is a focusable button in this
      // root that is not a `.ts-cell`, so after clicking an employee ID to
      // select a row (§16.2, §16.3 — the gesture the dock's panels and the
      // two-month extract are pointed with) Ctrl+Z became a silent no-op.
      //
      // Containment is also the honest boundary for the popover. A portal is
      // not a boundary in REACT's dispatch: React attaches its listeners to the
      // portal container when the `HostPortal` fiber mounts and builds the path
      // by walking `instance.return`, with no portal break — and `CodePicker`
      // is a React child of this root — so this handler IS on the path for
      // keystrokes typed inside the note field, where unscoped it answered
      // Ctrl+Z by reversing the previous correction with a live non-quiet write
      // instead of undoing the operator's text. The popover is portalled to
      // `document.body`, so it is a fiber descendant and NOT a DOM one, which
      // is exactly the distinction `contains` reads.
      //
      // `!altKey` closes the AltGr case: Windows reports AltGr as Ctrl+Alt, and
      // this is a bilingual product where AltGr is in daily use. `!shiftKey`
      // closes redo — Ctrl+Shift+Z on both platforms — which this feature does
      // not have: `undo` only pops the correction stack and issues another live
      // write, so answering redo would reverse a SECOND correction with no way
      // forward, and compound on every further press. (The letter guards below
      // leave `shiftKey` alone because they match case-insensitively; `z` has no
      // such counterpart.)
      if (
        (event.ctrlKey || event.metaKey) &&
        !event.altKey &&
        !event.shiftKey &&
        key.toLowerCase() === 'z' &&
        root.current?.contains(event.target as Node) === true
      ) {
        if (!editable) return
        event.preventDefault()
        onUndo()
        return
      }
      // A code letter with a modifier held is a BROWSER command, not a paint.
      // `s` is sick leave, so Ctrl+S marked sick leave and swallowed the save;
      // `a`, `p` and `x` did the same to select-all, print and cut. This guard
      // returns rather than stopping propagation, so `CodePicker` carries the
      // same one — the paint path has THREE handlers, not two.
      if (event.ctrlKey || event.metaKey || event.altKey) return
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
    [byId, cellFrom, editable, onUndo, refuse, whyLocked],
  )

  /**
   * Paint-path enumeration (Task 8 fix rounds 4–5). Keep every future
   * keyboard or activation path in this list before adding it:
   * - `onKeyDownCapture` Ctrl/Cmd+Z reaches `onUndo` only when it is inside
   *   this root, editable, not AltGr (`!altKey`), and not redo (`!shiftKey`);
   * - the same capture handler's Enter/Space/code branch reaches `refuse` (a
   *   toast, never a write) for locked cells and bails on Ctrl/Cmd/Alt, so
   *   browser commands never paint;
   * - `<tbody>` `onKeyDown` paints bare arrows/letters/Enter/Space only after
   *   the same Ctrl/Cmd/Alt guard; its arrows move focus rather than paint;
   * - `onClick` paints, fills, or opens the picker and bails on Ctrl/Cmd/Alt;
   *   this covers native `Ctrl+Space` activation and modifier clicks, while
   *   shift remains armed for the documented shift-click range;
   * - `CodePicker.onKeyDown` has the same modifier guard before it can choose;
   * - the picker menuitem click is deliberately unguarded: modifier and bare
   *   activation have the same outcome, so another guard would add noise;
   * - the picker note input's Enter is deliberately unguarded: it is a save
   *   field, no browser command is shadowed, and every modifier still submits;
   * - window `keydown` during a sweep recognizes Escape only and cancels;
   * - ribbon swatches, Undo, and month-stepper Enter/Space use native button
   *   activation, not a key interpreter, and the pointer path's shift-click is
   *   handled by `onClick`.
   */
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
      // The one paint path a KEYDOWN guard cannot reach. A day cell is a real
      // `<button>`, and its native activation behaviour is not modifier-gated:
      // measured in Chromium, `Ctrl+Space` on a focused cell dispatches a
      // synthesized click even though the keydown handlers decline the chord
      // (`Ctrl+Enter` does not — Chromium gates the Enter synthesis on
      // modifiers, the Space one it does not). With a brush armed that click
      // PAINTED, where bare Space opens the picker — so the chord did not match
      // the bare key, it silently wrote instead of showing a menu.
      //
      // The synthesized click carries the modifier state, so the guard belongs
      // here. `shiftKey` stays out: shift-click is §8's range gesture, below.
      if (event.ctrlKey || event.metaKey || event.altKey) return
      // The grip's ACTIVATION, whichever way it arrives. A grip is a real
      // button, so Enter and Space already synthesize a click here — one
      // branch therefore serves the pointer operator who clicks instead of
      // dragging and the keyboard operator who never can, with no second key
      // interpreter to keep in step with the paint path enumerated below.
      const gripNode = (event.target as HTMLElement).closest?.('[data-ts-grip]') as
        | HTMLElement
        | null
      const gripped = gripNode?.dataset.employee
      if (gripped) {
        event.preventDefault()
        setMoving({ employeeId: gripped, anchor: gripNode })
        return
      }
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
      // A chord belongs to the browser (or to `onKeyDownCapture`'s Ctrl+Z), not
      // to the sheet: without this, Ctrl+S painted sick leave instead of
      // saving.
      if (event.ctrlKey || event.metaKey || event.altKey) return
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
        const next = here === undefined ? undefined : visibleRows[here + vertical]
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
    [byId, cellFrom, cellNode, i18n, order, paint, visibleRows, whyLocked],
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
  const dismiss = useCallback(() => setHover(null), [])


  return (
    <div
      ref={root}
      onPointerDownCapture={onPointerDownCapture}
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
        {/* No `blockSize` on either the header or the footer row: their heights
            are `--ts-head` and `--ts-foot`, declared once on the cells. A row
            cannot be shorter than its own declared height, so `var(--row)` here
            silently won at the roomy stop and made the header 38px — a band the
            loading skeleton cannot hold open from a token, since the token said
            34px. */}
        <thead>
          <tr>
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
          // Delegated like every other gesture in this sheet: one set of
          // handlers on the body reads `data-ts-grip` / `data-ts-drop` off the
          // target, instead of 275 grips and 16 bands each carrying five
          // closures.
          onDragStart={onDragStart}
          onDragOver={onDragOver}
          onDragLeave={onDragLeave}
          onDrop={onDrop}
          onDragEnd={onDragEnd}
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
              const target = line.drop === undefined ? undefined : targets.get(line.drop)
              return (
                <tr key={line.key} className="ts-group" style={{ blockSize: 'var(--row)' }}>
                  {/* The printed designation, so its language follows the
                      DELIVERABLE and not the interface (UI spec §10).

                      In roster edit mode the same band is the drop target. A
                      valid one is ringed thin and the one under the drag ringed
                      thick, so validity is carried by the count beside the name
                      and by a change of WEIGHT — never by colour alone. */}
                  <th
                    colSpan={SPAN}
                    lang={line.lang}
                    data-ts-caps
                    scope="colgroup"
                    data-ts-drop={line.drop}
                    className={cn(
                      line.drop !== undefined &&
                        'ring-1 ring-inset ring-primary/40 data-[ts-over=1]:ring-2 data-[ts-over=1]:ring-primary',
                    )}
                  >
                    <span className="flex items-center gap-2">
                      <span className="truncate">{line.label}</span>
                      {line.count !== undefined && (
                        // Interface copy inside a band whose NAME is the printed
                        // designation, so it declares its own language rather
                        // than inheriting the deliverable's (UI spec §10).
                        <span
                          lang={i18n.language}
                          className="shrink-0 font-normal normal-case tracking-normal text-muted-foreground [unicode-bidi:isolate]"
                        >
                          {t('timesheet.rows', { count: line.count })}
                        </span>
                      )}
                      {target && rosterEdit?.renameControl?.(target)}
                    </span>
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
                filterCode={activeFilterCode}
                filterCurrent={currentFilterEmployeeId === line.row.employee_id}
                editedDays={editedByRow?.get(line.row.employee_id)}
                blocked={blockedBy.get(line.row.employee_id)}
                grip={rosterEdit ? strings.grip(line.row.employee_id) : undefined}
                strings={strings}
                onSelect={onSelect}
              />
            )
          })}
        </tbody>
        <tfoot>
          <tr>
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
                  title={`${t('timesheet.colDay')} ${day}: ${count}`}
                >
                  {count}
                </td>
              )
            })}
          </tr>
        </tfoot>
      </table>

      <div ref={tag} dir="ltr" className="ts-dragtag [unicode-bidi:isolate]" aria-hidden hidden />

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

      {moving && rosterEdit && (
        <DesignationPicker
          employeeId={moving.employeeId}
          designations={rosterEdit.designations}
          anchor={moving.anchor}
          onPick={(designationId) => {
            assign(moving.employeeId, designationId)
            closeMoving(true)
          }}
          onClose={closeMoving}
        />
      )}

      {hover && hoverRow && (
        <RowTally
          row={hoverRow}
          codes={codesOf(hoverRow)}
          daysInMonth={daysInMonth}
          anchor={hover.anchor}
          onDismiss={dismiss}
        />
      )}
    </div>
  )
}
