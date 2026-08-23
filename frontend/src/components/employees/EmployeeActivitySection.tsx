import { useInfiniteQuery, useQueryClient } from '@tanstack/react-query'
import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Link } from 'react-router-dom'
import { toast } from 'sonner'
import { EmployeeBadgeCard } from './EmployeeBadgeCard'
import { EmployeeActivityLookup } from './EmployeeActivityLookup'
import { api, type EmployeeActivityItemRead, type EmployeeActivityKind, type EmployeeListItem } from '@/lib/api'
import { openCorrespondenceInOutlook, outlookBridgeErrorMessage } from '@/lib/outlookBridge'
import { useIsMobile } from '@/lib/useIsMobile'
import { pickEmployeeName } from '@/lib/employeeName'
const PAGE_SIZE = 25

const KIND_STYLES: Record<EmployeeActivityKind, { soft: string; color: string; icon: React.JSX.Element }> = {
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
}

function activityHref(item: EmployeeActivityItemRead): string {
  switch (item.kind) {
    case 'document':
      return `/books?open=${item.target_id}`
    case 'leave':
      return `/leaves?open=${item.source_id}`
    case 'violation':
      return `/employees/${encodeURIComponent(item.employee_id)}?tab=violations&open=${item.source_id}`
    case 'ledger':
      return `/employees/${encodeURIComponent(item.employee_id)}?tab=correspondence`
  }
}

export interface EmployeeActivitySectionProps {
  onOpenProfile: (employeeId: string) => void
}
export function EmployeeActivitySection({ onOpenProfile }: EmployeeActivitySectionProps): React.JSX.Element {
  const { t, i18n } = useTranslation()
  const lang = i18n.language.startsWith('ar') ? 'ar' : 'en'
  const isMobile = useIsMobile()
  const queryClient = useQueryClient()
  const [employee, setEmployee] = useState<EmployeeListItem | null>(null)
  const [kind, setKind] = useState<EmployeeActivityKind | 'all'>('all')

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
  })

  const dayFormatter = useMemo(
    () => new Intl.DateTimeFormat(lang, { dateStyle: 'medium' }),
    [lang],
  )
  const timeFormatter = useMemo(
    () => new Intl.DateTimeFormat(lang, { timeStyle: 'short' }),
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

  function removeDestinationCache(employeeId: string | null, nextKind: EmployeeActivityKind | 'all'): void {
    queryClient.removeQueries({
      queryKey: ['employee-activity', employeeId, nextKind],
      exact: true,
    })
  }

  function handleEmployeeSelect(nextEmployee: EmployeeListItem): void {
    removeDestinationCache(nextEmployee.id, kind)
    setEmployee(nextEmployee)
  }

  function handleClearEmployee(): void {
    removeDestinationCache(null, kind)
    setEmployee(null)
  }

  function handleKindChange(nextKind: EmployeeActivityKind | 'all'): void {
    removeDestinationCache(employee?.id ?? null, nextKind)
    setKind(nextKind)
  }

  function clearFilters(): void {
    removeDestinationCache(null, 'all')
    setEmployee(null)
    setKind('all')
  }

  return (
    <section className="w-full border-y border-hairline bg-background px-4 py-8 md:px-8 lg:py-10" aria-labelledby="employee-activity-title">
      <div className="mx-auto w-full max-w-[1440px]">
        <header className="mb-6 flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.16em] text-primary">{t('employees.activity.eyebrow')}</p>
            <h2 id="employee-activity-title" className="mt-2 text-2xl font-bold tracking-tight text-foreground md:text-3xl">{t('employees.activity.title')}</h2>
            <p className="mt-2 max-w-2xl text-sm text-muted-foreground">{t('employees.activity.subtitle')}</p>
          </div>
          {!activityQuery.isPending && !activityQuery.isError && (
            <p className="text-sm font-medium text-muted-foreground">
              {t('employees.activity.resultCount', { count: total })} · {t('employees.activity.showing', { shown: items.length, total })}
            </p>
          )}
        </header>

        <div className={employee ? 'grid gap-8 lg:grid-cols-[340px_minmax(0,1fr)] lg:items-start' : ''}>
          {employee && (
            <EmployeeBadgeCard employee={employee} onOpenProfile={onOpenProfile} onClear={handleClearEmployee} />
          )}
          <div className="min-w-0">
            <div className="mb-6 flex flex-wrap items-center gap-2.5">
              <EmployeeActivityLookup onSelect={handleEmployeeSelect} onOpenProfile={onOpenProfile} />
              <div role="group" aria-label={t('employees.activity.typeLabel')} className="flex flex-wrap gap-1.5">
                {(['all', 'document', 'leave', 'violation', 'ledger'] as const).map((value) => (
                  <button
                    key={value}
                    type="button"
                    aria-pressed={kind === value}
                    onClick={() => handleKindChange(value)}
                    className={
                      kind === value
                        ? 'rounded-full bg-primary px-4 py-2.5 text-[12.5px] font-bold text-primary-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2'
                        : 'rounded-full border border-border bg-surface px-4 py-2.5 text-[12.5px] font-bold text-muted-foreground hover:bg-surface-raised focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary'
                    }
                  >
                    {t(value === 'all' ? 'employees.activity.all' : `employees.activity.${value === 'ledger' ? 'correspondence' : value}`)}
                  </button>
                ))}
              </div>
            </div>

            {activityQuery.isPending && (
              <div role="status" aria-label={t('employees.activity.loading')} className="space-y-3">
                <div className="h-16 animate-pulse rounded-xl bg-surface-raised" />
                <div className="h-16 animate-pulse rounded-xl bg-surface-raised" />
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
                    onClick={clearFilters}
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
                    <h3 className="border-b border-hairline bg-surface-raised px-5 py-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                      {group.day}
                    </h3>
                    {group.items.map((item) => (
                      <ActivityRow
                        key={`${item.kind}-${item.source_id}`}
                        item={item}
                        lang={lang}
                        dayFormatter={dayFormatter}
                        timeFormatter={timeFormatter}
                        showEmployee={employee == null}
                        isMobile={isMobile}
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
      </div>
    </section>
  )
}
interface ActivityRowProps {
  item: EmployeeActivityItemRead
  lang: 'en' | 'ar'
  dayFormatter: Intl.DateTimeFormat
  timeFormatter: Intl.DateTimeFormat
  showEmployee: boolean
  isMobile: boolean
  t: (key: string, options?: Record<string, unknown>) => string
}

function ActivityRow({
  item,
  lang,
  dayFormatter,
  timeFormatter,
  showEmployee,
  isMobile,
  t,
}: ActivityRowProps): React.JSX.Element {
  const employeeName = pickEmployeeName(
    { name_en: item.employee_name_en, name_ar: item.employee_name_ar },
    lang,
  )
  const initials = employeeName
    .split(' ')
    .filter(Boolean)
    .slice(0, 2)
    .map((word) => word[0])
    .join('')
    .toUpperCase()
  const date = new Date(item.occurred_at)
  const translationKind = item.kind === 'ledger' ? 'correspondence' : item.kind
  const actionKey = `employees.activity.actions.${translationKind}`
  const actionOptions = item.kind === 'leave' ? { title: item.title, days: item.days ?? 0 } : { title: item.title }
  const action = t(actionKey, actionOptions)
  const isEmailLedger = item.kind === 'ledger' && item.channel === 'email' && item.can_open_in_outlook !== false
  const destinationKey =
    item.kind === 'ledger' && !isEmailLedger
      ? 'employees.activity.readOnly'
      : {
          document: 'employees.activity.openDocument',
          leave: 'employees.activity.openLeave',
          violation: 'employees.activity.openViolation',
          ledger: 'employees.activity.openCorrespondence',
        }[item.kind]
  const kindStyle = KIND_STYLES[item.kind]

  const rowContent = (
    <>
      <span aria-hidden className="grid h-9 w-9 shrink-0 place-items-center rounded-[11px]" style={{ background: kindStyle.soft, color: kindStyle.color }}>
        {kindStyle.icon}
      </span>
      <span className="min-w-0 flex-1">
        <span dir="auto" className="block truncate text-sm font-semibold text-foreground">{item.title}</span>
        <span dir="auto" className="mt-0.5 block truncate text-xs text-muted-foreground">{action}{item.detail ? ` · ${item.detail}` : ''}</span>
      </span>
      {showEmployee && (
        <span className="hidden w-[210px] shrink-0 items-center gap-2.5 md:flex">
          <span aria-hidden className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-primary-soft text-[10.5px] font-bold text-primary-on-soft">{initials}</span>
          <span className="min-w-0">
            <span dir="auto" className="block truncate text-[13px] font-semibold text-foreground">{employeeName}</span>
            <span dir="auto" className="block font-mono text-[11px] text-faint">{item.employee_id}</span>
          </span>
        </span>
      )}
      <span dir="auto" className="hidden shrink-0 font-mono text-xs tabular-nums text-muted-foreground sm:block">{item.reference}</span>
      <span className="w-[84px] shrink-0 text-end text-xs tabular-nums text-muted-foreground">
        <span className="sr-only">{dayFormatter.format(date)} · </span>{timeFormatter.format(date)}
      </span>
      {isEmailLedger && isMobile && (
        <span className="sr-only">{t('employees.activity.desktopRequired')}</span>
      )}
      <span className="sr-only">{t(destinationKey)}</span>
    </>
  )
  const rowClass = 'group flex items-center gap-3.5 border-b border-hairline px-5 py-3.5 last:border-b-0 hover:bg-surface-raised focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary'
  if (isEmailLedger) {
    return (
      <button
        type="button"
        disabled={isMobile}
        className={`${rowClass} w-full text-start disabled:cursor-not-allowed disabled:opacity-60`}
        onClick={() => {
          if (isMobile) return
          void openCorrespondenceInOutlook(item.source_id, item.employee_id).catch((error: unknown) => {
            toast.error(outlookBridgeErrorMessage(error, t))
          })
        }}
      >
        {rowContent}
      </button>
    )
  }
  if (item.kind === 'ledger') {
    return <div className={rowClass} aria-disabled="true">{rowContent}</div>
  }
  return (
    <Link to={activityHref(item)} className={rowClass}>
      {rowContent}
    </Link>
  )
}

