import { Link } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { WidgetFrame } from '@/components/dashboard/WidgetFrame'
import type { WidgetProps } from './types'
import { MorePeople, PEOPLE_BIG, PEOPLE_LINK, PEOPLE_ROW, PeopleFeedback } from './peopleWidgetParts'
import { summaryEmployeeName, usePeopleSummary } from './peopleWidgetData'

const TO = '/employees?violations=open'

export function OpenViolationsWidget({ tier, rows }: WidgetProps): React.JSX.Element {
  const { t, i18n } = useTranslation()
  const query = usePeopleSummary()
  const data = query.data?.open_violations
  const list = tier === 'list' || tier === 'tall'
  const visible = data?.latest.slice(0, rows) ?? []
  const more = (data?.count ?? 0) - visible.length
  return (
    <WidgetFrame title={t('dashboard.widgets.violations.title')} count={list && data ? data.count : undefined} viewAllTo={TO}>
      {query.isPending || query.isError || !data ? <PeopleFeedback pending={query.isPending} retry={query.refetch} /> : data.count === 0 ? (
        <p className="text-[0.75em] text-muted-foreground">{t('dashboard.widgets.violations.empty')}</p>
      ) : list ? (
        <>
          <ul className="min-h-0 flex-1 overflow-hidden">{visible.map((item) => (
            <li key={item.id}><Link to={`/employees/${encodeURIComponent(item.employee_id)}?tab=violations&open=${item.id}`} className={PEOPLE_ROW}>
              <span aria-hidden className="shrink-0 text-[1em]">🚨</span><span className="min-w-0 flex-1"><bdi className="block truncate text-[0.78em] font-medium">{item.title}</bdi><bdi className="block truncate text-[0.65em] text-muted-foreground">{summaryEmployeeName(item, i18n.language)}</bdi></span><bdi className="shrink-0 font-mono text-[0.65em] text-muted-foreground">{item.date}</bdi>
            </Link></li>
          ))}</ul>
          <MorePeople count={more} to={TO} label={t('dashboard.widgets.violations.more', { count: more })} />
        </>
      ) : (
        <>
          <Link to={TO} className={`${PEOPLE_LINK} ${PEOPLE_BIG}`}>{data.count}</Link>
          {data.latest[0] && <p className="truncate pt-2 text-[0.7em] text-muted-foreground">{t('dashboard.widgets.violations.newest', { title: data.latest[0].title, date: data.latest[0].date })}</p>}
        </>
      )}
    </WidgetFrame>
  )
}
