import { Link } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { CalendarClock } from 'lucide-react'
import { EmptyState } from '@/components/ui/empty-state'
import { Skeleton } from '@/components/ui/skeleton'
import { formatRegisterMonth, inmateRegisterHref, inmateMonthlyTasksHref } from '@/pages/application/statistics/registerModel'
import { useInmateTasks } from '@/pages/application/statistics/useInmateRegister'

/** Retains the persisted violation_months widget ID; every row uses server task eligibility. */
export function ViolationMonthsWidget({ compact = true }: { compact?: boolean }): React.JSX.Element | null {
  const { t, i18n } = useTranslation()
  const query = useInmateTasks()
  const tasks = query.data?.items ?? []
  const rows = compact ? tasks.slice(0, 5) : tasks
  if (compact && query.isSuccess && tasks.length === 0) return null
  return (
    <section className="rounded-xl border border-hairline bg-surface">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-hairline px-4 py-3">
        <h3 className="text-sm font-semibold">{t('dashboard.widgetLabels.violation_months')}</h3>
        {tasks.length > 0 ? <bdi dir="ltr" className="font-mono text-sm">{tasks.length}</bdi> : null}
      </div>
      <div className="space-y-1 px-3 py-2">
        {query.isLoading ? <Skeleton className="h-20 w-full" /> : query.isError ? <EmptyState icon={CalendarClock} message={t('common.loadError')} actionLabel={t('common.retry')} onAction={() => void query.refetch()} /> : tasks.length === 0 ? (
          <p className="px-2 py-3 text-sm text-muted-foreground">{t('inmateStats.workflow.noTasks')}</p>
        ) : rows.map((item) => <Link key={`${item.year}-${item.month}-${item.kind}-${item.submission_id}`} to={inmateRegisterHref(item.year, item.month, item.submission_id)}
          className="flex flex-wrap items-center justify-between gap-2 rounded-lg px-2 py-3 text-start text-sm hover:bg-surface-tinted">
          <span className="min-w-0 font-medium">{formatRegisterMonth(item.year, item.month, i18n.language)}</span>
          <span className="text-muted-foreground">{t(`inmateStats.workflow.tasks.${item.kind}`)}</span>
        </Link>)}
      </div>
      {compact && tasks.length > rows.length ? <div className="border-t border-hairline px-4 py-3">
        <Link to={inmateMonthlyTasksHref} className="text-sm text-primary hover:underline">{t('inmateStats.workflow.allTasks')}</Link>
      </div> : null}
    </section>
  )
}
