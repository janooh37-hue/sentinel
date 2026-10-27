/**
 * PermitsWidget: zone-scoped security and item permit counts plus the latest
 * entries of each register.
 *
 * Every tier renders the compact view; an extra-large box (≥3 columns × ≥3
 * rows) renders the two-pane panel: security and item registers side by side,
 * each with linked count tiles and its own fitted latest-entries list.
 */
import { useId } from 'react'
import { Link } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'

import {
  api,
  type ItemPermitRead,
  type ItemPermitSummary,
  type PermitDerivedStatus,
  type PermitListItem,
  type PermitZone,
} from '@/lib/api'
import { WidgetEmpty, WidgetFrame, WIDGET_SUPPORT } from '@/components/dashboard/WidgetFrame'
import { useFitCount } from '@/components/dashboard/useFitCount'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import { useCapabilities } from '@/lib/useCapabilities'
import { useLocalStorage } from '@/lib/useLocalStorage'
import { cn } from '@/lib/utils'
import { PermitAccessBadge } from '@/pages/permits/PermitAccessBadge'
import { approvalTone, permitWindow, statusTone, zoneTone, type Tone } from '@/pages/permits/permitUtils'
import { useDashboardRuntime } from './dashboardWidgetContext'
import type { WidgetProps } from './types'

type ZoneFilter = 'all' | PermitZone
type ApprovalKey = keyof ItemPermitSummary
const ZONES: ZoneFilter[] = ['all', 'red', 'green', 'work_residence']
const STATUSES: PermitDerivedStatus[] = ['active', 'expiring', 'expired', 'revoked']
const APPROVALS: ApprovalKey[] = ['none', 'pending', 'awaiting_scan', 'approved', 'returned', 'rejected']
const linkCls = 'rounded-sm text-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring'

const toneCls: Record<Tone, string> = {
  active: 'text-success',
  warning: 'text-warning',
  danger: 'text-destructive',
  info: 'text-info',
  neutral: 'text-foreground',
  outline: 'text-foreground',
}
const zoneDotCls: Record<PermitZone, string> = { red: 'bg-destructive', green: 'bg-success', work_residence: 'bg-info' }
const rowCls =
  'flex min-w-0 flex-col gap-0.5 rounded-lg px-1.5 py-1.5 text-start transition-colors hover:bg-surface-tinted focus-visible:bg-surface-tinted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring motion-reduce:transition-none'

interface Tile { key: string; label: string; count: number | undefined; tone: Tone; to: string }

function Tiles({ tiles, className }: { tiles: Tile[]; className: string }): React.JSX.Element {
  return (
    <ul className={cn('grid shrink-0 gap-1.5', className)}>
      {tiles.map((tile) => (
        <li key={tile.key} className="min-w-0">
          <Link
            to={tile.to}
            title={`${tile.count} ${tile.label}`}
            className="flex h-full min-w-0 flex-col items-start rounded-xl border border-border bg-surface px-2.5 py-1.5 text-start transition-colors hover:border-border-strong focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring motion-reduce:transition-none"
          >
            <bdi className={cn('font-mono text-[1.3em] font-bold leading-tight tabular-nums', toneCls[tile.tone])}>{tile.count}</bdi>
            <span className="w-full truncate text-[0.68em] leading-tight text-muted-foreground">{tile.label}</span>
          </Link>
        </li>
      ))}
    </ul>
  )
}

/** One register's latest entries: whole rows that fit, then that register's remainder. */
function LatestPane<T extends { id: number }>({ rows, total, empty, more, moreTo, render }: {
  rows: T[]
  total: number
  empty: string
  more: (count: number) => string
  moreTo: string
  render: (row: T) => React.JSX.Element
}): React.JSX.Element {
  const { t } = useTranslation()
  const { listRef, visibleCount } = useFitCount(rows.length)
  const remaining = Math.max(0, total - visibleCount)
  return (
    <div className="mt-2 flex min-h-0 flex-1 flex-col border-t border-hairline pt-1.5">
      <h5 className="shrink-0 px-1.5 text-[0.65em] text-muted-foreground">{t('dashboard.widgets.permits.latestEntries')}</h5>
      {rows.length === 0 ? (
        <p className="px-1.5 py-2 text-[0.7em] text-muted-foreground">{empty}</p>
      ) : (
        <ul ref={listRef} className="min-h-0 flex-1 overflow-hidden">
          {rows.slice(0, visibleCount).map((row) => <li key={row.id}>{render(row)}</li>)}
        </ul>
      )}
      {remaining > 0 && <Link to={moreTo} className={cn(linkCls, 'shrink-0 self-start px-1.5 text-[0.65em]')}>{more(remaining)}</Link>}
    </div>
  )
}

function SecurityRow({ row, to }: { row: PermitListItem; to: string }): React.JSX.Element {
  const { t, i18n } = useTranslation()
  const { remaining } = permitWindow(t, i18n.language, row)
  return (
    <Link to={to} className={rowCls}>
      <span className="flex min-w-0 items-center justify-between gap-2">
        <bdi className="truncate text-[0.78em] font-medium text-foreground">{row.company}</bdi>
        <Badge tone={statusTone(row.derived_status)}>{t(`permits.status.${row.derived_status}`)}</Badge>
      </span>
      <span className="flex min-w-0 items-center gap-2 text-[0.65em] text-muted-foreground">
        <bdi dir="ltr" className="shrink-0 font-mono">{row.permit_no ?? `#${row.id}`}</bdi>
        <PermitAccessBadge accessAreas={row.access_areas} zones={row.zones} square />
        {/* Expired/revoked: the status badge already says it. */}
        {remaining && (row.derived_status === 'active' || row.derived_status === 'expiring') && <span className="truncate">{remaining}</span>}
      </span>
    </Link>
  )
}

function ItemRow({ row, to }: { row: ItemPermitRead; to: string }): React.JSX.Element {
  const { t, i18n } = useTranslation()
  const isAr = i18n.language.startsWith('ar')
  const approval = (row.approval_state ?? 'none') as ApprovalKey
  return (
    <Link to={to} className={rowCls}>
      <span className="flex min-w-0 items-center justify-between gap-2">
        <bdi className="truncate text-[0.78em] font-medium text-foreground">{isAr ? row.employee_name : row.employee_name_en}</bdi>
        <Badge tone={approval === 'awaiting_scan' ? 'warning' : approvalTone(approval)}>
          {approval === 'awaiting_scan' ? t('dashboard.widgets.permits.awaitingScan') : t(`permits.approval.${approval}`)}
        </Badge>
      </span>
      <span className="flex min-w-0 items-center gap-2 text-[0.65em] text-muted-foreground">
        <span className="shrink-0 font-medium">{t('permits.items.count', { count: row.items.length })}</span>
        <span className="min-w-0 truncate" dir="auto">{row.items.map((item) => item.name).join(isAr ? '، ' : ', ')}</span>
        <span className="ms-auto flex shrink-0 gap-1">
          {row.zones.map((z) => <Badge key={z} tone={zoneTone(z)} shape="square">{t(`permits.zone.${z}Short`)}</Badge>)}
        </span>
      </span>
    </Link>
  )
}

export function PermitsWidget({ tier, rows }: WidgetProps): React.JSX.Element {
  const { t, i18n } = useTranslation()
  const { has } = useCapabilities()
  const canView = has('permits.view')
  const { box } = useDashboardRuntime()
  const panel = tier === 'list' && box.w >= 3 && box.h >= 3
  const paneId = useId()
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
    <WidgetFrame title={t('dashboard.widgets.permits.title')} viewAllTo={to()} compact={tier === 'glance'}>
      {panel ? (
        <div
          role="group"
          aria-label={t('permits.filters.zone')}
          className="mb-2 flex w-fit shrink-0 gap-0.5 rounded-lg border border-border bg-surface-tinted p-0.5 [[data-theme=dark]_&]:bg-background"
        >
          {ZONES.map((option) => (
            <button
              key={option}
              type="button"
              aria-pressed={option === selected}
              title={option === 'all' ? undefined : t(`permits.zone.${option}`)}
              onClick={() => setZone(option)}
              className={cn(
                'inline-flex min-h-7 items-center gap-1.5 whitespace-nowrap rounded-md px-2.5 text-[0.7em] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring motion-reduce:transition-none',
                option === selected
                  ? 'bg-surface font-semibold text-primary shadow-sm [[data-theme=dark]_&]:bg-surface-tinted [[data-theme=dark]_&]:text-foreground'
                  : 'text-muted-foreground hover:text-foreground',
              )}
            >
              {option !== 'all' && <span aria-hidden className={cn('size-2 shrink-0 rounded-full', zoneDotCls[option])} />}
              {option === 'all' ? t('permits.filters.all') : t(`permits.zone.${option}Short`)}
            </button>
          ))}
        </div>
      ) : (
        <select
          aria-label={t('permits.filters.zone')}
          value={selected}
          onChange={(event) => setZone(event.target.value as ZoneFilter)}
          className="mb-1 h-6 w-full shrink-0 rounded-sm border border-border bg-surface text-[0.75em] text-foreground"
        >
          {ZONES.map((option) => (
            <option key={option} value={option}>
              {option === 'all' ? t('permits.filters.all') : t(`permits.zone.${option}`)}
            </option>
          ))}
        </select>
      )}
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
        <WidgetEmpty message={t('dashboard.widgets.permits.empty')} to={to()} action={t('dashboard.widgets.permits.emptyAction')} />
      ) : panel ? (
        <div className="grid min-h-0 flex-1 grid-cols-2 gap-4">
          <section aria-labelledby={`${paneId}-security`} className="flex min-h-0 min-w-0 flex-col">
            <h4 id={`${paneId}-security`} className="mb-1.5 shrink-0 text-[0.7em] font-medium text-muted-foreground">{t('permits.tabs.security')}</h4>
            <Tiles
              className="grid-cols-4"
              tiles={STATUSES.map((state) => ({ key: state, label: t(`permits.summary.${state}`), count: summary?.[state], tone: statusTone(state), to: to({ state }) }))}
            />
            <LatestPane
              rows={latestQuery.data?.items ?? []}
              total={latestQuery.data?.total ?? 0}
              empty={t('permits.empty')}
              more={(count) => t('dashboard.widgets.permits.moreSecurity', { count })}
              moreTo={to()}
              render={(row) => <SecurityRow row={row} to={to({ preview: String(row.id) })} />}
            />
          </section>
          <section aria-labelledby={`${paneId}-items`} className="flex min-h-0 min-w-0 flex-col border-s border-hairline ps-4">
            <h4 id={`${paneId}-items`} className="mb-1.5 shrink-0 text-[0.7em] font-medium text-muted-foreground">{t('permits.tabs.items')}</h4>
            <Tiles
              className="grid-cols-3"
              tiles={APPROVALS.map((state) => ({
                key: state,
                label: state === 'awaiting_scan' ? t('dashboard.widgets.permits.awaitingScan') : t(`permits.approval.${state}`),
                count: itemSummary?.[state],
                tone: state === 'awaiting_scan' ? 'warning' : approvalTone(state),
                to: to({ tab: 'items', istatus: state }),
              }))}
            />
            <LatestPane
              rows={latestItemsQuery.data?.items ?? []}
              total={latestItemsQuery.data?.total ?? 0}
              empty={t('permits.items.empty')}
              more={(count) => t('dashboard.widgets.permits.moreItems', { count })}
              moreTo={to({ tab: 'items' })}
              render={(row) => <ItemRow row={row} to={to({ tab: 'items', itemPreview: String(row.id) })} />}
            />
          </section>
        </div>
      ) : tier === 'glance' ? (
        <div className="flex min-h-0 min-w-0 flex-1 flex-col justify-between gap-1">
          <Link to={to({ state: 'active' })} className={cn(linkCls, 'flex min-w-0 items-baseline gap-1 text-foreground')} title={`${summary?.active} ${t('permits.summary.active')}`}>
            <b className="shrink-0 font-mono text-[1.65em] leading-none tabular-nums">{summary?.active}</b>
            <span className="truncate text-[0.75em]">{t('permits.summary.active')}</span>
          </Link>
          <div className={`flex min-w-0 justify-between gap-x-2 ${WIDGET_SUPPORT}`}>
            <Link to={to({ state: 'expiring' })} className={cn(linkCls, 'min-w-0 flex-1 truncate text-warning')} title={`${summary?.expiring} ${t('permits.summary.expiring')}`}>
              {summary?.expiring} {t('permits.summary.expiring')}
            </Link>
            <Link to={to({ tab: 'items' })} className={cn(linkCls, 'min-w-0 flex-1 truncate')} title={t('dashboard.widgets.permits.itemCount', { count: itemTotal })}>{t('dashboard.widgets.permits.itemCount', { count: itemTotal })}</Link>
          </div>
        </div>
      ) : (
        <>
          <div className={cn('grid shrink-0 gap-1 leading-tight', tier === 'tall' ? 'grid-cols-1' : 'grid-cols-2 gap-x-3')}>
            <div role="group" aria-label={t('permits.tabs.security')} className="grid grid-cols-2 gap-x-2 gap-y-0.5">
              {STATUSES.map((state) => (
                <Link key={state} to={to({ state })} title={`${summary?.[state]} ${t(`permits.summary.${state}`)}`} className={cn(linkCls, WIDGET_SUPPORT, 'flex min-w-0 items-baseline gap-1')}>
                  <b className="font-mono text-[1.08em] tabular-nums">{summary?.[state]}</b>
                  <span className="truncate">{t(`permits.summary.${state}`)}</span>
                </Link>
              ))}
            </div>
            <div role="group" aria-label={t('permits.tabs.items')} className="grid grid-cols-2 gap-x-2 gap-y-0.5 border-s border-hairline ps-2">
              {APPROVALS.map((state) => (
                <Link key={state} to={to({ tab: 'items', istatus: state })} title={`${itemSummary?.[state]} ${state === 'awaiting_scan' ? t('dashboard.widgets.permits.awaitingScan') : t(`permits.approval.${state}`)}`} className={cn(linkCls, WIDGET_SUPPORT, 'flex min-w-0 items-baseline gap-1')}>
                  <b className="font-mono tabular-nums">{itemSummary?.[state]}</b>
                  <span className="truncate">{state === 'awaiting_scan' ? t('dashboard.widgets.permits.awaitingScan') : t(`permits.approval.${state}`)}</span>
                </Link>
              ))}
            </div>
          </div>
          {showList && (
            <div className="mt-2 flex min-h-0 flex-1 flex-col border-t border-hairline pt-1">
              <h4 className={`${WIDGET_SUPPORT} shrink-0 text-muted-foreground`}>{t('dashboard.widgets.permits.latestEntries')}</h4>
              <ul ref={listRef} className="min-h-0 flex-1 overflow-hidden">
                {visible.map((row) => (
                  <li key={row.key}>
                    <Link to={row.to} className={`${WIDGET_SUPPORT} flex min-w-0 items-center gap-2 rounded-sm py-1 hover:bg-surface-tinted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring`}>
                      <bdi className="shrink-0 font-mono">{row.ref}</bdi>
                      <bdi className="min-w-0 flex-1 truncate">{row.name}</bdi>
                      <span className="shrink-0 text-muted-foreground">{row.status}</span>
                    </Link>
                  </li>
                ))}
              </ul>
              <div className={`${WIDGET_SUPPORT} flex shrink-0 flex-wrap justify-between gap-x-2`}>
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
