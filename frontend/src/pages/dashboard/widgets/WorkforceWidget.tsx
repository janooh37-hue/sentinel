import { Link } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { WidgetEmpty, WidgetFrame } from '@/components/dashboard/WidgetFrame'
import { siteToday } from '@/components/employees/useAttendanceAttention'
import { useCapabilities } from '@/lib/useCapabilities'
import type { WidgetProps } from './types'
import { PEOPLE_BIG, PEOPLE_LINK, PeopleFeedback } from './peopleWidgetParts'
import { usePeopleSummary } from './peopleWidgetData'

export function WorkforceWidget({ tier }: WidgetProps): React.JSX.Element {
  const { t } = useTranslation()
  const { has } = useCapabilities()
  const canViewEmployees = has('employees.view')
  const canViewLeaves = has('leaves.view')
  const query = usePeopleSummary()
  const totals = query.data?.totals
  const chips = totals ? [
    { count: totals.our_staff, key: 'ourStaff', to: canViewEmployees ? '/employees?status=Active' : undefined, tone: 'bg-primary' },
    { count: totals.present_today, key: 'onSite', to: canViewEmployees && canViewLeaves ? '/employees?present=true' : undefined, tone: 'bg-success' },
    { count: totals.loaned, key: 'loaned', to: canViewEmployees ? '/employees?status=Loaned' : undefined, tone: 'bg-info' },
    { count: totals.on_leave_today, key: 'onLeave', to: canViewLeaves ? `/leaves?status=Approved&on=${siteToday()}` : undefined, tone: 'bg-warning' },
  ] : []
  const unavailable = <><span aria-hidden>—</span><span className="sr-only">{t('dashboard.workspace.unavailable')}</span></>
  const working = <><span className={PEOPLE_BIG}>{totals?.employees_active ?? unavailable}</span><span className="text-[0.75em] text-muted-foreground">{t('dashboard.widgets.workspace.working')}</span></>
  return (
    <WidgetFrame title={t('dashboard.widgets.workspace.title')} viewAllTo={canViewEmployees ? '/employees?working=true' : undefined} compact={tier === 'glance'}>
      {query.isPending || query.isError || !totals ? <PeopleFeedback pending={query.isPending} retry={query.refetch} /> : (
        <>
          {canViewEmployees ? <Link to="/employees?working=true" className={`${PEOPLE_LINK} flex items-baseline gap-2`}>{working}</Link> : <div className="flex items-baseline gap-2">{working}</div>}
          {totals.employees_active === 0 ? <WidgetEmpty message={t('dashboard.widgets.workspace.empty')} to={canViewEmployees ? '/employees?working=true' : undefined} action={t('dashboard.widgets.workspace.emptyAction')} /> : (
            <div className={`flex gap-x-3 gap-y-1 pt-2 text-[0.75em] leading-tight ${tier === 'tall' || tier === 'list' ? 'flex-col' : 'flex-wrap'}`}>
              {(tier === 'glance' ? chips.filter((chip) => chip.key === 'onSite') : chips).map((chip) => {
                const content = <><span aria-hidden className={`size-1.5 rounded-full ${chip.tone}`} /><b className="font-mono tabular-nums">{chip.count ?? unavailable}</b>{t(`dashboard.widgets.workspace.${chip.key}`)}</>
                return chip.to ? <Link key={chip.key} to={chip.to} className={`${PEOPLE_LINK} inline-flex items-center gap-1 whitespace-nowrap`}>{content}</Link> : <span key={chip.key} className="inline-flex items-center gap-1 whitespace-nowrap">{content}</span>
              })}
            </div>
          )}
        </>
      )}
    </WidgetFrame>
  )
}
