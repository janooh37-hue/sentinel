import { useInfiniteQuery, useQueryClient } from '@tanstack/react-query'
import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Link } from 'react-router-dom'
import { EmployeeActivityLookup } from './EmployeeActivityLookup'
import { api, type EmployeeActivityItemRead, type EmployeeActivityKind, type EmployeeListItem } from '@/lib/api'
import { pickEmployeeName } from '@/lib/employeeName'

const PAGE_SIZE = 25

export function activityHref(item: EmployeeActivityItemRead): string {
  switch (item.kind) {
    case 'document':
      return `/books?open=${item.target_id}`
    case 'leave':
      return `/leaves?open=${item.source_id}`
    case 'violation':
      return `/employees/${encodeURIComponent(item.employee_id)}?tab=violations&open=${item.source_id}`
    case 'ledger':
      return `/ledger?open=${item.source_id}`
  }
}

export interface EmployeeActivitySectionProps {
  onOpenProfile: (employeeId: string) => void
}

export function EmployeeActivitySection({ onOpenProfile }: EmployeeActivitySectionProps): React.JSX.Element {
  const { t, i18n } = useTranslation()
  const lang = i18n.language.startsWith('ar') ? 'ar' : 'en'
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
  const dateTimeFormatter = useMemo(
    () => new Intl.DateTimeFormat(lang, { dateStyle: 'medium', timeStyle: 'short' }),
    [lang],
  )
  const items = activityQuery.data?.pages.flatMap((page) => page.items) ?? []
  const total = activityQuery.data?.pages[0]?.total ?? 0
  const filtered = employee != null || kind !== 'all'

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

        <div className="mb-6 grid gap-3 md:grid-cols-[minmax(0,1fr)_220px] md:items-end">
          <div>
            <p className="mb-2 text-sm font-semibold text-foreground">{t('employees.activity.lookupLabel')}</p>
            <EmployeeActivityLookup
              selected={employee}
              onSelect={handleEmployeeSelect}
              onClear={handleClearEmployee}
              onOpenProfile={onOpenProfile}
            />
          </div>
          <div>
            <label htmlFor="employee-activity-type" className="mb-2 block text-sm font-semibold text-foreground">
              {t('employees.activity.typeLabel')}
            </label>
            <select
              id="employee-activity-type"
              onChange={(event) => handleKindChange(event.target.value as EmployeeActivityKind | 'all')}
              value={kind}
              className="w-full rounded-xl border border-border bg-surface px-3 py-3 text-sm text-foreground outline-none focus-visible:ring-2 focus-visible:ring-primary"
            >
              <option value="all">{t('employees.activity.all')}</option>
              <option value="document">{t('employees.activity.document')}</option>
              <option value="leave">{t('employees.activity.leave')}</option>
              <option value="violation">{t('employees.activity.violation')}</option>
              <option value="ledger">{t('employees.activity.ledger')}</option>
            </select>
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
              className="mt-4 rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-white hover:bg-primary-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
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
          <>
            <div className="overflow-hidden rounded-2xl border border-border bg-surface">
              <div className="hidden grid-cols-[minmax(160px,1fr)_minmax(180px,1.2fr)_minmax(150px,1fr)_minmax(130px,1fr)_minmax(160px,1fr)_minmax(150px,1fr)] gap-4 border-b border-hairline px-5 py-3 text-xs font-semibold uppercase tracking-wide text-muted-foreground md:grid">
                <span>{t('employees.activity.employee')}</span>
                <span>{t('employees.activity.activity')}</span>
                <span>{t('employees.activity.type')}</span>
                <span>{t('employees.activity.reference')}</span>
                <span>{t('employees.activity.destination')}</span>
                <span>{t('employees.activity.dateTime')}</span>
              </div>
              {items.map((item) => <ActivityRow key={`${item.kind}-${item.source_id}`} item={item} lang={lang} dayFormatter={dayFormatter} dateTimeFormatter={dateTimeFormatter} t={t} />)}
            </div>
            
            {activityQuery.hasNextPage && (
              <button
                type="button"
                onClick={() => void activityQuery.fetchNextPage()}
                disabled={activityQuery.isFetchingNextPage}
                className="mx-auto mt-6 block rounded-lg border border-border px-4 py-2 text-sm font-semibold text-foreground hover:bg-surface-raised focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary disabled:cursor-wait disabled:opacity-60"
              >
                {t('employees.activity.loadMore')}
              </button>
            )}
          </>
        )}
      </div>
    </section>
  )
}

interface ActivityRowProps {
  item: EmployeeActivityItemRead
  lang: 'en' | 'ar'
  dayFormatter: Intl.DateTimeFormat
  dateTimeFormatter: Intl.DateTimeFormat
  t: (key: string, options?: Record<string, unknown>) => string
}

function ActivityRow({ item, lang, dayFormatter, dateTimeFormatter, t }: ActivityRowProps): React.JSX.Element {
  const employeeName = pickEmployeeName(
    { name_en: item.employee_name_en, name_ar: item.employee_name_ar },
    lang,
  )
  const date = new Date(item.occurred_at)
  const actionKey = `employees.activity.actions.${item.kind}`
  const actionOptions = item.kind === 'leave' ? { title: item.title, days: item.days ?? 0 } : { title: item.title }
  const action = t(actionKey, actionOptions)
  const destinationKey = {
    document: 'employees.activity.openDocument',
    leave: 'employees.activity.openLeave',
    violation: 'employees.activity.openViolation',
    ledger: 'employees.activity.openLedger',
  }[item.kind]

  return (
    <Link
      to={activityHref(item)}
      className="group block border-b border-hairline px-5 py-4 last:border-b-0 hover:bg-surface-raised focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary"
    >
      <div className="md:grid md:grid-cols-[minmax(160px,1fr)_minmax(180px,1.2fr)_minmax(150px,1fr)_minmax(130px,1fr)_minmax(160px,1fr)_minmax(150px,1fr)] md:items-center md:gap-4">
        <div className="min-w-0">
          <p dir="auto" className="truncate text-sm font-semibold text-foreground">{employeeName}</p>
          <p dir="auto" className="mt-1 font-mono tabular-nums text-xs text-muted-foreground">{item.employee_id}</p>
        </div>
        <div className="mt-3 min-w-0 md:mt-0">
          <p dir="auto" className="truncate text-sm font-semibold text-foreground">{item.title}</p>
          <p dir="auto" className="mt-1 truncate text-xs text-muted-foreground">{action}</p>
          {item.detail && <p dir="auto" className="mt-1 truncate text-xs text-muted-foreground">{item.detail}</p>}
        </div>
        <div className="mt-3 text-xs text-muted-foreground md:mt-0">{t(`employees.activity.${item.kind}`)}</div>
        <div dir="auto" className="mt-3 font-mono tabular-nums text-xs text-muted-foreground md:mt-0">{item.reference}</div>
        <div className="mt-3 text-sm font-semibold text-primary md:mt-0">{t(destinationKey)}</div>
        <div className="mt-3 text-xs text-muted-foreground md:mt-0">
          <span className="sr-only">{dayFormatter.format(date)} · </span>{dateTimeFormatter.format(date)}
        </div>
      </div>
    </Link>
  )
}

