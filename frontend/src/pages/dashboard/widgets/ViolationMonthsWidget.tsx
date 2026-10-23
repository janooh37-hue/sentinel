import { Link } from 'react-router-dom'
import { useTranslation } from 'react-i18next'

import { WidgetFrame } from '@/components/dashboard/WidgetFrame'
import { useFitCount } from '@/components/dashboard/useFitCount'
import { Skeleton } from '@/components/ui/skeleton'
import {
  formatRegisterMonth,
  inmateRegisterHref,
  newestAwaitingMonth,
} from '@/pages/application/statistics/registerModel'
import { useInmateAwaitingClose } from '@/pages/application/statistics/useInmateRegister'
import type { WidgetProps } from './types'

const linkClass = 'rounded-sm text-[0.72em] font-medium text-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring'

/** Ended inmate-violation months the current caller can act on. */
export function ViolationMonthsWidget({ tier, rows }: WidgetProps): React.JSX.Element {
  const { t, i18n } = useTranslation()
  const query = useInmateAwaitingClose()
  const months = query.data?.months ?? []
  const total = query.data?.count ?? 0
  const newestMonth = newestAwaitingMonth(months)
  const readyMonth = months.find((item) => item.closable)
  const { listRef, visibleCount } = useFitCount(Math.min(months.length, rows))
  const preview = months.slice(0, visibleCount)
  const moreCount = Math.max(0, total - preview.length)
  const list = tier === 'tall' || tier === 'list'
  const viewAllTo = newestMonth
    ? inmateRegisterHref(newestMonth.year, newestMonth.month)
    : '/services/inmate_conduct_violations?mode=stats'
  // Force Western digits in the shared month formatter for both languages.
  const locale = `${i18n.language.split('-u-')[0]}-u-nu-latn`

  return (
    <WidgetFrame title={t('dashboard.widgets.violation_months.title')} count={query.isSuccess && list ? total : undefined} viewAllTo={viewAllTo}>
      {query.isLoading ? (
        <div className="space-y-2" aria-label={t('common.loading')}>
          <Skeleton className="h-7 w-1/3" />
          <Skeleton className="h-3 w-3/4" />
        </div>
      ) : query.isError ? (
        <div className="flex flex-col gap-2" role="alert">
          <p className="text-[0.75em] text-muted-foreground">{t('common.loadError')}</p>
          <button type="button" className={`${linkClass} self-start`} onClick={() => void query.refetch()}>{t('common.retry')}</button>
        </div>
      ) : total === 0 ? (
        <p className="text-[0.75em] text-muted-foreground">{t('dashboard.widgets.violation_months.empty')}</p>
      ) : !list ? (
        <div className="flex min-h-0 flex-col gap-2">
          <p className="text-3xl font-semibold tabular-nums text-foreground">{total}<span className="ms-2 text-xs font-normal text-muted-foreground">{t('dashboard.widgets.violation_months.monthsOpen', { count: total })}</span></p>
          {readyMonth ? (
            <Link className={`${linkClass} self-start text-success`} to={inmateRegisterHref(readyMonth.year, readyMonth.month)}>
              {t('dashboard.widgets.violation_months.readyMonth', { month: formatRegisterMonth(readyMonth.year, readyMonth.month, locale) })}
            </Link>
          ) : (
            <p className="text-[0.7em] text-muted-foreground">{t('dashboard.widgets.violation_months.pending')}</p>
          )}
        </div>
      ) : (
        <>
          <ul ref={listRef} className="min-h-0 flex-1 overflow-hidden">
            {preview.map((item) => {
              const monthLabel = formatRegisterMonth(item.year, item.month, locale)
              return (
                <li key={`${item.year}-${item.month}`}>
                  <Link
                    to={inmateRegisterHref(item.year, item.month)}
                    aria-label={`${monthLabel}, ${t(`inmateStats.workflow.${item.stage}`)}`}
                    className="flex min-w-0 flex-wrap items-center justify-between gap-x-2 gap-y-0.5 rounded-lg py-1.5 text-start hover:bg-surface-tinted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    <div className="min-w-0">
                      <span className="block truncate text-[0.8em] font-medium text-foreground">{monthLabel}</span>
                      <span className="block text-[0.65em] text-muted-foreground">{t(`inmateStats.workflow.${item.stage}`)} · {t('inmateStats.awaiting.rows', { count: item.row_count })}</span>
                    </div>
                    <span className={`rounded-md px-1.5 py-0.5 text-[0.65em] font-semibold ${item.closable ? 'bg-success-soft text-success' : 'bg-warning-soft text-warning'}`}>
                      {item.closable ? t('inmateStats.awaiting.closable') : t('inmateStats.awaiting.blocked', { count: item.pending_count })}
                    </span>
                  </Link>
                </li>
              )
            })}
          </ul>
          {moreCount > 0 && <Link to={viewAllTo} className={`${linkClass} shrink-0 pt-1`}>{t('dashboard.widgets.violation_months.more', { count: moreCount })}</Link>}
        </>
      )}
    </WidgetFrame>
  )
}
