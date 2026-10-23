import { Link } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { WidgetEmpty, WidgetFrame } from '@/components/dashboard/WidgetFrame'
import { useFitCount } from '@/components/dashboard/useFitCount'
import { useCapabilities } from '@/lib/useCapabilities'
import { bidi } from '@/lib/bidi'
import { formatDmy } from '@/lib/formatDmy'
import type { WidgetProps } from './types'
import { MorePeople, PEOPLE_BIG, PEOPLE_LINK, PEOPLE_META, PEOPLE_NAME, PEOPLE_ROW, PeopleFeedback } from './peopleWidgetParts'
import { summaryEmployeeName, usePeopleSummary } from './peopleWidgetData'

const TO = '/employees?violations=open'

export function OpenViolationsWidget({ tier, rows }: WidgetProps): React.JSX.Element {
  const { t, i18n } = useTranslation()
  const { has } = useCapabilities()
  const canViewEmployees = has('employees.view')
  const query = usePeopleSummary()
  const data = query.data?.open_violations
  const list = tier === 'list' || tier === 'tall'
  const { listRef, visibleCount } = useFitCount(Math.min(data?.latest.length ?? 0, rows))
  const visible = data?.latest.slice(0, visibleCount) ?? []
  const more = (data?.count ?? 0) - visible.length
  return (
    <WidgetFrame title={t('dashboard.widgets.violations.title')} count={list && data ? data.count : undefined} viewAllTo={canViewEmployees ? TO : undefined} compact={tier === 'glance'}>
      {query.isPending || query.isError || !data ? <PeopleFeedback pending={query.isPending} retry={query.refetch} /> : data.count === 0 ? (
        <WidgetEmpty message={t('dashboard.widgets.violations.empty')} to={canViewEmployees ? TO : undefined} action={t('dashboard.widgets.violations.emptyAction')} />
      ) : list ? (
        <>
          <ul ref={listRef} className="min-h-0 flex-1 overflow-hidden">{visible.map((item) => {
            const content = <><span aria-hidden className="shrink-0 text-[1em]">🚨</span><span className="min-w-0 flex-1"><bdi className={PEOPLE_NAME}>{item.title}</bdi><bdi className={`${PEOPLE_META} block truncate`}>{summaryEmployeeName(item, i18n.language)}</bdi></span><bdi dir="ltr" className={`${PEOPLE_META} shrink-0 font-mono`}>{formatDmy(item.date)}</bdi></>
            return <li key={item.id}>{canViewEmployees ? <Link to={`/employees/${encodeURIComponent(item.employee_id)}?tab=violations&open=${item.id}`} className={PEOPLE_ROW}>{content}</Link> : <div className="flex min-w-0 items-center gap-2 py-2 text-start">{content}</div>}</li>
          })}</ul>
          {canViewEmployees ? <MorePeople count={more} to={TO} label={t('dashboard.widgets.violations.more', { count: more })} /> : more > 0 && <span className="shrink-0 border-t border-hairline pt-1 text-[0.75em]">{t('dashboard.widgets.violations.more', { count: more })}</span>}
        </>
      ) : (
        <>
          {canViewEmployees ? <Link to={TO} className={`${PEOPLE_LINK} ${PEOPLE_BIG}`}>{data.count}</Link> : <span className={PEOPLE_BIG}>{data.count}</span>}
          {data.latest[0] && <p className="truncate pt-2 text-[0.75em] text-muted-foreground" title={t('dashboard.widgets.violations.newest', { title: data.latest[0].title, date: bidi(formatDmy(data.latest[0].date)) })}>{t('dashboard.widgets.violations.newest', { title: data.latest[0].title, date: bidi(formatDmy(data.latest[0].date)) })}</p>}
        </>
      )}
    </WidgetFrame>
  )
}
