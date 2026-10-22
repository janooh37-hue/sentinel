/**
 * PermitsWidget: security-permit status counts and item-permit approval counts
 * from the permits register. Every count links to the register pre-filtered
 * (`?state=` on the security tab, `?tab=items&istatus=` on the items tab).
 *
 * Self-gating: renders nothing without `permits.view`. Shares the register's
 * query keys, so opening /permits after the dashboard reuses the cache.
 */

import { Link } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'

import { api, type PermitDerivedStatus } from '@/lib/api'
import { useCapabilities } from '@/lib/useCapabilities'
import { cn } from '@/lib/utils'
import {
  approvalTone,
  statusTone,
  type PermitApprovalState,
  type Tone,
} from '@/pages/permits/permitUtils'

const STATUSES: PermitDerivedStatus[] = ['active', 'expiring', 'expired', 'revoked']
const APPROVALS: PermitApprovalState[] = ['none', 'pending', 'approved', 'returned', 'rejected']

const toneCls: Record<Tone, string> = {
  active: 'text-success',
  warning: 'text-warning',
  danger: 'text-destructive',
  info: 'text-info',
  neutral: 'text-foreground',
  outline: 'text-foreground',
}

interface Tile {
  key: string
  label: string
  count: number | null
  tone: Tone
  to: string
}

function TileGroup({ title, tiles, className }: { title: string; tiles: Tile[]; className: string }): React.JSX.Element {
  return (
    <div className="min-w-0">
      <h4 className="mb-2 text-[0.78em] font-medium text-muted-foreground">{title}</h4>
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
    </div>
  )
}

export function PermitsWidget(): React.JSX.Element | null {
  const { t } = useTranslation()
  const { has } = useCapabilities()
  const canView = has('permits.view')

  const summaryQuery = useQuery({
    queryKey: ['permits-summary'],
    queryFn: () => api.permitsSummary(),
    enabled: canView,
    staleTime: 60_000,
  })
  // Same key + params as ItemPermitsTab's unfiltered list.
  // ponytail: approval counts are client-side over the ≤500-row list, as on
  // the register; add a server summary if the register outgrows it.
  const itemParams = { q: undefined, limit: 500 }
  const itemsQuery = useQuery({
    queryKey: ['item-permits-list', itemParams],
    queryFn: () => api.listItemPermits(itemParams),
    enabled: canView,
    staleTime: 60_000,
  })

  if (!canView) return null

  const summary = summaryQuery.data
  const itemCounts: Partial<Record<PermitApprovalState, number>> = {}
  for (const row of itemsQuery.data?.items ?? []) {
    const state = (row.approval_state ?? 'none') as PermitApprovalState
    itemCounts[state] = (itemCounts[state] ?? 0) + 1
  }

  const securityTiles: Tile[] = STATUSES.map((status) => ({
    key: status,
    label: t(`permits.summary.${status}`),
    count: summary ? summary[status] : null,
    tone: statusTone(status),
    to: `/permits?state=${status}`,
  }))
  const itemTiles: Tile[] = APPROVALS.map((state) => ({
    key: state,
    label: t(`permits.approval.${state}`),
    count: itemsQuery.isSuccess ? (itemCounts[state] ?? 0) : null,
    tone: approvalTone(state),
    to: `/permits?tab=items&istatus=${state}`,
  }))

  return (
    <section className="rounded-2xl border border-hairline bg-surface">
      <div className="flex items-center justify-between border-b border-hairline px-5 py-3.5">
        <h3 className="text-[0.86em] font-semibold text-foreground">{t('dashboard.widgetLabels.permits')}</h3>
        <Link
          to="/permits"
          className="text-[0.82em] font-medium text-primary transition-colors hover:underline focus-visible:rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          {t('dashboard.viewAll')}
        </Link>
      </div>
      <div className="grid gap-5 px-5 py-4 lg:grid-cols-[4fr_5fr]">
        <TileGroup title={t('permits.tabs.security')} tiles={securityTiles} className="grid-cols-2 sm:grid-cols-4" />
        <TileGroup title={t('permits.tabs.items')} tiles={itemTiles} className="grid-cols-3 sm:grid-cols-5" />
      </div>
    </section>
  )
}
