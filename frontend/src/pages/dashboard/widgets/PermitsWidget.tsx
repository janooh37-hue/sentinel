import { Link } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'

import { api, type ItemPermitSummary, type PermitDerivedStatus, type PermitZone } from '@/lib/api'
import { WidgetFrame } from '@/components/dashboard/WidgetFrame'
import { useFitCount } from '@/components/dashboard/useFitCount'
import { Skeleton } from '@/components/ui/skeleton'
import { useCapabilities } from '@/lib/useCapabilities'
import { useLocalStorage } from '@/lib/useLocalStorage'
import { cn } from '@/lib/utils'
import type { WidgetProps } from './types'

type ZoneFilter = 'all' | PermitZone
const ZONES: ZoneFilter[] = ['all', 'red', 'green', 'work_residence']
const STATUSES: PermitDerivedStatus[] = ['active', 'expiring', 'expired', 'revoked']
const APPROVALS: (keyof ItemPermitSummary)[] = ['none', 'pending', 'awaiting_scan', 'approved', 'returned', 'rejected']
const linkCls = 'rounded-sm text-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring'

export function PermitsWidget({ tier, rows }: WidgetProps): React.JSX.Element {
  const { t, i18n } = useTranslation()
  const { has } = useCapabilities()
  const canView = has('permits.view')
  const [stored, setZone] = useLocalStorage<ZoneFilter>('gssg.dashboard.permitsZone', 'all')
  const selected = ZONES.includes(stored) ? stored : 'all'
  const zone = selected === 'all' ? undefined : selected
  const showList = tier === 'list'
  const limit = Math.max(1, rows)
  const params = { zone, limit }
  const to = (values: Record<string, string> = {}): string => {
    const search = new URLSearchParams(values)
    if (zone) search.set('zone', zone)
    return `/permits${search.size ? `?${search}` : ''}`
  }
  const summaryQuery = useQuery({
    queryKey: zone ? ['permits-summary', zone] : ['permits-summary'],
    queryFn: () => api.permitsSummary(zone),
    enabled: canView,
    staleTime: 60_000,
  })
  const itemSummaryQuery = useQuery({
    queryKey: ['item-permits-summary', zone],
    queryFn: () => api.itemPermitsSummary(zone),
    enabled: canView,
    staleTime: 60_000,
  })
  const latestQuery = useQuery({
    queryKey: ['permits-list', params],
    queryFn: () => api.listPermits(params),
    enabled: canView && showList,
    staleTime: 60_000,
  })
  const latestItemsQuery = useQuery({
    queryKey: ['item-permits-list', params],
    queryFn: () => api.listItemPermits(params),
    enabled: canView && showList,
    staleTime: 60_000,
  })
  const queries = showList
    ? [summaryQuery, itemSummaryQuery, latestQuery, latestItemsQuery]
    : [summaryQuery, itemSummaryQuery]
  const summary = summaryQuery.data
  const itemSummary = itemSummaryQuery.data
  const itemTotal = itemSummary ? APPROVALS.reduce((total, state) => total + itemSummary[state], 0) : 0
  const securityTotal = summary ? summary.active + summary.expiring + summary.expired + summary.revoked : 0
  const latest = [
    ...(latestQuery.data?.items ?? []).map((row) => ({
      key: `security-${row.id}`,
      created: row.created_at,
      to: to({ preview: String(row.id) }),
      ref: row.permit_no ?? `#${row.id}`,
      name: row.company,
      status: t(`permits.status.${row.derived_status}`),
      kind: 'security',
    })),
    ...(latestItemsQuery.data?.items ?? []).map((row) => ({
      key: `item-${row.id}`,
      created: row.created_at,
      to: to({ tab: 'items', itemPreview: String(row.id) }),
      ref: row.book_ref ?? `#${row.id}`,
      name: i18n.language.startsWith('ar') ? row.employee_name : row.employee_name_en,
      status: row.approval_state === 'awaiting_scan'
        ? t('dashboard.widgets.permits.awaitingScan')
        : t(`permits.approval.${row.approval_state ?? 'none'}`),
      kind: 'items',
    })),
  ].sort((a, b) => b.created.localeCompare(a.created))
  const { listRef, visibleCount } = useFitCount(Math.min(latest.length, rows))
  const visible = latest.slice(0, visibleCount)
  const securityRemaining = Math.max(0, (latestQuery.data?.total ?? 0) - visible.filter((row) => row.kind === 'security').length)
  const itemsRemaining = Math.max(0, (latestItemsQuery.data?.total ?? 0) - visible.filter((row) => row.kind === 'items').length)

  return (
    <WidgetFrame title={t('dashboard.widgets.permits.title')} viewAllTo={to()}>
      <select
        aria-label={t('permits.filters.zone')}
        value={selected}
        onChange={(event) => setZone(event.target.value as ZoneFilter)}
        className="mb-1 h-6 w-full shrink-0 rounded-sm border border-border bg-surface text-[0.65em] text-foreground"
      >
        {ZONES.map((option) => (
          <option key={option} value={option}>
            {option === 'all' ? t('permits.filters.all') : t(`permits.zone.${option}`)}
          </option>
        ))}
      </select>
      {!canView ? (
        <p className="text-[0.75em] text-muted-foreground">{t('dashboard.widgets.permits.noAccess')}</p>
      ) : queries.some((query) => query.isError) ? (
        <div role="alert" className="text-[0.75em] text-muted-foreground">
          <p>{t('common.loadError')}</p>
          <button type="button" className={linkCls} onClick={() => queries.forEach((query) => void query.refetch())}>
            {t('common.retry')}
          </button>
        </div>
      ) : queries.some((query) => query.isPending) ? (
        <div role="status" aria-label={t('common.loading')} className="flex min-h-0 flex-1 flex-col gap-2">
          <Skeleton className="h-7 w-1/2" />
          <Skeleton className="h-4 w-full" />
        </div>
      ) : securityTotal + itemTotal === 0 ? (
        <Link className={cn(linkCls, 'text-[0.75em]')} to={to()}>{t('dashboard.widgets.permits.empty')}</Link>
      ) : tier === 'glance' ? (
        <div className="flex min-h-0 flex-1 flex-col justify-between gap-1">
          <Link to={to({ state: 'active' })} className={cn(linkCls, 'text-foreground')}>
            <b className="font-mono text-[1.65em] leading-none tabular-nums">{summary?.active}</b>{' '}
            <span className="text-[0.7em]">{t('permits.summary.active')}</span>
          </Link>
          <div className="flex flex-wrap justify-between gap-x-2 text-[0.65em]">
            <Link to={to({ state: 'expiring' })} className={cn(linkCls, 'text-warning')}>
              {summary?.expiring} {t('permits.summary.expiring')}
            </Link>
            <Link to={to({ tab: 'items' })} className={linkCls}>{t('dashboard.widgets.permits.itemCount', { count: itemTotal })}</Link>
          </div>
        </div>
      ) : (
        <>
          <div className={cn('grid shrink-0 gap-1', tier === 'tall' ? 'grid-cols-1' : 'grid-cols-2 gap-x-3')}>
            <div role="group" aria-label={t('permits.tabs.security')} className="grid grid-cols-2 gap-x-2 gap-y-0.5">
              {STATUSES.map((state) => (
                <Link key={state} to={to({ state })} className={cn(linkCls, 'flex min-w-0 items-baseline gap-1 text-[0.65em]')}>
                  <b className="font-mono text-[1.25em] tabular-nums">{summary?.[state]}</b>
                  <span className="truncate">{t(`permits.summary.${state}`)}</span>
                </Link>
              ))}
            </div>
            <div role="group" aria-label={t('permits.tabs.items')} className="grid grid-cols-2 gap-x-2 gap-y-0.5 border-s border-hairline ps-2">
              {APPROVALS.map((state) => (
                <Link key={state} to={to({ tab: 'items', istatus: state })} className={cn(linkCls, 'flex min-w-0 items-baseline gap-1 text-[0.6em]')}>
                  <b className="font-mono text-[1.25em] tabular-nums">{itemSummary?.[state]}</b>
                  <span className="truncate">{state === 'awaiting_scan' ? t('dashboard.widgets.permits.awaitingScan') : t(`permits.approval.${state}`)}</span>
                </Link>
              ))}
            </div>
          </div>
          {showList && (
            <div className="mt-2 flex min-h-0 flex-1 flex-col border-t border-hairline pt-1">
              <h4 className="shrink-0 text-[0.65em] text-muted-foreground">{t('dashboard.widgets.permits.latestEntries')}</h4>
              <ul ref={listRef} className="min-h-0 flex-1 overflow-hidden">
                {visible.map((row) => (
                  <li key={row.key}>
                    <Link to={row.to} className="flex min-w-0 items-center gap-2 rounded-sm py-1 text-[0.7em] hover:bg-surface-tinted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                      <bdi className="shrink-0 font-mono text-[0.85em]">{row.ref}</bdi>
                      <bdi className="min-w-0 flex-1 truncate">{row.name}</bdi>
                      <span className="shrink-0 text-[0.85em] text-muted-foreground">{row.status}</span>
                    </Link>
                  </li>
                ))}
              </ul>
              <div className="flex shrink-0 flex-wrap justify-between gap-x-2 text-[0.65em]">
                {securityRemaining > 0 && <Link to={to()} className={linkCls}>{t('dashboard.widgets.permits.moreSecurity', { count: securityRemaining })}</Link>}
                {itemsRemaining > 0 && <Link to={to({ tab: 'items' })} className={linkCls}>{t('dashboard.widgets.permits.moreItems', { count: itemsRemaining })}</Link>}
              </div>
            </div>
          )}
        </>
      )}
    </WidgetFrame>
  )
}
