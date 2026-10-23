import { useQuery } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { WidgetEmpty, WidgetFrame } from '@/components/dashboard/WidgetFrame'
import { api } from '@/lib/api'
import { useCapabilities } from '@/lib/useCapabilities'
import { BIG_NUMBER, INLINE_LINK, WidgetFeedback } from './recordWidgetParts'
import type { WidgetProps } from './types'

const DRAFTS_URL = '/books?mine=1&drafts=1'

export function MyDraftsWidget({ tier }: WidgetProps): React.JSX.Element {
  const { t } = useTranslation()
  const { has } = useCapabilities()
  const query = useQuery({ queryKey: ['dashboard'], queryFn: api.getDashboardSummary, staleTime: 60_000 })
  const records = query.data?.my_records
  return (
    <WidgetFrame title={t('dashboard.widgets.drafts.title')} viewAllTo={DRAFTS_URL} compact={tier === 'glance'}>
      {query.isPending || query.isError || !records ? <WidgetFeedback pending={query.isPending} retry={query.refetch} /> : <>
        <Link to={DRAFTS_URL} className={`${INLINE_LINK} ${BIG_NUMBER} w-fit shrink-0`}><bdi dir="ltr">{records.drafts}</bdi></Link>
        {records.drafts === 0 ? <WidgetEmpty message={t('dashboard.widgets.drafts.empty')} to={has('documents.generate') ? '/services' : DRAFTS_URL} action={t(has('documents.generate') ? 'dashboard.widgets.drafts.emptyAction' : 'dashboard.widgets.recordsAction')} /> : <>
          <p className="shrink-0 truncate pt-2 text-[0.75em] text-muted-foreground" title={t('dashboard.widgets.drafts.continue')}>{t('dashboard.widgets.drafts.continue')}</p>
          {tier !== 'glance' && <Link to={DRAFTS_URL} className={`${INLINE_LINK} shrink-0 truncate pt-2 text-[0.75em] text-primary`} title={t('dashboard.widgets.drafts.action')}>{t('dashboard.widgets.drafts.action')}</Link>}
        </>}
      </>}
    </WidgetFrame>
  )
}
