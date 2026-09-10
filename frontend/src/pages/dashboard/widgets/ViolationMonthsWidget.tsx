import { Link } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { CalendarClock } from 'lucide-react'

import { useIdentity } from '@/lib/useIdentity'
import { EmptyState } from '@/components/ui/empty-state'
import { Skeleton } from '@/components/ui/skeleton'
import {
  formatRegisterMonth,
  inmateRegisterHref,
  newestAwaitingMonth,
} from '@/pages/application/statistics/registerModel'
import { useInmateAwaitingClose } from '@/pages/application/statistics/useInmateRegister'

/** Admin-only reminder for ended inmate-violation months that still need a seal. */
export function ViolationMonthsWidget(): React.JSX.Element | null {
  const { t, i18n } = useTranslation()
  const { isAdmin } = useIdentity()
  const query = useInmateAwaitingClose(isAdmin)

  if (!isAdmin) return null

  const months = query.data?.months ?? []
  const total = query.data?.count ?? 0
  const rows = months.slice(0, 5)
  const newestMonth = newestAwaitingMonth(months)
  const moreCount = Math.max(0, total - rows.length)
  const isEmpty = query.isSuccess && total === 0

  return (
    <section className="mb-6 rounded-2xl border border-hairline bg-surface">
      <div className="flex items-center justify-between border-b border-hairline px-5 py-3.5">
        <h3 className="text-[0.86em] font-semibold text-foreground">
          {t('dashboard.widgetLabels.violation_months')}
        </h3>
        {(query.isLoading || total > 0) && (
          <span
            dir="ltr"
            className="rounded-full bg-warning/15 px-2 py-0.5 font-mono text-[0.7em] font-semibold text-warning"
          >
            {query.isLoading ? '…' : total}
          </span>
        )}
      </div>

      <div className="flex flex-col gap-0.5 px-3 py-2">
        {query.isLoading ? (
          Array.from({ length: 3 }).map((_, index) => (
            <div key={index} className="flex items-center gap-3 rounded-lg px-2 py-2">
              <div className="flex flex-1 flex-col gap-1.5">
                <Skeleton className="h-3 w-1/3" />
                <Skeleton className="h-2.5 w-1/4" />
              </div>
              <Skeleton className="h-4 w-24" />
            </div>
          ))
        ) : query.isError ? (
          <EmptyState
            icon={CalendarClock}
            message={t('common.loadError')}
            actionLabel={t('common.retry')}
            onAction={() => void query.refetch()}
            className="py-8"
          />
        ) : isEmpty ? (
          <EmptyState
            icon={CalendarClock}
            message={t('inmateStats.awaiting.empty')}
            className="py-8"
          />
        ) : (
          rows.map((item) => {
            const monthLabel = formatRegisterMonth(item.year, item.month, i18n.language)
            return (
              <Link
                key={`${item.year}-${item.month}`}
                to={inmateRegisterHref(item.year, item.month)}
                aria-label={`${monthLabel} — ${t('inmateStats.awaiting.open')}`}
                className="flex items-center gap-3 rounded-lg px-2 py-2 text-start transition-colors hover:bg-surface-tinted focus-visible:rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <div className="min-w-0 flex-1">
                  <span
                    dir="ltr"
                    className="block truncate text-[0.86em] font-medium text-foreground"
                  >
                    {monthLabel}
                  </span>
                  <span className="block text-[0.72em] text-muted-foreground">
                    {t('inmateStats.awaiting.rows', { count: item.row_count })}
                  </span>
                </div>
                <span
                  className={`shrink-0 rounded-md px-1.5 py-0.5 text-[0.68em] font-semibold ${
                    item.closable
                      ? 'bg-success-soft text-success'
                      : 'bg-warning-soft text-warning'
                  }`}
                >
                  {item.closable
                    ? t('inmateStats.awaiting.closable')
                    : t('inmateStats.awaiting.blocked', { count: item.pending_count })}
                </span>
              </Link>
            )
          })
        )}
      </div>

      {newestMonth && !query.isLoading && !query.isError && (
        <div className="border-t border-hairline px-5 py-2.5">
          <Link
            to={inmateRegisterHref(newestMonth.year, newestMonth.month)}
            className="text-[0.82em] font-medium text-primary transition-colors hover:underline focus-visible:rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            {moreCount > 0
              ? t('inmateStats.awaiting.more', { count: moreCount })
              : t('inmateStats.awaiting.open')}
          </Link>
        </div>
      )}
    </section>
  )
}
