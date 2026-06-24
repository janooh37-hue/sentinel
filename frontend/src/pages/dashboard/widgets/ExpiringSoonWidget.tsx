/**
 * ExpiringSoonWidget — dashboard widget showing employees with expiring
 * Emirates ID or passport documents within the next 90 days.
 *
 * Self-gating: renders nothing when the user lacks `employees.view`.
 * Shows top 5 rows; footer links to the full /expiry page.
 *
 * Query key: ['expiry', 'soon']
 */

import { useNavigate, Link } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { AlertOctagon, AlertTriangle, CalendarClock, Clock, ClipboardCheck } from 'lucide-react'

import { api, type ExpiryItem } from '@/lib/api'
import { useCapabilities } from '@/lib/useCapabilities'
import { pickEmployeeName } from '@/lib/employeeName'
import { useAwaitingReturnCount } from '@/pages/leaves/useAwaitingReturnCount'
import { EmptyState } from '@/components/ui/empty-state'
import { Skeleton } from '@/components/ui/skeleton'
import { cn } from '@/lib/utils'

interface ExpiryRowProps {
  item: ExpiryItem
  language: string
  onNavigate: () => void
}

function ExpiryRow({ item, language, onNavigate }: ExpiryRowProps): React.JSX.Element {
  const { t } = useTranslation()
  const days = Math.abs(item.days_remaining)

  let UrgIcon = Clock
  let colorClass = 'text-muted-foreground'
  let urgencyLabel: string

  if (item.bucket === 'expired') {
    UrgIcon = AlertOctagon
    colorClass = 'text-destructive'
    urgencyLabel = t('expiry.urgency.expired', { days })
  } else if (item.bucket === 'critical') {
    UrgIcon = AlertTriangle
    colorClass = 'text-warning'
    urgencyLabel = t('expiry.urgency.critical', { days })
  } else {
    urgencyLabel = t('expiry.urgency.soon', { days })
  }

  return (
    <button
      type="button"
      onClick={onNavigate}
      className="flex w-full items-center gap-3 rounded-lg px-2 py-2 text-start transition-colors hover:bg-surface-tinted focus-visible:bg-surface-tinted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      {/* Name + id */}
      <div className="min-w-0 flex-1">
        <span className="block truncate text-[0.86em] font-medium text-foreground">
          {pickEmployeeName(item, language)}
        </span>
        <span className="font-mono text-[0.72em] text-muted-foreground">
          {item.employee_id}
        </span>
      </div>

      {/* Doc-type chip */}
      <span className="shrink-0 rounded-md bg-surface-tinted px-1.5 py-0.5 font-mono text-[0.68em] font-semibold text-foreground">
        {t(`expiry.docType.${item.doc_type}`)}
      </span>

      {/* Urgency */}
      <div className={cn('flex shrink-0 items-center gap-1', colorClass)}>
        <UrgIcon className="h-3.5 w-3.5" strokeWidth={1.8} aria-hidden />
        <span className="text-[0.72em] font-medium">{urgencyLabel}</span>
      </div>
    </button>
  )
}

export function ExpiringSoonWidget(): React.JSX.Element | null {
  const { t, i18n } = useTranslation()
  const navigate = useNavigate()
  const { has } = useCapabilities()

  const expiryQuery = useQuery({
    queryKey: ['expiry', 'soon'],
    queryFn: () => api.getExpiry(90, 'all'),
    staleTime: 60_000,
  })

  const awaitingReturn = useAwaitingReturnCount()

  // Capability gate — only users who can view employees see this.
  if (!has('employees.view')) return null

  const allItems = expiryQuery.data ?? []
  const items = allItems.slice(0, 5)
  const total = allItems.length
  const isEmpty = expiryQuery.isSuccess && total === 0
  const hasUrgent = allItems.some((i) => i.bucket === 'expired' || i.bucket === 'critical')

  return (
    <section
      className="mb-6 rounded-2xl border border-hairline bg-surface"
    >
      {/* Header */}
      <div className="flex items-center justify-between border-b border-hairline px-5 py-3.5">
        <h3 className="text-[0.86em] font-semibold text-foreground">
          {t('expiry.dashboardTitle')}
        </h3>
        {(expiryQuery.isLoading || total > 0) && (
          <span
            className={cn(
              'rounded-full px-2 py-0.5 font-mono text-[0.7em] font-semibold',
              hasUrgent
                ? 'bg-destructive/15 text-destructive'
                : 'bg-warning/15 text-warning',
            )}
          >
            {expiryQuery.isLoading ? '…' : total}
          </span>
        )}
      </div>

      {/* Awaiting return form — shown above expiry rows when there are any */}
      {awaitingReturn > 0 && (
        <button
          type="button"
          onClick={() => navigate('/leaves', { state: { awaitingReturn: true } })}
          className="flex w-full items-center gap-3 border-b border-hairline px-3 py-2 text-start transition-colors hover:bg-surface-tinted focus-visible:bg-surface-tinted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <ClipboardCheck className="h-3.5 w-3.5 shrink-0 text-info" strokeWidth={1.8} aria-hidden />
          <div className="min-w-0 flex-1">
            <span className="block truncate text-[0.86em] font-medium text-foreground">
              {t('expiry.awaitingReturnDash')}
            </span>
            <span className="font-mono text-[0.72em] text-muted-foreground">
              {t('expiry.awaitingReturnDashCount', { count: awaitingReturn })}
            </span>
          </div>
        </button>
      )}

      {/* Content */}
      <div className="flex flex-col gap-0.5 px-3 py-2">
        {expiryQuery.isLoading ? (
          Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="flex items-center gap-3 rounded-lg px-2 py-2">
              <div className="flex flex-1 flex-col gap-1.5">
                <Skeleton className="h-3 w-1/3" />
                <Skeleton className="h-2.5 w-1/4" />
              </div>
              <Skeleton className="h-4 w-16" />
              <Skeleton className="h-4 w-20" />
            </div>
          ))
        ) : expiryQuery.isError ? (
          <EmptyState
            icon={CalendarClock}
            message={t('common.loadError')}
            actionLabel={t('common.retry')}
            onAction={() => void expiryQuery.refetch()}
            className="py-8"
          />
        ) : isEmpty ? (
          <EmptyState icon={CalendarClock} message={t('expiry.empty')} className="py-8" />
        ) : (
          items.map((item) => (
            <ExpiryRow
              key={`${item.employee_id}-${item.doc_type}`}
              item={item}
              language={i18n.language}
              onNavigate={() => navigate(`/employees/${encodeURIComponent(item.employee_id)}`)}
            />
          ))
        )}
      </div>

      {/* Footer */}
      {!isEmpty && !expiryQuery.isLoading && (
        <div className="border-t border-hairline px-5 py-2.5">
          <Link
            to="/expiry"
            className="text-[0.82em] font-medium text-primary transition-colors hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:rounded-sm"
          >
            {t('expiry.viewAll')}
          </Link>
        </div>
      )}
    </section>
  )
}
