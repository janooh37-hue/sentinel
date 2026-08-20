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
 */

import { useMemo } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
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

export interface SetCellInput {
  employeeId: string
  day: number
  /** `null` clears the override and lets the derived value show through. */
  code: Code | null
  note?: string | null
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
  if (note) next[day] = note
  else delete next[day]
  return next
}

/** Immutable single-cell write: only the touched row and its codes are copied. */
function paintCell(grid: TimesheetGridResponse, input: SetCellInput): TimesheetGridResponse {
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
 * Correct one cell, optimistically.
 *
 * The fill changes before the request leaves, and the PREVIOUS grid is restored
 * if the server refuses — a failed correction that leaves the wrong code on
 * screen is the one failure mode this page cannot have. The server's own message
 * is what the operator is told, not a generic apology.
 */
export function useSetCell(params: TimesheetParams) {
  const qc = useQueryClient()
  const key = keyOf(params)
  return useMutation({
    mutationFn: (input: SetCellInput) =>
      api.setTimesheetCell(params, {
        employee_id: input.employeeId,
        day: input.day,
        code: input.code,
        note: input.note ?? null,
      }),
    onMutate: async (input) => {
      // A refetch landing mid-flight would overwrite the optimistic fill.
      await qc.cancelQueries({ queryKey: key })
      const previous = qc.getQueryData<TimesheetGridResponse>(key)
      if (previous) qc.setQueryData(key, paintCell(previous, input))
      return { previous }
    },
    onError: (err, _input, context) => {
      if (context?.previous) qc.setQueryData(key, context.previous)
      toast.error(apiErrorMessage(err))
    },
    onSuccess: (grid) => qc.setQueryData(key, grid),
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
 * Only used when a response carries no `content-disposition` — the server's own
 * name is authoritative. These are the deliverables' own names, identical in
 * both UI languages, so they are not interface copy and do not belong in the
 * locale files.
 */
const FALLBACK_NAME: Record<TimesheetVariant, (month: string) => string> = {
  attendance: (month) => `كشف حضور شهر ${month}.xlsx`,
  statistics: (month) => `الاحصائية شهر ${month}.xlsx`,
}

const arabicMonth = (year: number, month: number): string =>
  new Intl.DateTimeFormat('ar', { month: 'long' }).format(new Date(year, month - 1, 1))

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
  URL.revokeObjectURL(url)
}

/** Both workbooks for a month. The first one produced FREEZES the month. */
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
        FALLBACK_NAME[args.variant](arabicMonth(args.year, args.month)),
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
  return { download: async (args) => void (await mutation.mutateAsync(args)), pending: mutation.isPending }
}

/** One employee's sheet. `months: 2` = the month named plus the one before it. */
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
        `كشف حضور ${args.employeeId} ${arabicMonth(args.year, args.month)}.xlsx`,
      ),
    onSuccess: saveBlob,
    onError: (err) => toast.error(apiErrorMessage(err)),
  })
  return { download: async (args) => void (await mutation.mutateAsync(args)), pending: mutation.isPending }
}
