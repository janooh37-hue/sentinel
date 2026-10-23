/**
 * EmployeeLookupPage — search-first employee hub (replaces the roster list).
 *
 * State A composition:
 *   • EmployeeSearchHero (navy band) with LookupHeroCards as children
 *   • Recent activity, followed by the inline EmployeeForm card when creating.
 *
 * Intake handoff: the create form is addressed by `?create=1`; its extraction
 * payload stays in history state because it is not shareable.
 */

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Link, useLocation, useNavigate, useSearchParams } from 'react-router-dom'
import { toast } from 'sonner'

import { AttendanceHeroCard } from '@/components/employees/AttendanceHeroCard'
import { useAttendanceAttention } from '@/components/employees/useAttendanceAttention'
import { EmployeeForm } from '@/components/employees/EmployeeForm'
import { EmployeeActivitySection } from '@/components/employees/EmployeeActivitySection'
import { EmployeeSearchHero } from '@/components/employees/EmployeeSearchHero'
import { EmployeesSectionTabs } from '@/components/employees/EmployeesSectionTabs'
import { LookupHeroCards } from '@/components/employees/LookupHeroCards'
import type { EmployeeFormOutput } from '@/components/employees/schema'
import { EMPLOYEE_STATUSES } from '@/components/employees/schema'
import { Button } from '@/components/ui/button'
import { pickEmployeeName } from '@/lib/employeeName'
import { ApiError, api, apiErrorMessage } from '@/lib/api'
import type { EmployeeCreate, ListEmployeesParams } from '@/lib/api'
import type { ExtractionResponse } from '@/lib/extraction'
import { useShortcutAction } from '@/lib/useKeyboardShortcuts'
import { useUrlOverlay } from '@/lib/urlState'

export function EmployeeLookupPage(): React.JSX.Element {
  const { t, i18n } = useTranslation()
  const navigate = useNavigate()
  const location = useLocation()
  const qc = useQueryClient()
  const [searchParams, setSearchParams] = useSearchParams()
  const filters: ListEmployeesParams = {
    status: EMPLOYEE_STATUSES.find((status) => status === searchParams.get('status')),
    pending: ['1', 'true'].includes(searchParams.get('pending') ?? '') || undefined,
    open_violations: searchParams.get('violations') === 'open' || undefined,
    working: searchParams.get('working') === 'true' || undefined,
    present: searchParams.get('present') === 'true' || undefined,
    on_leave: searchParams.get('on_leave') === 'true' || undefined,
  }
  const filtered = Object.values(filters).some(Boolean)
  const rawPage = Number(searchParams.get('page') ?? 1)
  const page = Number.isSafeInteger(rawPage) && rawPage > 0 ? rawPage : 1
  const filteredQuery = useQuery({
    queryKey: ['employees', 'dashboard-filter', filters, page],
    queryFn: () => api.listEmployees({ ...filters, limit: 30, offset: (page - 1) * 30 }),
    enabled: filtered,
  })
  const changePage = (nextPage: number) => setSearchParams((previous) => {
    const next = new URLSearchParams(previous)
    next.set('page', String(nextPage))
    return next
  })

  // Intake keeps its large extraction payload in history state, not the URL.
  const intakeState = location.state as {
    injectedExtraction?: ExtractionResponse
  } | null
  const overlay = useUrlOverlay('create')
  const creating = overlay.value === '1'
  const [createError, setCreateError] = useState<string | null>(null)
  const [createInjection, setCreateInjection] = useState<
    ExtractionResponse | undefined
  >(() => intakeState?.injectedExtraction)
  const createFormRef = useRef<HTMLDivElement>(null)
  // Same ordered list as the hero card and the register queue.
  const attendance = useAttendanceAttention()

  useEffect(() => {
    if (!creating || !createFormRef.current) return
    createFormRef.current.scrollIntoView({ block: 'start' })
    createFormRef.current
      .querySelector<HTMLElement>(
        'input:not([type="hidden"]):not([disabled]), select:not([disabled]), textarea:not([disabled]), button:not([disabled])',
      )
      ?.focus({ preventScroll: true })
  }, [creating])


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

  const createMutation = useMutation({
    mutationFn: (payload: EmployeeCreate) => api.createEmployee(payload),
    onSuccess: (row) => {
      void qc.invalidateQueries({ queryKey: ['employees'] })
      setCreateError(null)
      setCreateInjection(undefined)
      toast.success(t('employees.toast.created'))
      // Replace the `?create=1` entry: close() would queue an async Back that
      // can land after this navigation. Back from the record returns to the list.
      navigate(`/employees/${encodeURIComponent(row.id)}`, { replace: true })
    },
    onError: (err) => {
      setCreateError(humanError(err))
      toast.error(apiErrorMessage(err))
    },
  })

  useShortcutAction(
    'newItem',
    useCallback(() => overlay.open('1'), [overlay.open]),
  )

  const submitCreate = async (values: EmployeeFormOutput): Promise<void> => {
    // `effective_date` is the write-only reactivation return date — update only.
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { effective_date: _ignored, ...createValues } = values
    await createMutation.mutateAsync(createValues satisfies EmployeeCreate)
  }

  const handleSelect = useCallback(
    (id: string) => navigate(`/employees/${encodeURIComponent(id)}`),
    [navigate],
  )

  const handleCreate = useCallback(() => {
    overlay.open('1')
    setCreateError(null)
  }, [overlay.open])

  return (
    <div className="flex flex-1 flex-col overflow-auto bg-background">
      {/* ───── Navy hero band (always visible) ───── */}
      <EmployeeSearchHero
        onSelect={handleSelect}
        onCreate={handleCreate}
        onLeaveIds={onLeaveIds}
        filters={filters}
      >
        <LookupHeroCards
          onOpen={handleSelect}
          extraCard={<AttendanceHeroCard onOpen={() => navigate('/employees/attendance')} />}
        />
        {/* The lookup band is centre-composed, so the strip sits on its axis. */}
        <div className="mt-7 flex justify-center">
          <EmployeesSectionTabs attentionCount={attendance.attention} />
        </div>
      </EmployeeSearchHero>

      {filtered ? (
        <section className="mx-auto w-full max-w-[1180px] px-4 py-6 md:px-8" aria-label={t('dashboard.widgets.workspace.results')}>
          <div className="flex flex-wrap items-center justify-between gap-2 pb-3">
            <h2 className="text-[0.9em] font-semibold">{t('dashboard.widgets.workspace.results')}{filteredQuery.data ? ` · ${filteredQuery.data.total}` : ''}</h2>
            <Link to="/employees" className="text-[0.78em] text-primary underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">{t('dashboard.widgets.workspace.clearFilters')}</Link>
          </div>
          <p className="pb-3 text-[0.78em] text-muted-foreground">
            {[filters.status && t(`employees.status.${filters.status}`), filters.pending && t('dashboard.widgets.pending_departures.title'), filters.open_violations && t('dashboard.widgets.violations.title'), filters.working && t('dashboard.widgets.workspace.working'), filters.present && t('dashboard.widgets.workspace.onSite'), filters.on_leave && t('dashboard.widgets.workspace.onLeave')].filter(Boolean).join(' · ')}
          </p>
          {filteredQuery.isPending ? <div role="status" aria-label={t('common.loading')} className="h-20 rounded-lg bg-surface-tinted motion-safe:animate-pulse" /> : filteredQuery.isError ? (
            <p role="alert">{t('common.loadError')} <Button variant="ghost" onClick={() => void filteredQuery.refetch()}>{t('common.retry')}</Button></p>
          ) : filteredQuery.data.items.length === 0 ? <p className="text-muted-foreground">{t('dashboard.widgets.workspace.noMatches')}</p> : (
            <ul className="divide-y divide-hairline rounded-xl border border-hairline bg-surface">
              {filteredQuery.data.items.map((employee) => <li key={employee.id}><Link to={`/employees/${encodeURIComponent(employee.id)}${filters.open_violations ? '?tab=violations' : ''}`} className="flex items-center justify-between gap-3 px-4 py-3 text-start hover:bg-surface-tinted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring">
                <span className="min-w-0"><bdi className="block truncate font-medium">{pickEmployeeName(employee, i18n.language)}</bdi><bdi className="font-mono text-[0.75em] text-muted-foreground">{employee.id}</bdi></span><span className="text-[0.75em] text-muted-foreground">{t(`employees.status.${employee.status}`)}</span>
              </Link></li>)}
            </ul>
          )}
          {filteredQuery.data && filteredQuery.data.total > 30 && <nav className="flex items-center justify-between gap-2 pt-3" aria-label={t('dashboard.widgets.workspace.pages')}>
            <Button variant="ghost" disabled={page === 1} onClick={() => changePage(page - 1)}>{t('dashboard.widgets.workspace.previous')}</Button>
            <span className="font-mono text-[0.78em]">{page} / {Math.ceil(filteredQuery.data.total / 30)}</span>
            <Button variant="ghost" disabled={page * 30 >= filteredQuery.data.total} onClick={() => changePage(page + 1)}>{t('dashboard.widgets.workspace.next')}</Button>
          </nav>}
        </section>
      ) : <EmployeeActivitySection onOpenProfile={(employeeId) => navigate(`/employees/${encodeURIComponent(employeeId)}`)} />}

      {creating && (
        <div ref={createFormRef} className="mx-auto w-full max-w-[1180px] flex-1 px-4 pb-10 pt-6 md:px-8">
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
                overlay.close()
                setCreateError(null)
                setCreateInjection(undefined)
              }}
              submitting={createMutation.isPending}
            />
          </div>
        </div>
      )}
    </div>
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
