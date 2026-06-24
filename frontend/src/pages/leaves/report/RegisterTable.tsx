/**
 * RegisterTable — the report's register: filter chips (kind / status / search /
 * group / clear), a sortable header, group subheaders, day rows with pending
 * quick actions, the inline RecordExpansion strip, the EmployeeProfileStrip
 * anchor, and the mono totals footer (prototype `.register`).
 *
 * Presentational: all scope/sort/group/expansion/profile state is owned by
 * LeavesReport and arrives as props; the only state here is the shared
 * quick-action mutation and the focus-return refs.
 *
 * Focus contract: when an expansion or the profile strip closes (toggle, ✕,
 * Escape, post-mutation collapse), focus returns to the button that opened it
 * (chevron / name button), tracked via refs at click time.
 */
import { Fragment, useEffect, useId, useMemo, useRef } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { CalendarDays, ChevronRight, X } from 'lucide-react'
import { toast } from 'sonner'

import { api, ApiError } from '@/lib/api'
import type { LeaveListItem, LeaveStatus } from '@/lib/api'
import { splitBilingual } from '@/lib/bilingualValue'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { EmptyState } from '@/components/ui/empty-state'
import { Input } from '@/components/ui/input'

import { actionsFor, needsAction } from '../lifecycle'
import { StatusBadge } from '../StatusBadge'
import { leaveEmployeeName } from '../leaveEmployeeName'
import { EmployeeProfileStrip } from './EmployeeProfileStrip'
import { PeriodRun } from './PeriodRun'
import { RecordExpansion } from './RecordExpansion'
import { dateLocale, fmtMonthYear } from './fmt'
import { CANONICAL_KINDS, classifyLeaveType, kindMeta, type KindId } from './kinds'
import {
  groupRows, tableTotals,
  type GroupMode, type ReportScope, type SortSpec,
} from './reportData'

/** Shared row/header grid (plan-locked template). */
const GRID = 'grid grid-cols-[1.6fr_1.2fr_1.1fr_0.5fr_0.9fr_44px] items-center gap-4 px-4'

/** Canonical workflow statuses for the status chip row. */
const WORKFLOW_STATUSES: LeaveStatus[] = ['Pending', 'Approved', 'Rejected', 'Cancelled', 'Completed']

const COLUMNS: { key: SortSpec['key']; labelKey: string; numeric?: boolean }[] = [
  { key: 'employee', labelKey: 'leaves.columns.employee' },
  { key: 'kind', labelKey: 'leaves.report.colKind' },
  { key: 'start', labelKey: 'leaves.report.period' },
  { key: 'days', labelKey: 'leaves.columns.days', numeric: true },
  { key: 'status', labelKey: 'leaves.columns.status' },
]

const GROUP_LABEL_KEYS: Record<GroupMode, string> = {
  none: 'leaves.report.groupNone',
  kind: 'leaves.report.groupKind',
  month: 'leaves.report.groupMonth',
}

const CHIP_BASE =
  'inline-flex items-center rounded-full px-3 py-1 text-[0.78em] font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:ring-offset-background motion-reduce:transition-none'
const CHIP_ON = 'bg-primary-soft font-semibold text-primary'
const CHIP_OFF = 'bg-surface-tinted text-muted-foreground hover:bg-border hover:text-foreground'

function toggleItem<T>(list: T[], item: T): T[] {
  return list.includes(item) ? list.filter((x) => x !== item) : [...list, item]
}

interface RegisterTableProps {
  /** Scoped + sorted rows (the hook's `tableRows`). */
  rows: LeaveListItem[]
  /** ALL fetched rows — the profile strip derives from these, never the scope. */
  allRows: LeaveListItem[]
  /** ISO `YYYY-MM-DD` (today). */
  today: string
  sort: SortSpec
  onSort: (s: SortSpec) => void
  group: GroupMode
  onGroup: (g: GroupMode) => void
  scope: ReportScope
  onKindsChange: (kinds: KindId[]) => void
  onStatusesChange: (statuses: string[]) => void
  onQChange: (q: string) => void
  /** Clears every facet (chips + search + month + employee — prototype `data-clear`). */
  onClearScope: () => void
  expandedId: number | null
  onExpand: (id: number | null) => void
  profileEmployeeId: string | null
  onProfile: (employeeId: string | null) => void
  onFilterEmployee: (employeeId: string) => void
  /** UI-state hook only — invalidations are owned by RecordExpansion (see LeavesReport). */
  onMutated: () => void
}

export function RegisterTable({
  rows,
  allRows,
  today,
  sort,
  onSort,
  group,
  onGroup,
  scope,
  onKindsChange,
  onStatusesChange,
  onQChange,
  onClearScope,
  expandedId,
  onExpand,
  profileEmployeeId,
  onProfile,
  onFilterEmployee,
  onMutated,
}: RegisterTableProps): React.JSX.Element {
  const { t, i18n } = useTranslation()
  const qc = useQueryClient()
  const groupLabelId = useId()
  const locale = dateLocale(i18n.language)

  const groups = useMemo(() => groupRows(rows, group, sort), [rows, group, sort])
  const totals = useMemo(() => tableTotals(rows), [rows])

  // ── Focus return ──────────────────────────────────────────────────────────
  // The buttons that opened the expansion / profile, captured at click time.
  // When either surface closes (any path: toggle, ✕, Escape, collapse-after-
  // mutation), focus returns to its invoker. focus() on a detached node (e.g.
  // the row was deleted) is a safe no-op.
  const expandInvokerRef = useRef<HTMLButtonElement | null>(null)
  const profileInvokerRef = useRef<HTMLButtonElement | null>(null)
  const prevExpandedIdRef = useRef(expandedId)
  useEffect(() => {
    if (prevExpandedIdRef.current !== null && expandedId === null) {
      expandInvokerRef.current?.focus()
    }
    prevExpandedIdRef.current = expandedId
  }, [expandedId])
  const prevProfileIdRef = useRef(profileEmployeeId)
  useEffect(() => {
    if (prevProfileIdRef.current !== null && profileEmployeeId === null) {
      profileInvokerRef.current?.focus()
    }
    prevProfileIdRef.current = profileEmployeeId
  }, [profileEmployeeId])

  // ── Pending quick actions ─────────────────────────────────────────────────
  // One shared mutation for every row's inline Approve/Reject. Same semantics
  // as RecordExpansion's transition mutation: invalidate the list + the
  // employee's balance, toast the decision.
  const quickMutation = useMutation({
    mutationFn: ({ row, status }: { row: LeaveListItem; status: LeaveStatus }) =>
      api.updateLeave(row.id, { status }),
    onSuccess: (_data, { row, status }) => {
      void qc.invalidateQueries({ queryKey: ['leaves-list'] })
      void qc.invalidateQueries({ queryKey: ['leave-balance', row.employee_id] })
      toast.success(status === 'Approved' ? t('leaves.toast.approved') : t('leaves.toast.rejected'))
    },
    onError: (err) => toast.error(err instanceof ApiError ? err.message : String(err)),
  })

  function cycleSort(key: SortSpec['key']): void {
    onSort(
      sort.key === key
        ? { key, dir: sort.dir === 'asc' ? 'desc' : 'asc' }
        : { key, dir: 'asc' },
    )
  }

  const hasChipFilters =
    scope.kinds.length > 0 || scope.statuses.length > 0 || scope.q.trim() !== ''

  // Profile strip anchor: under the employee's FIRST visible row; when the
  // scope hides all their rows, pinned directly under the table header.
  const firstProfileRowId =
    profileEmployeeId !== null
      ? (rows.find((r) => r.employee_id === profileEmployeeId)?.id ?? null)
      : null

  const profileStrip =
    profileEmployeeId !== null ? (
      <div role="row">
        <div role="cell" aria-colspan={6}>
          <EmployeeProfileStrip
            employeeId={profileEmployeeId}
            rows={allRows}
            today={today}
            onFilterEmployee={onFilterEmployee}
            onClose={() => onProfile(null)}
          />
        </div>
      </div>
    ) : null

  return (
    <div className="flex flex-col gap-3">
      {/* ── chip row: kind chips · status chips · search · group · clear ── */}
      <div className="flex flex-wrap items-center gap-2">
        <div
          role="group"
          aria-label={t('leaves.report.colKind')}
          className="flex flex-wrap items-center gap-1.5"
        >
          {CANONICAL_KINDS.map((k) => {
            const active = scope.kinds.includes(k.id)
            return (
              <button
                key={k.id}
                type="button"
                aria-pressed={active}
                onClick={() => onKindsChange(toggleItem(scope.kinds, k.id))}
                className={cn(CHIP_BASE, 'gap-1', active ? CHIP_ON : CHIP_OFF)}
              >
                <span aria-hidden="true">{k.emoji}</span>
                {t(k.i18nKey)}
              </button>
            )
          })}
        </div>
        <span className="h-[18px] w-px bg-border" aria-hidden="true" />
        <div
          role="group"
          aria-label={t('leaves.columns.status')}
          className="flex flex-wrap items-center gap-1.5"
        >
          {WORKFLOW_STATUSES.map((s) => {
            const active = scope.statuses.includes(s)
            return (
              <button
                key={s}
                type="button"
                aria-pressed={active}
                onClick={() => onStatusesChange(toggleItem(scope.statuses, s))}
                className={cn(CHIP_BASE, active ? CHIP_ON : CHIP_OFF)}
              >
                {t(`leaves.status.${s}`)}
              </button>
            )
          })}
        </div>
        <Input
          type="search"
          value={scope.q}
          onChange={(e) => onQChange(e.target.value)}
          placeholder={t('leaves.report.searchPlaceholder')}
          aria-label={t('leaves.report.searchPlaceholder')}
          className="h-8 w-[200px] rounded-full border-hairline bg-surface text-[0.85em]"
        />
        <div className="ms-auto flex items-center gap-2">
          <span
            id={groupLabelId}
            className="text-[0.7em] font-semibold uppercase tracking-[0.1em] text-muted-foreground rtl:tracking-normal"
          >
            {t('leaves.report.groupLabel')}
          </span>
          <div
            role="group"
            aria-labelledby={groupLabelId}
            className="flex overflow-hidden rounded-lg border border-border bg-surface-raised"
          >
            {(['none', 'kind', 'month'] as const).map((m) => (
              <button
                key={m}
                type="button"
                aria-pressed={group === m}
                onClick={() => onGroup(m)}
                className={cn(
                  'border-e border-hairline px-3 py-1.5 text-[0.78em] transition-colors last:border-e-0',
                  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring',
                  'motion-reduce:transition-none',
                  group === m
                    ? 'bg-primary-soft font-semibold text-primary'
                    : 'font-medium text-muted-foreground hover:text-foreground',
                )}
              >
                {t(GROUP_LABEL_KEYS[m])}
              </button>
            ))}
          </div>
          {hasChipFilters && (
            <Button
              variant="ghost"
              size="sm"
              onClick={onClearScope}
              className="h-8 gap-1 rounded-full text-[0.78em] text-muted-foreground"
            >
              <X className="h-3.5 w-3.5" aria-hidden="true" />
              {t('leaves.report.clearFilters')}
            </Button>
          )}
        </div>
      </div>

      {/* ── register card ── */}
      {/* overflow-clip, NOT overflow-hidden: -hidden creates a scroll container,
          which would trap the sticky group subheaders inside the card; -clip
          clips the rounded corners identically without one. */}
      <div className="overflow-clip rounded-2xl border border-hairline bg-surface">
        <div role="table" aria-label={t('leaves.title')}>
          {/* header */}
          <div role="rowgroup">
            <div role="row" className={cn(GRID, 'border-b border-hairline bg-surface-tinted py-2')}>
              {COLUMNS.map((c) => {
                const active = sort.key === c.key
                return (
                  <span
                    key={c.key}
                    role="columnheader"
                    aria-sort={active ? (sort.dir === 'asc' ? 'ascending' : 'descending') : 'none'}
                    className="min-w-0"
                  >
                    <button
                      type="button"
                      onClick={() => cycleSort(c.key)}
                      className={cn(
                        'flex w-full items-center gap-1.5 rounded-sm text-[0.72em] font-semibold uppercase tracking-[0.1em] transition-colors rtl:tracking-normal',
                        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                        'motion-reduce:transition-none',
                        c.numeric && 'justify-end',
                        active ? 'text-primary' : 'text-muted-foreground hover:text-foreground',
                      )}
                    >
                      {t(c.labelKey)}
                      {/* ▲▼ stack on every sortable header (prototype `.arr`)
                          — the affordance is visible before the first click;
                          the active direction is the colored one. */}
                      <span
                        aria-hidden="true"
                        className="flex flex-col text-[0.55em] leading-[0.8] text-faint"
                      >
                        <span className={cn(active && sort.dir === 'asc' && 'text-primary')}>▲</span>
                        <span className={cn(active && sort.dir === 'desc' && 'text-primary')}>▼</span>
                      </span>
                    </button>
                  </span>
                )
              })}
              <span role="columnheader">
                <span className="sr-only">{t('leaves.report.expandRow')}</span>
              </span>
            </div>
          </div>

          {/* body */}
          <div role="rowgroup">
            {firstProfileRowId === null && profileStrip}
            {rows.length === 0 ? (
              <div role="row">
                <div role="cell" aria-colspan={6}>
                  <EmptyState
                    icon={CalendarDays}
                    message={t('leaves.report.emptyFiltered')}
                    actionLabel={t('leaves.report.clearFilters')}
                    onAction={onClearScope}
                  />
                </div>
              </div>
            ) : (
              groups.map((g) => (
                <Fragment key={g.key}>
                  {group !== 'none' && (
                    <div
                      role="row"
                      className="sticky top-0 z-10 border-b border-hairline bg-surface-raised"
                    >
                      <div
                        role="cell"
                        aria-colspan={6}
                        className="flex flex-wrap items-baseline gap-x-2 px-4 py-1.5 font-mono text-[0.7em] uppercase tracking-[0.1em] text-muted-foreground rtl:tracking-normal"
                      >
                        <span className="font-semibold text-foreground">
                          {g.kind !== null ? (
                            <>
                              <span className="me-1" aria-hidden="true">
                                {kindMeta(g.kind).emoji}
                              </span>
                              {t(kindMeta(g.kind).i18nKey)}
                            </>
                          ) : (
                            fmtMonthYear(g.month ?? '', locale)
                          )}
                        </span>
                        <span aria-hidden="true">·</span>
                        <span className="tabular-nums">
                          {t('leaves.report.totalsRecords', { count: g.rows.length })}
                        </span>
                        <span aria-hidden="true">·</span>
                        <span className="tabular-nums">
                          {t('leaves.report.totalsDays', { count: g.days })}
                        </span>
                      </div>
                    </div>
                  )}
                  {g.rows.map((row) => {
                    const open = expandedId === row.id
                    const rowActions = actionsFor(row.leave_type, row.status, row.end_date, today)
                    const showQuick = rowActions.includes('approve')
                    const attention = needsAction(row.leave_type, row.status, row.end_date, today)
                    const profileOpen = profileEmployeeId === row.employee_id
                    return (
                      <Fragment key={row.id}>
                        <div
                          role="row"
                          data-leave-row-id={row.id}
                          onClick={(e) => {
                            // A click that ends a text selection (copying a
                            // G-number) must not toggle the expansion.
                            if (window.getSelection()?.isCollapsed === false) return
                            // Row click = expansion toggle. The chevron is the
                            // focus-return target even for row-surface clicks.
                            const chevron = e.currentTarget.querySelector<HTMLButtonElement>(
                              '[data-row-chevron]',
                            )
                            if (chevron) expandInvokerRef.current = chevron
                            onExpand(open ? null : row.id)
                          }}
                          className={cn(
                            GRID,
                            'min-h-[52px] cursor-pointer border-b border-hairline transition-colors hover:bg-surface-tinted motion-reduce:transition-none',
                            open && 'bg-surface-raised',
                            // Subtle warning-soft row tint (the Records page's
                            // amber-row pattern) — the StatusBadge + quick
                            // actions carry the state, never color alone.
                            // Also fires for overdue NS rows needing a certificate.
                            attention && !open && 'bg-warning-soft/40',
                          )}
                        >
                          {/* employee */}
                          <div role="cell" className="flex min-w-0 flex-col items-start py-2">
                            <button
                              type="button"
                              aria-expanded={profileOpen}
                              onClick={(e) => {
                                e.stopPropagation()
                                profileInvokerRef.current = e.currentTarget
                                onProfile(profileOpen ? null : row.employee_id)
                              }}
                              className={cn(
                                'max-w-full truncate rounded-sm text-start text-[0.85em] font-semibold underline decoration-dotted underline-offset-4 transition-colors',
                                'hover:text-primary hover:decoration-solid hover:decoration-primary',
                                'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                                'motion-reduce:transition-none',
                                profileOpen
                                  ? 'text-primary decoration-solid decoration-primary'
                                  : 'text-foreground decoration-faint',
                              )}
                            >
                              {leaveEmployeeName(row, i18n.language)}
                            </button>
                            <bdi
                              dir="ltr"
                              className="block font-mono text-[0.72em] text-muted-foreground"
                            >
                              {row.employee_id}
                            </bdi>
                          </div>
                          {/* kind */}
                          <div role="cell" className="min-w-0 truncate text-[0.85em] text-foreground">
                            <span className="me-1" aria-hidden="true">
                              {kindMeta(classifyLeaveType(row.leave_type)).emoji}
                            </span>
                            {t(`leaves.type.${row.leave_type}`, {
                              defaultValue: splitBilingual(row.leave_type, i18n.language),
                            })}
                          </div>
                          {/* period */}
                          <div role="cell" className="min-w-0">
                            <PeriodRun
                              start={row.start_date}
                              end={row.end_date}
                              locale={locale}
                              className="text-[0.82em] text-foreground"
                            />
                          </div>
                          {/* days */}
                          <div
                            role="cell"
                            className="text-end text-[0.85em] font-bold tabular-nums text-foreground"
                          >
                            {row.days}
                          </div>
                          {/* status + quick actions */}
                          <div role="cell" className="flex min-w-0 flex-wrap items-center gap-1.5 py-1.5">
                            <StatusBadge status={row.status} leaveType={row.leave_type} endDate={row.end_date} hasCertificate={row.has_certificate} />
                            {showQuick && (
                              // The span absorbs clicks that fall through a
                              // disabled button (Button sets pointer-events-none
                              // while disabled) so they never toggle the row.
                              <span
                                className="flex items-center gap-1"
                                onClick={(e) => e.stopPropagation()}
                              >
                                <Button
                                  size="sm"
                                  disabled={quickMutation.isPending}
                                  onClick={(e) => {
                                    e.stopPropagation()
                                    quickMutation.mutate({ row, status: 'Approved' })
                                  }}
                                  className="h-6 rounded-full px-2 text-[0.7em]"
                                >
                                  {t('leaves.report.quickApprove')}
                                </Button>
                                <Button
                                  variant="secondary"
                                  size="sm"
                                  disabled={quickMutation.isPending}
                                  onClick={(e) => {
                                    e.stopPropagation()
                                    quickMutation.mutate({ row, status: 'Rejected' })
                                  }}
                                  className="h-6 rounded-full px-2 text-[0.7em] text-accent"
                                >
                                  {t('leaves.report.quickReject')}
                                </Button>
                              </span>
                            )}
                          </div>
                          {/* expansion chevron */}
                          <div role="cell" className="justify-self-end">
                            <button
                              type="button"
                              data-row-chevron
                              aria-expanded={open}
                              aria-label={t('leaves.report.expandRow')}
                              onClick={(e) => {
                                e.stopPropagation()
                                expandInvokerRef.current = e.currentTarget
                                onExpand(open ? null : row.id)
                              }}
                              className="inline-flex h-8 w-8 items-center justify-center rounded-full text-faint transition-colors hover:bg-surface-tinted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring motion-reduce:transition-none"
                            >
                              <ChevronRight
                                aria-hidden="true"
                                strokeWidth={1.5}
                                className={cn(
                                  'h-4 w-4 transition-transform motion-reduce:transition-none',
                                  open ? 'rotate-90' : 'rtl:rotate-180',
                                )}
                              />
                            </button>
                          </div>
                        </div>
                        {open && (
                          <div role="row">
                            <div role="cell" aria-colspan={6}>
                              {/* key isolates notes/confirm-delete state per record */}
                              <RecordExpansion
                                key={row.id}
                                row={row}
                                today={today}
                                onMutated={onMutated}
                                onRequestClose={() => onExpand(null)}
                              />
                            </div>
                          </div>
                        )}
                        {row.id === firstProfileRowId && profileStrip}
                      </Fragment>
                    )
                  })}
                </Fragment>
              ))
            )}
          </div>
        </div>

        {/* footer totals */}
        <div className="border-t border-hairline px-4 py-2 font-mono text-[0.72em] tabular-nums text-muted-foreground">
          {[
            t('leaves.report.totalsRecords', { count: totals.records }),
            t('leaves.report.totalsDays', { count: totals.days }),
            t('leaves.report.totalsEmployees', { count: totals.employees }),
          ].join(' · ')}
        </div>
      </div>
    </div>
  )
}
