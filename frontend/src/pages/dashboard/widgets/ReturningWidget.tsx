import { Link } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { WidgetFrame } from '@/components/dashboard/WidgetFrame'
import { useFitCount } from '@/components/dashboard/useFitCount'
import { siteToday } from '@/components/employees/useAttendanceAttention'
import { computeEndDate } from '@/lib/leaveDateMath'
import type { WidgetProps } from './types'
import { LeaveWidgetRow, MorePeople, PEOPLE_BIG, PEOPLE_LINK, PeopleFeedback } from './peopleWidgetParts'
import { summaryEmployeeName, usePeopleSummary } from './peopleWidgetData'

export function ReturningWidget({ tier, rows }: WidgetProps): React.JSX.Element {
  const { t, i18n } = useTranslation()
  const query = usePeopleSummary()
  const today = siteToday()
  const to = `/leaves?status=Approved&end_from=${today}&end_to=${computeEndDate(today, 8)}`
  const all = query.data?.upcoming_leave_ends ?? []
  const list = tier === 'list' || tier === 'tall'
  const { listRef, visibleCount } = useFitCount(Math.min(all.length, rows))
  const visible = all.slice(0, visibleCount)
  const tomorrow = all.filter((item) => item.days_remaining === 1)
  const more = all.length - visible.length
  return (
    <WidgetFrame title={t('dashboard.widgets.upcoming_leave.title')} count={list && query.isSuccess ? all.length : undefined} viewAllTo={to}>
      {query.isPending || query.isError ? <PeopleFeedback pending={query.isPending} retry={query.refetch} /> : all.length === 0 ? (
        <p className="text-[0.75em] text-muted-foreground">{t('dashboard.widgets.upcoming_leave.empty')}</p>
      ) : list ? (
        <>
          <ul ref={listRef} className="min-h-0 flex-1 overflow-hidden">{visible.map((item) => <LeaveWidgetRow key={item.leave_id} item={item} language={i18n.language} when={item.days_remaining <= 0 ? t('dashboard.widgets.upcoming_leave.today') : item.days_remaining === 1 ? t('dashboard.widgets.upcoming_leave.tomorrow') : t('dashboard.widgets.upcoming_leave.inDays', { count: item.days_remaining })} />)}</ul>
          <MorePeople count={more} to={to} label={t('dashboard.widgets.upcoming_leave.more', { count: more })} />
        </>
      ) : (
        <>
          <Link to={to} className={`${PEOPLE_LINK} ${PEOPLE_BIG}`}>{all.length}</Link>
          <p className="truncate pt-2 text-[0.7em] text-warning">{t('dashboard.widgets.upcoming_leave.tomorrowCount', { count: tomorrow.length })}{tier === 'summary' && tomorrow.length > 0 ? ` · ${tomorrow.map((item) => summaryEmployeeName(item, i18n.language)).join(i18n.language.startsWith('ar') ? '، ' : ', ')}` : ''}</p>
        </>
      )}
    </WidgetFrame>
  )
}
