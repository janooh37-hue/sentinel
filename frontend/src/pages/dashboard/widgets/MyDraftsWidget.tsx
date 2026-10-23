import { useQuery } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { WidgetFrame } from '@/components/dashboard/WidgetFrame'
import { api } from '@/lib/api'
import { BIG_NUMBER, INLINE_LINK, WidgetFeedback } from './recordWidgetParts'
import type { WidgetProps } from './types'

const DRAFTS_URL = '/books?mine=1&drafts=1'

// The existing Books API has no drafts filter. Do not preview an arbitrary first page.
export function MyDraftsWidget({ tier }: WidgetProps): React.JSX.Element {
  const { t } = useTranslation()
  const query = useQuery({ queryKey: ['dashboard'], queryFn: api.getDashboardSummary, staleTime: 60_000 })
  const records = query.data?.my_records
  return (
    <WidgetFrame title={t('dashboard.widgets.drafts.title')} viewAllTo={DRAFTS_URL}>
      {query.isPending || query.isError || !records ? <WidgetFeedback pending={query.isPending} retry={query.refetch} /> : <>
        <Link to={DRAFTS_URL} className={`${INLINE_LINK} ${BIG_NUMBER} w-fit shrink-0`}><bdi dir="ltr">{records.drafts}</bdi></Link>
        <p className="pt-2 text-[0.75em] text-muted-foreground">{t(records.drafts > 0 ? 'dashboard.widgets.drafts.continue' : 'dashboard.widgets.drafts.empty')}</p>
        {tier !== 'glance' && records.drafts > 0 && <Link to={DRAFTS_URL} className={`${INLINE_LINK} pt-2 text-[0.72em] text-primary`}>{t('dashboard.widgets.drafts.action')}</Link>}
      </>}
    </WidgetFrame>
  )
}
