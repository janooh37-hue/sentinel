import { useQuery } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { WidgetEmpty, WidgetFrame } from '@/components/dashboard/WidgetFrame'
import { useFitCount } from '@/components/dashboard/useFitCount'
import { api } from '@/lib/api'
import { useInboxSummary } from '@/pages/books/useInboxCount'
import { useRecordDelete } from '@/pages/books/RecordDeleteProvider'
import { BIG_NUMBER, INLINE_LINK, MoreRecords, RECORD_ROW, WidgetFeedback } from './recordWidgetParts'
import { recordAge } from './recordWidgetTime'
import type { WidgetProps } from './types'

const PURPOSES = ['action', 'info', 'reply', 'circulate'] as const
const RECEIVED_URL = '/ledger?tab=books&scope=incoming'
const SENT_URL = '/ledger?tab=books&scope=outgoing'

export function InboxWidget({ tier, rows }: WidgetProps): React.JSX.Element {
  const { t, i18n } = useTranslation()
  const isAr = i18n.language.startsWith('ar')
  const query = useInboxSummary()
  const summary = query.data
  const { pendingIds } = useRecordDelete()
  const list = tier === 'list' || tier === 'tall'
  const preview = useQuery({
    queryKey: ['books', 'dashboard-inbox', rows],
    queryFn: () => api.listBooks({ inbox: 'received', sort: '-date', limit: rows }),
    enabled: list && !!summary && summary.received > 0,
  })
  const candidates = preview.data?.items.filter((item) => !pendingIds.has(item.id)) ?? []
  const { listRef, visibleCount } = useFitCount(Math.min(candidates.length, rows))
  const visible = candidates.slice(0, visibleCount)
  return (
    <WidgetFrame title={t('dashboard.widgets.inbox.title')} viewAllTo={RECEIVED_URL} compact={tier === 'glance'}>
      {query.isPending || query.isError || !summary ? <WidgetFeedback pending={query.isPending} retry={query.refetch} /> : <>
        <Link to={RECEIVED_URL} className={`${INLINE_LINK} flex shrink-0 items-baseline gap-2`}><bdi dir="ltr" className={BIG_NUMBER}>{summary.unread}</bdi>{' '}<span className="text-[0.75em] text-muted-foreground">{t('dashboard.widgets.inbox.unread')}</span></Link>
        {tier === 'glance' ? summary.received > 0 && <p className="pt-2 text-[0.75em] text-muted-foreground">{t('dashboard.widgets.inbox.needAction', { count: summary.by_purpose.action })}</p> : <>
          {(summary.received > 0 || summary.sent > 0) && <div className="flex shrink-0 flex-wrap gap-x-3 gap-y-1 py-1 text-[0.75em] text-muted-foreground">
            <Link to={RECEIVED_URL} className={INLINE_LINK}>{t('dashboard.widgets.inbox.received')}: <bdi dir="ltr">{summary.received}</bdi></Link>
            <Link to={SENT_URL} className={INLINE_LINK}>{t('dashboard.widgets.inbox.sent')}: <bdi dir="ltr">{summary.sent}</bdi></Link>
          </div>}
          {summary.received > 0 && <ul aria-label={t('dashboard.widgets.inbox.byPurpose')} className="flex shrink-0 flex-wrap gap-x-3 gap-y-1 pb-1 text-[0.75em] text-muted-foreground">
            {PURPOSES.filter((purpose) => summary.by_purpose[purpose] > 0).map((purpose) => <li key={purpose}><Link to={RECEIVED_URL} className={INLINE_LINK}><bdi dir="ltr" className="font-mono font-semibold text-foreground">{summary.by_purpose[purpose]}</bdi> {t(`books.send.purposes.${purpose}`)}</Link></li>)}
          </ul>}
        </>}
        {summary.received === 0 ? <WidgetEmpty message={t('dashboard.widgets.inbox.empty')} to={RECEIVED_URL} action={t('dashboard.widgets.inbox.emptyAction')} /> : list && (preview.isPending || preview.isError ? <WidgetFeedback pending={preview.isPending} retry={preview.refetch} /> : <>
          <ul ref={listRef} className="min-h-0 flex-1 overflow-hidden divide-y divide-hairline">
            {visible.map((item) => <li key={item.id}><Link to={`${RECEIVED_URL}&book=${item.id}`} className={RECORD_ROW}>
              <span className="min-w-0 flex-1"><span className="block truncate" dir="auto">{item.subject || item.ref_number}</span><span className="block truncate text-muted-foreground">{t('dashboard.widgets.inbox.from', { name: (isAr ? item.my_inbox?.sent_by_name_ar || item.my_inbox?.sent_by_name : item.my_inbox?.sent_by_name) || t('dashboard.widgets.inbox.unknownSender') })}</span></span>
              <span className="max-w-24 shrink-0 text-muted-foreground">{recordAge(item.my_inbox?.sent_at || item.created_at, isAr)}</span>
            </Link></li>)}
          </ul>
          <MoreRecords count={(preview.data?.total ?? summary.received) - visible.length} to={RECEIVED_URL} labelKey="dashboard.widgets.inbox.more" />
        </>)}
      </>}
    </WidgetFrame>
  )
}
