/**
 * PermitsWidget: security-permit status counts, item-permit approval counts,
 * and the latest entries of each register, scoped by a zone quick filter.
 *
 * The zone choice is remembered per browser (the inspection unit watches the
 * red zone only). Counts link to the register pre-filtered; a latest-entry row
 * opens the register's own quick view (`?preview=` / `?itemPreview=`).
 *
 * Self-gating: renders nothing without `permits.view`.
 */

import { Link } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'

import {
  api,
  type ItemPermitRead,
  type PermitDerivedStatus,
  type PermitListItem,
  type PermitZone,
} from '@/lib/api'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import { useCapabilities } from '@/lib/useCapabilities'
import { useLocalStorage } from '@/lib/useLocalStorage'
import { cn } from '@/lib/utils'
import { PermitAccessBadge } from '@/pages/permits/PermitAccessBadge'
import {
  approvalTone,
  permitWindow,
  statusTone,
  zoneTone,
  type PermitApprovalState,
  type Tone,
} from '@/pages/permits/permitUtils'

type ZoneFilter = 'all' | PermitZone

const ZONE_FILTERS: ZoneFilter[] = ['all', 'red', 'green', 'work_residence']
const STATUSES: PermitDerivedStatus[] = ['active', 'expiring', 'expired', 'revoked']
const APPROVALS: PermitApprovalState[] = ['none', 'pending', 'approved', 'returned', 'rejected']
const LATEST = 5

const toneCls: Record<Tone, string> = {
  active: 'text-success',
  warning: 'text-warning',
  danger: 'text-destructive',
  info: 'text-info',
  neutral: 'text-foreground',
  outline: 'text-foreground',
}

const zoneDotCls: Record<PermitZone, string> = {
  red: 'bg-destructive',
  green: 'bg-success',
  work_residence: 'bg-info',
}

const rowCls =
  'flex min-w-0 flex-col gap-1 rounded-lg px-2 py-2 text-start transition-colors hover:bg-surface-tinted focus-visible:bg-surface-tinted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring motion-reduce:transition-none'

/** `?a=1&b=2`, skipping empty values. */
function href(path: string, params: Record<string, string | null>): string {
  const search = new URLSearchParams()
  for (const [key, value] of Object.entries(params)) if (value) search.set(key, value)
  const qs = search.toString()
  return qs ? `${path}?${qs}` : path
}

interface Tile {
  key: string
  label: string
  count: number | null
  tone: Tone
  to: string
}

function TileGrid({ tiles, className }: { tiles: Tile[]; className: string }): React.JSX.Element {
  return (
    <ul className={cn('grid gap-2', className)}>
      {tiles.map((tile) => (
        <li key={tile.key} className="min-w-0">
          <Link
            to={tile.to}
            className="flex h-full min-w-0 flex-col items-start rounded-xl border border-border bg-surface px-2.5 py-2 text-start transition-colors hover:border-border-strong focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:ring-offset-background motion-reduce:transition-none md:px-3 md:py-2.5"
          >
            <span className={cn('font-mono text-xl font-bold tabular-nums md:text-2xl', toneCls[tile.tone])}>
              <bdi>{tile.count ?? '—'}</bdi>
            </span>
            <span className="text-[0.72rem] leading-tight text-muted-foreground">{tile.label}</span>
          </Link>
        </li>
      ))}
    </ul>
  )
}

/** Latest-entries list with loading, error and empty states. */
function LatestList<T extends { id: number }>({
  query,
  rows,
  empty,
  render,
}: {
  query: { isPending: boolean; isError: boolean; refetch: () => unknown }
  rows: T[]
  empty: string
  render: (row: T) => React.JSX.Element
}): React.JSX.Element {
  const { t } = useTranslation()
  return (
    <div className="mt-3 border-t border-hairline pt-2">
      <h5 className="px-2 pb-1 text-[0.72rem] font-medium text-muted-foreground">
        {t('dashboard.widgets.permits.latest')}
      </h5>
      {query.isPending ? (
        Array.from({ length: 3 }, (_, i) => (
          <div key={i} className="flex flex-col gap-1.5 px-2 py-2.5">
            <Skeleton className="h-3 w-1/2" />
            <Skeleton className="h-2.5 w-1/3" />
          </div>
        ))
      ) : query.isError ? (
        <p className="px-2 py-3 text-[0.82em] text-muted-foreground">
          {t('common.loadError')}{' '}
          <button
            type="button"
            onClick={() => void query.refetch()}
            className="font-medium text-primary hover:underline focus-visible:rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            {t('common.retry')}
          </button>
        </p>
      ) : rows.length === 0 ? (
        <p className="px-2 py-3 text-[0.82em] text-muted-foreground">{empty}</p>
      ) : (
        <ul className="flex flex-col">
          {rows.map((row) => (
            <li key={row.id}>{render(row)}</li>
          ))}
        </ul>
      )}
    </div>
  )
}

function SecurityRow({ row, zone }: { row: PermitListItem; zone: PermitZone | null }): React.JSX.Element {
  const { t, i18n } = useTranslation()
  const { remaining } = permitWindow(t, i18n.language, row)
  return (
    <Link to={href('/permits', { zone, preview: String(row.id) })} className={rowCls}>
      <span className="flex min-w-0 items-center justify-between gap-2">
        <bdi className="truncate text-[0.86em] font-medium text-foreground">{row.company}</bdi>
        <Badge tone={statusTone(row.derived_status)}>{t(`permits.status.${row.derived_status}`)}</Badge>
      </span>
      <span className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-[0.72rem] text-muted-foreground">
        <bdi dir="ltr" className="font-mono">
          {row.permit_no ?? `#${row.id}`}
        </bdi>
        <PermitAccessBadge accessAreas={row.access_areas} zones={row.zones} square />
        {/* Expired/revoked: the status badge already says it. */}
        {remaining && (row.derived_status === 'active' || row.derived_status === 'expiring') && <span>{remaining}</span>}
      </span>
    </Link>
  )
}

function ItemRow({ row }: { row: ItemPermitRead }): React.JSX.Element {
  const { t, i18n } = useTranslation()
  const isAr = i18n.language.startsWith('ar')
  const approval = (row.approval_state ?? 'none') as PermitApprovalState
  return (
    <Link to={href('/permits', { tab: 'items', itemPreview: String(row.id) })} className={rowCls}>
      <span className="flex min-w-0 items-center justify-between gap-2">
        <bdi className="truncate text-[0.86em] font-medium text-foreground">
          {isAr ? row.employee_name : row.employee_name_en}
        </bdi>
        <Badge tone={approvalTone(approval)}>{t(`permits.approval.${approval}`)}</Badge>
      </span>
      <span className="flex min-w-0 items-center gap-2 text-[0.72rem] text-muted-foreground">
        <span className="shrink-0 font-medium">{t('permits.items.count', { count: row.items.length })}</span>
        <span className="min-w-0 truncate" dir="auto">
          {row.items.map((item) => item.name).join(isAr ? '، ' : ', ')}
        </span>
        <span className="ms-auto flex shrink-0 gap-1">
          {row.zones.map((z) => (
            <Badge key={z} tone={zoneTone(z)} shape="square">
              {t(`permits.zone.${z}Short`)}
            </Badge>
          ))}
        </span>
      </span>
    </Link>
  )
}

export function PermitsWidget(): React.JSX.Element | null {
  const { t } = useTranslation()
  const { has } = useCapabilities()
  const canView = has('permits.view')

  const [stored, setZoneFilter] = useLocalStorage<ZoneFilter>('gssg.dashboard.permitsZone', 'all')
  const zoneFilter = ZONE_FILTERS.includes(stored) ? stored : 'all'
  const zone = zoneFilter === 'all' ? null : zoneFilter

  // Unscoped keys match the register's, so either surface warms the other.
  const summaryQuery = useQuery({
    queryKey: zone ? ['permits-summary', zone] : ['permits-summary'],
    queryFn: () => api.permitsSummary(zone ?? undefined),
    enabled: canView,
    staleTime: 60_000,
  })
  const latestParams = { zone: zone ?? undefined, limit: LATEST }
  const latestQuery = useQuery({
    queryKey: ['permits-list', latestParams],
    queryFn: () => api.listPermits(latestParams),
    enabled: canView,
    staleTime: 60_000,
  })
  // ponytail: item permits have no server zone filter or summary; counts and
  // the zone scope are client-side over the ≤500-row list, as on the register.
  const itemParams = { q: undefined, limit: 500 }
  const itemsQuery = useQuery({
    queryKey: ['item-permits-list', itemParams],
    queryFn: () => api.listItemPermits(itemParams),
    enabled: canView,
    staleTime: 60_000,
  })

  if (!canView) return null

  const summary = summaryQuery.data
  const items = (itemsQuery.data?.items ?? []).filter((row) => !zone || row.zones.includes(zone))
  const itemCounts: Partial<Record<PermitApprovalState, number>> = {}
  for (const row of items) {
    const state = (row.approval_state ?? 'none') as PermitApprovalState
    itemCounts[state] = (itemCounts[state] ?? 0) + 1
  }

  const securityTiles: Tile[] = STATUSES.map((status) => ({
    key: status,
    label: t(`permits.summary.${status}`),
    count: summary ? summary[status] : null,
    tone: statusTone(status),
    to: href('/permits', { state: status, zone }),
  }))
  const itemTiles: Tile[] = APPROVALS.map((state) => ({
    key: state,
    label: t(`permits.approval.${state}`),
    count: itemsQuery.isSuccess ? (itemCounts[state] ?? 0) : null,
    tone: approvalTone(state),
    to: href('/permits', { tab: 'items', istatus: state }),
  }))

  return (
    <section className="rounded-2xl border border-hairline bg-surface">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 border-b border-hairline px-5 py-3">
        <h3 className="text-[0.86em] font-semibold text-foreground">{t('dashboard.widgetLabels.permits')}</h3>
        <div
          role="group"
          aria-label={t('permits.filters.zone')}
          className="order-last flex w-full gap-0.5 rounded-lg border border-border bg-surface-tinted p-0.5 sm:order-none sm:ms-auto sm:w-auto [[data-theme=dark]_&]:bg-background"
        >
          {ZONE_FILTERS.map((option) => {
            const active = option === zoneFilter
            return (
              <button
                key={option}
                type="button"
                aria-pressed={active}
                onClick={() => setZoneFilter(option)}
                className={cn(
                  'inline-flex min-h-11 flex-1 items-center justify-center gap-1.5 whitespace-nowrap rounded-md px-2.5 text-[0.78em] transition-colors sm:min-h-8 sm:flex-none',
                  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring motion-reduce:transition-none',
                  active
                    ? 'bg-surface font-semibold text-primary shadow-sm [[data-theme=dark]_&]:bg-surface-tinted [[data-theme=dark]_&]:text-foreground'
                    : 'text-muted-foreground hover:text-foreground',
                )}
              >
                {option !== 'all' && (
                  <span className={cn('h-2 w-2 shrink-0 rounded-full', zoneDotCls[option])} aria-hidden />
                )}
                {option === 'all' ? t('permits.filters.all') : t(`permits.zone.${option}Short`)}
              </button>
            )
          })}
        </div>
        <Link
          to={href('/permits', { zone })}
          className="ms-auto text-[0.82em] font-medium text-primary transition-colors hover:underline focus-visible:rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring sm:ms-0"
        >
          {t('dashboard.viewAll')}
        </Link>
      </div>
      <div className="grid gap-6 px-5 py-4 lg:grid-cols-2">
        <div className="min-w-0">
          <h4 className="mb-2 text-[0.78em] font-medium text-muted-foreground">{t('permits.tabs.security')}</h4>
          <TileGrid tiles={securityTiles} className="grid-cols-2 sm:grid-cols-4" />
          <LatestList
            query={latestQuery}
            rows={latestQuery.data?.items ?? []}
            empty={t('permits.empty')}
            render={(row) => <SecurityRow row={row} zone={zone} />}
          />
        </div>
        <div className="min-w-0">
          <h4 className="mb-2 text-[0.78em] font-medium text-muted-foreground">{t('permits.tabs.items')}</h4>
          <TileGrid tiles={itemTiles} className="grid-cols-3 sm:grid-cols-5" />
          <LatestList
            query={itemsQuery}
            rows={items.slice(0, LATEST)}
            empty={t('permits.items.empty')}
            render={(row) => <ItemRow row={row} />}
          />
        </div>
      </div>
    </section>
  )
}
