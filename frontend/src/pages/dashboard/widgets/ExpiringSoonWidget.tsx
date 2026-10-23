import { Link } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { WidgetFrame } from '@/components/dashboard/WidgetFrame'
import { useFitCount } from '@/components/dashboard/useFitCount'
import { api } from '@/lib/api'
import { pickEmployeeName } from '@/lib/employeeName'
import { useCapabilities } from '@/lib/useCapabilities'
import type { WidgetProps } from './types'
import { MorePeople, PEOPLE_BIG, PEOPLE_LINK, PEOPLE_ROW, PeopleAvatar, PeopleFeedback } from './peopleWidgetParts'

export function ExpiringSoonWidget({ tier, rows }: WidgetProps): React.JSX.Element {
  const { t, i18n } = useTranslation()
  const { has } = useCapabilities()
  const query = useQuery({ queryKey: ['expiry', 'soon'], queryFn: () => api.getExpiry(90, 'all'), staleTime: 60_000 })
  const all = query.data ?? []
  const list = tier === 'list' || tier === 'tall'
  const { listRef, visibleCount } = useFitCount(Math.min(all.length, rows))
  const visible = all.slice(0, visibleCount)
  const expired = all.filter((item) => item.days_remaining < 0).length
  const critical = all.filter((item) => item.days_remaining >= 0 && item.days_remaining <= 30).length
  const more = all.length - visible.length
  return (
    <WidgetFrame title={t('dashboard.widgets.expiring_soon.title')} count={list && query.isSuccess ? all.length : undefined} viewAllTo="/expiry">
      {query.isPending || query.isError ? <PeopleFeedback pending={query.isPending} retry={query.refetch} /> : all.length === 0 ? (
        <p className="text-[0.75em] text-muted-foreground">{t('dashboard.widgets.expiring_soon.empty')}</p>
      ) : list ? (
        <>
          <ul ref={listRef} className="min-h-0 flex-1 overflow-hidden">{visible.map((item) => {
            const name = pickEmployeeName(item, i18n.language)
            const content = <><PeopleAvatar name={name} /><span className="min-w-0 flex-1"><bdi className="block truncate text-[0.78em] font-medium">{name}</bdi><span className="block truncate text-[0.65em] text-muted-foreground"><bdi className="font-mono">{item.employee_id}</bdi> · {t(`expiry.docType.${item.doc_type}`)}</span></span><span className={`max-w-[40%] text-end text-[0.65em] ${item.days_remaining < 0 ? 'text-accent' : item.days_remaining <= 30 ? 'text-warning' : 'text-muted-foreground'}`}>{t(`expiry.urgency.${item.days_remaining < 0 ? 'expired' : item.days_remaining <= 30 ? 'critical' : 'soon'}`, { days: Math.abs(item.days_remaining) })}</span></>
            return <li key={`${item.employee_id}-${item.doc_type}`}>{has('employees.view') ? <Link to={`/employees/${encodeURIComponent(item.employee_id)}?tab=documents`} className={PEOPLE_ROW}>{content}</Link> : <div className={PEOPLE_ROW}>{content}</div>}</li>
          })}</ul>
          <MorePeople count={more} to="/expiry" label={t('dashboard.widgets.expiring_soon.more', { count: more })} />
        </>
      ) : (
        <>
          <Link to="/expiry" className={`${PEOPLE_LINK} flex items-baseline gap-2`}><span className={PEOPLE_BIG}>{all.length}</span><span className="text-[0.7em] text-muted-foreground">{t('dashboard.widgets.expiring_soon.within90')}</span></Link>
          <div className="flex flex-wrap gap-x-2 pt-2 text-[0.68em]"><span className="text-accent">{t('dashboard.widgets.expiring_soon.expired', { count: expired })}</span><span className="text-warning">{t('dashboard.widgets.expiring_soon.critical', { count: critical })}</span></div>
        </>
      )}
    </WidgetFrame>
  )
}
