/**
 * The month's data layer: one read, five writes, two downloads.
 *
 * Read side follows `pages/leaves/report/useLeaveReport.ts` — a module-level
 * `queryFn`, a stable `EMPTY_*` fallback so an absent month does not hand the
 * page a fresh `[]` on every render, `useMemo` for every derivation, and one
 * flat returned object.
 *
 * NOTE, same hazard as `useLeaveReport`: the returned object is a fresh wrapper
 * every render. Consumers must destructure the memoized members (`rows`,
 * `joined`, `leaving`, `blocking`, …) and never depend on the wrapper's
 * identity, or every effect keyed on it fires on every keystroke in the page's
 * search field.
 *
 * Writes follow `pages/employees/EmployeeDetailPage.tsx:123-139` (`useMutation`
 * + `toast`), with one difference that matters: a month write answers with the
 * REFRESHED grid, so the response is written straight into the cache instead of
 * invalidating and fetching the same month twice.
 *
 * Cell writes are additionally SERIALISED by a mutation scope and reconciled a
 * cell at a time. Dragging across days is the primary interaction, so two
 * writes in flight is the normal case, not the edge: a wholesale snapshot
 * restore would let a failed write hand back a grid the server never sent, and
 * a wholesale response write would un-paint the cells still queued behind it.
 */

import { useMemo } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { QueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'

import { api, apiErrorMessage } from '@/lib/api'
import type {
  TimesheetGridResponse,
  TimesheetIssue,
  TimesheetPeriodPatch,
  TimesheetRemoved,
  TimesheetRow,
  TimesheetSheet,
  TimesheetVariant,
} from '@/lib/api'

import type { Code } from './codes'

export interface TimesheetParams {
  year: number
  month: number
  sheet: TimesheetSheet
}

/** A joiner or a leaver, derived from the roster edge the row carries. */
export interface RosterEdge {
  employee_id: string
  name_en: string
  day: number
  confirmed: boolean
}

/**
 * The cache-level shape of one cell write.
 *
 * `code` is the wire string rather than `Code` because a ROLLBACK carries back
 * whatever the grid already held, and the response type does not narrow that.
 */
interface CellWrite {
  employeeId: string
  day: number
  code: string | null
  /** `undefined` leaves the note alone; `null` clears it. */
  note?: string | null
}

/**
 * The last SERVER-CONFIRMED value of every cell that has an unanswered write.
 *
 * The query cache cannot answer this. Once a write has painted, the cache holds
 * the PAINT; a second write to the same cell that reads it captures an
 * unconfirmed value, and two refusals then leave the first refusal's code on
 * screen:
 *
 *   cell 'P'; A paints 'AL' (baseline 'P'); B paints 'SL' (baseline 'AL')
 *   A refused -> 'P';  B refused -> 'AL', which the server had just rejected
 *
 * That is the failure locked rule 7 forbids, and it is reachable from the Undo
 * button and from any second click on an unanswered cell. So the baseline is
 * recorded once per cell, inherited by later writes, and REPLACED by the
 * server's own value the moment a write to that cell is answered — which is
 * what keeps an accepted-then-refused pair from rolling the accepted value out.
 *
 * `Mutation.state.context` — which holds whatever `onMutate` returned — is not
 * enough on its own, for two reasons.
 *
 * The first is why this is a registry and not a snapshot: a baseline captured
 * at mutate time goes STALE the moment an earlier write to the same cell is
 * ACCEPTED. `cell 'P'; A 'AL' accepted; B 'SL' refused` must land on 'AL', and
 * a context captured before A answered says 'P'. Only `onSuccess` knows the
 * confirmed value, and it cannot write into another mutation's context — so the
 * baseline lives somewhere both handlers can reach.
 *
 * The second is a timing detail worth knowing: `Mutation.execute()` assigns the
 * context only after `await options.onMutate(...)` resolves, so two writes to
 * one cell issued in the SAME tick both enter `onMutate` before either resolves
 * and the second would read `undefined`. That case happens to be safe either
 * way — neither write has painted yet, so the cache is still confirmed — but it
 * means context is not readable when the inheritance is decided.
 *
 * Keyed by `QueryClient`, so it dies with the client and cannot leak between
 * tests or between two clients in one process.
 */
const BASELINES = new WeakMap<QueryClient, Map<string, CellWrite>>()

function baselinesFor(qc: QueryClient): Map<string, CellWrite> {
  const existing = BASELINES.get(qc)
  if (existing) return existing
  const fresh = new Map<string, CellWrite>()
  BASELINES.set(qc, fresh)
  return fresh
}

/** The registry key. Both writers must spell it identically or a baseline is
 *  silently orphaned, so it is computed in exactly one place. */
const cellIdOf = (p: TimesheetParams, cell: { employeeId: string; day: number }): string =>
  `${p.year}-${p.month}-${p.sheet}|${cell.employeeId}|${cell.day}`

export interface SetCellInput extends CellWrite {
  /** `null` clears the override and lets the derived value show through. */
  code: Code | null
  /**
   * Suppress THIS write's own error toast. Never sent on the wire.
   *
   * A fill is one write per cell because `set_cell` is one cell, and the server
   * refuses per cell: a day outside the roster window comes back 422
   * `TIMESHEET_OFF_ROSTER` while its neighbours are taken. Left alone that is
   * one toast per refused day, so the caller that issued the fill collects the
   * refusals and says it once instead.
   *
   * Only the TELLING moves. The rollback to the last server-confirmed value
   * happens either way, before this flag is read.
   */
  quiet?: boolean
}

const EMPTY_ROWS: TimesheetRow[] = []
const EMPTY_ISSUES: TimesheetIssue[] = []
const EMPTY_REMOVED: TimesheetRemoved[] = []

const keyOf = (p: TimesheetParams): readonly unknown[] => [
  'timesheet',
  p.year,
  p.month,
  p.sheet,
]

/**
 * Every cell write for one month shares this scope, so react-query runs them
 * one at a time. `onMutate` still paints the instant the pointer moves — the
 * scope only holds the REQUEST back until the previous one has answered, which
 * is what makes a per-cell reconcile sound: when a response lands, the writes
 * behind it have not been sent yet.
 */
const scopeOf = (p: TimesheetParams): string =>
  `timesheet-cell:${p.year}-${p.month}-${p.sheet}`

/** Identifies cell writes for ONE month in the mutation cache. */
const cellKeyOf = (p: TimesheetParams): readonly unknown[] => [
  'timesheet',
  'cell',
  p.year,
  p.month,
  p.sheet,
]

/**
 * Read one month.
 *
 * `warnings` is deliberately NOT joined to `rows`: the server recomputes it live
 * even on a sealed month, so an issue may name an employee who has no row here
 * at all (a departure, or someone hired after the seal). Anything rendered from
 * it is keyed by employee and stands on its own.
 */
export function useTimesheetGrid(params: TimesheetParams) {
  const query = useQuery({
    queryKey: keyOf(params),
    queryFn: () => api.getTimesheet(params),
  })
  const grid = query.data
  const rows = grid?.rows ?? EMPTY_ROWS
  const blocking = grid?.blocking ?? EMPTY_ISSUES
  const warnings = grid?.warnings ?? EMPTY_ISSUES
  const removed = grid?.removed ?? EMPTY_REMOVED

  // Neither joiners nor leavers are sent as fields: both are roster edges the
  // row already carries. `removed` is the one movement the server has to report,
  // because those people are absent from `rows` by construction.
  const joined = useMemo(() => {
    const out: RosterEdge[] = []
    for (const row of rows) {
      if (row.joined_day === null) continue
      out.push({
        employee_id: row.employee_id,
        name_en: row.name_en,
        day: row.joined_day,
        confirmed: row.start_confirmed,
      })
    }
    return out
  }, [rows])
  const leaving = useMemo(() => {
    const out: RosterEdge[] = []
    for (const row of rows) {
      if (row.left_day === null) continue
      out.push({
        employee_id: row.employee_id,
        name_en: row.name_en,
        day: row.left_day,
        confirmed: true,
      })
    }
    return out
  }, [rows])

  return {
    isPending: query.isPending,
    isError: query.isError,
    error: query.error,
    grid,
    rows,
    blocking,
    warnings,
    removed,
    joined,
    leaving,
    daysInMonth: grid?.days_in_month ?? 31,
    postCount: grid?.post_count ?? 0,
    closed: grid?.closed_at !== null && grid?.closed_at !== undefined,
    closedAt: grid?.closed_at ?? null,
    closedBy: grid?.closed_by ?? null,
    refetch: query.refetch,
  }
}

/** Notes serialise with STRING keys, so `day` is indexed as one. */
function withNote(
  notes: TimesheetRow['notes'],
  day: number,
  note: string | null,
): TimesheetRow['notes'] {
  const next = { ...notes }
  const key = String(day)
  if (note) next[key] = note
  else delete next[key]
  return next
}

/** Immutable single-cell write: only the touched row and its codes are copied. */
function paintCell(grid: TimesheetGridResponse, input: CellWrite): TimesheetGridResponse {
  const index = grid.rows.findIndex((r) => r.employee_id === input.employeeId)
  if (index < 0) return grid
  const row = grid.rows[index]
  const codes = row.codes.slice()
  codes[input.day - 1] = input.code
  const rows = grid.rows.slice()
  rows[index] = {
    ...row,
    codes,
    notes:
      input.note === undefined ? row.notes : withNote(row.notes, input.day, input.note),
  }
  return { ...grid, rows }
}

/**
 * The cell writes that are painted but not yet sent.
 *
 * Writes are serialised, so at most one is in flight and the rest sit paused
 * with their optimistic fill already in the cache. When a response lands we
 * take the server's grid WHOLE — it carries the recomputed `blocking`,
 * `warnings`, `stat_codes` and `post_count` the release decision is made from —
 * and then repaint these on top, so an answer never un-paints a drag that is
 * still running.
 *
 * `settling` is excluded by REFERENCE identity: `state.variables` is the very
 * object handed to `mutate`, so the write whose response we are applying can
 * never repaint its own request over the server's answer.
 */
function queuedCellWrites(
  qc: QueryClient,
  mutationKey: readonly unknown[],
  settling: SetCellInput,
): SetCellInput[] {
  const out: SetCellInput[] = []
  for (const mutation of qc.getMutationCache().findAll({
    mutationKey,
    exact: true,
    status: 'pending',
  })) {
    const variables = mutation.state.variables as SetCellInput | undefined
    if (variables && variables !== settling) out.push(variables)
  }
  return out
}

/**
 * Correct one cell, optimistically.
 *
 * The fill changes before the request leaves, and the CELL is put back if the
 * server refuses — a failed correction that leaves the wrong code on screen is
 * the one failure mode this page cannot have. The server's own message is what
 * the operator is told, not a generic apology.
 *
 * Nothing here ever restores a whole snapshot. With two writes in flight — a
 * drag across days, a shift-clicked range — a wholesale restore would re-seat
 * the optimistic grid captured before the earlier write answered, silently
 * discarding the server's recomputed `blocking`, `warnings`, `stat_codes` and
 * `post_count`. The operator makes the release decision from those counts.
 *
 * Where a refused cell goes back to is `BASELINES`, never the cache: the cache
 * holds paint, and a second write to the same cell must not inherit an
 * unconfirmed value. The three handlers keep one invariant between them — while
 * a cell has an unanswered write, `BASELINES` holds that cell's last
 * server-confirmed value:
 *
 *   onMutate   seeds it, or inherits the entry an earlier write left
 *   onSuccess  replaces it with the server's own value for that cell
 *   onSettled  drops it once no write for that cell is left unanswered
 */
export function useSetCell(params: TimesheetParams) {
  const qc = useQueryClient()
  const key = keyOf(params)
  const cellKey = cellKeyOf(params)
  return useMutation({
    mutationKey: cellKey,
    scope: { id: scopeOf(params) },
    mutationFn: (input: SetCellInput) =>
      api.setTimesheetCell(params, {
        employee_id: input.employeeId,
        day: input.day,
        code: input.code,
        note: input.note ?? null,
      }),
    onMutate: async (input) => {
      // Recorded BEFORE the await. Two writes to one cell in the same tick both
      // reach this line before either paints, so the inheritance has to be
      // settled here and not after a suspension point.
      const baselines = baselinesFor(qc)
      const cellId = cellIdOf(params, input)
      if (!baselines.has(cellId)) {
        const row = qc
          .getQueryData<TimesheetGridResponse>(key)
          ?.rows.find((r) => r.employee_id === input.employeeId)
        baselines.set(cellId, {
          employeeId: input.employeeId,
          day: input.day,
          code: row?.codes[input.day - 1] ?? null,
          // Notes serialise with STRING keys.
          note: row?.notes[String(input.day)] ?? null,
        })
      }

      // A refetch landing mid-flight would overwrite the optimistic fill.
      await qc.cancelQueries({ queryKey: key })
      const grid = qc.getQueryData<TimesheetGridResponse>(key)
      if (grid) qc.setQueryData(key, paintCell(grid, input))
    },
    onError: (err, input) => {
      const confirmed = baselinesFor(qc).get(cellIdOf(params, input))
      const current = qc.getQueryData<TimesheetGridResponse>(key)
      if (current && confirmed) qc.setQueryData(key, paintCell(current, confirmed))
      // The revert above is unconditional; only the telling is opt-out, so a
      // fill can report its refused days in one line instead of one per day.
      if (!input.quiet) toast.error(apiErrorMessage(err))
    },
    onSuccess: (grid, input) => {
      // This cell is now confirmed, so anything still queued for it inherits
      // the SERVER's value — not what the cell held before this write. Without
      // this an accepted write followed by a refused one to the same cell would
      // roll the accepted value straight back out.
      const row = grid.rows.find((r) => r.employee_id === input.employeeId)
      if (row) {
        baselinesFor(qc).set(cellIdOf(params, input), {
          employeeId: input.employeeId,
          day: input.day,
          code: row.codes[input.day - 1] ?? null,
          note: row.notes[String(input.day)] ?? null,
        })
      }
      const queued = queuedCellWrites(qc, cellKey, input)
      qc.setQueryData(key, queued.reduce((next, write) => paintCell(next, write), grid))
    },
    onSettled: (_grid, _err, input) => {
      // Held while another write to the same cell is still unanswered — that
      // write's rollback is this entry. `onSettled` runs before react-query
      // dispatches this mutation's terminal state, so exclude ourselves.
      const stillQueued = qc
        .getMutationCache()
        .findAll({ mutationKey: cellKey, exact: true, status: 'pending' })
        .some((mutation) => {
          const vars = mutation.state.variables as SetCellInput | undefined
          if (!vars || vars === input) return false
          return vars.employeeId === input.employeeId && vars.day === input.day
        })
      if (!stillQueued) baselinesFor(qc).delete(cellIdOf(params, input))
    },
  })
}

/** The month's contracted post count and any block-2 filler choices. */
export function usePatchPeriod(params: TimesheetParams) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (payload: TimesheetPeriodPatch) => api.patchTimesheetPeriod(params, payload),
    onSuccess: (grid) => qc.setQueryData(keyOf(params), grid),
    onError: (err) => toast.error(apiErrorMessage(err)),
  })
}

export function useCloseMonth(params: TimesheetParams) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: () => api.closeTimesheetMonth(params),
    onSuccess: (grid) => qc.setQueryData(keyOf(params), grid),
    onError: (err) => toast.error(apiErrorMessage(err)),
  })
}

export function useReopenMonth(params: TimesheetParams) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: () => api.reopenTimesheetMonth(params),
    onSuccess: (grid) => qc.setQueryData(keyOf(params), grid),
    onError: (err) => toast.error(apiErrorMessage(err)),
  })
}

/** 204, not a grid — so this is the one write that has to refetch. */
export function useAcknowledgeStart(params: TimesheetParams) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (employeeId: string) => api.acknowledgeTimesheetStart(params, employeeId),
    onSuccess: () => qc.invalidateQueries({ queryKey: keyOf(params) }),
    onError: (err) => toast.error(apiErrorMessage(err)),
  })
}

/**
 * The month the operator works on: the one that just ended. The workbooks are
 * produced after a month closes, not during it, so this is the month
 * `TimesheetPage` opens on AND the month an employee record offers for someone
 * still on the roster. One declaration, because two answers to "which month"
 * is how the record and the page come to disagree.
 */
export const lastCompletedMonth = (now: Date = new Date()): { year: number; month: number } => {
  const month = now.getMonth() // 0-based, so this IS last month 1-based
  return month === 0 ? { year: now.getFullYear() - 1, month: 12 } : { year: now.getFullYear(), month }
}

/**
 * The month before the one named — the earlier of the two sheets a `months=2`
 * export carries. December→January is the whole reason this is a function.
 */
export const previousMonth = (year: number, month: number): { year: number; month: number } =>
  month === 1 ? { year: year - 1, month: 12 } : { year, month: month - 1 }

const arabicMonth = (year: number, month: number): string =>
  new Intl.DateTimeFormat('ar', { month: 'long' }).format(new Date(year, month - 1, 1))

/**
 * The two deliverables' own names for a month.
 *
 * These are the workbook names, identical in both UI languages, so they are not
 * interface copy and do not belong in the locale files. They serve two callers
 * from ONE declaration: the fallback when a response carries no
 * `content-disposition` — the server's own name is authoritative — and the
 * release panel, which prints what the operator is about to save.
 */
export const monthWorkbookNames = (
  year: number,
  month: number,
): Record<TimesheetVariant, string> => {
  const name = arabicMonth(year, month)
  return {
    attendance: `كشف حضور شهر ${name}.xlsx`,
    statistics: `الاحصائية شهر ${name}.xlsx`,
  }
}

/**
 * One employee's sheet for one month, under the same agreed pattern.
 *
 * Exported for the same reason as `monthWorkbookNames`: the release surface
 * prints what the operator is about to save, and a second copy of the template
 * is a name the panel can show after the hook has stopped sending it. For
 * `months=2` the server answers with ONE workbook carrying two sheets, named
 * from the LATER month — which is the month passed here.
 */
export const employeeWorkbookName = (
  employeeId: string,
  year: number,
  month: number,
): string => `كشف حضور ${employeeId} ${arabicMonth(year, month)}.xlsx`

/**
 * Land a blob on disk under its own name.
 *
 * This is the app's first real save-as: every other blob helper here opens a
 * preview in a tab. An `.xlsx` in a tab is a download prompt with the wrong
 * name, which is how the wrong file gets sent to a client.
 */
function saveBlob(file: { blob: Blob; filename: string }): void {
  const url = URL.createObjectURL(file.blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = file.filename
  document.body.append(anchor)
  anchor.click()
  anchor.remove()
  // Deferred one task: Firefox CANCELS the download when the blob URL is
  // revoked before the download's own fetch has begun, and the operator gets
  // neither a file nor an error. Chrome tolerates the synchronous revoke, which
  // is exactly why this would have shipped unnoticed.
  setTimeout(() => URL.revokeObjectURL(url), 0)
}

/**
 * Both workbooks for a month. The first one produced FREEZES the month.
 *
 * `download` NEVER rejects. `onError` has already shown the operator the
 * server's own message, so rethrowing would only surface as an unhandled
 * rejection at the natural call site — `onClick={() => void download(args)}`.
 * The promise settles when the browser has the file, or when the attempt has
 * been reported; callers that need to know may read `pending`.
 */
export function useTimesheetDownload(): {
  download: (args: {
    year: number
    month: number
    sheet: TimesheetSheet
    variant: TimesheetVariant
  }) => Promise<void>
  pending: boolean
} {
  const qc = useQueryClient()
  const mutation = useMutation({
    mutationFn: (args: {
      year: number
      month: number
      sheet: TimesheetSheet
      variant: TimesheetVariant
    }) =>
      api.fetchTimesheetExport(
        args,
        monthWorkbookNames(args.year, args.month)[args.variant],
      ),
    onSuccess: (file, args) => {
      saveBlob(file)
      // The export sealed the month, so the cached grid is now stale.
      void qc.invalidateQueries({
        queryKey: keyOf({ year: args.year, month: args.month, sheet: args.sheet }),
      })
    },
    onError: (err) => toast.error(apiErrorMessage(err)),
  })
  return {
    download: async (args) => {
      await mutation.mutateAsync(args).catch(() => {})
    },
    pending: mutation.isPending,
  }
}

/**
 * One employee's sheet. `months: 2` = the month named plus the one before it.
 *
 * Same contract as `useTimesheetDownload`: `download` never rejects.
 */
export function useEmployeeSheetDownload(): {
  download: (args: {
    employeeId: string
    year: number
    month: number
    months: 1 | 2
  }) => Promise<void>
  pending: boolean
} {
  const mutation = useMutation({
    mutationFn: (args: { employeeId: string; year: number; month: number; months: 1 | 2 }) =>
      api.fetchTimesheetEmployeeExport(
        args,
        employeeWorkbookName(args.employeeId, args.year, args.month),
      ),
    onSuccess: saveBlob,
    onError: (err) => toast.error(apiErrorMessage(err)),
  })
  return {
    download: async (args) => {
      await mutation.mutateAsync(args).catch(() => {})
    },
    pending: mutation.isPending,
  }
}
