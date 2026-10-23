import { Link } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { WidgetFrame } from '@/components/dashboard/WidgetFrame'
import { siteToday } from '@/components/employees/useAttendanceAttention'
import { computeEndDate } from '@/lib/leaveDateMath'
import type { WidgetProps } from './types'
import { LeaveWidgetRow, MorePeople, PEOPLE_BIG, PEOPLE_LINK, PeopleAvatar, PeopleFeedback } from './peopleWidgetParts'
import { summaryEmployeeName, usePeopleSummary } from './peopleWidgetData'

export function OnLeaveTodayWidget({ tier, rows }: WidgetProps): React.JSX.Element {
  const { t, i18n } = useTranslation()
  const query = usePeopleSummary()
  const today = siteToday()
  const to = `/leaves?status=Approved&on=${today}`
  const all = query.data?.on_leave_today ?? []
  const list = tier === 'list' || tier === 'tall'
  const visible = all.slice(0, rows)
  const tomorrow = all.filter((item) => item.end_date === computeEndDate(today, 2)).length
  const more = all.length - visible.length
  return (
    <WidgetFrame title={t('dashboard.widgets.on_leave_today.title')} count={list && query.isSuccess ? all.length : undefined} viewAllTo={to}>
      {query.isPending || query.isError ? <PeopleFeedback pending={query.isPending} retry={query.refetch} /> : all.length === 0 ? (
        <p className="text-[0.75em] text-muted-foreground">{t('dashboard.widgets.on_leave_today.empty')}</p>
      ) : list ? (
        <>
          <ul className="min-h-0 flex-1 overflow-hidden">{visible.map((item) => <LeaveWidgetRow key={item.leave_id} item={item} language={i18n.language} when={t('dashboard.widgets.on_leave_today.until', { date: item.end_date })} />)}</ul>
          <MorePeople count={more} to={to} label={t('dashboard.widgets.on_leave_today.more', { count: more })} />
        </>
      ) : (
        <>
          <Link to={to} className={`${PEOPLE_LINK} flex items-baseline gap-2`}><span className={PEOPLE_BIG}>{all.length}</span><span className="text-[0.7em] text-muted-foreground">{t('dashboard.widgets.on_leave_today.records')}</span></Link>
          <div className="flex min-w-0 items-center gap-1 pt-2 text-[0.7em] text-muted-foreground">
            {tier === 'summary' && <><span className="flex shrink-0 -space-x-1 rtl:space-x-reverse">{all.slice(0, 5).map((item) => <PeopleAvatar key={item.leave_id} name={summaryEmployeeName(item, i18n.language)} />)}</span>{all.length > 5 && <Link to={to} className={PEOPLE_LINK}>+{all.length - 5}</Link>}</>}
            <span>{t('dashboard.widgets.on_leave_today.tomorrow', { count: tomorrow })}</span>
          </div>
        </>
      )}
    </WidgetFrame>
  )
}
