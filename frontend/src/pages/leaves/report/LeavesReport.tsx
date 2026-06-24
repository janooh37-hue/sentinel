/**
 * LeavesReport — the desktop "Annual Report" assembly: masthead → scope chips
 * → figure folio (Fig. 2 is the controller) → insight line → register table.
 *
 * One state owner: the scope lives in `useLeaveReport`; this component adds
 * the table-presentation state (group / expandedId / profileEmployeeId) and
 * passes everything down — RegisterTable stays presentational.
 *
 * Deep-link: `openId` (from `?open=<id>`, wired by TabRecords) expands that
 * row and centers it once, then `onOpenConsumed` clears it upstream.
 */
import { useCallback, useEffect, useMemo, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { useLocation, useNavigate } from 'react-router-dom'

import { Button } from '@/components/ui/button'
import { Skeleton, SkeletonRow } from '@/components/ui/skeleton'

import { actionsFor, displayState } from '../lifecycle'
import { leaveEmployeeName } from '../leaveEmployeeName'
import { buildConfirmationEmail } from './confirmEmail'
import { FigKindBars } from './FigKindBars'
import { FigMonthColumns } from './FigMonthColumns'
import { FigOutcomes } from './FigOutcomes'
import { InsightLine } from './InsightLine'
import { RegisterTable } from './RegisterTable'
import { ReportMasthead } from './ReportMasthead'
import { dateLocale, fmtMonthYear } from './fmt'
import type { GroupMode } from './reportData'
import { useLeaveReport } from './useLeaveReport'

const SCOPE_CHIP =
  'inline-flex items-center gap-1.5 rounded-full bg-primary-soft px-3 py-1 text-[0.75em] font-semibold text-primary transition-opacity hover:opacity-85 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 motion-reduce:transition-none'

interface LeavesReportProps {
  /** Deep-link (`?open=<id>`): expand this row + scroll it into view once. */
  openId?: number | null
  /** Called once the deep-link has been consumed — clear it upstream. */
  onOpenConsumed?: () => void
}

export function LeavesReport({
  openId = null,
  onOpenConsumed,
}: LeavesReportProps): React.JSX.Element {
  const { t, i18n } = useTranslation()
  const location = useLocation()
  const navigate = useNavigate()
  const qc = useQueryClient()
  const report = useLeaveReport()
  // The `figures` wrapper is a fresh object every render — destructure the
  // INNER memoized arrays and pass those down, never the wrapper itself.
  const { kinds: figKinds, months: figMonths, outcomes: figOutcomes, insights } = report.figures
  const { scope, setMonth, setEmployeeId, setKinds, setStatuses, setQ, sort, setSort } = report

  const [group, setGroup] = useState<GroupMode>('none')
  const [expandedId, setExpandedId] = useState<number | null>(null)
  const [profileEmployeeId, setProfileEmployeeId] = useState<string | null>(null)
  // Pre-activate the awaiting-return filter when navigating from the bell /
  // dashboard attention area (they pass `{ state: { awaitingReturn: true } }`).
  const [awaitingReturnOnly, setAwaitingReturnOnly] = useState(
    () => !!(location.state as Record<string, unknown> | null)?.awaitingReturn,
  )

  const locale = dateLocale(i18n.language)
  const currentMonthIndex = Number(report.today.slice(5, 7)) - 1

  // Deep-link: expand + center the row once the data is in, then hand the
  // token back so refresh/back-nav don't re-trigger it.
  useEffect(() => {
    if (openId === null || report.isPending) return
    // eslint-disable-next-line react-hooks/set-state-in-effect -- URL-param hydration (the TabRecords pattern)
    setExpandedId(openId)
    const raf = requestAnimationFrame(() => {
      document
        .querySelector(`[data-leave-row-id="${openId}"]`)
        ?.scrollIntoView({ block: 'center' })
      // Consume INSIDE the frame callback: consuming synchronously would clear
      // `openId` upstream, re-run this effect, and the cleanup would cancel
      // this rAF before the scroll ever happened.
      onOpenConsumed?.()
    })
    return () => cancelAnimationFrame(raf)
  }, [openId, report.isPending, onOpenConsumed])

  const pendingActive = scope.statuses.length === 1 && scope.statuses[0] === 'Pending'
  const awaitingReturnActive = awaitingReturnOnly
  const sickActive = scope.kinds.includes('Sick Leave')

  const monthChipLabel =
    scope.month !== null
      ? fmtMonthYear(
          `${scope.month.year}-${String(scope.month.monthIndex + 1).padStart(2, '0')}`,
          locale,
        )
      : null
  const scopeLabel = monthChipLabel ?? t('leaves.report.scopeAllYear', { year: report.year })

  // Employee chip label: name from the employee's first fetched row (the
  // shared fallback-to-G-number helper); the filter can only be set from a
  // profile strip, so a row always exists in practice.
  const employeeChipName = useMemo(() => {
    if (scope.employeeId === null) return null
    const first = report.all.find((r) => r.employee_id === scope.employeeId)
    return first ? leaveEmployeeName(first, i18n.language) : scope.employeeId
  }, [scope.employeeId, report.all, i18n.language])

  const busiestMonthLabel = useMemo(() => {
    if (insights.busiestMonthIndex === null) return null
    return new Intl.DateTimeFormat(i18n.language, { month: 'long', timeZone: 'UTC' }).format(
      new Date(Date.UTC(report.year, insights.busiestMonthIndex, 1)),
    )
  }, [insights.busiestMonthIndex, i18n.language, report.year])

  // Invalidations are owned by RecordExpansion / the table's quick-action
  // mutation (both invalidate ['leaves-list'] + ['leave-balance', …] on
  // success) — duplicating them here would double-fetch. `onMutated` is
  // UI-state only: collapsing the expansion keeps a deleted row from leaving
  // a stale `expandedId` behind, and RegisterTable's focus-return effect
  // hands focus back to the row's chevron after a decision.
  const handleMutated = useCallback(() => setExpandedId(null), [])

  const clearScope = useCallback(() => {
    setMonth(null)
    setEmployeeId(null)
    setKinds([])
    setStatuses([])
    setQ('')
    setAwaitingReturnOnly(false)
  }, [setMonth, setEmployeeId, setKinds, setStatuses, setQ])

  // Awaiting-return filter is a computed display state, not a stored status, so
  // it cannot go through applyScope's statuses facet. Apply it as a post-filter
  // on tableRows, mirroring the pending filter's toggle semantics.
  const visibleRows = useMemo(
    () =>
      awaitingReturnOnly
        ? report.tableRows.filter(
            (r) =>
              displayState(r.leave_type, r.status, r.end_date, report.today, r.has_certificate) ===
              'AwaitingReturn',
          )
        : report.tableRows,
    [awaitingReturnOnly, report.tableRows, report.today],
  )

  // Scope-driven on purpose: the office emails confirmations in batches — filter
  // the report to the group (month/employee/kind), then the button emails exactly
  // that scope's pending requests.
  // `actionsFor` returning 'approve' is the canonical test for "this row needs
  // a confirm/approve decision" — matches the same filter the register table uses.
  const pendingRequests = useMemo(
    () =>
      report.scopedRows.filter((r) =>
        actionsFor(r.leave_type, r.status, r.end_date, report.today).includes('approve'),
      ),
    [report.scopedRows, report.today],
  )

  const openConfirmCompose = useCallback(() => {
    const prefill = buildConfirmationEmail(pendingRequests, {
      subject: t('leaves.report.confirmEmail.subject', { n: pendingRequests.length }),
      intro: t('leaves.report.confirmEmail.intro'),
      colName: t('leaves.report.confirmEmail.colName'),
      colPeriod: t('leaves.report.confirmEmail.colPeriod'),
      colDays: t('leaves.report.confirmEmail.colDays'),
      lang: i18n.language,
    })
    navigate('/ledger', { state: { composePrefill: prefill } })
  }, [pendingRequests, t, i18n.language, navigate])

  if (report.isPending) {
    return (
      <div className="mx-auto flex w-full max-w-[1180px] flex-col gap-4" aria-busy="true">
        <div className="grid grid-cols-3 gap-3.5 max-xl:grid-cols-1">
          {Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} className="h-[220px] rounded-2xl" />
          ))}
        </div>
        <div className="overflow-hidden rounded-2xl border border-hairline bg-surface">
          {Array.from({ length: 6 }).map((_, i) => (
            <SkeletonRow key={i} cols={6} />
          ))}
        </div>
      </div>
    )
  }

  if (report.isError) {
    return (
      <div className="mx-auto flex w-full max-w-[1180px] flex-col items-center gap-3 py-16">
        <p className="text-sm text-muted-foreground">{t('common.loadError')}</p>
        <Button
          variant="secondary"
          size="sm"
          className="rounded-full"
          onClick={() => void qc.invalidateQueries({ queryKey: ['leaves-list'] })}
        >
          {t('common.retry')}
        </Button>
      </div>
    )
  }

  return (
    <div className="mx-auto flex w-full max-w-[1180px] flex-col gap-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <ReportMasthead
          year={report.year}
          today={report.today}
          onLeaveTodayCount={report.onLeaveTodayCount}
          pendingCount={report.pendingCount}
          pendingActive={pendingActive}
          onPendingClick={() => setStatuses(pendingActive ? [] : ['Pending'])}
          awaitingReturnCount={report.awaitingReturnCount}
          awaitingReturnActive={awaitingReturnActive}
          onAwaitingReturnClick={() => setAwaitingReturnOnly(!awaitingReturnOnly)}
          endingSoonCount={report.endingSoonCount}
        />
        {pendingRequests.length > 0 && (
          <Button variant="secondary" size="sm" onClick={openConfirmCompose}>
            ✉{' '}{t('leaves.report.confirmEmail.button', { n: pendingRequests.length })}
          </Button>
        )}
      </div>

      {/* active-scope chips (dismiss = clear that facet) */}
      {(scope.month !== null || scope.employeeId !== null) && (
        <div className="flex flex-wrap items-center gap-2">
          {scope.month !== null && (
            <button type="button" onClick={() => setMonth(null)} className={SCOPE_CHIP}>
              {t('leaves.report.scopedToMonth', { month: monthChipLabel })}
              <span aria-hidden="true" className="text-[0.9em]">
                ✕
              </span>
            </button>
          )}
          {scope.employeeId !== null && (
            <button type="button" onClick={() => setEmployeeId(null)} className={SCOPE_CHIP}>
              {t('leaves.report.scopedToEmployee', { name: employeeChipName })}
              <span aria-hidden="true" className="text-[0.9em]">
                ✕
              </span>
            </button>
          )}
        </div>
      )}

      {/* figure folio — Fig. 2 controls the report scope */}
      <div className="grid grid-cols-3 gap-3.5 max-xl:grid-cols-1">
        <FigKindBars data={figKinds} scopeLabel={scopeLabel} yearToDate={scope.month === null} />
        <FigMonthColumns
          data={figMonths}
          selected={scope.month}
          currentMonthIndex={currentMonthIndex}
          year={report.year}
          onSelect={setMonth}
        />
        <FigOutcomes data={figOutcomes} scopeLabel={scopeLabel} />
      </div>

      <InsightLine
        insights={insights}
        monthLabel={busiestMonthLabel}
        sickActive={sickActive}
        onSickClick={() =>
          setKinds(
            sickActive
              ? scope.kinds.filter((k) => k !== 'Sick Leave')
              : [...scope.kinds, 'Sick Leave'],
          )
        }
      />

      <RegisterTable
        rows={visibleRows}
        allRows={report.all}
        today={report.today}
        sort={sort}
        onSort={setSort}
        group={group}
        onGroup={setGroup}
        scope={scope}
        onKindsChange={setKinds}
        onStatusesChange={setStatuses}
        onQChange={setQ}
        onClearScope={clearScope}
        expandedId={expandedId}
        onExpand={setExpandedId}
        profileEmployeeId={profileEmployeeId}
        onProfile={setProfileEmployeeId}
        onFilterEmployee={setEmployeeId}
        onMutated={handleMutated}
      />
    </div>
  )
}
