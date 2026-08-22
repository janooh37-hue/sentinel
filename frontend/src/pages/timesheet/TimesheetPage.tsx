/**
 * Monthly time sheet — the A3 locked shell (UI spec §16).
 *
 * The page is an app shell, and the ONE thing that scrolls is the grid. Head,
 * toolbar, ribbon and notice line are fixed above it; the dock is fixed below
 * it. That shape exists for one reason: reaching the release actions must never
 * mean scrolling past 275 employees. Everything here follows from it —
 * `overflow-hidden` on the shell, `flex-1 min-h-0 overflow-auto` on the grid
 * wrapper, and `min-h-0` on every flex ancestor in between, because a flex child
 * will not shrink below its content without it.
 *
 * `min-block-size-0` is NOT a Tailwind utility (v4.3.0 emits nothing for it), so
 * the block-axis release is spelled `min-h-0` — the same class the other 30
 * one-screen layouts in this app use. In a horizontal writing mode the two are
 * the same property; only one of them exists.
 *
 * Route: `/employees/timesheet`. The time sheet is a subpage under Employees,
 * not an eighth top-nav entry: it is reached from the Employees section tabs,
 * which this page carries in a navy band above the shell, so the way in is also
 * the way back out.
 *
 * Capability split (backend `_OPERATOR_CAPS` / `_MANAGER_CAPS`): `timesheet.view`
 * reads the month, `timesheet.edit` corrects it and produces the workbooks —
 * which freezes it. A viewer therefore gets a complete, read-only page: the
 * ribbon becomes the legend it looks like, and no edit affordance is rendered at
 * all (a disabled control still answers Enter and Space — UI spec §14).
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { CalendarClock } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'

import { EmployeesSectionTabs } from '@/components/employees/EmployeesSectionTabs'
import { useAttendanceAttention } from '@/components/employees/useAttendanceAttention'
import { EmptyState } from '@/components/ui/empty-state'
import {
  apiErrorMessage,
  type TimesheetDesignationRead,
  type TimesheetGridResponse,
  type TimesheetRow,
  type TimesheetSheet,
  type TimesheetVariant,
} from '@/lib/api'
import { useCapabilities } from '@/lib/useCapabilities'
import { cn } from '@/lib/utils'

import { CodeRibbon } from './CodeRibbon'
import { TimesheetDock } from './TimesheetDock'
import { TimesheetGrid, TimesheetMasthead, type FillCell, type RosterEdit } from './TimesheetGrid'
import { TimesheetNotice } from './TimesheetNotice'
import { TimesheetGlance, type GlanceTab } from './TimesheetGlance'
import { DesignationRenameControl, TimesheetRosterEditor } from './TimesheetRosterEditor'
import { MonthStepper, TimesheetToolbar, type TimesheetDensity } from './TimesheetToolbar'
import { type Code, type CodeSlug, isCode, slugOf } from './codes'
import { TimesheetCodeFilterBar } from './TimesheetCodeFilterBar'
import { buildTimesheetCodeIndex } from './timesheetCodeIndex'
import { applyRosterDraft, type RosterDraft } from './rosterDraft'
import {
  currentMonth,
  isStaleRosterError,
  timesheetRosterErrorKey,
  useAcknowledgeStart,
  useCloseMonth,
  useEmployeeSheetDownload,
  usePatchPeriod,
  useReopenMonth,
  useSetCell,
  useSetTimesheetRoster,
  useTimesheetDesignations,
  useTimesheetDownload,
  useTimesheetGrid,
} from './useTimesheet'

export interface TimesheetUiState {
  variant: TimesheetVariant
  /** The armed code, painted by a click or a keystroke on a cell. */
  brush: Code | null
  /** `employee_id` of the row the extract and the picker are pointed at. */
  selected: string | null
  panel: 'posts' | 'codes' | 'employee' | 'release' | null
  /** The employee search, forgiving: `7141`, `g7141`, `rasel` all match. */
  query: string
  density: TimesheetDensity
}

/** One correction, kept so `Undo last change` does not need the cell found again. */
interface Correction {
  employeeId: string
  day: number
  previous: Code | null
}

/** Enough rows to fill the tallest sane viewport; the skeleton is never scrolled. */
const SKELETON_ROWS = Array.from({ length: 14 }, (_, i) => i)

/**
 * The dock takes the whole payload, and it is fixed furniture: it renders in
 * every state, including the one before the month has landed. So a pending
 * month reads as an empty one — zero rows, zero checks, no seal — rather than
 * the dock appearing under the grid as the response arrives, which is the
 * locked-rule-6 jump the skeleton exists to prevent, one band lower.
 */
const PENDING_MONTH: TimesheetGridResponse = {
  year: 0,
  month: 1,
  days_in_month: 31,
  sheet: 'main',
  post_count: 0,
  rows: [],
  blocking: [],
  warnings: [],
  removed: [],
  closed_at: null,
  closed_by: null,
}

/**
 * Stable empties, so "no draft", "no catalog" and "no sibling workbook" keep
 * one identity each: they all feed `useMemo` dependency lists that the grid's
 * row memo hangs off, and a fresh `new Map()` per render would rebuild the
 * printed sheet on every keystroke in the search field.
 */
const NO_DRAFT: RosterDraft = new Map()
const NO_DESIGNATIONS: readonly TimesheetDesignationRead[] = []
const NO_ROWS: readonly TimesheetRow[] = []

/**
 * Below this the side glance starts on its rail. The day columns are already
 * at the 26px floor of `--cell`'s clamp under ~1406px, so the sheet scrolls
 * sideways whatever this column does; `xl` is the project's own stop nearest
 * that point, and it is the one the rest of the shell already switches on.
 * Read ONCE, at mount: after that the operator's own answer stands.
 */
const NARROW = '(max-width: 1279px)'

/**
 * The short structural pulse a filter match or a row jump lands with. Keyframed
 * rather than a class, because it has to fire again for the SAME row — a class
 * toggle needs a reflow between two identical states, and a transition that
 * ends on `outline: none` cannot be restarted at all.
 */
const PULSE: Keyframe[] = [
  { outline: '2px solid var(--primary)' },
  { outline: '2px solid transparent' },
  { outline: '2px solid transparent' },
]

export function TimesheetPage(): React.JSX.Element {
  const { t, i18n } = useTranslation()
  const { has } = useCapabilities()
  const canEdit = has('timesheet.edit')

  const [params, setParams] = useState<{ year: number; month: number; sheet: TimesheetSheet }>(
    () => ({ ...currentMonth(), sheet: 'main' }),
  )
  const [ui, setUi] = useState<TimesheetUiState>({
    variant: 'attendance',
    brush: null,
    selected: null,
    panel: null,
    query: '',
    density: 'default',
  })
  const [corrections, setCorrections] = useState<Correction[]>([])
  /**
   * Roster edit mode and its staged assignments. The React Query result stays
   * the rollback baseline: Cancel is this state going back to empty, with no
   * request (design §"Draft and save").
   */
  const [roster, setRoster] = useState<{ editing: boolean; draft: RosterDraft }>({
    editing: false,
    draft: NO_DRAFT,
  })
  /** The last refused batch's own sentence, printed beside the draft it kept. */
  const [rosterError, setRosterError] = useState<string | null>(null)
  /**
   * The side glance's own two facts (design §"State and performance"). It
   * starts on the rail at narrow widths, and every change after that is the
   * operator's: nothing re-collapses the column behind them, and neither a
   * bottom panel nor a collapse can lose the active view, because the view is
   * held here rather than in the column.
   */
  const [glance, setGlance] = useState<{ tab: GlanceTab; collapsed: boolean }>(() => ({
    tab: 'codes',
    collapsed: window.matchMedia(NARROW).matches,
  }))
  /**
   * The row the sheet was last asked to show, and why.
   *
   * `tick` is what makes a REPEAT honourable: pressing `Show row` twice for the
   * same man changes neither the selection nor the filter, so without a counter
   * the second press is a no-op and the operator is left pressing a control
   * that answers nothing. `jumped` keeps the pulse where it belongs — a jump
   * arrives from somewhere else on the page and has to announce where it
   * landed; clicking rows would otherwise flash the sheet all day.
   */
  const [cue, setCue] = useState<{ id: string; tick: number; jumped: boolean } | null>(null)

  const grid = useTimesheetGrid(params)
  /**
   * The OTHER workbook, read only while a move is being staged.
   *
   * The design has the operator select the Drivers sheet to move a man to the
   * Drivers workbook — and he is not printed there, so there is nobody to drag.
   * Naming him therefore needs the sibling month, and nothing else on this page
   * does: outside roster edit mode the read is switched off and never issued.
   */
  const siblingParams = useMemo(() => {
    const sheet: TimesheetSheet = params.sheet === 'main' ? 'drivers' : 'main'
    return { ...params, sheet }
  }, [params])
  const sibling = useTimesheetGrid(siblingParams, roster.editing)
  const setCell = useSetCell(params)
  const period = usePatchPeriod(params)
  const closeMonth = useCloseMonth(params)
  const reopenMonth = useReopenMonth(params)
  const acknowledge = useAcknowledgeStart(params)
  const monthFile = useTimesheetDownload()
  const employeeFile = useEmployeeSheetDownload()
  const catalog = useTimesheetDesignations()
  // Quiet: the editor keeps the refused draft on screen and prints the reason
  // beside it, so the hook's own toast would be the same sentence twice.
  const rosterWrite = useSetTimesheetRoster({ quiet: true })
  // The switcher's badge: the same count the Attendance tab carries on every
  // other page in the section, so the number never depends on the way in.
  const attendance = useAttendanceAttention()

  // Cells are correctable only on the attendance grid of an open month, by
  // someone holding `timesheet.edit`. The statistics grid is derived: the fix
  // belongs upstream, in the attendance grid or the filler assignment. Roster
  // mode suspends it: the ribbon becomes the legend again and the corrections
  // chip goes with it, because neither applies to a staged move.
  const editable = canEdit && !grid.closed && ui.variant === 'attendance' && !roster.editing

  const rows = grid.rows
  const [filter, setFilter] = useState<{ code: CodeSlug; index: number } | null>(null)
  const scrollRef = useRef<HTMLDivElement | null>(null)
  const filterCode = filter?.code ?? null
  const filterBarRef = useRef<HTMLDivElement | null>(null)
  const focusedFilterCode = useRef<CodeSlug | null>(null)
  const scrollTarget = useRef<string | null>(null)
  /** The index always describes the server response, never the staged roster. */
  const codeIndex = useMemo(
    () => buildTimesheetCodeIndex(rows, ui.variant, grid.daysInMonth),
    [grid.daysInMonth, rows, ui.variant],
  )
  const filterMatches = useMemo(
    () => (filter ? codeIndex.employeeIds[filter.code] : []),
    [codeIndex, filter],
  )
  const filterIndex = useMemo(() => {
    if (!filter || filterMatches.length === 0) return 0
    return ((filter.index % filterMatches.length) + filterMatches.length) % filterMatches.length
  }, [filter, filterMatches.length])
  const currentFilterEmployeeId = filter ? (filterMatches[filterIndex] ?? null) : null
  const filteredEmployeeIds = useMemo(
    () => (filterMatches.length > 0 ? new Set(filterMatches) : null),
    [filterMatches],
  )

  /**
   * The valid targets: active designations of the workbook on screen, in
   * printed rank order (design §"Draft and save" — "Only designations
   * belonging to the displayed workbook sheet are drop targets").
   *
   * This one list is every target the mode offers — the drop bands, the grip
   * picker, and the cross-workbook picker in the band — which is what keeps the
   * design's own next sentence true: moving a man to the Drivers workbook is
   * done while the Drivers sheet is selected, because a Drivers designation is
   * a target only then.
   */
  const designations = useMemo(() => {
    const all = catalog.data ?? NO_DESIGNATIONS
    return all
      .filter((each) => each.active && each.sheet === params.sheet)
      .sort((a, b) => a.rank_order - b.rank_order || a.id - b.id)
  }, [catalog.data, params.sheet])

  /**
   * Roster editing needs all three: the permission, an open month, and a
   * catalog that actually arrived. A failed catalog load therefore costs the
   * roster editor and nothing else — the cells of an open month stay
   * correctable (design §"Failure and empty states").
   */
  const canRoster = canEdit && !grid.closed && designations.length > 0

  const rowsById = useMemo(() => {
    const index = new Map<string, (typeof rows)[number]>()
    for (const row of rows) index.set(row.employee_id, row)
    return index
  }, [rows])

  /**
   * Who the sheet is printing — the SERVER's answer for the sheet on screen,
   * never the staged one. It is what makes a jump from a finding honourable:
   * `warnings` is recomputed live even on a sealed month, so an issue can name
   * somebody with no row in the same payload.
   */
  const rosterEmployeeIds = useMemo(() => new Set(rowsById.keys()), [rowsById])

  /** The other workbook, and only while there is a reason to have read it. */
  const siblingRows = roster.editing ? sibling.rows : NO_ROWS

  /**
   * What the server already holds, across BOTH workbooks.
   *
   * `onAssignRoster` compares an assignment against this to decide whether it
   * changed anything, and a man staged in from the other workbook has a real
   * designation over there — reading it as "none" would make a re-pick of the
   * band he is already staged under look like a fresh change. Rows from the
   * sheet on screen win: while a saved batch settles both queries can name the
   * same man, and the one the operator is reading is the one that counts.
   */
  const baselineById = useMemo(() => {
    if (siblingRows.length === 0) return rowsById
    const index = new Map<string, TimesheetRow>(
      siblingRows.map((row) => [row.employee_id, row]),
    )
    for (const [id, row] of rowsById) index.set(id, row)
    return index
  }, [rowsById, siblingRows])

  /**
   * Who the other workbook still has to offer: everybody on it who is not
   * already printed here and not already staged to come across. Staging one
   * takes him out of this list and puts him on the sheet, where the grip and
   * the drop bands take over — so he is never named in two places at once.
   */
  const crossCandidates = useMemo(
    () =>
      siblingRows.filter(
        (row) => !rowsById.has(row.employee_id) && !roster.draft.has(row.employee_id),
      ),
    [roster.draft, rowsById, siblingRows],
  )

  /**
   * The staged arrivals: rows the other workbook owns that the draft has moved
   * onto this one. Only the STAGED ones — every other man over there belongs to
   * the sheet the operator is not looking at, and `applyRosterDraft` passes a
   * row it has no draft entry for straight through onto the wrong workbook.
   */
  const crossRows = useMemo(
    () =>
      roster.draft.size === 0
        ? NO_ROWS
        : siblingRows.filter(
            (row) => roster.draft.has(row.employee_id) && !rowsById.has(row.employee_id),
          ),
    [roster.draft, rowsById, siblingRows],
  )

  /**
   * What the sheet prints: the server's rows until something is staged, and
   * the staged order after that — with the staged arrivals from the other
   * workbook among them. Identity is preserved while the draft is empty,
   * because this array is the grid's `rows` prop and 275 memoised rows hang
   * off it.
   *
   * The statistics variant is deliberately excluded. It groups by the two
   * blocks rather than by designation, so a staged order there files a man
   * under a block heading he is not in and SPLITS the block he is — the group
   * runs are emitted on a change of the consecutive key, so one drafted row in
   * the middle prints the same block twice. The draft is not discarded, only
   * unprinted: switching back to attendance shows it again.
   */
  const printedRows = useMemo(
    () =>
      roster.draft.size === 0 || ui.variant === 'statistics'
        ? rows
        : applyRosterDraft(
            crossRows.length === 0 ? rows : [...rows, ...crossRows],
            catalog.data ?? NO_DESIGNATIONS,
            params.sheet,
            roster.draft,
          ),
    [catalog.data, crossRows, params.sheet, roster.draft, rows, ui.variant],
  )

  /**
   * Leaving the month drops the staged draft with the corrections log: a draft
   * names employees for ONE month, and carrying it across would let Save write
   * assignments the operator staged while looking at a different sheet.
   */
  const leaveMonth = useCallback(() => {
    setCorrections([])
    setRoster({ editing: false, draft: NO_DRAFT })
    setFilter(null)
    setRosterError(null)
  }, [])

  const stepMonth = useCallback(
    (delta: -1 | 1) => {
      setParams((prev) => {
        const raw = prev.month + delta
        if (raw < 1) return { ...prev, year: prev.year - 1, month: 12 }
        if (raw > 12) return { ...prev, year: prev.year + 1, month: 1 }
        return { ...prev, month: raw }
      })
      leaveMonth()
    },
    [leaveMonth],
  )

  const undo = useCallback(() => {
    const last = corrections[corrections.length - 1]
    if (!last) return
    setCorrections((stack) => stack.slice(0, -1))
    setCell.mutate({ employeeId: last.employeeId, day: last.day, code: last.previous })
  }, [corrections, setCell])

  /** The code a cell holds right now — the value a later Undo has to restore. */
  const codeAt = useCallback(
    (employeeId: string, day: number): Code | null => {
      const row = rowsById.get(employeeId)
      const held = row?.codes[day - 1] ?? null
      return held !== null && isCode(held) ? held : null
    },
    [rowsById],
  )

  /**
   * One cell, from a click on the picker or a code letter on the keyboard.
   *
   * The input object is built HERE and handed straight to `mutateAsync`. It is
   * never reused, copied or spread between calls: `useSetCell`'s `onSettled`
   * recognises the write that is settling by reference identity on
   * `state.variables`, and two writes sharing one object would each be mistaken
   * for the other's sibling — which drops the baseline early and costs a
   * refused cell its last server-confirmed value (Task 7, locked rule 7).
   */
  const onSetCell = useCallback(
    (employeeId: string, day: number, code: Code | null, note?: string) => {
      const entry: Correction = { employeeId, day, previous: codeAt(employeeId, day) }
      setCorrections((stack) => [...stack, entry])
      void setCell
        .mutateAsync({ employeeId, day, code, note })
        .catch(() => setCorrections((stack) => stack.filter((candidate) => candidate !== entry)))
    },
    [codeAt, setCell],
  )

  /**
   * A swept rectangle or a shift-clicked run, committed once as one write per
   * cell — because `set_cell` is one cell, and it REFUSES per cell: a day
   * outside the roster window comes back 422 `TIMESHEET_OFF_ROSTER` while its
   * neighbours are taken. So a fill degrades instead of failing: the accepted
   * cells stay, each refused cell rolls back to its last server-confirmed
   * value, and the operator is told ONCE.
   *
   * A refused cell also leaves no correction behind: the record has to match
   * what the server actually took, or the chip counts writes that never landed
   * and Undo starts by trying to reverse them.
   *
   * `quiet` is what makes it once. Every write still reverts itself, but the
   * per-write toast is suppressed and the refusals are counted here, so a
   * twelve-day sweep across a roster edge is one line and not nine.
   *
   * Each cell gets its own freshly built input for the identity reason spelled
   * out on `onSetCell` above.
   */
  const onFill = useCallback(
    (cells: FillCell[], code: Code) => {
      if (cells.length === 0) return
      // Built once, pushed optimistically so the edited ring appears while the
      // writes are in flight, and pruned below by OBJECT IDENTITY. Identity
      // rather than employee+day because a click can land mid-flight and append
      // its own correction after these; matching on the value would take the
      // wrong entry off the stack.
      const entries: Correction[] = cells.map((cell) => ({
        employeeId: cell.employeeId,
        day: cell.day,
        previous: codeAt(cell.employeeId, cell.day),
      }))
      setCorrections((stack) => [...stack, ...entries])
      void (async () => {
        const settled = await Promise.allSettled(
          cells.map((cell) =>
            setCell.mutateAsync({
              employeeId: cell.employeeId,
              day: cell.day,
              code,
              quiet: true,
            }),
          ),
        )
        const refused = settled.filter(
          (result): result is PromiseRejectedResult => result.status === 'rejected',
        )
        // A refused cell was never corrected, so it must not stay on the stack.
        // Left there, the chip over-counts — `4 corrections` for a sweep where
        // two landed — and `Undo last change` pops the refused ones FIRST,
        // re-issuing `set_cell` for a day the roster edge owns. That write is
        // refused again and NOT quiet, so the operator collects an error toast
        // for undoing something that never happened, once per refusal, before
        // the corrections that did land are even reachable.
        const dropped = new Set(entries.filter((_, i) => settled[i].status === 'rejected'))
        if (dropped.size > 0) {
          setCorrections((stack) => stack.filter((entry) => !dropped.has(entry)))
        }
        if (refused.length === 0) {
          // UI spec §8 wants a run to announce itself as `G7057 · day 6–17 —
          // AL`, which only says something true for ONE employee's contiguous
          // run. A multi-row rectangle, or a run the roster edge punched holes
          // in, is reported as a count instead — `rangePainted` would name a
          // span it did not paint.
          const first = cells[0]
          const last = cells[cells.length - 1]
          const oneRun =
            cells.length > 1 &&
            cells.every((cell) => cell.employeeId === first.employeeId) &&
            last.day - first.day + 1 === cells.length
          toast.success(
            oneRun
              ? t('timesheet.rangePainted', {
                  id: first.employeeId,
                  from: first.day,
                  to: last.day,
                  code: slugOf(code),
                })
              : t('timesheet.filled', { count: cells.length, code: slugOf(code) }),
          )
          return
        }
        // The server's own sentence, once. Every refusal in one gesture has the
        // same cause — the roster window — so the first one speaks for all.
        toast.error(
          t('timesheet.fillRefused', {
            count: refused.length,
            reason: apiErrorMessage(refused[0].reason),
          }),
        )
      })()
    },
    [codeAt, setCell, t],
  )

  /**
   * `useCallback`, not an inline arrow at the call site, because `GridRow` is
   * `memo`ised and every other prop it takes is already stable: `codes` is the
   * query's own array, `strings` is a `useMemo` on `t`, `editedDays` is
   * `undefined` for an untouched row. So one fresh function identity per render
   * is enough to re-render all 275 rows — 8,525 `cellLabel` interpolations and
   * ~17k element diffs — and the always-visible employee search calls `setUi`
   * on every keystroke, so typing a G-number repainted the whole sheet once per
   * character. That is the exact hazard the delegated handlers and the row memo
   * exist to avoid (`TimesheetGrid.tsx`'s header note), undone one level up.
   *
   * The setter form takes no dependency, so this identity never changes.
   */
  const onSelectRow = useCallback((selected: string | null) => {
    setUi((prev) => ({ ...prev, selected }))
    setCue((prev) =>
      selected === null ? null : { id: selected, tick: (prev?.tick ?? 0) + 1, jumped: false },
    )
  }, [])

  const onOpenPanel = useCallback((panel: TimesheetUiState['panel']) => {
    setUi((prev) => ({ ...prev, panel }))
  }, [])

  const onQuery = useCallback((query: string) => {
    setUi((prev) => ({ ...prev, query }))
  }, [])
  const onFilterCode = useCallback(
    (code: CodeSlug) => {
      if (roster.editing) return
      setCue(null)
      setFilter({ code, index: 0 })
      setUi((prev) => ({ ...prev, panel: null }))
      // Wherever the code was pressed, the side comes back on its codes view:
      // the bar above the sheet says what is filtered, and that list is where
      // the next code is chosen (design §"Filtering", steps 1-2).
      setGlance({ tab: 'codes', collapsed: false })
    },
    [roster.editing],
  )

  const onPreviousFilterEmployee = useCallback(() => {
    setFilter((prev) =>
      prev && filterMatches.length > 0
        ? { ...prev, index: prev.index - 1 }
        : prev,
    )
  }, [filterMatches.length])

  const onNextFilterEmployee = useCallback(() => {
    setFilter((prev) =>
      prev && filterMatches.length > 0
        ? { ...prev, index: prev.index + 1 }
        : prev,
    )
  }, [filterMatches.length])

  const onClearFilter = useCallback(() => setFilter(null), [])

  /**
   * A finding's row, from the side glance. It clears the filter first: the man
   * a check names is not necessarily in the filtered set, and a jump that
   * lands on a hidden row is a jump to nothing.
   */
  const onShowRow = useCallback((employeeId: string) => {
    setFilter(null)
    setUi((prev) => ({ ...prev, selected: employeeId }))
    setCue((prev) => ({ id: employeeId, tick: (prev?.tick ?? 0) + 1, jumped: true }))
  }, [])

  const onGlanceTab = useCallback((tab: GlanceTab) => {
    setGlance((prev) => ({ ...prev, tab }))
  }, [])

  const onGlanceCollapse = useCallback((collapsed: boolean) => {
    setGlance((prev) => ({ ...prev, collapsed }))
  }, [])

  /**
   * The notice line asks for the checks; this is where they are. Any bottom
   * panel closes, because an open one covers the column the checks are printed
   * in — and the column expands whatever state it was left in, because a chip
   * that opens nothing visible is a chip that lied.
   */
  const onOpenChecks = useCallback(() => {
    setUi((prev) => ({ ...prev, panel: null }))
    setGlance({ tab: 'checks', collapsed: false })
  }, [])


  /**
   * The red block, as ONE gesture rather than N writes announced N times.
   *
   * `onFill` is already the partial-refusal path: it paints optimistically,
   * awaits every cell, rolls each refusal back to its last server-confirmed
   * value, prunes the corrections that never landed, and tells the operator
   * once. The helper's job is only to arrive with days the server will accept —
   * `EmployeePanel` has already dropped the roster edges, which is what stops
   * `set_cell` refusing `TIMESHEET_OFF_ROSTER` cell by cell.
   */
  const onFillRedBlock = useCallback(
    (employeeId: string, days: number[]) => {
      if (days.length === 0) return
      onFill(
        days.map((day) => ({ employeeId, day })),
        'X',
      )
    },
    [onFill],
  )

  const onSetPostCount = useCallback(
    (postCount: number) => period.mutate({ post_count: postCount }),
    [period],
  )

  /**
   * Accepting a starting point is not a correction: it writes no override row,
   * so the backend allows it on a CLOSED month too.
   */
  const onAcknowledge = useCallback(
    (employeeId: string) => acknowledge.mutate(employeeId),
    [acknowledge],
  )

  /**
   * `download()` never rejects — `onError` has already shown the server's own
   * message — so `void download(args)` is the whole call and a `.catch` would
   * only be noise.
   */
  const onDownload = useCallback(
    (variant: TimesheetVariant) => void monthFile.download({ ...params, variant }),
    [monthFile, params],
  )

  const onEmployeeDownload = useCallback(
    (args: { employeeId: string; year: number; month: number; months: 1 | 2 }) =>
      void employeeFile.download(args),
    [employeeFile],
  )

  const onCloseMonth = useCallback(() => closeMonth.mutate(), [closeMonth])
  const onReopenMonth = useCallback(() => reopenMonth.mutate(), [reopenMonth])

  /**
   * Entering roster edit mode (design §"Entering edit mode"): back to the
   * attendance grid, because the statistics variant groups by block and has no
   * designation bands to drop onto; and the brush disarmed, because a code
   * armed for cells that are now refused is a control that answers nothing.
   */
  const onEditRoster = useCallback(() => {
    setUi((prev) => ({ ...prev, variant: 'attendance', brush: null, panel: null }))
    setFilter(null)
    setRoster({ editing: true, draft: NO_DRAFT })
    setRosterError(null)
  }, [])

  /**
   * Stage one move — or unstage it. The draft holds only what CHANGED: a man
   * dropped back on the designation the server already has him on leaves the
   * draft, so Save never names him and the atomic batch stays the size of the
   * actual edit. "Already has him on" is read from both workbooks, because this
   * is also the callback the cross-workbook picker stages through.
   */
  const onAssignRoster = useCallback(
    (employeeId: string, designationId: number) => {
      const original = baselineById.get(employeeId)?.designation_id ?? null
      setRoster((prev) => {
        const draft = new Map(prev.draft)
        if (designationId === original) draft.delete(employeeId)
        else draft.set(employeeId, designationId)
        return { ...prev, draft }
      })
    },
    [baselineById],
  )

  /**
   * Drop ONE staged entry, leaving the rest of the draft alone.
   *
   * Every other staged move can be undone by moving the row back, because the
   * row is on the sheet with a grip on it. An arrival from the other workbook
   * cannot: the designations that would send him home belong to the workbook
   * that is not on screen, and putting them among this sheet's drop targets is
   * exactly the parity the design forbids. So the take-back is a control of its
   * own, and it is the draft entry it removes — never the whole draft, which is
   * what Cancel is for.
   */
  const onUnstageRoster = useCallback((employeeId: string) => {
    setRoster((prev) => {
      if (!prev.draft.has(employeeId)) return prev
      const draft = new Map(prev.draft)
      draft.delete(employeeId)
      return { ...prev, draft }
    })
  }, [])

  /** One batch, for the month on screen. Success closes; failure keeps both. */
  const onSaveRoster = useCallback(() => {
    if (roster.draft.size === 0 || rosterWrite.isPending) return
    setRosterError(null)
    rosterWrite.mutate(
      {
        year: params.year,
        month: params.month,
        assignments: [...roster.draft].map(([employee_id, designation_id]) => ({
          employee_id,
          designation_id,
        })),
      },
      {
        onSuccess: () => setRoster({ editing: false, draft: NO_DRAFT }),
        onError: (err) => {
          // A refusal this surface has words for is read in the interface's
          // own language; anything else keeps the server's sentence, which at
          // least says what happened.
          const key = timesheetRosterErrorKey(err)
          setRosterError(key === null ? apiErrorMessage(err) : t(key))
          // A stale catalog or a vanished employee means the bands and the rows
          // themselves were wrong, not just the write — and the sentence for
          // each of them promises a reload — so both queries are refetched. The
          // draft and the mode stay, because the operator's intent is still
          // valid (design §"Failure and empty states").
          if (isStaleRosterError(err)) {
            void catalog.refetch()
            void grid.refetch()
          }
        },
      },
    )
  }, [catalog, grid, params.month, params.year, roster.draft, rosterWrite, t])

  /** The rollback: the query result was never touched, so this is all it takes. */
  const onCancelRoster = useCallback(() => {
    setRoster({ editing: false, draft: NO_DRAFT })
    setRosterError(null)
  }, [])

  /**
   * The mode cannot outlive its own preconditions. A refetch can seal the month
   * under an open draft — somebody else pressed Close, or the first download
   * did — and staging further moves against a sealed month only collects
   * refusals. The same holds if the catalog empties. So the mode ends and the
   * draft goes with it, which is what leaves the sheet printing the order the
   * seal froze.
   */
  useEffect(() => {
    if (!roster.editing || canRoster) return
    // Server refetches can revoke editability after entry; synchronize local mode.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    onCancelRoster()
  }, [canRoster, onCancelRoster, roster.editing])
  useEffect(() => {
    // Match membership comes from the server query and can disappear on refetch.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (filter !== null && filterMatches.length === 0) onClearFilter()
  }, [filter, filterMatches.length, onClearFilter])

  useEffect(() => {
    if (filterCode === null) {
      focusedFilterCode.current = null
      return
    }
    if (focusedFilterCode.current === filterCode) return
    focusedFilterCode.current = filterCode
    filterBarRef.current?.focus()
  }, [filterCode])

  /**
   * ONE scroll owner on the page, and one cue at a time. The grid deliberately
   * has no selection effect of its own: two owners fight over the same
   * `scrollIntoView` and the loser's `behavior` wins at random.
   *
   * Priority is freshness. A live filter is always the newest intent, because a
   * jump CLEARS the filter before it selects. Below it the cue, but only while
   * it still describes the selection — so a row picked somewhere else is never
   * overruled by a jump the operator has already moved on from.
   */
  const scrollIntent = useMemo(() => {
    if (currentFilterEmployeeId) {
      return {
        id: currentFilterEmployeeId,
        key: `filter:${currentFilterEmployeeId}`,
        mark: true,
      }
    }
    if (cue && cue.id === ui.selected) {
      return { id: cue.id, key: `cue:${cue.tick}`, mark: cue.jumped }
    }
    if (ui.selected) return { id: ui.selected, key: `selection:${ui.selected}`, mark: false }
    return null
  }, [cue, currentFilterEmployeeId, ui.selected])

  useEffect(() => {
    if (!scrollIntent) {
      scrollTarget.current = null
      return
    }
    if (scrollTarget.current === scrollIntent.key) return
    const row = scrollRef.current?.querySelector<HTMLElement>(
      `tr[data-employee="${CSS.escape(scrollIntent.id)}"]`,
    )
    if (!row) return
    scrollTarget.current = scrollIntent.key
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    if (scrollIntent.mark) {
      row.scrollIntoView({ block: 'center', inline: 'nearest' })
      // The lasting mark is `data-selected` on the row itself; the pulse only
      // draws the eye to it, so reduced motion drops the pulse and loses
      // nothing permanent. jsdom implements no Web Animations API, which the
      // same guard covers.
      if (!reduced && typeof row.animate === 'function') row.animate(PULSE, { duration: 220 })
    } else {
      row.scrollIntoView({
        block: 'center',
        inline: 'nearest',
        behavior: reduced ? 'auto' : 'smooth',
      })
    }
  }, [scrollIntent])


  /**
   * The band's rename affordance, built here because the dialog reaches
   * react-query and handed to the grid as a node, so the sheet itself stays a
   * props component with no provider of its own.
   */
  const renameControl = useCallback(
    (designation: TimesheetDesignationRead) => (
      <DesignationRenameControl designation={designation} sheet={params.sheet} />
    ),
    [params.sheet],
  )

  const rosterEdit = useMemo<RosterEdit | undefined>(
    () =>
      roster.editing
        ? { designations, onAssign: onAssignRoster, renameControl }
        : undefined,
    [designations, onAssignRoster, renameControl, roster.editing],
  )

  /** Every cell corrected in this session, for the grid's structural mark. */
  const edited = useMemo(
    () => new Set(corrections.map((c) => `${c.employeeId}|${c.day}`)),
    [corrections],
  )

  const monthStamp = `${String(params.month).padStart(2, '0')} · ${params.year}`
  const arabicMonth = new Intl.DateTimeFormat('ar', { month: 'long' }).format(
    new Date(params.year, params.month - 1, 1),
  )
  const hint = grid.closed
    ? t('timesheet.closedOn', {
        date: grid.closedAt
          ? new Date(grid.closedAt).toLocaleDateString(i18n.language, {
              day: '2-digit',
              month: 'short',
              year: 'numeric',
            })
          : '',
        who: grid.closedBy ?? '',
      })
    : ui.variant === 'statistics'
      ? t('timesheet.derivedHint')
      : canEdit
        ? t('timesheet.brushHint')
        : t('timesheet.readOnlyHint')

  /**
   * A bottom panel opens upward over the grid and would cover the margin
   * column, so the column's track goes to nothing and its contents unmount
   * (design §"Side glance"). The three tracks are written out rather than
   * interpolated because Tailwind reads them out of this source.
   */
  const dockOpen = ui.panel !== null
  const sideTrack = dockOpen
    ? 'grid-cols-[minmax(0,1fr)_0px]'
    : glance.collapsed
      ? 'grid-cols-[minmax(0,1fr)_36px]'
      : 'grid-cols-[minmax(0,1fr)_400px]'

  return (
    <div
      data-testid="timesheet-shell"
      data-ts-density={ui.density}
      className="flex min-h-0 flex-1 flex-col overflow-hidden bg-background"
    >
      {/* The Employees switcher, at the foot of the same navy band the other
          three section pages carry. `shrink-0` because its sibling is a full
          roster, and without it the band collapses to a few pixels. Compact by
          design: this shell gets one screen, and the head below already names
          the month, so the band holds nothing but the tabs.
          `data-print-hide` because the paper is the sheet, not the screen — a
          named `@page` turns any box left in flow beside it into a blank
          sheet. */}
      <section
        data-print-hide
        className="shrink-0 pt-3.5 text-white"
        style={{ background: 'var(--hero-grad)' }}
      >
        <EmployeesSectionTabs attentionCount={attendance.attention} />
      </section>

      <div className="flex shrink-0 flex-col gap-2 px-4 pb-2 pt-3 md:px-6">
        <header className="flex flex-wrap items-baseline gap-x-4 gap-y-2">
          <div className="min-w-0">
            <div
              data-ts-caps
              className="text-[0.62rem] font-semibold uppercase tracking-[0.16em] text-faint"
            >
              {t('timesheet.eyebrow')}
            </div>
            <h1 className="text-[1.35em] font-bold tracking-tight text-foreground">
              {t('timesheet.title')}
            </h1>
          </div>
          <p className="min-w-0 max-w-[38ch] text-[0.78em] text-muted-foreground">
            {t('timesheet.lede')}
          </p>

          <div className="ms-auto flex flex-wrap items-center gap-3">
            <div>
              <label className="sr-only" htmlFor="timesheet-search">
                {t('timesheet.searchLabel')}
              </label>
              <input
                id="timesheet-search"
                type="search"
                value={ui.query}
                placeholder={t('timesheet.searchPlaceholder')}
                onChange={(e) =>
                  setUi((prev) => ({ ...prev, query: e.target.value, panel: 'employee' }))
                }
                className="w-[13rem] rounded-full border border-border-strong bg-surface px-3 py-1.5 text-[0.78em] text-foreground placeholder:text-faint focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              />
            </div>
            {/* The month as a mono datum, not a heading: it is compared against a
                filename. `07 · 2026` is one LTR run, so the leaf is isolated or
                bidi splits it around the separator (UI spec §14). */}
            <div className="text-end">
              <div
                dir="ltr"
                className="font-mono text-[1.15em] font-semibold tracking-tight tabular-nums [unicode-bidi:isolate]"
              >
                {monthStamp}
              </div>
              <div className="text-[0.7em] text-muted-foreground">{arabicMonth}</div>
            </div>
            <span
              className={cn(
                'inline-flex shrink-0 items-center gap-1.5 rounded-full px-2.5 py-1 text-[0.72em] font-semibold',
                grid.closed
                  ? 'bg-primary-soft text-primary'
                  : grid.blocking.length > 0
                    ? 'bg-accent-soft text-accent'
                    : 'bg-success-soft text-success',
              )}
            >
              {grid.closed
                ? t('timesheet.closed')
                : grid.blocking.length > 0
                  ? t('timesheet.toFix', { count: grid.blocking.length })
                  : t('timesheet.ready')}
            </span>
          </div>
        </header>

        <TimesheetToolbar
          year={params.year}
          month={params.month}
          sheet={params.sheet}
          variant={ui.variant}
          density={ui.density}
          rowCount={grid.rows.length}
          daysInMonth={grid.daysInMonth}
          onStepMonth={stepMonth}
          onSheetChange={(sheet) => {
            setParams((prev) => ({ ...prev, sheet }))
            // The other workbook has other designations, so a draft staged
            // against this one cannot follow the operator across.
            leaveMonth()
          }}
          onVariantChange={(variant) => {
            setFilter(null)
            setUi((prev) => ({ ...prev, variant, brush: null }))
          }}
          onDensityChange={(density) => setUi((prev) => ({ ...prev, density }))}
        />

        <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
          <CodeRibbon
            brush={ui.brush}
            onArm={(brush) => setUi((prev) => ({ ...prev, brush }))}
            readOnly={!editable}
          />
          <span className="text-[0.75em] text-muted-foreground">{hint}</span>
          {/* The way into roster edit mode, beside the other edit furniture and
              ABSENT — never disabled — for a viewer, a sealed month, or a
              catalog that did not arrive (amendment A3, UI spec §14). Outside
              the `editable` group below because entering is what switches the
              variant back, so it has to be reachable from the statistics grid
              too. */}
          <span className="ms-auto flex items-center gap-3">
            {canRoster && !roster.editing && (
              <button
                type="button"
                onClick={onEditRoster}
                className="inline-flex shrink-0 items-center rounded-full border border-border bg-surface px-2.5 py-1 text-[0.72em] font-semibold text-muted-foreground transition-colors hover:border-primary hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                {t('timesheet.rosterEdit.enter')}
              </button>
            )}
            {/* Edit-only furniture. A `timesheet.view` operator can never push
                onto this stack, so the chip would sit permanently at "No
                corrections yet" with a permanently dead undo — immediately
                beside the hint that has just explained they cannot edit. */}
            {editable && (
              <>
                <span className="inline-flex items-center gap-1.5 rounded-full bg-surface-tinted px-2.5 py-1 text-[0.72em] font-semibold text-muted-foreground">
                  {t('timesheet.corrections', { count: corrections.length })}
                </span>
                <button
                  type="button"
                  onClick={undo}
                  disabled={corrections.length === 0}
                  className="text-[0.78em] font-medium text-primary hover:underline disabled:cursor-not-allowed disabled:no-underline disabled:opacity-40"
                >
                  ↩ {t('timesheet.undo')}
                </button>
              </>
            )}
          </span>
        </div>

        <TimesheetNotice
          blocking={grid.blocking.length}
          warnings={grid.warnings.length}
          joined={grid.joined.length}
          leaving={grid.leaving.length}
          removed={grid.removed.length}
          onOpenChecks={onOpenChecks}
        />
      </div>

      {/* The sheet body: the workbook card, and the margin column beside it.
          The tracks are the design's own numbers — 400px open, the 36px rail,
          and nothing at all while a bottom panel covers the grid — and
          `minmax(0, 1fr)` on the first is what stops the sheet's fixed
          `inline-size` from blowing that track out. The row track is explicit
          for the same reason the flex ancestors carry `min-h-0`: one implicit
          `auto` row would size to the whole table and take the page's only
          scroller with it. */}
      <div
        data-testid="timesheet-body"
        className={cn('grid min-h-0 flex-1 grid-rows-[minmax(0,1fr)] px-4 md:px-6', sideTrack)}
      >
        <section className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-t-2xl border border-b-0 border-hairline bg-surface">
          {/* The quoted workbook header, INSIDE the card and above the scroll
              region (UI spec §16.1's shell diagram, and `.docmast` inside
              `.card` in the A3 mockup). Fixed furniture: it names the document
              the card is showing, so it must not scroll away with the roster.
              Rendered in every state — a band that appears only once the month
              lands is a band that shifts the sheet down as it arrives. */}
          <TimesheetMasthead year={params.year} month={params.month} />

          {/* The mode band: inside the card, above the scroll region, and
              `shrink-0` — fixed furniture like the masthead, so entering the
              mode costs no scroll geometry and `timesheet-scroll` stays the one
              scroller on the page. */}
          {roster.editing && (
            <TimesheetRosterEditor
              sheet={params.sheet}
              staged={roster.draft.size}
              pending={rosterWrite.isPending}
              error={rosterError}
              designations={designations}
              crossOffered={crossCandidates}
              crossStaged={crossRows}
              crossLoading={sibling.isPending}
              crossFailed={sibling.isError}
              onCrossRetry={sibling.refetch}
              onStage={onAssignRoster}
              onUnstage={onUnstageRoster}
              onSave={onSaveRoster}
              onCancel={onCancelRoster}
            />
          )}
          {filter && currentFilterEmployeeId && filterMatches.length > 0 && (
            <TimesheetCodeFilterBar
              ref={filterBarRef}
              code={filter.code}
              cellCount={codeIndex.cellCounts[filter.code]}
              employeeCount={filterMatches.length}
              position={filterIndex + 1}
              employeeId={currentFilterEmployeeId}
              employeeName={rowsById.get(currentFilterEmployeeId)?.name_en ?? currentFilterEmployeeId}
              onPrevious={onPreviousFilterEmployee}
              onNext={onNextFilterEmployee}
              onClear={onClearFilter}
            />
          )}


          {/* THE ONLY SCROLL REGION ON THE PAGE. The grid owns its own
              `<table>` in here rather than the shared `Table` primitive, which
              wraps itself in `w-full overflow-x-auto` and would be a second
              scroller. */}
          <div ref={scrollRef} data-testid="timesheet-scroll" className="min-h-0 flex-1 overflow-auto">
            {grid.isPending ? (
              <>
                <span role="status" className="sr-only">
                  {t('timesheet.loading')}
                </span>
                {/* The day-header band, held open at the grid's own
                    `--ts-head`. Without it the whole roster drops by the
                    header's height the moment the month lands — 34px, which is
                    locked rule 6 again and a bigger jump than any per-row
                    drift. It is a SIBLING of the skeleton, never a child: the
                    skeleton is one element per row and the test below pins that
                    shape. Nothing pulses here, because the band is not content
                    that arrives: all 31 columns exist in every month, so the
                    header is known before the response is. */}
                <div
                  data-testid="timesheet-skeleton-head"
                  aria-hidden
                  style={{ blockSize: 'var(--ts-head)' }}
                  className="border-b border-hairline bg-surface-raised"
                />
                {/* Skeleton on the grid's EXACT pitch: one row per `var(--row)`
                    with no container padding and no gaps, and the day strip
                    flush against the `--id-block` identity bar. Any leading
                    padding or row gap makes the month visibly jump into place
                    when it lands, which is the whole point of locked rule 6. */}
                <div
                  data-testid="timesheet-skeleton"
                  aria-hidden
                  style={{ '--ts-days': grid.daysInMonth } as React.CSSProperties}
                  className="flex flex-col"
                >
                  {SKELETON_ROWS.map((n) => (
                    <div
                      key={n}
                      className="flex items-center"
                      style={{ blockSize: 'var(--row)' }}
                    >
                      <div className="h-3 w-[var(--id-block)] shrink-0 animate-pulse rounded bg-surface-tinted" />
                      <div className="ts-skeleton-cells shrink-0 animate-pulse rounded" />
                    </div>
                  ))}
                </div>
              </>
            ) : grid.isError ? (
              <div className="flex flex-col items-center gap-3 py-16">
                <p className="text-[0.82em] text-muted-foreground">{t('common.loadError')}</p>
                <button
                  type="button"
                  onClick={() => void grid.refetch()}
                  className="rounded-full border border-border-strong px-3 py-1 text-[0.75em] font-semibold text-muted-foreground transition-colors hover:border-primary hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  {t('common.retry')}
                </button>
              </div>
            ) : printedRows.length === 0 ? (
              // Not a shrug: the reason, and the way out of the month. Keyed to
              // what the sheet PRINTS, not to what the server sent: a Drivers
              // workbook nobody is on yet is empty until the first arrival is
              // staged onto it, and that arrival has to be visible before Save.
              <div
                data-testid="timesheet-empty"
                className="flex flex-col items-center gap-2 pb-10"
              >
                <EmptyState
                  icon={CalendarClock}
                  message={t('timesheet.emptyTitle')}
                  description={t('timesheet.emptyReason')}
                />
                <MonthStepper year={params.year} month={params.month} onStep={stepMonth} />
              </div>
            ) : (
              <TimesheetGrid
                rows={printedRows}
                year={params.year}
                month={params.month}
                daysInMonth={grid.daysInMonth}
                variant={ui.variant}
                closed={grid.closed}
                canEdit={canEdit}
                brush={ui.brush}
                selected={ui.selected}
                activeFilterCode={filter?.code ?? null}
                filteredEmployeeIds={filteredEmployeeIds}
                currentFilterEmployeeId={currentFilterEmployeeId}
                edited={edited}
                blocking={grid.blocking}
                postCount={grid.postCount}
                roster={rosterEdit}
                onSetCell={onSetCell}
                onFill={onFill}
                onSelect={onSelectRow}
                onUndo={undo}
              />
            )}
          </div>
        </section>

        {/* The margin column, SECOND in the DOM and second in the grid, which
            is what lands it at the inline end in both directions. Outside the
            card on purpose: it annotates the workbook rather than belonging to
            it, and it owns its own overflow so the sheet keeps the one
            scroller. */}
        <TimesheetGlance
          index={codeIndex}
          activeCode={filterCode}
          blocking={grid.blocking}
          warnings={grid.warnings}
          joined={grid.joined}
          leaving={grid.leaving}
          removed={grid.removed}
          rosterEmployeeIds={rosterEmployeeIds}
          tab={glance.tab}
          collapsed={glance.collapsed}
          dockOpen={dockOpen}
          filterDisabled={roster.editing}
          year={params.year}
          month={params.month}
          closed={grid.closed}
          canEdit={canEdit}
          onTab={onGlanceTab}
          onCollapse={onGlanceCollapse}
          onFilterCode={onFilterCode}
          onShowRow={onShowRow}
          onAcknowledge={onAcknowledge}
        />
      </div>

      {/* The dock: fixed furniture below the scroll region, so opening a panel
          costs no layout shift and reaching a download costs no scrolling. Its
          four groups — contracted posts, codes, employee sheet, files and
          downloads — and its five panels are Task 9's `TimesheetDock`. */}
      <TimesheetDock
        grid={grid.grid ?? PENDING_MONTH}
        canEdit={canEdit}
        index={codeIndex}
        filterDisabled={roster.editing}
        ui={ui}
        onOpenPanel={onOpenPanel}
        onFilterCode={onFilterCode}
        onSelect={onSelectRow}
        onQuery={onQuery}
        onSetPostCount={onSetPostCount}
        onDownload={onDownload}
        onEmployeeDownload={onEmployeeDownload}
        onFillRedBlock={onFillRedBlock}
        onClose={onCloseMonth}
        onReopen={onReopenMonth}
      />
    </div>
  )
}
