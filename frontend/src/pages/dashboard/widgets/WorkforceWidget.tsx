import { Link } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { WidgetFrame } from '@/components/dashboard/WidgetFrame'
import type { WidgetProps } from './types'
import { PEOPLE_BIG, PEOPLE_LINK, PeopleFeedback } from './peopleWidgetParts'
import { usePeopleSummary } from './peopleWidgetData'

export function WorkforceWidget({ tier }: WidgetProps): React.JSX.Element {
  const { t } = useTranslation()
  const query = usePeopleSummary()
  const totals = query.data?.totals
  const chips = totals ? [
    { count: totals.our_staff, key: 'ourStaff', to: '/employees?status=Active', tone: 'bg-primary' },
    { count: totals.present_today, key: 'onSite', to: '/employees?present=true', tone: 'bg-success' },
    { count: totals.loaned, key: 'loaned', to: '/employees?status=Loaned', tone: 'bg-info' },
    { count: totals.on_leave_today, key: 'onLeave', to: '/employees?on_leave=true', tone: 'bg-warning' },
  ] : []
  return (
    <WidgetFrame title={t('dashboard.widgets.workspace.title')} viewAllTo="/employees?working=true">
      {query.isPending || query.isError || !totals ? <PeopleFeedback pending={query.isPending} retry={query.refetch} /> : (
        <>
          <Link to="/employees?working=true" className={`${PEOPLE_LINK} flex items-baseline gap-2`}>
            <span className={PEOPLE_BIG}>{totals.employees_active}</span><span className="text-[0.7em] text-muted-foreground">{t('dashboard.widgets.workspace.working')}</span>
          </Link>
          {totals.employees_active === 0 ? <p className="pt-2 text-[0.72em] text-muted-foreground">{t('dashboard.widgets.workspace.empty')}</p> : (
            <div className={`flex gap-x-3 gap-y-1 pt-2 text-[0.68em] ${tier === 'tall' || tier === 'list' ? 'flex-col' : 'flex-wrap'}`}>
              {(tier === 'glance' ? chips.filter((chip) => chip.key === 'onSite') : chips).map((chip) => (
                <Link key={chip.key} to={chip.to} className={`${PEOPLE_LINK} inline-flex items-center gap-1`}>
                  <span aria-hidden className={`size-1.5 rounded-full ${chip.tone}`} /><b className="font-mono tabular-nums">{chip.count}</b>{t(`dashboard.widgets.workspace.${chip.key}`)}
                </Link>
              ))}
            </div>
          )}
        </>
      )}
    </WidgetFrame>
  )
}
