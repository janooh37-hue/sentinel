/**
 * Employees list — TAMM-style top-level page.
 *
 * Single-pane list. Clicking a row navigates to `/employees/:id`
 * (EmployeeDetailPage — Task 4 of the TAMM redesign), which now owns the
 * full hero + 5-tab detail surface. This page keeps:
 *   - search + filter chips (persisted via useLocalStorage)
 *   - virtualized roster (EmployeeList)
 *   - an in-page "Create employee" form, which on success redirects to the
 *     new employee's detail page.
 *
 * Cross-page handoff (Ledger smart-links stash a G-number at
 * `gssg.employees.openId`) is consumed on mount → immediate navigate.
 */

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useVirtualizer } from '@tanstack/react-virtual'
import { Plus, Users } from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useLocation, useNavigate } from 'react-router-dom'
import { toast } from 'sonner'

import { EmployeeForm } from '@/components/employees/EmployeeForm'
import { EmployeeList } from '@/components/employees/EmployeeList'
import type { EmployeeFormOutput } from '@/components/employees/schema'
import { EmptyState } from '@/components/ui/empty-state'
import { Input } from '@/components/ui/input'
import { SkeletonRow } from '@/components/ui/skeleton'
import { ApiError, api, apiErrorMessage } from '@/lib/api'
import type { EmployeeCreate, EmployeeListItem, EmployeeStatus } from '@/lib/api'
import type { ExtractionResponse } from '@/lib/extraction'
import { pickEmployeeName } from '@/lib/employeeName'
import { pickPosition } from '@/lib/employeePosition'
import { useShortcutAction } from '@/lib/useKeyboardShortcuts'
import { cn } from '@/lib/utils'

type FilterKey = 'all' | 'active' | 'onLeave' | 'resigned' | 'terminated'

interface EmployeesFilterState {
  q: string
  filter: FilterKey
}

const DEFAULT_FILTERS: EmployeesFilterState = { q: '', filter: 'all' }

const FILTER_TO_STATUS: Record<FilterKey, EmployeeStatus | ''> = {
  all: '',
  active: 'Active',
  onLeave: '', // applied client-side via dashboard.on_leave_today
  resigned: 'Resigned',
  terminated: 'Terminated',
}

export function EmployeesPage(): React.JSX.Element {
  const { t, i18n } = useTranslation()
  const navigate = useNavigate()
  const location = useLocation()
  const qc = useQueryClient()

  // Filter/search state is intentionally in-memory: leaving the page resets it
  // so you never return to a stale search. Records persist; UI filters don't.
  const [filters, setFilters] = useState<EmployeesFilterState>(DEFAULT_FILTERS)
  const { q, filter } = filters

  const setQ = useCallback(
    (value: string) => setFilters((prev) => ({ ...prev, q: value })),
    [setFilters],
  )
  const setFilter = useCallback(
    (value: FilterKey) => setFilters((prev) => ({ ...prev, filter: value })),
    [setFilters],
  )

  // Intake injection: when navigated here with { openCreate, injectedExtraction }
  // (from IntakePanel for an unmatched document), open the create form with
  // the extraction pre-loaded. Initialise state lazily from location.state so
  // we avoid calling setState inside an effect. The history state is cleared
  // on mount so a refresh doesn't re-open the create form.
  const intakeState = (location.state as { openCreate?: boolean; injectedExtraction?: ExtractionResponse } | null)
  const [creating, setCreating] = useState(() => !!intakeState?.openCreate)
  const [createError, setCreateError] = useState<string | null>(null)
  const [createInjection, setCreateInjection] = useState<ExtractionResponse | undefined>(
    () => intakeState?.injectedExtraction,
  )

  // Clear history state once on mount so refresh doesn't re-trigger.
  useEffect(() => {
    if (intakeState?.openCreate) {
      navigate(location.pathname, { replace: true, state: {} })
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Smart-link handoff from Ledger: consume on mount and redirect to detail.
  useEffect(() => {
    try {
      const pending = window.localStorage.getItem('gssg.employees.openId')
      if (pending) {
        window.localStorage.removeItem('gssg.employees.openId')
        navigate(`/employees/${encodeURIComponent(pending)}`, { replace: true })
      }
    } catch {
      // ignore storage failures (private mode, quota)
    }
  }, [navigate])

  const statusForApi = FILTER_TO_STATUS[filter] || undefined
  const listQuery = useQuery({
    queryKey: ['employees', { q, status: statusForApi }],
    queryFn: () =>
      api.listEmployees({
        q: q.trim() || undefined,
        status: statusForApi,
        limit: 500,
      }),
  })

  // Cheap shared cache with Dashboard — exposes today's on-leave set so we
  // can both filter and tint status pills without a new endpoint.
  const dashboardQuery = useQuery({
    queryKey: ['dashboard'],
    queryFn: api.getDashboardSummary,
    staleTime: 60_000,
  })
  const onLeaveIds = useMemo(() => {
    const set = new Set<string>()
    for (const item of dashboardQuery.data?.on_leave_today ?? []) {
      set.add(item.employee_id)
    }
    return set
  }, [dashboardQuery.data])

  const rawRows = useMemo(() => listQuery.data?.items ?? [], [listQuery.data])
  const total = listQuery.data?.total ?? 0
  const rows = useMemo(() => {
    if (filter === 'onLeave') {
      return rawRows.filter((r) => onLeaveIds.has(r.id))
    }
    return rawRows
  }, [rawRows, filter, onLeaveIds])

  // Source the active count from the dashboard summary (stable total across
  // all filters) rather than the filtered list (which shows 0 under non-'all'
  // filters other than 'active').
  const activeCount = dashboardQuery.data?.totals.employees_active ?? 0

  const createMutation = useMutation({
    mutationFn: (payload: EmployeeCreate) => api.createEmployee(payload),
    onSuccess: (row) => {
      void qc.invalidateQueries({ queryKey: ['employees'] })
      setCreating(false)
      setCreateError(null)
      setCreateInjection(undefined)
      toast.success(t('employees.toast.created'))
      navigate(`/employees/${encodeURIComponent(row.id)}`)
    },
    onError: (err) => {
      setCreateError(humanError(err))
      toast.error(apiErrorMessage(err))
    },
  })

  useShortcutAction(
    'newItem',
    useCallback(() => setCreating(true), []),
  )

  const submitCreate = async (values: EmployeeFormOutput): Promise<void> => {
    await createMutation.mutateAsync(values satisfies EmployeeCreate)
  }

  const chips: Array<{ key: FilterKey; label: string }> = [
    { key: 'all', label: t('employees.chips.all') },
    { key: 'active', label: t('employees.chips.active') },
    { key: 'onLeave', label: t('employees.chips.onLeave') },
    { key: 'resigned', label: t('employees.chips.resigned') },
    { key: 'terminated', label: t('employees.chips.terminated') },
  ]

  return (
    <div className="flex flex-1 flex-col overflow-auto bg-background">
      <div className="mx-auto w-full max-w-[1180px] flex-1 px-4 pb-10 pt-6 md:px-8">
        {/* ───── Header ───── */}
        <header className="mb-5 flex items-end justify-between gap-4">
          <div className="min-w-0">
            <div className="text-[0.75em] font-medium uppercase tracking-[0.18em] text-muted-foreground">
              {t('employees.eyebrow')}
            </div>
            <h2 className="mt-1 text-[1.7em] font-bold tracking-tight text-foreground">
              {t('employees.title')}
            </h2>
            <div className="mt-1 text-[0.86em] text-muted-foreground">
              {t('employees.pageMeta', { count: total, active: activeCount })}
            </div>
          </div>
          <button
            type="button"
            onClick={() => {
              setCreating(true)
              setCreateError(null)
            }}
            className="inline-flex shrink-0 items-center gap-1.5 rounded-full bg-primary px-4 py-2 text-[0.85em] font-semibold text-primary-foreground transition-colors hover:bg-primary-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2"
          >
            <Plus className="h-3.5 w-3.5" strokeWidth={2.5} />
            {t('employees.newEmployee')}
          </button>
        </header>

        {creating ? (
          <div className="rounded-2xl border border-hairline bg-surface p-6">
            {createError && (
              <div
                role="alert"
                className="mb-4 rounded-md border border-accent/30 bg-accent-soft px-3 py-2 text-xs text-accent"
              >
                {createError}
              </div>
            )}
            <EmployeeForm
              mode="create"
              initialExtraction={createInjection}
              onSubmit={submitCreate}
              onCancel={() => {
                setCreating(false)
                setCreateError(null)
                setCreateInjection(undefined)
              }}
              submitting={createMutation.isPending}
            />
          </div>
        ) : (
          <>
            {/* ───── Filter bar ───── */}
            {/* Mobile: search + count on first row; chips on a dedicated scrollable second row.
                Desktop: all in one row. */}
            <div className="mb-3 flex flex-col gap-0 rounded-2xl bg-surface md:flex-row md:items-center md:gap-2 md:px-3 md:py-2">
              {/* Row 1 (mobile) / inline (desktop): search + count */}
              <div className="flex items-center gap-2 px-3 py-2 md:contents">
                <Input
                  placeholder={t('common.search')}
                  value={q}
                  onChange={(e) => setQ(e.target.value)}
                  className="h-9 flex-1 border-0 bg-transparent shadow-none focus-visible:ring-0 md:max-w-xs md:flex-none"
                />
                <div className="shrink-0 font-mono text-[0.75em] text-muted-foreground">
                  {listQuery.isPending
                    ? t('common.loading')
                    : `${rows.length} / ${total}`}
                </div>
              </div>

              {/* Row 2 (mobile) / inline (desktop): filter chips */}
              <div className="flex w-full items-center gap-1.5 overflow-x-auto px-3 pb-2 [-webkit-overflow-scrolling:touch] md:flex-1 md:flex-wrap md:overflow-visible md:px-0 md:pb-0">
                {chips.map((c) => {
                  const active = filter === c.key
                  return (
                    <button
                      key={c.key}
                      type="button"
                      onClick={() => setFilter(c.key)}
                      aria-pressed={active}
                      className={cn(
                        'inline-flex shrink-0 items-center rounded-full px-3 py-1.5 text-[0.78em] font-medium transition-colors min-h-[2.75rem] md:min-h-0 md:py-1',
                        active
                          ? 'bg-primary text-primary-foreground'
                          : 'bg-surface-tinted text-muted-foreground hover:bg-border hover:text-foreground',
                      )}
                    >
                      {c.label}
                    </button>
                  )
                })}
              </div>
            </div>

            {/* ───── Desktop list (hidden below md) ───── */}
            <div className="max-md:hidden overflow-hidden rounded-2xl border border-hairline bg-surface">
              {listQuery.isPending ? (
                <div className="flex flex-col">
                  {Array.from({ length: 8 }).map((_, i) => (
                    <SkeletonRow key={i} cols={3} />
                  ))}
                </div>
              ) : rows.length === 0 ? (
                <EmptyState
                  icon={Users}
                  message={
                    q || filter !== 'all'
                      ? t('employees.list.emptyFiltered')
                      : t('employees.list.empty')
                  }
                />
              ) : (
                <div style={{ height: 'min(70vh, 720px)' }}>
                  <EmployeeList
                    rows={rows}
                    onLeaveIds={onLeaveIds}
                    onSelect={(id) =>
                      navigate(`/employees/${encodeURIComponent(id)}`)
                    }
                  />
                </div>
              )}
            </div>

            {/* ───── Mobile card list (hidden at md and above) ───── */}
            <div className="md:hidden">
              {listQuery.isPending ? (
                <div className="flex flex-col gap-2 pb-24">
                  {Array.from({ length: 6 }).map((_, i) => (
                    <div key={i} className="h-[72px] animate-pulse rounded-2xl bg-surface" />
                  ))}
                </div>
              ) : rows.length === 0 ? (
                <EmptyState
                  icon={Users}
                  message={
                    q || filter !== 'all'
                      ? t('employees.list.emptyFiltered')
                      : t('employees.list.empty')
                  }
                />
              ) : (
                <MobileEmployeeList
                  rows={rows}
                  onLeaveIds={onLeaveIds}
                  onSelect={(id) => navigate(`/employees/${encodeURIComponent(id)}`)}
                  language={i18n.language}
                  t={t}
                />
              )}
            </div>
          </>
        )}
      </div>

      {/* ───── Mobile FAB — "New employee" (hidden at md and above) ───── */}
      {!creating && (
        <button
          type="button"
          aria-label={t('employees.newEmployee')}
          onClick={() => {
            setCreating(true)
            setCreateError(null)
          }}
          className="fixed bottom-20 end-4 z-40 md:hidden inline-flex h-14 w-14 items-center justify-center rounded-full bg-primary text-primary-foreground shadow-lg shadow-primary/30 transition-colors hover:bg-primary-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2"
        >
          <Plus className="h-6 w-6" strokeWidth={2.5} />
        </button>
      )}
    </div>
  )
}

// ─── Mobile-only virtualized card list ───────────────────────────────────────

interface MobileEmployeeListProps {
  rows: EmployeeListItem[]
  onLeaveIds: ReadonlySet<string>
  onSelect: (id: string) => void
  language: string
  t: (key: string) => string
}

// Cards are mostly ~88px (name + meta + optional department); measureElement
// reconciles the few taller two-line-name cards. Dedicated scroll container so
// the virtualizer has a bounded viewport (the page wrapper itself scrolls).
const MOBILE_CARD_ESTIMATE = 88

function MobileEmployeeList({
  rows,
  onLeaveIds,
  onSelect,
  language,
  t,
}: MobileEmployeeListProps): React.JSX.Element {
  const parentRef = useRef<HTMLDivElement>(null)
  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => MOBILE_CARD_ESTIMATE,
    overscan: 6,
  })

  return (
    <div
      ref={parentRef}
      className="overflow-auto pb-24"
      style={{ height: 'calc(100vh - 16rem)' }}
    >
      <div style={{ height: virtualizer.getTotalSize(), position: 'relative' }}>
        {virtualizer.getVirtualItems().map((vi) => {
          const row = rows[vi.index]
          if (!row) return null
          return (
            <div
              key={row.id}
              ref={virtualizer.measureElement}
              data-index={vi.index}
              style={{
                position: 'absolute',
                top: 0,
                insetInlineStart: 0,
                width: '100%',
                transform: `translateY(${vi.start}px)`,
                paddingBottom: 8,
              }}
            >
              <EmployeeMobileCard
                row={row}
                onLeave={onLeaveIds.has(row.id)}
                onClick={() => onSelect(row.id)}
                language={language}
                t={t}
              />
            </div>
          )
        })}
      </div>
    </div>
  )
}

// ─── Mobile-only employee card ───────────────────────────────────────────────

interface EmployeeMobileCardProps {
  row: EmployeeListItem
  onLeave: boolean
  onClick: () => void
  language: string
  t: (key: string) => string
}

function EmployeeMobileCard({
  row,
  onLeave,
  onClick,
  language,
  t,
}: EmployeeMobileCardProps): React.JSX.Element {
  // Derive pill style matching StatusDotPill in EmployeeList
  let pillBg: string
  let pillFg: string
  let pillLabel: string
  if (onLeave) {
    pillBg = 'var(--warning-soft)'
    pillFg = 'var(--warning)'
    pillLabel = t('employees.statusPill.onLeave')
  } else if (row.status === 'Active') {
    pillBg = 'var(--success-soft)'
    pillFg = 'var(--success)'
    pillLabel = t('employees.status.Active')
  } else {
    pillBg = 'var(--surface-tinted)'
    pillFg = 'var(--text-muted)'
    pillLabel = t(`employees.status.${row.status}`)
  }

  // Initials for the avatar fallback (same logic as Avatar3D — first letter of G-number)
  const initials = row.id.replace('G-', '').slice(0, 2)

  return (
    <button
      type="button"
      onClick={onClick}
      className="flex w-full items-center gap-3 rounded-2xl border border-hairline bg-surface p-3 text-start transition-colors hover:bg-surface-tinted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
    >
      {/* Avatar */}
      <div className="relative h-10 w-10 shrink-0 overflow-hidden rounded-full bg-primary-soft">
        {row.has_photo && (
          <img
            src={`/api/v1/employees/${encodeURIComponent(row.id)}/photo`}
            alt=""
            loading="lazy"
            className="absolute inset-0 h-full w-full object-cover"
            onError={(e) => { e.currentTarget.style.display = 'none' }}
          />
        )}
        <span className="absolute inset-0 flex items-center justify-center font-mono text-[0.72em] font-bold text-primary">
          {initials}
        </span>
      </div>

      {/* Name + meta */}
      <div className="min-w-0 flex-1">
        <div className="line-clamp-2 text-[0.9em] font-semibold leading-tight text-foreground">
          {pickEmployeeName(row, language)}
        </div>
        <div className="mt-0.5 flex items-center gap-1.5 text-[0.74em] text-muted-foreground">
          <span className="font-mono">{row.id}</span>
          {pickPosition(row, language) && (
            <>
              <span aria-hidden className="text-faint">·</span>
              <span className="truncate">{pickPosition(row, language)}</span>
            </>
          )}
        </div>
        {row.department && (
          <div className="mt-0.5 truncate text-[0.74em] text-muted-foreground">
            {row.department}
          </div>
        )}
      </div>

      {/* Status pill */}
      <span
        className="inline-flex shrink-0 items-center gap-1.5 rounded-full px-2.5 py-0.5 text-[0.78em] font-semibold"
        style={{ background: pillBg, color: pillFg }}
      >
        <span aria-hidden className="h-1.5 w-1.5 rounded-full" style={{ background: pillFg }} />
        {pillLabel}
      </span>
    </button>
  )
}

function humanError(err: unknown): string {
  if (err instanceof ApiError) {
    if (err.code === 'EMPLOYEE_INVALID_STATUS_END_DATE') {
      return err.message
    }
    return `${err.code}: ${err.message}`
  }
  return err instanceof Error ? err.message : String(err)
}
