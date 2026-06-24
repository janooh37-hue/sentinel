/**
 * useLeaveReport — fetches the FULL leaves list (paged `listLeaves` until
 * `total` is reached — the report's figures are wrong if even one row is
 * missing) + scope state + memoized derivations for the "Annual Report" view.
 * All logic lives in `reportData.ts` (tested); this hook only owns state and
 * memoization.
 *
 * Scoping semantics (matches the approved prototype):
 * - The TABLE follows the full scope (month + employee + kind/status chips + q).
 * - The FIGURES follow month + employee only — chips and search are table
 *   refinements; the folio keeps showing the full picture of the scope.
 * - Fig. 2 (months) always shows all 12 months of the year, scoped only by
 *   employee — it is the controller and must stay clickable for every month.
 */
import { useCallback, useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { api } from '@/lib/api'
import type { LeaveListItem } from '@/lib/api'
import { todayIso } from '@/lib/leaveDateMath'
import { canonStatus, displayState, endingSoon } from '../lifecycle'
import { leaveEmployeeName } from '../leaveEmployeeName'
import {
  countedRows, applyScope, kindAggregates, monthAggregates, monthWindow,
  outcomeAggregates, computeInsights, recordOverlapsYear,
  sortRows, yearToDateWindow,
  type ReportScope, type SortSpec, type MonthRef,
} from './reportData'
import type { KindId } from './kinds'

const EMPTY_ROWS: LeaveListItem[] = []
const PAGE_SIZE = 500 // backend LIST_MAX_LIMIT

async function fetchAllLeaves(): Promise<LeaveListItem[]> {
  const first = await api.listLeaves({ limit: PAGE_SIZE })
  const items = [...first.items]
  let total = first.total
  while (items.length < total) {
    const next = await api.listLeaves({ limit: PAGE_SIZE, offset: items.length })
    if (next.items.length === 0) break // total drifted mid-pagination; stop rather than spin
    items.push(...next.items)
    total = next.total
  }
  return items
}

export function useLeaveReport() {
  const { i18n } = useTranslation()
  const today = todayIso()
  const year = Number(today.slice(0, 4))
  const listQuery = useQuery({
    queryKey: ['leaves-list', 'report-all'],
    queryFn: fetchAllLeaves,
  })
  const all: LeaveListItem[] = listQuery.data ?? EMPTY_ROWS

  const [month, setMonth] = useState<MonthRef | null>(null)
  const [employeeId, setEmployeeId] = useState<string | null>(null)
  const [kinds, setKinds] = useState<KindId[]>([])
  const [statuses, setStatuses] = useState<string[]>([])
  const [q, setQ] = useState('')
  const [sort, setSort] = useState<SortSpec>({ key: 'start', dir: 'desc' })

  const scope: ReportScope = useMemo(
    () => ({ month, employeeId, kinds, statuses, q }),
    [month, employeeId, kinds, statuses, q],
  )
  const scopedRows = useMemo(() => applyScope(all, scope), [all, scope])
  // Sort by the DISPLAYED name so the Arabic UI orders by Arabic names.
  const nameOf = useCallback(
    (r: LeaveListItem) => leaveEmployeeName(r, i18n.language),
    [i18n.language],
  )
  const tableRows = useMemo(
    () => sortRows(scopedRows, sort, nameOf, i18n.language),
    [scopedRows, sort, nameOf, i18n.language],
  )
  // Figures: bounded to the report year (the captions claim "— {year}"), and
  // they follow month+employee scope but NOT kind/status chips (chips are
  // table refinements; the folio keeps showing the full picture of the scope
  // — matches the prototype). Day counts are window-clipped: the selected
  // month, or Jan 1 → today ("year to date") when no month is selected.
  const yearRows = useMemo(() => all.filter((r) => recordOverlapsYear(r, year)), [all, year])
  const figureRows = useMemo(
    () => applyScope(yearRows, { month, employeeId, kinds: [], statuses: [], q: '' }),
    [yearRows, month, employeeId],
  )
  const figWindow = useMemo(
    () => (month ? monthWindow(month.year, month.monthIndex) : yearToDateWindow(year, today)),
    [month, year, today],
  )
  // "Leave days" figures (1, 2) + the insight use countedRows (drops
  // record-only kinds + Rejected/Cancelled); Fig. 3 is the outcomes figure
  // and keeps every status to narrate the full lifecycle.
  const figKinds = useMemo(
    () => kindAggregates(countedRows(figureRows), figWindow),
    [figureRows, figWindow],
  )
  // Fig 2 always shows all 12 months of the year, scoped only by employee:
  const figMonths = useMemo(
    () => monthAggregates(countedRows(applyScope(yearRows, { month: null, employeeId, kinds: [], statuses: [], q: '' })), year),
    [yearRows, employeeId, year],
  )
  const figOutcomes = useMemo(() => outcomeAggregates(figureRows), [figureRows])
  const figInsights = useMemo(() => computeInsights(figKinds, figMonths), [figKinds, figMonths])
  const pendingCount = useMemo(
    () => all.filter((r) => canonStatus(r.status) === 'Pending').length,
    [all],
  )
  const awaitingReturnCount = useMemo(
    () =>
      all.filter(
        (r) =>
          displayState(r.leave_type, r.status, r.end_date, today, r.has_certificate) ===
          'AwaitingReturn',
      ).length,
    [all, today],
  )
  const endingSoonCount = useMemo(
    () => all.filter((r) => endingSoon(r.leave_type, r.status, r.end_date, today)).length,
    [all, today],
  )
  // Masthead "{n} on leave today" — distinct PEOPLE away right now (a person
  // with two overlapping records is one absentee). This is a HEADCOUNT, not a
  // day-sum: NS/admin rows still count (a person away IS away), only
  // Rejected and Cancelled are excluded.
  const onLeaveTodayCount = useMemo(() => {
    const away = new Set<string>()
    for (const r of all) {
      const cs = canonStatus(r.status)
      if (cs === 'Rejected' || cs === 'Cancelled') continue
      if (r.start_date.slice(0, 10) <= today && r.end_date.slice(0, 10) >= today) {
        away.add(r.employee_id)
      }
    }
    return away.size
  }, [all, today])

  return {
    isPending: listQuery.isPending, isError: listQuery.isError, year, today,
    all, scopedRows, tableRows,
    // NOTE: `figures` is a fresh wrapper object every render — consumers must
    // destructure the inner memoized arrays (kinds/months/outcomes/insights),
    // never depend on `figures` identity itself.
    figures: {
      kinds: figKinds,
      months: figMonths,
      outcomes: figOutcomes,
      insights: figInsights,
    },
    scope, setMonth, setEmployeeId, setKinds, setStatuses, setQ, sort, setSort,
    pendingCount, awaitingReturnCount, endingSoonCount, onLeaveTodayCount,
  }
}
