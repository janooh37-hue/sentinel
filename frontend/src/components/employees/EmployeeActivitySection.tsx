import { useInfiniteQuery } from '@tanstack/react-query'
import { useLayoutEffect, useMemo, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import { Link } from 'react-router-dom'
import { EmployeeBadgeCard } from './EmployeeBadgeCard'
import { DutyLocationActivity } from './DutyLocationActivity'
import { StatusActivity } from './StatusActivity'
import { StatusPill } from './StatusPill'
import { ACTIVITY_FILTERS, type ActivityFilter } from './employeeActivityModel'
import { EMPLOYEE_STATUSES } from './schema'
import { api, type EmployeeActivityItemRead, type EmployeeActivityKind, type EmployeeListItem } from '@/lib/api'
import { pickEmployeeName } from '@/lib/employeeName'
import { bidi } from '@/lib/bidi'
import { todayIso } from '@/lib/leaveDateMath'

const PAGE_SIZE = 25

const KIND_STYLES: Record<EmployeeActivityKind, { soft: string; color: string; icon: React.JSX.Element }> = {
  employee_added: {
    soft: 'var(--surface-tinted)',
    color: 'var(--text-muted)',
    icon: <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><circle cx="9" cy="7" r="3.5" /><path d="M2.5 20v-2a4 4 0 0 1 4-4h5a4 4 0 0 1 4 4v2M19 8v6m-3-3h6" /></svg>,
  },
  document: {
    soft: '#e6f0f6',
    color: '#0d5c8a',
    icon: <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M6 2h7l5 5v13a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2zm7 1.5V8h4.5" /></svg>,
  },
  leave: {
    soft: '#e5f3ee',
    color: '#047857',
    icon: <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M8 2v3M16 2v3M3.5 9.5h17M5 4.5h14a1.5 1.5 0 0 1 1.5 1.5v13A1.5 1.5 0 0 1 19 20.5H5A1.5 1.5 0 0 1 3.5 19V6A1.5 1.5 0 0 1 5 4.5z" /></svg>,
  },
  violation: {
    soft: '#f9ede4',
    color: '#b3541e',
    icon: <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M12 3 2.5 20h19L12 3zm0 6v5m0 3v.5" /></svg>,
  },
  ledger: {
    soft: '#f1eef8',
    color: '#6b4fb0',
    icon: <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M3.5 5.5h17v13h-17zM3.5 6.5 12 13l8.5-6.5" /></svg>,
  },
  duty_location: {
    soft: 'var(--primary-soft)',
    color: 'var(--primary-on-soft)',
    icon: <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M12 21s7-6 7-12a7 7 0 1 0-14 0c0 6 7 12 7 12Zm0-9.5h.01" /></svg>,
  },
  status: {
    soft: 'var(--info-soft)',
    color: 'var(--info)',
    icon: <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M4 8h13m-4-4 4 4-4 4M20 16H7m4-4-4 4 4 4" /></svg>,
  },
  id_change: {
    soft: 'var(--primary-soft)',
    color: 'var(--primary-text)',
    icon: <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M4 8h13m-4-4 4 4-4 4M20 16H7m4-4-4 4 4 4" /></svg>,
  },
}

function activityHref(item: EmployeeActivityItemRead): string {
  switch (item.kind) {
    case 'employee_added':
      return `/employees?employee=${encodeURIComponent(item.employee_id)}`
    case 'document':
      return `/books?open=${item.target_id}`
    case 'leave':
      return `/leaves?open=${item.source_id}`
    case 'violation':
      return `/employees/${encodeURIComponent(item.employee_id)}?tab=violations&open=${item.source_id}`
    case 'ledger':
      return `/ledger?mail=${item.source_id}`
    case 'duty_location':
    case 'id_change':
      return `/employees/${encodeURIComponent(item.employee_id)}?tab=activity`
    case 'status':
      return `/employees/${encodeURIComponent(item.employee_id)}`
  }
}

export interface EmployeeActivitySectionProps {
  employee: EmployeeListItem | null
  kind: ActivityFilter
  onKindChange: (kind: ActivityFilter) => void
  onClearFilters: () => void
}

export function EmployeeActivitySection({
  employee,
  kind,
  onKindChange,
  onClearFilters,
}: EmployeeActivitySectionProps): React.JSX.Element {
  const { t, i18n } = useTranslation()
  const lang = i18n.language.startsWith('ar') ? 'ar' : 'en'
  const chipGroupRef = useRef<HTMLDivElement>(null)
  const employeeId = employee?.id

  useLayoutEffect(() => {
    // Keep a shared link's selected chip visible without scrolling the page.
    const group = chipGroupRef.current
    if (!group || group.scrollWidth <= group.clientWidth) return
    const selected = group.querySelector('[aria-pressed="true"]')
    if (!selected) return
    const { left, right } = group.getBoundingClientRect()
    const chip = selected.getBoundingClientRect()
    const offset = chip.left < left ? chip.left - left : Math.max(0, chip.right - right)
    if (offset) group.scrollBy({ left: offset })
  }, [employeeId, kind, lang])

  const activityQuery = useInfiniteQuery({
    queryKey: ['employee-activity', employee?.id ?? null, kind],
    initialPageParam: 0,
    queryFn: ({ pageParam }) => api.listEmployeeActivity({
      ...(employee ? { employee_id: employee.id } : {}),
      ...(kind === 'all' ? {} : { kind }),
      limit: PAGE_SIZE,
      offset: pageParam,
    }),
    getNextPageParam: (lastPage, pages) => {
      const loaded = pages.reduce((count, page) => count + page.items.length, 0)
      return loaded < lastPage.total ? loaded : undefined
    },
    staleTime: 30_000,
    refetchOnMount: 'always',
    // A different employee or chip starts at page one, including on Back.
    gcTime: 0,
  })

  const dayFormatter = useMemo(
    () => new Intl.DateTimeFormat(lang, { dateStyle: 'medium' }),
    [lang],
  )
  const timeFormatter = useMemo(
    () => new Intl.DateTimeFormat(lang, { timeStyle: 'short' }),
    [lang],
  )
  const joiningDateFormatter = useMemo(
    () => new Intl.DateTimeFormat(lang === 'ar' ? 'ar-AE' : 'en', {
      day: 'numeric', month: 'long', year: 'numeric', numberingSystem: 'latn', timeZone: 'UTC',
    }),
    [lang],
  )
  const pages = activityQuery.data?.pages
  const items = useMemo(() => pages?.flatMap((page) => page.items) ?? [], [pages])
  const total = pages?.[0]?.total ?? 0
  const filtered = employee != null || kind !== 'all'
  const dayGroups = useMemo(() => {
    const groups: Array<{ day: string; items: EmployeeActivityItemRead[] }> = []
    for (const item of items) {
      const day = dayFormatter.format(new Date(item.occurred_at))
      const last = groups[groups.length - 1]
      if (last?.day === day) {
        last.items.push(item)
      } else {
        groups.push({ day, items: [item] })
      }
    }
    return groups
  }, [dayFormatter, items])

  return (
    <section
      className={`w-full border-y border-hairline bg-background px-4 md:px-8 ${employee ? 'py-5 md:py-6' : 'py-8 lg:py-10'}`}
      aria-labelledby="employee-activity-title"
    >
      <div className={`mx-auto w-full max-w-[1440px] ${employee ? 'grid gap-5 lg:grid-cols-[340px_minmax(0,1fr)] lg:items-start lg:gap-8' : ''}`}>
        {employee && <EmployeeBadgeCard key={employee.id} employee={employee} onClear={onClearFilters} />}
        <div className="min-w-0">
          <header className="mb-3 flex flex-col gap-2 sm:mb-6 sm:gap-3 md:flex-row md:items-end md:justify-between">
            <div>
              {!employee && <p className="mb-2 text-xs font-semibold uppercase tracking-[0.16em] text-primary rtl:tracking-normal">{t('employees.activity.eyebrow')}</p>}
              <h2 id="employee-activity-title" className="text-2xl font-bold tracking-tight text-foreground rtl:tracking-normal md:text-3xl">{t('employees.activity.title')}</h2>
              {!employee && <p className="mt-2 max-w-2xl text-sm text-muted-foreground">{t('employees.activity.subtitle')}</p>}
            </div>
            {!activityQuery.isPending && !activityQuery.isError && (
              <p className="text-sm font-medium text-muted-foreground">
                <span className={employee ? 'hidden sm:inline' : undefined}>
                  {`${t('employees.activity.resultCount', { count: total })} · `}
                </span>
                {t('employees.activity.showing', { shown: items.length, total })}
              </p>
            )}
          </header>

          <div
            ref={chipGroupRef}
            role="group"
            aria-label={t('employees.activity.typeLabel')}
            className={`flex gap-1.5 ${employee
              ? 'mb-3 overflow-x-auto pb-1 [scrollbar-width:thin] sm:mb-6 sm:flex-wrap sm:overflow-visible sm:pb-0'
              : 'mb-6 flex-wrap'
            }`}
          >
            {ACTIVITY_FILTERS.map((value) => (
              <button
                key={value}
                type="button"
                aria-pressed={kind === value}
                onClick={() => onKindChange(value)}
                className={`min-h-[44px] shrink-0 rounded-full px-4 py-2.5 text-[12.5px] font-bold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset lg:min-h-0 ${
                  kind === value
                    ? 'bg-primary text-primary-foreground focus-visible:ring-primary-foreground'
                    : 'border border-border bg-surface text-muted-foreground hover:bg-surface-raised focus-visible:ring-primary'
                }`}
              >
                {t(value === 'id_change' ? 'employees.idChangeActivity.label' : `employees.activity.${value}`)}
              </button>
            ))}
          </div>

          {activityQuery.isPending && (
            <div role="status" aria-label={t('employees.activity.loading')} className="space-y-3">
              <div className="h-16 rounded-xl bg-surface-raised motion-safe:animate-pulse" />
              <div className="h-16 rounded-xl bg-surface-raised motion-safe:animate-pulse" />
            </div>
          )}

          {activityQuery.isError && (
            <div className="rounded-2xl border border-destructive/30 bg-surface p-6 text-center">
              <p className="text-sm text-destructive">{t('employees.activity.loadError')}</p>
              <button
                type="button"
                onClick={() => void activityQuery.refetch()}
                className="mt-4 rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground hover:bg-primary-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
              >
                {t('employees.activity.retry')}
              </button>
            </div>
          )}

          {!activityQuery.isPending && !activityQuery.isError && items.length === 0 && (
            <div className="rounded-2xl border border-border bg-surface p-8 text-center">
              <p className="text-sm text-muted-foreground">
                {t(filtered ? 'employees.activity.emptyFiltered' : 'employees.activity.empty')}
              </p>
              {filtered && (
                <button
                  type="button"
                  onClick={onClearFilters}
                  className="mt-4 rounded-lg border border-border px-4 py-2 text-sm font-semibold text-foreground hover:bg-surface-raised focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                >
                  {t('employees.activity.clearFilters')}
                </button>
              )}
            </div>
          )}

          {!activityQuery.isPending && !activityQuery.isError && items.length > 0 && (
            <div className="overflow-hidden rounded-2xl border border-border bg-surface">
              {dayGroups.map((group) => (
                <div key={group.day}>
                  <h3 className="border-b border-hairline bg-surface-raised px-5 py-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground rtl:tracking-normal">
                    {group.day}
                  </h3>
                  {group.items.map((item) => (
                    <ActivityRow
                      key={`${item.kind}-${item.source_id}`}
                      item={item}
                      lang={lang}
                      dayFormatter={dayFormatter}
                      timeFormatter={timeFormatter}
                      joiningDateFormatter={joiningDateFormatter}
                      showEmployee={employee == null}
                      t={t}
                    />
                  ))}
                </div>
              ))}
              {activityQuery.hasNextPage && (
                <button
                  type="button"
                  onClick={() => void activityQuery.fetchNextPage()}
                  disabled={activityQuery.isFetchingNextPage}
                  className="mx-auto mt-6 block w-full rounded-lg border border-border px-4 py-2 text-sm font-semibold text-foreground hover:bg-surface-raised focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary disabled:cursor-wait disabled:opacity-60 md:w-auto"
                >
                  {t('employees.activity.loadMore')}
                </button>
              )}
            </div>
          )}
        </div>
      </div>
    </section>
  )
}

interface ActivityRowProps {
  item: EmployeeActivityItemRead
  lang: 'en' | 'ar'
  dayFormatter: Intl.DateTimeFormat
  timeFormatter: Intl.DateTimeFormat
  joiningDateFormatter: Intl.DateTimeFormat
  showEmployee: boolean
  t: (key: string, options?: Record<string, unknown>) => string
}

function ActivityRow({
  item,
  lang,
  dayFormatter,
  timeFormatter,
  joiningDateFormatter,
  showEmployee,
  t,
}: ActivityRowProps): React.JSX.Element {
  const employeeName = pickEmployeeName(
    { name_en: item.employee_name_en, name_ar: item.employee_name_ar },
    lang,
  )
  const isAdded = item.kind === 'employee_added'
  const showEmployeeColumn = showEmployee && !isAdded
  const initials = showEmployeeColumn
    ? employeeName.split(' ').filter(Boolean).slice(0, 2).map((word) => word[0]).join('').toUpperCase()
    : ''
  const addedStatus = isAdded ? EMPLOYEE_STATUSES.find((status) => status === item.status) : undefined
  const date = new Date(item.occurred_at)
  const action = isAdded || item.kind === 'duty_location' || item.kind === 'status' || item.kind === 'id_change'
    ? null
    : t(
        `employees.activity.actions.${item.kind}`,
        item.kind === 'leave' ? { title: item.title, days: item.days ?? 0 } : { title: item.title },
      )
  const destinationKey = {
    document: 'employees.activity.openDocument',
    leave: 'employees.activity.openLeave',
    violation: 'employees.activity.openViolation',
    ledger: 'employees.activity.openLedger',
    duty_location: 'employees.activity.openEmployeeActivity',
    status: 'employees.activity.statusEvent.openProfile',
    id_change: 'employees.activity.openEmployeeActivity',
    employee_added: 'employees.activity.openEmployeeActivity',
  }[item.kind]
  const kindStyle = KIND_STYLES[item.kind]

  return (
    <Link
      to={activityHref(item)}
      className="group flex items-center gap-2.5 border-b border-hairline px-3.5 py-3.5 last:border-b-0 hover:bg-surface-raised focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary sm:gap-3.5 sm:px-5"
    >
      <span aria-hidden className="grid h-9 w-9 shrink-0 place-items-center rounded-[11px]" style={{ background: kindStyle.soft, color: kindStyle.color }}>
        {kindStyle.icon}
      </span>
      <span className="min-w-0 flex-1">
        {isAdded ? (
          <>
            <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
              <span className="min-w-0 text-sm font-semibold text-foreground [overflow-wrap:anywhere]">
                {t(item.actor_name ? 'employees.activity.added.withActor' : 'employees.activity.added.sentence', {
                  name: bidi(employeeName),
                  id: bidi(item.employee_id),
                  ...(item.actor_name ? { actor: bidi(item.actor_name) } : {}),
                })}
              </span>
              {addedStatus && <StatusPill status={addedStatus} />}
            </span>
            {item.joining_date && (
              <time dateTime={item.joining_date} className="mt-1 block text-xs text-muted-foreground">
                {t(item.joining_date > todayIso() ? 'employees.activity.added.joins' : 'employees.activity.added.joined', {
                  date: joiningDateFormatter.format(new Date(`${item.joining_date}T00:00:00Z`)),
                })}
              </time>
            )}
          </>
        ) : item.kind === 'duty_location' ? (
          <DutyLocationActivity item={item} />
        ) : item.kind === 'status' ? (
          <StatusActivity item={item} />
        ) : item.kind === 'id_change' ? (
          <>
            <span className="block text-sm font-semibold text-foreground">{t('employees.idChangeActivity.sentence', { reference: item.reference, title: item.title })}</span>
            {item.reason && <span className="mt-0.5 block text-xs text-muted-foreground">{t('employees.idChangeActivity.reason')}: <bdi dir="auto">{item.reason}</bdi></span>}
            {item.actor_name && <span className="mt-0.5 block text-xs text-muted-foreground">{t('employees.idChangeActivity.actor', { actor: bidi(item.actor_name) })}</span>}
          </>
        ) : (
          <>
            <span dir="auto" className="block truncate text-sm font-semibold text-foreground">{item.title}</span>
            <span dir="auto" className="mt-0.5 block truncate text-xs text-muted-foreground">{action}{item.detail ? ` · ${item.detail}` : ''}</span>
          </>
        )}
      </span>
      {showEmployeeColumn && (
        <span className="hidden w-[210px] shrink-0 items-center gap-2.5 md:flex">
          <span aria-hidden className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-primary-soft text-[10.5px] font-bold text-primary-on-soft">{initials}</span>
          <span className="min-w-0">
            <span dir="auto" className="block truncate text-[13px] font-semibold text-foreground">{employeeName}</span>
            <span dir="auto" className="block font-mono text-[11px] text-faint">{item.employee_id}</span>
          </span>
        </span>
      )}
      {!isAdded && <span dir="auto" className="hidden shrink-0 font-mono text-xs tabular-nums text-muted-foreground sm:block">{item.reference}</span>}
      <span className="shrink-0 text-end text-xs tabular-nums text-muted-foreground sm:w-[84px]">
        <span className="sr-only">{dayFormatter.format(date)} · </span>{timeFormatter.format(date)}
      </span>
      <span className="sr-only">{t(destinationKey)}</span>
    </Link>
  )
}

